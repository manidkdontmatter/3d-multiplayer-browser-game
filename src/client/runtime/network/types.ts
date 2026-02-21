import type {
  MovementInput,
  AbilityUseEvent
} from "../types";

export interface PendingInput {
  sequence: number;
  delta: number;
  movement: MovementInput;
  orientation: { yaw: number; pitch: number };
}

export interface ReconciliationAck {
  sequence: number;
  serverTick: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number;
}

export interface ReconciliationFrame {
  ack: ReconciliationAck;
  replay: PendingInput[];
}

export interface LoadoutState {
  selectedHotbarSlot: number;
  abilityIds: number[];
}

export interface AbilityEventBatch {
  definitions: import("../../../shared/index").AbilityDefinition[];
  loadout: LoadoutState | null;
}

export interface NetSimulationConfig {
  enabled: boolean;
  ackDropRate: number;
  ackDelayMs: number;
  ackJitterMs: number;
}

export interface QueuedLoadoutCommand {
  applySelectedHotbarSlot: boolean;
  selectedHotbarSlot: number;
  applyAssignment: boolean;
  assignTargetSlot: number;
  assignAbilityId: number;
}

export interface AbilityStateConsumeResult {
  abilityBatch: AbilityEventBatch | null;
  abilityUseEvents: AbilityUseEvent[];
}
