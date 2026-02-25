// Runs local control-plane orchestration for map process supervision, auth bootstrap, transfer tickets, and single-writer persistence.
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  type BootstrapRequest,
  type BootstrapResponse,
  type GenericOrchestratorResponse,
  type MapRegistrationRequest,
  type PersistSnapshotRequest,
  type PersistedPlayerSnapshot,
  type TransferRequest,
  type TransferResponse,
  type ValidateJoinTicketRequest,
  type ValidateJoinTicketResponse
} from "../shared/orchestrator";
import type { RuntimeMapConfig } from "../shared/world";
import { MapProcessSupervisor, type MapProcessSpec } from "./MapProcessSupervisor";
import { GUEST_ACCOUNT_ID_BASE, PersistenceService, type PlayerSnapshot } from "../server/persistence/PersistenceService";

interface JoinTicketRecord {
  token: string;
  authKey: string | null;
  accountId: number;
  playerSnapshot: PlayerSnapshot | null;
  targetInstanceId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  consumedAtMs: number | null;
}

const ORCH_PORT = Number(process.env.ORCH_PORT ?? 9000);
const INTERNAL_RPC_SECRET = process.env.ORCH_INTERNAL_RPC_SECRET ?? randomBytes(24).toString("hex");
const JOIN_TICKET_TTL_MS = Number(process.env.ORCH_JOIN_TICKET_TTL_MS ?? 10_000);
const DEFAULT_MAP_ID = process.env.ORCH_DEFAULT_MAP_ID ?? "sandbox-alpha";
const MAP_A_PORT = Number(process.env.MAP_A_PORT ?? 9001);
const MAP_B_PORT = Number(process.env.MAP_B_PORT ?? 9002);
const ORCH_PERSIST_FLUSH_MS = Math.max(100, Math.floor(Number(process.env.ORCH_PERSIST_FLUSH_MS ?? 5000)));
const persistence = new PersistenceService(process.env.ORCH_DATA_PATH ?? "./data/game.sqlite");
let nextGuestAccountId = GUEST_ACCOUNT_ID_BASE;

const defaultMapConfig = (instanceId: string, seed: number): RuntimeMapConfig => ({
  mapId: DEFAULT_MAP_ID,
  instanceId,
  seed,
  groundHalfExtent: 192,
  groundHalfThickness: 0.5,
  cubeCount: 280
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

const joinTickets = new Map<string, JoinTicketRecord>();
const mapReady = new Map<string, { wsUrl: string; mapConfig: RuntimeMapConfig; pid: number; atMs: number }>();
const orchestratorBaseUrl = `http://localhost:${ORCH_PORT}`;
const supervisor = new MapProcessSupervisor(orchestratorBaseUrl, INTERNAL_RPC_SECRET);
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

function bootstrap(): void {
  supervisor.start(mapSpecs);
  const flushTimer = setInterval(() => {
    void flushPersistenceQueue();
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
      maps: mapSpecs.map((spec) => ({
        instanceId: spec.instanceId,
        wsUrl: `ws://localhost:${spec.wsPort}`,
        ready: mapReady.has(spec.instanceId)
      })),
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
    const ticket = issueJoinTicket(identity.authKey, identity.accountId, playerSnapshot, selected.instanceId);
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
    const target = mapReady.get(payload.toMapInstanceId);
    if (!target) {
      sendJson(res, 404, { ok: false, error: "target_map_not_ready" } satisfies TransferResponse);
      return;
    }
    const normalizedAccountId = Math.max(1, Math.floor(payload.accountId));
    if (payload.playerSnapshot && normalizedAccountId < GUEST_ACCOUNT_ID_BASE) {
      persistence.savePlayerSnapshot(toPlayerSnapshot(payload.playerSnapshot));
    }
    const ticket = issueJoinTicket(
      typeof payload.authKey === "string" && payload.authKey.length > 0 ? payload.authKey : null,
      normalizedAccountId,
      payload.playerSnapshot ? toPlayerSnapshot(payload.playerSnapshot) : null,
      payload.toMapInstanceId
    );
    sendJson(res, 200, {
      ok: true,
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

  sendJson(res, 404, { ok: false, error: "not_found" } satisfies GenericOrchestratorResponse);
}

function pickMapForBootstrap(): { instanceId: string; wsUrl: string; mapConfig: RuntimeMapConfig } | null {
  const preferred = mapSpecs.find((spec) => spec.instanceId === "map-a") ?? mapSpecs[0];
  if (!preferred) {
    return null;
  }
  const preferredReady = mapReady.get(preferred.instanceId);
  if (preferredReady) {
    return {
      instanceId: preferred.instanceId,
      wsUrl: preferredReady.wsUrl,
      mapConfig: preferredReady.mapConfig
    };
  }
  const fallback = mapSpecs.find((spec) => mapReady.has(spec.instanceId));
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
  targetInstanceId: string
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
    consumedAtMs: null
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
    return { ok: false, authKey: null, error: "ticket_expired" };
  }
  if (ticket.targetInstanceId !== mapInstanceId) {
    return { ok: false, authKey: null, error: "ticket_target_mismatch" };
  }
  ticket.consumedAtMs = now;
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
