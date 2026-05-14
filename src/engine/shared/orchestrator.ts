// Shared orchestrator and map-process contract types for join/bootstrap control-plane RPC.
import type { RuntimeMapConfig } from "./world";

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

export interface BootstrapRequest {
  authKey: string | null;
}

export interface BootstrapResponse {
  ok: boolean;
  wsUrl?: string;
  joinTicket?: string;
  mapConfig?: RuntimeMapConfig;
  error?: string;
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

export interface PersistCriticalEventRequest {
  eventId: string;
  instanceId: string;
  accountId: number;
  eventType: string;
  eventPayload: unknown;
  eventAtMs: number;
}

export interface TransferResultRequest {
  transferId: string;
  stage: "source_released" | "aborted" | "completed";
  reason?: string;
}
