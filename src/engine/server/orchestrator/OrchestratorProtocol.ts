// Server-side orchestrator and map-process contract types for control-plane RPC and persistence.
import type { InventoryStateSnapshot } from "../../shared/items";
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
  inventoryState?: InventoryStateSnapshot | null;
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
}

export interface GenericOrchestratorResponse {
  ok: boolean;
  error?: string;
}

export interface TransferRequest {
  authKey: string | null;
  accountId: number;
  fromMapInstanceId: string;
  toMapInstanceId: string;
  playerSnapshot: PersistedPlayerSnapshot | null;
  inventoryState?: InventoryStateSnapshot | null;
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
  snapshot: InventoryStateSnapshot;
  eventId: string;
  eventAtMs: number;
}

export interface TransferResultRequest {
  transferId: string;
  stage: "source_released" | "aborted" | "completed";
  reason?: string;
}
