// Runs local control-plane orchestration for map process supervision, auth bootstrap, transfer tickets, and single-writer persistence.
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  type BootstrapRequest,
  type BootstrapResponse,
  type GenericOrchestratorResponse,
  type MapHeartbeatRequest,
  type MapRegistrationRequest,
  type PersistCriticalEventRequest,
  type PersistSnapshotRequest,
  type PersistedPlayerSnapshot,
  type TransferRequest,
  type TransferResultRequest,
  type TransferResponse,
  type ValidateJoinTicketRequest,
  type ValidateJoinTicketResponse
} from "../shared/orchestrator";
import { coerceRuntimeMapConfig, type RuntimeMapConfig } from "../shared/world";
import { MapProcessSupervisor, type MapProcessSpec } from "./MapProcessSupervisor";
import {
  GUEST_ACCOUNT_ID_BASE,
  PersistenceService,
  type PlayerSnapshot
} from "../server/persistence/PersistenceService";

interface JoinTicketRecord {
  token: string;
  authKey: string | null;
  accountId: number;
  playerSnapshot: PlayerSnapshot | null;
  targetInstanceId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  consumedAtMs: number | null;
  kind: "bootstrap" | "transfer";
  transferId: string | null;
}

interface TransferRecord {
  transferId: string;
  accountId: number;
  fromMapInstanceId: string;
  toMapInstanceId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  sourceReleasedAtMs: number | null;
  destinationAcceptedAtMs: number | null;
  completedAtMs: number | null;
  abortedAtMs: number | null;
  lastReason: string | null;
}

const ORCH_PORT = Number(process.env.ORCH_PORT ?? 9000);
const INTERNAL_RPC_SECRET = process.env.ORCH_INTERNAL_RPC_SECRET ?? randomBytes(24).toString("hex");
const JOIN_TICKET_TTL_MS = Number(process.env.ORCH_JOIN_TICKET_TTL_MS ?? 10_000);
const TRANSFER_TOKEN_TTL_MS = Number(process.env.ORCH_TRANSFER_TOKEN_TTL_MS ?? 10_000);
const ORCH_ENABLE_DEBUG_ENDPOINTS = process.env.ORCH_ENABLE_DEBUG_ENDPOINTS === "1";
const ORCH_MAP_RESTART_WINDOW_MS = Math.max(1_000, Math.floor(Number(process.env.ORCH_MAP_RESTART_WINDOW_MS ?? 60_000)));
const ORCH_MAP_RESTART_MAX_IN_WINDOW = Math.max(1, Math.floor(Number(process.env.ORCH_MAP_RESTART_MAX_IN_WINDOW ?? 3)));
const ORCH_MAP_QUARANTINE_MS = Math.max(1_000, Math.floor(Number(process.env.ORCH_MAP_QUARANTINE_MS ?? 60_000)));
const ORCH_HEARTBEAT_TIMEOUT_MS = Math.max(1_000, Math.floor(Number(process.env.ORCH_HEARTBEAT_TIMEOUT_MS ?? 15_000)));
const MAP_DYNAMIC_PORT_BASE = Math.max(1025, Math.floor(Number(process.env.MAP_DYNAMIC_PORT_BASE ?? 9100)));
const DEFAULT_MAP_ID = process.env.ORCH_DEFAULT_MAP_ID ?? "sandbox-alpha";
const MAP_A_PORT = Number(process.env.MAP_A_PORT ?? 9001);
const MAP_B_PORT = Number(process.env.MAP_B_PORT ?? 9002);
const ORCH_PERSIST_FLUSH_MS = Math.max(100, Math.floor(Number(process.env.ORCH_PERSIST_FLUSH_MS ?? 5000)));
const persistence = new PersistenceService(process.env.ORCH_DATA_PATH ?? "./data/game.sqlite");
let nextGuestAccountId = GUEST_ACCOUNT_ID_BASE;

const defaultMapConfig = (instanceId: string, seed: number): RuntimeMapConfig => ({
  ...coerceRuntimeMapConfig({
    mapId: DEFAULT_MAP_ID,
    instanceId,
    seed
  })
});

const mapSpecs: MapProcessSpec[] = [
  {
    instanceId: "map-a",
    mapId: DEFAULT_MAP_ID,
    wsPort: MAP_A_PORT,
    mapConfig: defaultMapConfig("map-a", 1337)
  },
  {
    instanceId: "map-b",
    mapId: DEFAULT_MAP_ID,
    wsPort: MAP_B_PORT,
    mapConfig: defaultMapConfig("map-b", 7331)
  }
];
const mapSpecsByInstance = new Map<string, MapProcessSpec>();
const usedWsPorts = new Set<number>();
for (const spec of mapSpecs) {
  mapSpecsByInstance.set(spec.instanceId, spec);
  usedWsPorts.add(spec.wsPort);
}

const joinTickets = new Map<string, JoinTicketRecord>();
const mapReady = new Map<string, { wsUrl: string; mapConfig: RuntimeMapConfig; pid: number; atMs: number }>();
const mapHeartbeats = new Map<string, { atMs: number; pid: number; onlinePlayers: number; uptimeSeconds: number }>();
const transferRecords = new Map<string, TransferRecord>();
const orchestratorBaseUrl = `http://localhost:${ORCH_PORT}`;
const supervisor = new MapProcessSupervisor(orchestratorBaseUrl, INTERNAL_RPC_SECRET, {
  restartWindowMs: ORCH_MAP_RESTART_WINDOW_MS,
  restartMaxInWindow: ORCH_MAP_RESTART_MAX_IN_WINDOW,
  quarantineMs: ORCH_MAP_QUARANTINE_MS,
  onMapProcessExit: (instanceId) => {
    mapReady.delete(instanceId);
    mapHeartbeats.delete(instanceId);
  }
});
const persistenceQueue = new Map<number, PersistSnapshotRequest>();
const persistenceMetrics = {
  enqueued: 0,
  flushed: 0,
  flushErrors: 0,
  flushBatches: 0,
  maxQueueSize: 0,
  lastFlushAtMs: 0,
  lastFlushDurationMs: 0
};
let nextDynamicWsPort = MAP_DYNAMIC_PORT_BASE;

function bootstrap(): void {
  supervisor.start([...mapSpecsByInstance.values()]);
  const flushTimer = setInterval(() => {
    void flushPersistenceQueue();
    sweepExpiredTransfers();
  }, ORCH_PERSIST_FLUSH_MS);
  const server = createServer(async (req, res) => {
    try {
      await routeRequest(req, res);
    } catch (error) {
      console.error("[orchestrator] request error", error);
      sendJson(res, 500, { ok: false, error: "internal_error" } satisfies GenericOrchestratorResponse);
    }
  });
  server.listen(ORCH_PORT, () => {
    console.log(`[orchestrator] listening http://localhost:${ORCH_PORT}`);
  });

  const shutdown = (): void => {
    console.log("[orchestrator] shutdown requested");
    clearInterval(flushTimer);
    void flushPersistenceQueue().catch((error) => {
      console.error("[orchestrator] flush on shutdown failed", error);
    });
    supervisor.stopAll();
    persistence.close();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (method === "OPTIONS") {
    sendPreflight(res);
    return;
  }

  if (method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      maps: [...mapSpecsByInstance.values()].map((spec) => ({
        instanceId: spec.instanceId,
        wsUrl: `ws://localhost:${spec.wsPort}`,
        ready: mapReady.has(spec.instanceId),
        healthy: isMapHealthy(spec.instanceId),
        pid: mapReady.get(spec.instanceId)?.pid ?? null,
        lastHeartbeatAtMs: mapHeartbeats.get(spec.instanceId)?.atMs ?? null,
        quarantineUntilMs: supervisor.getQuarantineUntil(spec.instanceId)
      })),
      transfers: {
        active: transferRecords.size
      },
      persistence: {
        queueSize: persistenceQueue.size,
        ...persistenceMetrics
      }
    });
    return;
  }

  if (method === "POST" && url.pathname === "/bootstrap") {
    const payload = (await readJsonBody(req)) as BootstrapRequest;
    const selected = pickMapForBootstrap();
    if (!selected) {
      sendJson(res, 503, { ok: false, error: "no_ready_maps" } satisfies BootstrapResponse);
      return;
    }
    const identity = resolveIdentity(payload.authKey ?? null, req.socket.remoteAddress ?? "unknown");
    const playerSnapshot = loadSnapshot(identity.accountId);
    const ticket = issueJoinTicket(identity.authKey, identity.accountId, playerSnapshot, selected.instanceId, {
      kind: "bootstrap",
      transferId: null
    });
    sendJson(res, 200, {
      ok: true,
      wsUrl: selected.wsUrl,
      joinTicket: ticket,
      mapConfig: selected.mapConfig
    } satisfies BootstrapResponse);
    return;
  }

  if (method === "POST" && url.pathname === "/orch/map-ready") {
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" } satisfies GenericOrchestratorResponse);
      return;
    }
    const payload = (await readJsonBody(req)) as MapRegistrationRequest;
    mapReady.set(payload.instanceId, {
      wsUrl: payload.wsUrl,
      mapConfig: payload.mapConfig,
      pid: payload.pid,
      atMs: Date.now()
    });
    mapHeartbeats.set(payload.instanceId, {
      atMs: Date.now(),
      pid: payload.pid,
      onlinePlayers: 0,
      uptimeSeconds: 0
    });
    sendJson(res, 200, { ok: true } satisfies GenericOrchestratorResponse);
    return;
  }

  if (method === "POST" && url.pathname === "/orch/map-heartbeat") {
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" } satisfies GenericOrchestratorResponse);
      return;
    }
    const payload = (await readJsonBody(req)) as MapHeartbeatRequest;
    const instanceId = typeof payload.instanceId === "string" ? payload.instanceId.trim() : "";
    if (instanceId.length === 0) {
      sendJson(res, 400, { ok: false, error: "instance_id_required" } satisfies GenericOrchestratorResponse);
      return;
    }
    mapHeartbeats.set(instanceId, {
      atMs: Date.now(),
      pid: Math.max(0, Math.floor(payload.pid)),
      onlinePlayers: Math.max(0, Math.floor(payload.onlinePlayers)),
      uptimeSeconds: Math.max(0, Math.floor(payload.uptimeSeconds))
    });
    sendJson(res, 200, { ok: true } satisfies GenericOrchestratorResponse);
    return;
  }

  if (method === "POST" && url.pathname === "/orch/validate-join-ticket") {
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, authKey: null, error: "unauthorized" } satisfies ValidateJoinTicketResponse);
      return;
    }
    const payload = (await readJsonBody(req)) as ValidateJoinTicketRequest;
    const validation = validateJoinTicket(payload.joinTicket, payload.mapInstanceId);
    sendJson(res, validation.ok ? 200 : 401, validation);
    return;
  }

  if (method === "POST" && url.pathname === "/orch/request-transfer") {
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" } satisfies TransferResponse);
      return;
    }
    const payload = (await readJsonBody(req)) as TransferRequest;
    const target = await ensureMapInstanceReady(payload.toMapInstanceId);
    if (!target) {
      sendJson(res, 404, { ok: false, error: "target_map_not_ready" } satisfies TransferResponse);
      return;
    }
    const normalizedAccountId = Math.max(1, Math.floor(payload.accountId));
    if (payload.playerSnapshot && normalizedAccountId < GUEST_ACCOUNT_ID_BASE) {
      persistence.savePlayerSnapshot(toPlayerSnapshot(payload.playerSnapshot));
    }
    const transferId = randomBytes(16).toString("hex");
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + Math.max(500, TRANSFER_TOKEN_TTL_MS);
    transferRecords.set(transferId, {
      transferId,
      accountId: normalizedAccountId,
      fromMapInstanceId: payload.fromMapInstanceId,
      toMapInstanceId: payload.toMapInstanceId,
      issuedAtMs,
      expiresAtMs,
      sourceReleasedAtMs: null,
      destinationAcceptedAtMs: null,
      completedAtMs: null,
      abortedAtMs: null,
      lastReason: null
    });
    persistCriticalEvent({
      eventId: `transfer_requested:${transferId}`,
      instanceId: payload.fromMapInstanceId,
      accountId: normalizedAccountId,
      eventType: "map_transfer_requested",
      eventPayload: {
        transferId,
        fromMapInstanceId: payload.fromMapInstanceId,
        toMapInstanceId: payload.toMapInstanceId
      },
      eventAtMs: issuedAtMs
    });
    const ticket = issueJoinTicket(
      typeof payload.authKey === "string" && payload.authKey.length > 0 ? payload.authKey : null,
      normalizedAccountId,
      payload.playerSnapshot ? toPlayerSnapshot(payload.playerSnapshot) : null,
      payload.toMapInstanceId,
      {
        kind: "transfer",
        transferId
      }
    );
    sendJson(res, 200, {
      ok: true,
      transferId,
      wsUrl: target.wsUrl,
      joinTicket: ticket,
      mapConfig: target.mapConfig
    } satisfies TransferResponse);
    return;
  }

  if (method === "POST" && url.pathname === "/orch/persist-snapshot") {
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" } satisfies GenericOrchestratorResponse);
      return;
    }
    const payload = (await readJsonBody(req)) as PersistSnapshotRequest;
    enqueuePersistSnapshot(payload);
    if (persistenceQueue.size >= 512) {
      await flushPersistenceQueue();
    }
    sendJson(res, 200, { ok: true } satisfies GenericOrchestratorResponse);
    return;
  }

  if (method === "POST" && url.pathname === "/orch/persist-critical-event") {
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" } satisfies GenericOrchestratorResponse);
      return;
    }
    const payload = (await readJsonBody(req)) as PersistCriticalEventRequest;
    persistCriticalEvent(payload);
    sendJson(res, 200, { ok: true } satisfies GenericOrchestratorResponse);
    return;
  }

  if (method === "POST" && url.pathname === "/orch/transfer-result") {
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" } satisfies GenericOrchestratorResponse);
      return;
    }
    const payload = (await readJsonBody(req)) as TransferResultRequest;
    const transferId = typeof payload.transferId === "string" ? payload.transferId.trim() : "";
    if (transferId.length === 0) {
      sendJson(res, 400, { ok: false, error: "transfer_id_required" } satisfies GenericOrchestratorResponse);
      return;
    }
    const record = transferRecords.get(transferId);
    if (!record) {
      sendJson(res, 404, { ok: false, error: "transfer_not_found" } satisfies GenericOrchestratorResponse);
      return;
    }
    const now = Date.now();
    if (payload.stage === "source_released") {
      if (record.sourceReleasedAtMs === null) {
        record.sourceReleasedAtMs = now;
        record.lastReason = payload.reason ?? null;
        persistCriticalEvent({
          eventId: `transfer_source_released:${transferId}`,
          instanceId: record.fromMapInstanceId,
          accountId: record.accountId,
          eventType: "map_transfer_source_released",
          eventPayload: { transferId, reason: payload.reason ?? null },
          eventAtMs: now
        });
      }
      maybeCompleteTransferRecord(record, now);
      sendJson(res, 200, { ok: true } satisfies GenericOrchestratorResponse);
      return;
    }
    if (payload.stage === "completed") {
      if (record.completedAtMs === null) {
        record.completedAtMs = now;
      }
      persistCriticalEvent({
        eventId: `transfer_completed:${transferId}`,
        instanceId: record.toMapInstanceId,
        accountId: record.accountId,
        eventType: "map_transfer_completed",
        eventPayload: { transferId, reason: payload.reason ?? null },
        eventAtMs: now
      });
      sendJson(res, 200, { ok: true } satisfies GenericOrchestratorResponse);
      return;
    }
    if (record.abortedAtMs === null) {
      record.abortedAtMs = now;
      record.lastReason = payload.reason ?? "aborted";
      persistCriticalEvent({
        eventId: `transfer_aborted:${transferId}`,
        instanceId: record.fromMapInstanceId,
        accountId: record.accountId,
        eventType: "map_transfer_aborted",
        eventPayload: { transferId, reason: payload.reason ?? "aborted" },
        eventAtMs: now
      });
    }
    sendJson(res, 200, { ok: true } satisfies GenericOrchestratorResponse);
    return;
  }

  if (method === "POST" && url.pathname === "/orch/debug/crash-map") {
    if (!ORCH_ENABLE_DEBUG_ENDPOINTS) {
      sendJson(res, 404, { ok: false, error: "not_found" } satisfies GenericOrchestratorResponse);
      return;
    }
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" } satisfies GenericOrchestratorResponse);
      return;
    }
    const payload = (await readJsonBody(req)) as { instanceId?: unknown };
    const instanceId = typeof payload.instanceId === "string" ? payload.instanceId.trim() : "";
    if (instanceId.length === 0) {
      sendJson(res, 400, { ok: false, error: "instance_id_required" } satisfies GenericOrchestratorResponse);
      return;
    }
    if (!supervisor.killInstance(instanceId)) {
      sendJson(res, 404, { ok: false, error: "instance_not_found" } satisfies GenericOrchestratorResponse);
      return;
    }
    sendJson(res, 200, { ok: true } satisfies GenericOrchestratorResponse);
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" } satisfies GenericOrchestratorResponse);
}

function pickMapForBootstrap(): { instanceId: string; wsUrl: string; mapConfig: RuntimeMapConfig } | null {
  const allSpecs = [...mapSpecsByInstance.values()];
  const preferred = allSpecs.find((spec) => spec.instanceId === "map-a") ?? allSpecs[0];
  if (!preferred) {
    return null;
  }
  const preferredReady = isMapHealthy(preferred.instanceId) ? mapReady.get(preferred.instanceId) : null;
  if (preferredReady) {
    return {
      instanceId: preferred.instanceId,
      wsUrl: preferredReady.wsUrl,
      mapConfig: preferredReady.mapConfig
    };
  }
  const fallback = allSpecs.find((spec) => isMapHealthy(spec.instanceId));
  if (!fallback) {
    return null;
  }
  const ready = mapReady.get(fallback.instanceId);
  if (!ready) {
    return null;
  }
  return {
    instanceId: fallback.instanceId,
    wsUrl: ready.wsUrl,
    mapConfig: ready.mapConfig
  };
}

function isMapHealthy(instanceId: string): boolean {
  const ready = mapReady.get(instanceId);
  if (!ready) {
    return false;
  }
  const heartbeat = mapHeartbeats.get(instanceId);
  const basis = heartbeat?.atMs ?? ready.atMs;
  return Date.now() - basis <= ORCH_HEARTBEAT_TIMEOUT_MS;
}

async function ensureMapInstanceReady(instanceIdRaw: string): Promise<{ wsUrl: string; mapConfig: RuntimeMapConfig } | null> {
  const instanceId = instanceIdRaw.trim();
  if (instanceId.length === 0) {
    return null;
  }
  if (!mapSpecsByInstance.has(instanceId)) {
    const dynamicSpec: MapProcessSpec = {
      instanceId,
      mapId: DEFAULT_MAP_ID,
      wsPort: allocateDynamicWsPort(),
      mapConfig: defaultMapConfig(instanceId, deriveSeedFromInstanceId(instanceId))
    };
    mapSpecsByInstance.set(instanceId, dynamicSpec);
    usedWsPorts.add(dynamicSpec.wsPort);
  }
  if (!mapReady.has(instanceId)) {
    const spec = mapSpecsByInstance.get(instanceId);
    if (!spec) {
      return null;
    }
    const started = supervisor.startInstance(spec);
    if (!started) {
      return null;
    }
  }
  const ready = await waitForMapReady(instanceId, 10_000);
  if (!ready || !isMapHealthy(instanceId)) {
    return null;
  }
  return {
    wsUrl: ready.wsUrl,
    mapConfig: ready.mapConfig
  };
}

async function waitForMapReady(instanceId: string, timeoutMs: number): Promise<{
  wsUrl: string;
  mapConfig: RuntimeMapConfig;
  pid: number;
  atMs: number;
} | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = mapReady.get(instanceId);
    if (ready) {
      return ready;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

function allocateDynamicWsPort(): number {
  while (usedWsPorts.has(nextDynamicWsPort)) {
    nextDynamicWsPort += 1;
  }
  const selected = nextDynamicWsPort;
  usedWsPorts.add(selected);
  nextDynamicWsPort += 1;
  return selected;
}

function deriveSeedFromInstanceId(instanceId: string): number {
  let hash = 0;
  for (let i = 0; i < instanceId.length; i += 1) {
    hash = Math.imul(hash ^ instanceId.charCodeAt(i), 16777619);
  }
  return Math.abs(hash | 0) + 1;
}

function resolveIdentity(authKey: string | null, remoteIp: string): { authKey: string | null; accountId: number } {
  if (typeof authKey === "string" && authKey.length > 0) {
    const auth = persistence.authenticateOrCreate(authKey, remoteIp);
    if (auth.ok && typeof auth.accountId === "number") {
      return {
        authKey,
        accountId: auth.accountId
      };
    }
  }
  return {
    authKey: null,
    accountId: nextGuestAccountId++
  };
}

function loadSnapshot(accountId: number): PlayerSnapshot | null {
  return persistence.loadPlayerState(accountId);
}

function issueJoinTicket(
  authKey: string | null,
  accountId: number,
  playerSnapshot: PlayerSnapshot | null,
  targetInstanceId: string,
  meta: { kind: "bootstrap" | "transfer"; transferId: string | null }
): string {
  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + Math.max(500, JOIN_TICKET_TTL_MS);
  const tokenId = randomBytes(16).toString("hex");
  const payload = `${tokenId}.${targetInstanceId}.${issuedAtMs}.${expiresAtMs}`;
  const signature = signPayload(payload);
  const token = `${payload}.${signature}`;
  joinTickets.set(tokenId, {
    token,
    authKey,
    accountId,
    playerSnapshot,
    targetInstanceId,
    issuedAtMs,
    expiresAtMs,
    consumedAtMs: null,
    kind: meta.kind,
    transferId: meta.transferId
  });
  return token;
}

function validateJoinTicket(joinTicket: string, mapInstanceId: string): ValidateJoinTicketResponse {
  const parsed = parseAndVerifyTicket(joinTicket);
  if (!parsed.ok) {
    return { ok: false, authKey: null, error: parsed.error };
  }
  const ticket = joinTickets.get(parsed.tokenId);
  if (!ticket) {
    return { ok: false, authKey: null, error: "ticket_not_found" };
  }
  const now = Date.now();
  if (ticket.consumedAtMs !== null) {
    return { ok: false, authKey: null, error: "ticket_already_consumed" };
  }
  if (now > ticket.expiresAtMs) {
    if (ticket.kind === "transfer" && ticket.transferId) {
      const record = transferRecords.get(ticket.transferId);
      if (record && record.abortedAtMs === null && record.completedAtMs === null) {
        record.abortedAtMs = now;
        record.lastReason = "ticket_expired";
        persistCriticalEvent({
          eventId: `transfer_aborted:${record.transferId}`,
          instanceId: record.fromMapInstanceId,
          accountId: record.accountId,
          eventType: "map_transfer_aborted",
          eventPayload: { transferId: record.transferId, reason: "ticket_expired" },
          eventAtMs: now
        });
      }
    }
    return { ok: false, authKey: null, error: "ticket_expired" };
  }
  if (ticket.targetInstanceId !== mapInstanceId) {
    return { ok: false, authKey: null, error: "ticket_target_mismatch" };
  }
  ticket.consumedAtMs = now;
  if (ticket.kind === "transfer" && typeof ticket.transferId === "string" && ticket.transferId.length > 0) {
    const record = transferRecords.get(ticket.transferId);
    if (record) {
      if (record.destinationAcceptedAtMs === null) {
        record.destinationAcceptedAtMs = now;
        persistCriticalEvent({
          eventId: `transfer_destination_accepted:${record.transferId}`,
          instanceId: mapInstanceId,
          accountId: record.accountId,
          eventType: "map_transfer_destination_accepted",
          eventPayload: { transferId: record.transferId, mapInstanceId },
          eventAtMs: now
        });
      }
      maybeCompleteTransferRecord(record, now);
    }
  }
  return {
    ok: true,
    authKey: ticket.authKey,
    accountId: ticket.accountId,
    playerSnapshot: ticket.playerSnapshot
  };
}

function parseAndVerifyTicket(token: string): { ok: true; tokenId: string } | { ok: false; error: string } {
  const parts = token.split(".");
  if (parts.length !== 5) {
    return { ok: false, error: "ticket_malformed" };
  }
  const [tokenId, targetInstanceId, issuedAtRaw, expiresAtRaw, signature] = parts;
  if (!tokenId || !targetInstanceId || !issuedAtRaw || !expiresAtRaw || !signature) {
    return { ok: false, error: "ticket_malformed" };
  }
  const payload = `${tokenId}.${targetInstanceId}.${issuedAtRaw}.${expiresAtRaw}`;
  const expected = signPayload(payload);
  if (signature !== expected) {
    return { ok: false, error: "ticket_bad_signature" };
  }
  return { ok: true, tokenId };
}

function signPayload(payload: string): string {
  return createHmac("sha256", INTERNAL_RPC_SECRET).update(payload).digest("hex");
}

function isAuthorizedInternalRequest(req: IncomingMessage): boolean {
  const header = req.headers["x-orch-secret"];
  const secret = Array.isArray(header) ? header[0] : header;
  return typeof secret === "string" && secret.length > 0 && secret === INTERNAL_RPC_SECRET;
}

function toPlayerSnapshot(snapshot: PersistedPlayerSnapshot): PlayerSnapshot {
  return {
    accountId: Math.max(1, Math.floor(snapshot.accountId)),
    x: Number(snapshot.x) || 0,
    y: Number(snapshot.y) || 0,
    z: Number(snapshot.z) || 0,
    yaw: Number(snapshot.yaw) || 0,
    pitch: Number(snapshot.pitch) || 0,
    vx: Number(snapshot.vx) || 0,
    vy: Number(snapshot.vy) || 0,
    vz: Number(snapshot.vz) || 0,
    health: Math.max(0, Math.floor(Number(snapshot.health) || 0)),
    primaryMouseSlot: Math.max(0, Math.floor(Number(snapshot.primaryMouseSlot) || 0)),
    secondaryMouseSlot: Math.max(0, Math.floor(Number(snapshot.secondaryMouseSlot) || 0)),
    hotbarAbilityIds: Array.isArray(snapshot.hotbarAbilityIds)
      ? snapshot.hotbarAbilityIds.map((abilityId) =>
          Math.max(0, Math.floor(Number.isFinite(abilityId) ? abilityId : 0))
        )
      : []
  };
}

function enqueuePersistSnapshot(payload: PersistSnapshotRequest): void {
  const accountId = Math.max(1, Math.floor(payload.accountId));
  if (accountId >= GUEST_ACCOUNT_ID_BASE) {
    return;
  }
  const existing = persistenceQueue.get(accountId);
  if (existing) {
    persistenceQueue.set(accountId, {
      accountId,
      snapshot: payload.snapshot,
      saveCharacter: existing.saveCharacter || payload.saveCharacter,
      saveAbilityState: existing.saveAbilityState || payload.saveAbilityState
    });
  } else {
    persistenceQueue.set(accountId, {
      accountId,
      snapshot: payload.snapshot,
      saveCharacter: payload.saveCharacter,
      saveAbilityState: payload.saveAbilityState
    });
  }
  persistenceMetrics.enqueued += 1;
  if (persistenceQueue.size > persistenceMetrics.maxQueueSize) {
    persistenceMetrics.maxQueueSize = persistenceQueue.size;
  }
}

async function flushPersistenceQueue(): Promise<void> {
  if (persistenceQueue.size === 0) {
    return;
  }
  const start = Date.now();
  const entries = [...persistenceQueue.values()];
  persistenceQueue.clear();
  persistenceMetrics.flushBatches += 1;
  try {
    for (const payload of entries) {
      const snapshot = toPlayerSnapshot(payload.snapshot);
      if (payload.saveCharacter && payload.saveAbilityState) {
        persistence.savePlayerSnapshot(snapshot);
      } else if (payload.saveCharacter) {
        persistence.saveCharacterSnapshot(snapshot);
      } else if (payload.saveAbilityState) {
        persistence.saveAbilityStateSnapshot(snapshot);
      }
    }
    persistenceMetrics.flushed += entries.length;
  } catch (error) {
    persistenceMetrics.flushErrors += 1;
    for (const payload of entries) {
      enqueuePersistSnapshot(payload);
    }
    throw error;
  } finally {
    persistenceMetrics.lastFlushAtMs = Date.now();
    persistenceMetrics.lastFlushDurationMs = Date.now() - start;
  }
}

function maybeCompleteTransferRecord(record: TransferRecord, atMs: number): void {
  if (record.completedAtMs !== null || record.abortedAtMs !== null) {
    return;
  }
  if (record.sourceReleasedAtMs === null || record.destinationAcceptedAtMs === null) {
    return;
  }
  record.completedAtMs = atMs;
  persistCriticalEvent({
    eventId: `transfer_completed:${record.transferId}`,
    instanceId: record.toMapInstanceId,
    accountId: record.accountId,
    eventType: "map_transfer_completed",
    eventPayload: {
      transferId: record.transferId,
      sourceReleasedAtMs: record.sourceReleasedAtMs,
      destinationAcceptedAtMs: record.destinationAcceptedAtMs
    },
    eventAtMs: atMs
  });
}

function sweepExpiredTransfers(): void {
  const now = Date.now();
  for (const record of transferRecords.values()) {
    if (record.completedAtMs !== null || record.abortedAtMs !== null) {
      continue;
    }
    if (now <= record.expiresAtMs) {
      continue;
    }
    record.abortedAtMs = now;
    record.lastReason = "transfer_expired";
    persistCriticalEvent({
      eventId: `transfer_aborted:${record.transferId}`,
      instanceId: record.fromMapInstanceId,
      accountId: record.accountId,
      eventType: "map_transfer_aborted",
      eventPayload: {
        transferId: record.transferId,
        reason: "transfer_expired"
      },
      eventAtMs: now
    });
  }
  for (const [transferId, record] of transferRecords.entries()) {
    const terminalAtMs = record.completedAtMs ?? record.abortedAtMs;
    if (terminalAtMs === null) {
      continue;
    }
    if (now - terminalAtMs < 60_000) {
      continue;
    }
    transferRecords.delete(transferId);
  }
}

function persistCriticalEvent(payload: PersistCriticalEventRequest): void {
  const eventId = typeof payload.eventId === "string" ? payload.eventId : "";
  if (eventId.length === 0) {
    return;
  }
  const instanceId =
    typeof payload.instanceId === "string" && payload.instanceId.length > 0
      ? payload.instanceId
      : "unknown";
  const eventType =
    typeof payload.eventType === "string" && payload.eventType.length > 0
      ? payload.eventType
      : "unknown";
  const eventPayloadJson = safeJsonStringify(payload.eventPayload ?? {});
  persistence.saveCriticalEvent({
    eventId,
    instanceId,
    accountId: Math.max(1, Math.floor(payload.accountId)),
    eventType,
    eventPayloadJson,
    eventAtMs: Math.max(0, Math.floor(payload.eventAtMs))
  });
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({ error: "payload_stringify_failed" });
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (body.length === 0) {
    return {};
  }
  return JSON.parse(body) as unknown;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const json = JSON.stringify(payload);
  res.statusCode = statusCode;
  applyCorsHeaders(res);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(json);
}

function sendPreflight(res: ServerResponse): void {
  res.statusCode = 204;
  applyCorsHeaders(res);
  res.end();
}

function applyCorsHeaders(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-orch-secret");
}

bootstrap();
