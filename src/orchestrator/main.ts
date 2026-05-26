/**
 * Purpose: This file starts this runtime entrypoint and wires the initial systems together.
 * Scope: It belongs to the multi-process map orchestration layer.
 * Human Summary: Used by process orchestration to supervise map/server processes and cross-process control flow.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  type GenericOrchestratorResponse,
  type LoadPersistentPickupsRequest,
  type LoadPersistentPickupsResponse,
  type MapHeartbeatRequest,
  type MapRuntimeMetricsSnapshot,
  type MapRegistrationRequest,
  type PersistentPickupRecord,
  type PersistPersistentPickupsRequest,
  type PersistCriticalEventRequest,
  type PersistInventoryMutationRequest,
  type PersistSnapshotBatchRequest,
  type PersistSnapshotRequest,
  type PersistedPlayerSnapshot,
  type TransferRequest,
  type TransferResultRequest,
  type TransferResponse,
  type ValidateJoinTicketRequest,
  type ValidateJoinTicketResponse
} from "../engine/server/orchestrator/OrchestratorProtocol";
import type { BootstrapRequest, BootstrapResponse } from "../engine/shared/bootstrapProtocol";
import type { InventorySnapshot } from "../engine/shared/items";
import type { PlayerSettings } from "../engine/shared/playerSettings";
import {
  type FinalizeSourceReleaseRequest,
  type OrchestratorIpcEnvelope,
  type OrchestratorIpcRequestMap,
  type ReserveIncomingTransferRequest,
  isOrchestratorIpcEnvelope
} from "../engine/server/orchestrator/OrchestratorIpcProtocol";
import { coerceRuntimeMapConfig, type RuntimeMapConfig } from "../engine/shared/world";
import { MapProcessSupervisor, type MapProcessSpec } from "./MapProcessSupervisor";
import {
  GUEST_ACCOUNT_ID_BASE,
  PersistenceService,
  type PersistedPickupState,
  type PlayerSnapshot
} from "../engine/server/persistence/PersistenceService";

interface JoinTicketRecord {
  token: string;
  accountKey: string | null;
  accountId: number;
  playerSnapshot: PlayerSnapshot | null;
  inventoryState: InventorySnapshot | null;
  playerSettings: PlayerSettings | null;
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
  destinationReservedAtMs: number | null;
  sourceReleasedAtMs: number | null;
  destinationAcceptedAtMs: number | null;
  destinationActivatedAtMs: number | null;
  completedAtMs: number | null;
  abortedAtMs: number | null;
  lastReason: string | null;
}

type PendingIpcRequest = {
  instanceId: string;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

const ORCH_PORT = Number(process.env.ORCH_PORT ?? 9000);
const ORCH_PUBLIC_WS_URL_TEMPLATE = process.env.ORCH_PUBLIC_WS_URL_TEMPLATE?.trim() ?? "";
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
const OPS_TPS_GOOD_RATIO = readPositiveEnvNumber("OPS_TPS_GOOD_RATIO", 0.98);
const OPS_TPS_WARN_RATIO = readPositiveEnvNumber("OPS_TPS_WARN_RATIO", 0.9);
const OPS_TICK_P95_GOOD_MULTIPLIER = readPositiveEnvNumber("OPS_TICK_P95_GOOD_MULTIPLIER", 1.05);
const OPS_TICK_P95_WARN_MULTIPLIER = readPositiveEnvNumber("OPS_TICK_P95_WARN_MULTIPLIER", 1.25);
const OPS_OVER_BUDGET_GOOD_PERCENT = readPositiveEnvNumber("OPS_OVER_BUDGET_GOOD_PERCENT", 2);
const OPS_OVER_BUDGET_WARN_PERCENT = readPositiveEnvNumber("OPS_OVER_BUDGET_WARN_PERCENT", 10);
const OPS_FANOUT_GOOD_P95 = readPositiveEnvNumber("OPS_FANOUT_GOOD_P95", 150);
const OPS_FANOUT_WARN_P95 = readPositiveEnvNumber("OPS_FANOUT_WARN_P95", 350);
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
    mapId: "void-transfer",
    wsPort: MAP_B_PORT,
    mapConfig: coerceRuntimeMapConfig({
      mapId: "void-transfer",
      instanceId: "map-b",
      seed: 7331,
      groundHalfExtent: 96,
      groundHalfThickness: 0.5,
      cubeCount: 0
    })
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
const mapHeartbeats = new Map<
  string,
  { atMs: number; pid: number; onlinePlayers: number; uptimeSeconds: number; mapMetrics: MapRuntimeMetricsSnapshot | null }
>();
const transferRecords = new Map<string, TransferRecord>();
const transferAbortReasonCounts = new Map<string, number>();
const pendingMapRequests = new Map<string, PendingIpcRequest>();
const supervisor = new MapProcessSupervisor({
  restartWindowMs: ORCH_MAP_RESTART_WINDOW_MS,
  restartMaxInWindow: ORCH_MAP_RESTART_MAX_IN_WINDOW,
  quarantineMs: ORCH_MAP_QUARANTINE_MS,
  onMapProcessMessage: (instanceId, message) => {
    void handleMapProcessIpcMessage(instanceId, message);
  },
  onMapProcessExit: (instanceId) => {
    mapReady.delete(instanceId);
    mapHeartbeats.delete(instanceId);
    rejectPendingRequestsForInstance(instanceId, new Error(`map process exited: ${instanceId}`));
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
  lastFlushDurationMs: 0,
  lastFlushEntryCount: 0,
  maxFlushEntryCount: 0
};
let queueGrowthLastSampleAtMs = 0;
let queueGrowthLastSampleSize = 0;
let queueGrowthRatePerMinute = 0;
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

async function handleMapProcessIpcMessage(instanceId: string, message: unknown): Promise<void> {
  if (!isOrchestratorIpcEnvelope(message)) {
    return;
  }
  const envelope = message as OrchestratorIpcEnvelope;
  if (envelope.target !== "orchestrator") {
    return;
  }
  if (envelope.messageKind === "response" && envelope.correlationId) {
    resolvePendingMapRequest(envelope);
    return;
  }
  if (envelope.messageKind === "event") {
    handleMapProcessEvent(instanceId, envelope);
    return;
  }
  if (envelope.messageKind !== "request" || !envelope.correlationId) {
    return;
  }
  try {
    const payload = await dispatchMapProcessRequest(instanceId, envelope.messageType, envelope.payload);
    sendMapProcessEnvelope(instanceId, {
      messageKind: "response",
      messageType: envelope.messageType,
      correlationId: envelope.correlationId,
      source: "orchestrator",
      target: envelope.source,
      sentAtMs: Date.now(),
      payload,
      ok: true
    });
  } catch (error) {
    sendMapProcessEnvelope(instanceId, {
      messageKind: "response",
      messageType: envelope.messageType,
      correlationId: envelope.correlationId,
      source: "orchestrator",
      target: envelope.source,
      sentAtMs: Date.now(),
      payload: {},
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function handleMapProcessEvent(instanceId: string, envelope: OrchestratorIpcEnvelope): void {
  if (envelope.messageType === "MapProcessBooted") {
    const payload = envelope.payload as MapRegistrationRequest;
    mapReady.set(instanceId, {
      wsUrl: payload.wsUrl,
      mapConfig: payload.mapConfig,
      pid: payload.pid,
      atMs: Date.now()
    });
    mapHeartbeats.set(instanceId, {
      atMs: Date.now(),
      pid: payload.pid,
      onlinePlayers: 0,
      uptimeSeconds: 0,
      mapMetrics: null
    });
    return;
  }
  if (envelope.messageType === "MapHeartbeat") {
    const payload = envelope.payload as MapHeartbeatRequest;
    mapHeartbeats.set(instanceId, {
      atMs: Date.now(),
      pid: Math.max(0, Math.floor(payload.pid)),
      onlinePlayers: Math.max(0, Math.floor(payload.onlinePlayers)),
      uptimeSeconds: Math.max(0, Math.floor(payload.uptimeSeconds)),
      mapMetrics: payload.mapMetrics ?? null
    });
    return;
  }
  if (envelope.messageType === "TransferCompleted") {
    const payload = envelope.payload as { transferId?: unknown; instanceId?: unknown };
    const transferId = typeof payload.transferId === "string" ? payload.transferId.trim() : "";
    const record = transferId.length > 0 ? transferRecords.get(transferId) : null;
    if (!record || record.completedAtMs !== null) {
      return;
    }
    const now = Date.now();
    record.destinationActivatedAtMs = record.destinationActivatedAtMs ?? now;
    record.completedAtMs = now;
    persistCriticalEvent({
      eventId: `transfer_completed:${record.transferId}`,
      instanceId: record.toMapInstanceId,
      accountId: record.accountId,
      eventType: "map_transfer_completed",
      eventPayload: {
        transferId: record.transferId,
        instanceId: typeof payload.instanceId === "string" ? payload.instanceId : record.toMapInstanceId
      },
      eventAtMs: now
    });
  }
}

async function dispatchMapProcessRequest(
  instanceId: string,
  messageType: string,
  payload: unknown
): Promise<unknown> {
  if (messageType === "ConsumeJoinTicket") {
    const typed = payload as ValidateJoinTicketRequest;
    return validateJoinTicket(typed.joinTicket, typed.mapInstanceId);
  }
  if (messageType === "RequestTransfer") {
    return handleTransferRequest(payload as TransferRequest);
  }
  if (messageType === "PersistSnapshotBatch") {
    const batch = payload as PersistSnapshotBatchRequest;
    for (const snapshot of Array.isArray(batch.snapshots) ? batch.snapshots : []) {
      enqueuePersistSnapshot(snapshot);
    }
    if (persistenceQueue.size >= 512) {
      await flushPersistenceQueue();
    }
    return { ok: true } satisfies GenericOrchestratorResponse;
  }
  if (messageType === "PersistCriticalEvent") {
    persistCriticalEvent(payload as PersistCriticalEventRequest);
    return { ok: true } satisfies GenericOrchestratorResponse;
  }
  if (messageType === "PersistInventoryMutation") {
    persistInventoryMutation(payload as PersistInventoryMutationRequest);
    return { ok: true } satisfies GenericOrchestratorResponse;
  }
  if (messageType === "LoadPersistentPickups") {
    return loadPersistentPickups(payload as LoadPersistentPickupsRequest);
  }
  if (messageType === "PersistPersistentPickups") {
    persistPersistentPickups(payload as PersistPersistentPickupsRequest);
    return { ok: true } satisfies GenericOrchestratorResponse;
  }
  throw new Error(`Unhandled map IPC request ${messageType} from ${instanceId}`);
}

function sendMapProcessEnvelope(instanceId: string, envelope: OrchestratorIpcEnvelope): void {
  const managed = supervisor.getManaged(instanceId);
  if (!managed) {
    throw new Error(`map process not found: ${instanceId}`);
  }
  managed.process.send?.(envelope);
}

function sendMapProcessRequest<K extends keyof OrchestratorIpcRequestMap>(
  instanceId: string,
  messageType: K,
  payload: OrchestratorIpcRequestMap[K]["request"],
  timeoutMs = 5000
): Promise<OrchestratorIpcRequestMap[K]["response"]> {
  const correlationId = `${instanceId}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
  const envelope: OrchestratorIpcEnvelope<OrchestratorIpcRequestMap[K]["request"]> = {
    messageKind: "request",
    messageType,
    correlationId,
    source: "orchestrator",
    target: instanceId,
    sentAtMs: Date.now(),
    payload
  };
  return new Promise<OrchestratorIpcRequestMap[K]["response"]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingMapRequests.delete(correlationId);
      reject(new Error(`map IPC request timed out: ${String(messageType)} -> ${instanceId}`));
    }, timeoutMs);
    pendingMapRequests.set(correlationId, {
      instanceId,
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout
    });
    sendMapProcessEnvelope(instanceId, envelope);
  });
}

function resolvePendingMapRequest(envelope: OrchestratorIpcEnvelope): void {
  const correlationId = envelope.correlationId;
  if (!correlationId) {
    return;
  }
  const pending = pendingMapRequests.get(correlationId);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timeout);
  pendingMapRequests.delete(correlationId);
  if (envelope.ok === false) {
    pending.reject(new Error(envelope.error ?? `map IPC request failed: ${envelope.messageType}`));
    return;
  }
  pending.resolve(envelope.payload);
}

function rejectPendingRequestsForInstance(instanceId: string, error: Error): void {
  for (const [correlationId, pending] of pendingMapRequests.entries()) {
    if (pending.instanceId !== instanceId) {
      continue;
    }
    clearTimeout(pending.timeout);
    pendingMapRequests.delete(correlationId);
    pending.reject(error);
  }
}

async function routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (method === "OPTIONS") {
    sendPreflight(res);
    return;
  }

  if (method === "GET" && url.pathname === "/metrics") {
    sendJson(res, 200, buildObservabilitySnapshot());
    return;
  }

  if (method === "GET" && url.pathname === "/ops") {
    const html = renderOpsDashboard(buildObservabilitySnapshot());
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
    return;
  }

  if (method === "POST" && url.pathname === "/bootstrap") {
    const payload = (await readJsonBody(req)) as BootstrapRequest;
    const selected = pickMapForBootstrap();
    if (!selected) {
      sendJson(res, 503, { ok: false, error: "no_ready_maps" } satisfies BootstrapResponse);
      return;
    }
    const identity = resolveIdentity(
      (typeof payload.accountKey === "string" ? payload.accountKey : payload.authKey) ?? null,
      req.socket.remoteAddress ?? "unknown"
    );
    if (!identity.ok) {
      sendJson(res, 401, { ok: false, error: identity.error } satisfies BootstrapResponse);
      return;
    }
    const playerSnapshot = loadSnapshot(identity.accountId);
    const inventoryState = loadInventorySnapshot(identity.accountId);
    const playerSettings = loadPlayerSettings(identity.accountId);
    const ticket = issueJoinTicket(identity.accountKey, identity.accountId, playerSnapshot, inventoryState, playerSettings, selected.instanceId, {
      kind: "bootstrap",
      transferId: null
    });
    sendJson(res, 200, {
      ok: true,
      wsUrl: resolveClientWsUrl(selected.instanceId, selected.wsUrl),
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
      uptimeSeconds: 0,
      mapMetrics: null
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
      uptimeSeconds: Math.max(0, Math.floor(payload.uptimeSeconds)),
      mapMetrics: payload.mapMetrics ?? null
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
    const validation = await validateJoinTicket(payload.joinTicket, payload.mapInstanceId);
    sendJson(res, validation.ok ? 200 : 401, validation);
    return;
  }

  if (method === "POST" && url.pathname === "/orch/request-transfer") {
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" } satisfies TransferResponse);
      return;
    }
    const response = await handleTransferRequest((await readJsonBody(req)) as TransferRequest);
    sendJson(res, response.ok ? 200 : 404, response);
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

  if (method === "POST" && url.pathname === "/orch/persist-snapshot-batch") {
    if (!isAuthorizedInternalRequest(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" } satisfies GenericOrchestratorResponse);
      return;
    }
    const payload = (await readJsonBody(req)) as PersistSnapshotBatchRequest;
    const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
    for (const snapshot of snapshots) {
      enqueuePersistSnapshot(snapshot);
    }
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
      incrementTransferAbortReason(record.lastReason);
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

function resolveClientWsUrl(instanceId: string, internalWsUrl: string): string {
  if (ORCH_PUBLIC_WS_URL_TEMPLATE.length === 0) {
    return internalWsUrl;
  }
  const port = extractPortFromWsUrl(internalWsUrl);
  return ORCH_PUBLIC_WS_URL_TEMPLATE
    .replaceAll("{instanceId}", encodeURIComponent(instanceId))
    .replaceAll("{port}", String(port ?? ""));
}

function extractPortFromWsUrl(wsUrl: string): number | null {
  try {
    const parsed = new URL(wsUrl);
    if (parsed.port.length > 0) {
      const numericPort = Number(parsed.port);
      if (Number.isInteger(numericPort) && numericPort > 0 && numericPort <= 65535) {
        return numericPort;
      }
    }
    if (parsed.protocol === "ws:") {
      return 80;
    }
    if (parsed.protocol === "wss:") {
      return 443;
    }
    return null;
  } catch {
    return null;
  }
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

async function handleTransferRequest(payload: TransferRequest): Promise<TransferResponse> {
  const target = await ensureMapInstanceReady(payload.toMapInstanceId);
  if (!target) {
    return { ok: false, error: "target_map_not_ready" };
  }
  const normalizedAccountId = Math.max(1, Math.floor(payload.accountId));
  const transferId = randomBytes(16).toString("hex");
  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + Math.max(500, TRANSFER_TOKEN_TTL_MS);
  const reservePayload: ReserveIncomingTransferRequest = {
    transferId,
    accountId: normalizedAccountId,
    fromMapInstanceId: payload.fromMapInstanceId,
    toMapInstanceId: payload.toMapInstanceId,
    expiresAtMs
  };
  try {
    const reserveResponse = await sendMapProcessRequest(
      payload.toMapInstanceId,
      "ReserveIncomingTransfer",
      reservePayload,
      5000
    );
    if (!reserveResponse.ok) {
      return { ok: false, error: reserveResponse.error ?? "target_map_not_ready" };
    }
  } catch {
    return { ok: false, error: "target_map_not_ready" };
  }
  if (payload.playerSnapshot && normalizedAccountId < GUEST_ACCOUNT_ID_BASE) {
    persistence.savePlayerSnapshot(toPlayerSnapshot(payload.playerSnapshot));
  }
  if (payload.inventoryState && normalizedAccountId < GUEST_ACCOUNT_ID_BASE) {
    persistence.saveInventoryState(normalizedAccountId, payload.inventoryState);
  }
  if (payload.playerSettings && normalizedAccountId < GUEST_ACCOUNT_ID_BASE) {
    persistence.savePlayerSettings(normalizedAccountId, payload.playerSettings);
  }
  transferRecords.set(transferId, {
    transferId,
    accountId: normalizedAccountId,
    fromMapInstanceId: payload.fromMapInstanceId,
    toMapInstanceId: payload.toMapInstanceId,
    issuedAtMs,
    expiresAtMs,
    destinationReservedAtMs: issuedAtMs,
    sourceReleasedAtMs: null,
    destinationAcceptedAtMs: null,
    destinationActivatedAtMs: null,
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
    typeof payload.accountKey === "string" && payload.accountKey.length > 0
      ? payload.accountKey
      : typeof payload.authKey === "string" && payload.authKey.length > 0
        ? payload.authKey
        : null,
    normalizedAccountId,
    payload.playerSnapshot ? toPlayerSnapshot(payload.playerSnapshot) : null,
    payload.inventoryState ?? null,
    payload.playerSettings ?? null,
    payload.toMapInstanceId,
    {
      kind: "transfer",
      transferId
    }
  );
  return {
    ok: true,
    transferId,
    wsUrl: resolveClientWsUrl(payload.toMapInstanceId, target.wsUrl),
    joinTicket: ticket,
    mapConfig: target.mapConfig
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

function resolveIdentity(
  accountKey: string | null,
  remoteIp: string
):
  | { ok: true; accountKey: string | null; accountId: number }
  | { ok: false; error: string } {
  if (typeof accountKey === "string" && accountKey.length > 0) {
    const auth = persistence.authenticateOrCreate(accountKey, remoteIp);
    if (!auth.ok || typeof auth.accountId !== "number") {
      return {
        ok: false,
        error: auth.code
      };
    }
    return {
      ok: true,
      accountKey,
      accountId: auth.accountId
    };
  }
  return {
    ok: true,
    accountKey: null,
    accountId: nextGuestAccountId++
  };
}

function loadSnapshot(accountId: number): PlayerSnapshot | null {
  return persistence.loadPlayerState(accountId);
}

function loadInventorySnapshot(accountId: number): InventorySnapshot | null {
  if (accountId >= GUEST_ACCOUNT_ID_BASE) {
    return null;
  }
  return persistence.loadInventoryState(accountId);
}

function loadPlayerSettings(accountId: number): PlayerSettings | null {
  if (accountId >= GUEST_ACCOUNT_ID_BASE) {
    return null;
  }
  return persistence.loadPlayerSettings(accountId);
}

function issueJoinTicket(
  accountKey: string | null,
  accountId: number,
  playerSnapshot: PlayerSnapshot | null,
  inventoryState: InventorySnapshot | null,
  playerSettings: PlayerSettings | null,
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
    accountKey,
    accountId,
    playerSnapshot,
    inventoryState,
    playerSettings,
    targetInstanceId,
    issuedAtMs,
    expiresAtMs,
    consumedAtMs: null,
    kind: meta.kind,
    transferId: meta.transferId
  });
  return token;
}

async function validateJoinTicket(joinTicket: string, mapInstanceId: string): Promise<ValidateJoinTicketResponse> {
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
        incrementTransferAbortReason(record.lastReason);
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
  if (ticket.kind === "transfer" && typeof ticket.transferId === "string" && ticket.transferId.length > 0) {
    const record = transferRecords.get(ticket.transferId);
    if (!record) {
      return { ok: false, authKey: null, error: "transfer_not_found" };
    }
    if (record.abortedAtMs !== null || record.completedAtMs !== null) {
      return { ok: false, authKey: null, error: "transfer_not_active" };
    }
    try {
      const releasePayload: FinalizeSourceReleaseRequest = {
        transferId: record.transferId,
        accountId: record.accountId,
        fromMapInstanceId: record.fromMapInstanceId,
        toMapInstanceId: record.toMapInstanceId
      };
      const releaseResponse = await sendMapProcessRequest(
        record.fromMapInstanceId,
        "FinalizeSourceRelease",
        releasePayload,
        5000
      );
      if (!releaseResponse.ok) {
        throw new Error(releaseResponse.error ?? "source_release_failed");
      }
    } catch (error) {
      record.abortedAtMs = Date.now();
      record.lastReason = "source_release_failed";
      incrementTransferAbortReason(record.lastReason);
      persistCriticalEvent({
        eventId: `transfer_aborted:${record.transferId}`,
        instanceId: record.fromMapInstanceId,
        accountId: record.accountId,
        eventType: "map_transfer_aborted",
        eventPayload: { transferId: record.transferId, reason: "source_release_failed" },
        eventAtMs: record.abortedAtMs
      });
      return { ok: false, authKey: null, error: "source_release_failed" };
    }
    if (record.sourceReleasedAtMs === null) {
      record.sourceReleasedAtMs = now;
      persistCriticalEvent({
        eventId: `transfer_source_released:${record.transferId}`,
        instanceId: record.fromMapInstanceId,
        accountId: record.accountId,
        eventType: "map_transfer_source_released",
        eventPayload: { transferId: record.transferId },
        eventAtMs: now
      });
    }
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
  }
  ticket.consumedAtMs = now;
  return {
    ok: true,
    authKey: ticket.accountKey,
    accountId: ticket.accountId,
    playerSnapshot: ticket.playerSnapshot,
    inventoryState: ticket.inventoryState,
    playerSettings: ticket.playerSettings,
    transferId: ticket.transferId
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
    secondaryMouseSlot: Math.max(0, Math.floor(Number(snapshot.secondaryMouseSlot) || 0))
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
      saveAbilityState: existing.saveAbilityState || payload.saveAbilityState,
      saveSettings: Boolean(existing.saveSettings || payload.saveSettings),
      settings: payload.settings ?? existing.settings ?? null
    });
  } else {
    persistenceQueue.set(accountId, {
      accountId,
      snapshot: payload.snapshot,
      saveCharacter: payload.saveCharacter,
      saveAbilityState: payload.saveAbilityState,
      saveSettings: Boolean(payload.saveSettings),
      settings: payload.settings ?? null
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
    persistence.savePlayerSnapshotBatch(entries.map((payload) => ({
      snapshot: toPlayerSnapshot(payload.snapshot),
      saveCharacter: payload.saveCharacter,
      saveAbilityState: payload.saveAbilityState,
      saveSettings: Boolean(payload.saveSettings),
      settings: payload.settings ?? null
    })));
    persistenceMetrics.flushed += entries.length;
    persistenceMetrics.lastFlushEntryCount = entries.length;
    if (entries.length > persistenceMetrics.maxFlushEntryCount) {
      persistenceMetrics.maxFlushEntryCount = entries.length;
    }
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
    incrementTransferAbortReason("transfer_expired");
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

function incrementTransferAbortReason(reasonRaw: string | null | undefined): void {
  const reason = typeof reasonRaw === "string" && reasonRaw.trim().length > 0 ? reasonRaw.trim() : "unknown";
  transferAbortReasonCounts.set(reason, (transferAbortReasonCounts.get(reason) ?? 0) + 1);
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

function persistInventoryMutation(payload: PersistInventoryMutationRequest): void {
  const accountId = Math.max(1, Math.floor(payload.accountId));
  if (accountId >= GUEST_ACCOUNT_ID_BASE) {
    return;
  }
  persistence.saveInventoryState(accountId, payload.snapshot);
  persistCriticalEvent({
    eventId: payload.eventId,
    instanceId: payload.instanceId,
    accountId,
    eventType: "inventory_mutation",
    eventPayload: {
      action: payload.action,
      itemCount: payload.snapshot.itemInstances.length,
      equipmentSlots: Object.keys(payload.snapshot.equipment)
    },
    eventAtMs: payload.eventAtMs
  });
}

function loadPersistentPickups(payload: LoadPersistentPickupsRequest): LoadPersistentPickupsResponse {
  const instanceId = typeof payload.instanceId === "string" ? payload.instanceId.trim() : "";
  if (instanceId.length <= 0) {
    return {
      ok: false,
      pickups: [],
      error: "instanceId required"
    };
  }
  const pickups = persistence.loadPersistentPickups(instanceId).map((pickup) => toPersistentPickupRecord(pickup));
  return {
    ok: true,
    pickups
  };
}

function persistPersistentPickups(payload: PersistPersistentPickupsRequest): void {
  const instanceId = typeof payload.instanceId === "string" ? payload.instanceId.trim() : "";
  if (instanceId.length <= 0) {
    return;
  }
  const pickups = Array.isArray(payload.pickups)
    ? payload.pickups
        .map((pickup) => toPersistedPickupState(pickup))
        .filter((pickup): pickup is PersistedPickupState => pickup !== null)
    : [];
  persistence.savePersistentPickups(instanceId, pickups);
}

function toPersistentPickupRecord(pickup: PersistedPickupState): PersistentPickupRecord {
  return {
    pickupId: pickup.pickupId,
    definitionId: pickup.definitionId,
    modelId: pickup.modelId,
    quantity: pickup.quantity,
    persistencePolicy: pickup.persistencePolicy,
    x: pickup.x,
    y: pickup.y,
    z: pickup.z,
    rotation: {
      x: pickup.rotation.x,
      y: pickup.rotation.y,
      z: pickup.rotation.z,
      w: pickup.rotation.w
    }
  };
}

function toPersistedPickupState(raw: unknown): PersistedPickupState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const pickup = raw as Partial<PersistedPickupState>;
  const rotation = pickup.rotation;
  if (!rotation || typeof rotation !== "object") {
    return null;
  }
  const pickupId = Math.max(1, Math.floor(Number(pickup.pickupId)));
  const definitionId = Math.max(1, Math.floor(Number(pickup.definitionId)));
  const modelId = Math.max(0, Math.floor(Number(pickup.modelId)));
  const quantity = Math.max(1, Math.floor(Number(pickup.quantity)));
  if (!Number.isFinite(pickupId) || !Number.isFinite(definitionId) || !Number.isFinite(modelId) || !Number.isFinite(quantity)) {
    return null;
  }
  return {
    pickupId,
    definitionId,
    modelId,
    quantity,
    persistencePolicy: pickup.persistencePolicy === "persistent" ? "persistent" : "transient_runtime",
    x: Number.isFinite(pickup.x) ? Number(pickup.x) : 0,
    y: Number.isFinite(pickup.y) ? Number(pickup.y) : 0,
    z: Number.isFinite(pickup.z) ? Number(pickup.z) : 0,
    rotation: {
      x: Number.isFinite(rotation.x) ? Number(rotation.x) : 0,
      y: Number.isFinite(rotation.y) ? Number(rotation.y) : 0,
      z: Number.isFinite(rotation.z) ? Number(rotation.z) : 0,
      w: Number.isFinite(rotation.w) ? Number(rotation.w) : 1
    }
  };
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({ error: "payload_stringify_failed" });
  }
}

function buildObservabilitySnapshot(): {
  ok: true;
  generatedAtMs: number;
  orchestrator: {
    uptimeSeconds: number;
    totalConfiguredMaps: number;
    readyMapCount: number;
    healthyMapCount: number;
    totalOnlinePlayers: number;
    activeTransfers: number;
    transferSla: {
      activeCount: number;
      completedRecentCount: number;
      abortedRecentCount: number;
      completionLatencyAvgMs: number;
      completionLatencyP95Ms: number;
      sourceReleaseLatencyAvgMs: number;
      destinationAcceptLatencyAvgMs: number;
      abortReasons: Readonly<Record<string, number>>;
    };
    mapChurn: {
      totalRestarts: number;
      quarantinedMapCount: number;
    };
    persistence: {
      queueSize: number;
      enqueued: number;
      flushed: number;
      flushErrors: number;
      flushBatches: number;
      maxQueueSize: number;
      lastFlushAtMs: number;
      lastFlushDurationMs: number;
      lastFlushEntryCount: number;
      maxFlushEntryCount: number;
      flushesPerMinute: number;
      snapshotsFlushedPerMinute: number;
      queueGrowthRatePerMinute: number;
    };
  };
  maps: Array<{
    instanceId: string;
    mapId: string;
    wsUrl: string;
    ready: boolean;
    healthy: boolean;
    pid: number | null;
    lastHeartbeatAtMs: number | null;
    quarantineUntilMs: number | null;
    restartCount: number;
    lastExitAtMs: number | null;
    mapMetrics: MapRuntimeMetricsSnapshot | null;
  }>;
} {
  const now = Date.now();
  const maps = [...mapSpecsByInstance.values()].map((spec) => {
    const heartbeat = mapHeartbeats.get(spec.instanceId);
    return {
      instanceId: spec.instanceId,
      mapId: spec.mapId,
      wsUrl: `ws://localhost:${spec.wsPort}`,
      ready: mapReady.has(spec.instanceId),
      healthy: isMapHealthy(spec.instanceId),
      pid: mapReady.get(spec.instanceId)?.pid ?? null,
      lastHeartbeatAtMs: heartbeat?.atMs ?? null,
      quarantineUntilMs: supervisor.getQuarantineUntil(spec.instanceId),
      restartCount: supervisor.getRestartCount(spec.instanceId),
      lastExitAtMs: supervisor.getLastExitAtMs(spec.instanceId),
      mapMetrics: heartbeat?.mapMetrics ?? null
    };
  });
  const totalOnlinePlayers = maps.reduce((sum, map) => sum + (map.mapMetrics?.onlinePlayers ?? 0), 0);
  const uptimeSeconds = Math.max(0, Math.floor(process.uptime()));
  if (queueGrowthLastSampleAtMs > 0) {
    const elapsedMs = now - queueGrowthLastSampleAtMs;
    if (elapsedMs > 0) {
      queueGrowthRatePerMinute = ((persistenceQueue.size - queueGrowthLastSampleSize) * 60_000) / elapsedMs;
    }
  }
  queueGrowthLastSampleAtMs = now;
  queueGrowthLastSampleSize = persistenceQueue.size;
  const completedRecent = [...transferRecords.values()].filter((record) => record.completedAtMs !== null);
  const abortedRecent = [...transferRecords.values()].filter((record) => record.abortedAtMs !== null);
  const completionLatencies = completedRecent
    .map((record) => (record.completedAtMs ?? 0) - record.issuedAtMs)
    .filter((value) => value > 0);
  const sourceReleaseLatencies = completedRecent
    .map((record) => (record.sourceReleasedAtMs ?? 0) - record.issuedAtMs)
    .filter((value) => value > 0);
  const destinationAcceptLatencies = completedRecent
    .map((record) => (record.destinationAcceptedAtMs ?? 0) - record.issuedAtMs)
    .filter((value) => value > 0);
  const totalRestarts = maps.reduce((sum, map) => sum + map.restartCount, 0);
  const quarantinedMapCount = maps.filter((map) => (map.quarantineUntilMs ?? 0) > now).length;
  const flushesPerMinute = uptimeSeconds > 0 ? (persistenceMetrics.flushBatches / uptimeSeconds) * 60 : 0;
  const snapshotsFlushedPerMinute = uptimeSeconds > 0 ? (persistenceMetrics.flushed / uptimeSeconds) * 60 : 0;
  return {
    ok: true,
    generatedAtMs: now,
    orchestrator: {
      uptimeSeconds,
      totalConfiguredMaps: maps.length,
      readyMapCount: maps.filter((map) => map.ready).length,
      healthyMapCount: maps.filter((map) => map.healthy).length,
      totalOnlinePlayers,
      activeTransfers: transferRecords.size,
      transferSla: {
        activeCount: transferRecords.size,
        completedRecentCount: completedRecent.length,
        abortedRecentCount: abortedRecent.length,
        completionLatencyAvgMs: computeAverage(completionLatencies),
        completionLatencyP95Ms: computeP95(completionLatencies),
        sourceReleaseLatencyAvgMs: computeAverage(sourceReleaseLatencies),
        destinationAcceptLatencyAvgMs: computeAverage(destinationAcceptLatencies),
        abortReasons: Object.freeze(Object.fromEntries([...transferAbortReasonCounts.entries()].sort((a, b) => b[1] - a[1])))
      },
      mapChurn: {
        totalRestarts,
        quarantinedMapCount
      },
      persistence: {
        queueSize: persistenceQueue.size,
        ...persistenceMetrics,
        flushesPerMinute,
        snapshotsFlushedPerMinute,
        queueGrowthRatePerMinute
      }
    },
    maps
  };
}

function renderOpsDashboard(snapshot: ReturnType<typeof buildObservabilitySnapshot>): string {
  const cards = snapshot.maps
    .map((map) => {
      const metrics = map.mapMetrics;
      const healthClass = map.healthy ? "ok" : "warn";
      const heartbeatIso = formatTimestampToSecond(map.lastHeartbeatAtMs);
      const tps = metrics ? metrics.tick.effectiveTps.toFixed(2) : "n/a";
      const targetTickMs = metrics ? metrics.tick.targetMs.toFixed(2) : "n/a";
      const tickMean = metrics ? metrics.tick.meanDurationMs.toFixed(2) : "n/a";
      const tickP95 = metrics ? metrics.tick.p95DurationMs.toFixed(2) : "n/a";
      const tickStddev = metrics ? metrics.tick.stddevDurationMs.toFixed(2) : "n/a";
      const tickSpike = metrics ? metrics.tick.worstSpikeOverTargetMs.toFixed(2) : "n/a";
      const netOut = metrics ? (metrics.net.avgOutboundBytesPerSecond / 1024).toFixed(2) : "n/a";
      const netIn = metrics ? (metrics.net.avgInboundBytesPerSecond / 1024).toFixed(2) : "n/a";
      const targetTps = metrics && metrics.tick.targetMs > 0 ? (1000 / metrics.tick.targetMs).toFixed(2) : "n/a";
      const quarantine = formatTimestampToSecond(map.quarantineUntilMs);
      const commandSetsPerSecond = metrics ? metrics.commandIngress.commandSetsPerSecond.toFixed(2) : "n/a";
      const inputCommandsPerSecond = metrics ? metrics.commandIngress.inputCommandsPerSecond.toFixed(2) : "n/a";
      const peakInputPerPlayerPerSecond = metrics ? metrics.commandIngress.peakInputCommandsPerPlayerPerSecond.toFixed(2) : "n/a";
      const replicationNear = metrics ? metrics.replication.nearEntities : "n/a";
      const replicationFar = metrics ? metrics.replication.farEntities : "n/a";
      const replicationWindowMean = metrics ? metrics.replication.entitiesPerPlayerWindow.mean.toFixed(2) : "n/a";
      const replicationWindowP95 = metrics ? metrics.replication.entitiesPerPlayerWindow.p95.toFixed(2) : "n/a";
      const replicationWindowMax = metrics ? metrics.replication.entitiesPerPlayerWindow.max.toFixed(2) : "n/a";
      const tpsClass = metrics ? classifyTpsHealth(metrics.tick.effectiveTps, metrics.tick.targetMs) : "metric-neutral";
      const tickP95Class = metrics ? classifyTickP95Health(metrics.tick.p95DurationMs, metrics.tick.targetMs) : "metric-neutral";
      const overBudgetClass = metrics ? classifyOverBudgetHealth(metrics.tick.overBudgetPercent) : "metric-neutral";
      const fanoutClass = metrics ? classifyFanoutHealth(metrics.replication.entitiesPerPlayerWindow.p95) : "metric-neutral";
      return `<article class="map-card">
<div class="map-card-header">
  <div class="map-id">${escapeHtml(map.instanceId)}</div>
  <div class="map-health ${healthClass}">${map.healthy ? "healthy" : "degraded"}</div>
</div>
<div class="map-subtitle">${escapeHtml(map.mapId)}</div>
<div class="map-metrics">
  <div data-tooltip="Number of currently connected players on this map process."><span>Connected Players</span><strong>${metrics?.onlinePlayers ?? 0}</strong></div>
  <div class="${tpsClass}" data-tooltip="Actual ticks per second versus target ticks per second for this map process."><span>Ticks Per Second (Actual / Target)</span><strong>${metrics ? `${tps} / ${targetTps}` : "n/a"}</strong></div>
  <div class="${tickP95Class}" data-tooltip="Tick duration average and p95 in milliseconds. Lower is better; p95 shows tail latency spikes."><span>Tick Duration Average / P95</span><strong>${metrics ? `${tickMean} / ${tickP95} ms` : "n/a"}</strong></div>
  <div data-tooltip="Tick duration standard deviation and worst spike above target tick budget, both in milliseconds."><span>Tick StdDev / Worst Spike Over Target</span><strong>${metrics ? `${tickStddev} / ${tickSpike} ms` : "n/a"}</strong></div>
  <div class="${overBudgetClass}" data-tooltip="Percent of ticks that exceeded the target tick duration budget. Lower is better."><span>Tick Over-Budget Rate</span><strong>${metrics ? `${metrics.tick.overBudgetPercent.toFixed(2)} %` : "n/a"}</strong></div>
  <div data-tooltip="NPC lifecycle counts: active (simulating), inactive (not currently active), hibernating (deep sleep state)."><span>NPC Active / Inactive / Hibernating</span><strong>${metrics ? `${metrics.activeNpcs} / ${metrics.inactiveNpcs} / ${metrics.hibernatingNpcs}` : "n/a"}</strong></div>
  <div data-tooltip="Count of active projectile entities currently simulated on this map."><span>Active Projectiles</span><strong>${metrics?.activeProjectiles ?? "n/a"}</strong></div>
  <div data-tooltip="Average outbound and inbound network throughput per player in kibibytes per second."><span>Network Throughput Outbound / Inbound (KiB/s)</span><strong>${metrics ? `${netOut} / ${netIn}` : "n/a"}</strong></div>
  <div data-tooltip="Command set rate and input command rate received by the server per second."><span>Command Sets / Input Commands Per Second</span><strong>${metrics ? `${commandSetsPerSecond} / ${inputCommandsPerSecond}` : "n/a"}</strong></div>
  <div data-tooltip="Peak observed per-player input command rate per second in this server process uptime window."><span>Peak Input Commands Per Player Per Second</span><strong>${peakInputPerPlayerPerSecond}</strong></div>
  <div data-tooltip="Registered replicated entities by spatial channel: near channel and far channel. This is registration inventory, not active per-client send count."><span>Registered Replicated Entities Near / Far</span><strong>${metrics ? `${replicationNear} / ${replicationFar}` : "n/a"}</strong></div>
  <div class="${fanoutClass}" data-tooltip="Rolling entities/player window summary: average, p95, and max. This is fanout pressure per connected player."><span>Entities/Player Rolling Average / P95 / Max</span><strong>${metrics ? `${replicationWindowMean} / ${replicationWindowP95} / ${replicationWindowMax}` : "n/a"}</strong></div>
  <div data-tooltip="Timestamp of most recent heartbeat received from this map process."><span>Last Heartbeat Timestamp</span><strong>${escapeHtml(heartbeatIso)}</strong></div>
  <div data-tooltip="Operating system process ID of this map process."><span>Process ID</span><strong>${map.pid ?? "n/a"}</strong></div>
  <div data-tooltip="How many times this map process has exited and been restarted since orchestrator boot."><span>Restart Count</span><strong>${map.restartCount}</strong></div>
  <div data-tooltip="Timestamp when this map process last exited."><span>Last Exit Timestamp</span><strong>${escapeHtml(formatTimestampToSecond(map.lastExitAtMs))}</strong></div>
  <div data-tooltip="If quarantined, map process will not be restarted until this timestamp."><span>Quarantine Until Timestamp</span><strong>${escapeHtml(quarantine)}</strong></div>
</div>
</article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Orchestrator Ops</title>
<style>
body { font-family: "Segoe UI", Tahoma, sans-serif; background: #0f1720; color: #e8eef5; margin: 0; padding: 18px; }
h1 { margin: 0 0 12px; font-size: 24px; }
.summary { display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 10px; margin-bottom: 16px; }
.card { background: #17212b; border: 1px solid #2a3a4c; border-radius: 10px; padding: 10px; position: relative; cursor: help; }
.label { color: #8ca3ba; font-size: 12px; text-transform: uppercase; }
.value { font-size: 20px; margin-top: 4px; }
.maps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.map-card { background: #121b24; border: 1px solid #2a3a4c; border-radius: 10px; padding: 12px; }
.map-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.map-id { font-size: 18px; font-weight: 600; }
.map-subtitle { color: #9cb3c9; margin-bottom: 8px; font-size: 13px; }
.map-health { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.map-metrics { display: grid; grid-template-columns: 1fr; gap: 6px; }
.map-metrics div { display: flex; flex-direction: column; background: #162230; border: 1px solid #243445; border-radius: 8px; padding: 7px; }
.map-metrics div { position: relative; cursor: help; }
.map-metrics span { color: #9cb3c9; font-size: 11px; text-transform: uppercase; }
.map-metrics strong { font-size: 13px; margin-top: 2px; }
.map-metrics div::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  width: min(360px, 80vw);
  background: linear-gradient(180deg, #1f2f43 0%, #182636 100%);
  border: 1px solid #2f4b66;
  border-radius: 8px;
  color: #d7e7f7;
  font-size: 12px;
  line-height: 1.35;
  padding: 8px 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
  z-index: 20;
}
.map-metrics div::before {
  content: "";
  position: absolute;
  left: 14px;
  bottom: calc(100% + 2px);
  border-width: 6px;
  border-style: solid;
  border-color: #2f4b66 transparent transparent transparent;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
  z-index: 21;
}
.map-metrics div:hover::after,
.map-metrics div:hover::before {
  opacity: 1;
  transform: translateY(0);
}
.card::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  width: min(360px, 80vw);
  background: linear-gradient(180deg, #1f2f43 0%, #182636 100%);
  border: 1px solid #2f4b66;
  border-radius: 8px;
  color: #d7e7f7;
  font-size: 12px;
  line-height: 1.35;
  padding: 8px 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
  z-index: 30;
}
.card::before {
  content: "";
  position: absolute;
  left: 14px;
  bottom: calc(100% + 2px);
  border-width: 6px;
  border-style: solid;
  border-color: #2f4b66 transparent transparent transparent;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
  z-index: 31;
}
.card:hover::after,
.card:hover::before {
  opacity: 1;
  transform: translateY(0);
}
.ok { color: #4ade80; }
.warn { color: #f59e0b; }
.metric-good { border-color: #1f7a3f !important; background: #113021 !important; }
.metric-warn { border-color: #946200 !important; background: #3b2c0f !important; }
.metric-bad { border-color: #8b1d2c !important; background: #3a1720 !important; }
.metric-neutral { }
</style>
</head>
<body>
<h1>Orchestrator Ops</h1>
<div class="summary">
  <div class="card" data-tooltip="Timestamp when this orchestrator metrics snapshot was generated."><div class="label">Generated</div><div class="value">${escapeHtml(formatTimestampToSecond(snapshot.generatedAtMs))}</div></div>
  <div class="card" data-tooltip="Count of healthy map processes over total configured map processes."><div class="label">Healthy Maps</div><div class="value">${snapshot.orchestrator.healthyMapCount} / ${snapshot.orchestrator.totalConfiguredMaps}</div></div>
  <div class="card" data-tooltip="Total connected players across all map processes."><div class="label">Online Players</div><div class="value">${snapshot.orchestrator.totalOnlinePlayers}</div></div>
  <div class="card" data-tooltip="Currently active transfer records tracked by orchestrator."><div class="label">Active Transfers</div><div class="value">${snapshot.orchestrator.activeTransfers}</div></div>
  <div class="card" data-tooltip="Average and p95 end-to-end transfer completion latency in milliseconds."><div class="label">Transfer Complete Avg / P95</div><div class="value">${snapshot.orchestrator.transferSla.completionLatencyAvgMs.toFixed(0)} / ${snapshot.orchestrator.transferSla.completionLatencyP95Ms.toFixed(0)} ms</div></div>
  <div class="card" data-tooltip="Total map process restarts and number currently quarantined."><div class="label">Restarts / Quarantined</div><div class="value">${snapshot.orchestrator.mapChurn.totalRestarts} / ${snapshot.orchestrator.mapChurn.quarantinedMapCount}</div></div>
  <div class="card" data-tooltip="Current pending persistence queue size in orchestrator."><div class="label">Persistence Queue</div><div class="value">${snapshot.orchestrator.persistence.queueSize}</div></div>
  <div class="card" data-tooltip="Current persistence queue growth rate per minute. Positive means backlog is growing."><div class="label">Queue Growth / Min</div><div class="value">${snapshot.orchestrator.persistence.queueGrowthRatePerMinute.toFixed(1)}</div></div>
  <div class="card" data-tooltip="How many persistence flush batches are executed per minute."><div class="label">Persistence Flushes / Min</div><div class="value">${snapshot.orchestrator.persistence.flushesPerMinute.toFixed(1)}</div></div>
  <div class="card" data-tooltip="How many player snapshots are flushed per minute by orchestrator persistence pipeline."><div class="label">Snapshots Flushed / Min</div><div class="value">${snapshot.orchestrator.persistence.snapshotsFlushedPerMinute.toFixed(1)}</div></div>
  <div class="card" data-tooltip="Most frequent transfer abort reason with occurrence count since orchestrator boot."><div class="label">Top Transfer Abort Reason</div><div class="value">${escapeHtml(formatTopAbortReason(snapshot.orchestrator.transferSla.abortReasons))}</div></div>
</div>
<section class="maps-grid">${cards}</section>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestampToSecond(timestampMs: number | null | undefined): string {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return "none";
  }
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function computeAverage(values: readonly number[]): number {
  if (values.length <= 0) {
    return 0;
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

function computeP95(values: readonly number[]): number {
  if (values.length <= 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * 0.95)));
  return sorted[index] ?? 0;
}

function formatTopAbortReason(reasons: Readonly<Record<string, number>>): string {
  const entries = Object.entries(reasons);
  if (entries.length <= 0) {
    return "none";
  }
  entries.sort((a, b) => b[1] - a[1]);
  const [reason, count] = entries[0]!;
  return `${reason} (${count})`;
}

function classifyTpsHealth(effectiveTps: number, targetTickMs: number): string {
  const targetTps = targetTickMs > 0 ? 1000 / targetTickMs : 0;
  if (!Number.isFinite(targetTps) || targetTps <= 0) {
    return "metric-neutral";
  }
  const ratio = effectiveTps / targetTps;
  if (ratio >= OPS_TPS_GOOD_RATIO) {
    return "metric-good";
  }
  if (ratio >= OPS_TPS_WARN_RATIO) {
    return "metric-warn";
  }
  return "metric-bad";
}

function classifyTickP95Health(tickP95Ms: number, targetTickMs: number): string {
  if (!Number.isFinite(targetTickMs) || targetTickMs <= 0) {
    return "metric-neutral";
  }
  if (tickP95Ms <= targetTickMs * OPS_TICK_P95_GOOD_MULTIPLIER) {
    return "metric-good";
  }
  if (tickP95Ms <= targetTickMs * OPS_TICK_P95_WARN_MULTIPLIER) {
    return "metric-warn";
  }
  return "metric-bad";
}

function classifyOverBudgetHealth(percent: number): string {
  if (percent <= OPS_OVER_BUDGET_GOOD_PERCENT) {
    return "metric-good";
  }
  if (percent <= OPS_OVER_BUDGET_WARN_PERCENT) {
    return "metric-warn";
  }
  return "metric-bad";
}

function classifyFanoutHealth(p95EntitiesPerPlayer: number): string {
  if (!Number.isFinite(p95EntitiesPerPlayer)) {
    return "metric-neutral";
  }
  if (p95EntitiesPerPlayer <= OPS_FANOUT_GOOD_P95) {
    return "metric-good";
  }
  if (p95EntitiesPerPlayer <= OPS_FANOUT_WARN_P95) {
    return "metric-warn";
  }
  return "metric-bad";
}

function readPositiveEnvNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return raw;
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


