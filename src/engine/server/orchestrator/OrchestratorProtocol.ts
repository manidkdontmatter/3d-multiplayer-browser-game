/**
 * Purpose: This file defines message shapes and command/event names used between systems, and coordinates multi-process map/server management and IPC contracts.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type { InventorySnapshot, PickupPersistencePolicy } from "../../shared/items";
import type { PlayerSettings } from "../../shared/playerSettings";
import type { RuntimeMapConfig } from "../../shared/world";

export interface PersistedPlayerSnapshot {
  accountId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  health: number;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
}

export interface ValidateJoinTicketRequest {
  joinTicket: string;
  mapInstanceId: string;
}

export interface ValidateJoinTicketResponse {
  ok: boolean;
  authKey: string | null;
  accountId?: number;
  playerSnapshot?: PersistedPlayerSnapshot | null;
  inventoryState?: InventorySnapshot | null;
  playerSettings?: PlayerSettings | null;
  transferId?: string | null;
  error?: string;
}

export interface MapRegistrationRequest {
  instanceId: string;
  mapId: string;
  wsUrl: string;
  mapConfig: RuntimeMapConfig;
  pid: number;
}

export interface MapHeartbeatRequest {
  instanceId: string;
  pid: number;
  onlinePlayers: number;
  uptimeSeconds: number;
  atMs: number;
  mapMetrics?: MapRuntimeMetricsSnapshot;
}

export interface MapRuntimeMetricsSnapshot {
  uptimeSeconds: number;
  onlinePlayers: number;
  activeNpcs: number;
  inactiveNpcs: number;
  hibernatingNpcs: number;
  activeProjectiles: number;
  pendingOfflineSnapshots: number;
  pilotedReferenceFrames: number;
  tick: {
    targetMs: number;
    lastDurationMs: number;
    meanDurationMs: number;
    stddevDurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
    worstSpikeOverTargetMs: number;
    overBudgetPercent: number;
    effectiveTps: number;
  };
  loop: {
    catchUpLoopCount: number;
    catchUpStepCount: number;
    skippedTickResyncCount: number;
  };
  net: {
    connectedPlayers: number;
    windowSeconds: number;
    avgInboundBytesPerSecond: number;
    avgOutboundBytesPerSecond: number;
    avgInboundMessagesPerSecond: number;
    avgOutboundMessagesPerSecond: number;
    p95InboundBytesPerSecond: number;
    p95OutboundBytesPerSecond: number;
    p95InboundMessagesPerSecond: number;
    p95OutboundMessagesPerSecond: number;
    warningMask: number;
  };
  commandIngress: {
    commandSetsPerSecond: number;
    inputCommandsPerSecond: number;
    peakInputCommandsPerPlayerPerSecond: number;
  };
  replication: {
    nearEntities: number;
    farEntities: number;
    totalEntities: number;
    entitiesPerPlayer: number;
    entitiesPerPlayerWindow: {
      samples: number;
      mean: number;
      p95: number;
      max: number;
    };
  };
}

export interface GenericOrchestratorResponse {
  ok: boolean;
  error?: string;
}

export interface TransferRequest {
  accountKey?: string | null;
  authKey: string | null;
  accountId: number;
  fromMapInstanceId: string;
  toMapInstanceId: string;
  playerSnapshot: PersistedPlayerSnapshot | null;
  inventoryState?: InventorySnapshot | null;
  playerSettings?: PlayerSettings | null;
}

export interface TransferResponse {
  ok: boolean;
  transferId?: string;
  wsUrl?: string;
  joinTicket?: string;
  mapConfig?: RuntimeMapConfig;
  error?: string;
}

export interface PersistSnapshotRequest {
  accountId: number;
  snapshot: PersistedPlayerSnapshot;
  saveCharacter: boolean;
  saveAbilityState: boolean;
  saveSettings?: boolean;
  settings?: PlayerSettings | null;
}

export interface PersistSnapshotBatchRequest {
  snapshots: PersistSnapshotRequest[];
}

export interface PersistCriticalEventRequest {
  eventId: string;
  instanceId: string;
  accountId: number;
  eventType: string;
  eventPayload: unknown;
  eventAtMs: number;
}

export interface PersistInventoryMutationRequest {
  accountId: number;
  instanceId: string;
  action: number;
  snapshot: InventorySnapshot;
  eventId: string;
  eventAtMs: number;
}

export interface PersistentPickupRecord {
  pickupId: number;
  definitionId: number;
  modelId: number;
  quantity: number;
  persistencePolicy: PickupPersistencePolicy;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number; w: number };
}

export interface LoadPersistentPickupsRequest {
  instanceId: string;
}

export interface LoadPersistentPickupsResponse {
  ok: boolean;
  pickups: PersistentPickupRecord[];
  error?: string;
}

export interface PersistPersistentPickupsRequest {
  instanceId: string;
  pickups: PersistentPickupRecord[];
}

export interface TransferResultRequest {
  transferId: string;
  stage: "source_released" | "aborted" | "completed";
  reason?: string;
}

