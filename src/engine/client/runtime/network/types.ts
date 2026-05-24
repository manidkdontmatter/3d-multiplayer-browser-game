/**
 * Purpose: This file defines data/type contracts that keep connected systems compatible.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import type {
  AlertSeverity,
  AbilityDefinition,
  AbilityCreatorType,
  MovementMode,
  RuntimeMapConfig
} from "../../../shared/index";
import type { InventorySnapshot } from "../../../shared/index";
import type { PlayerSettings } from "../../../shared/index";
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
  carriedFramePid: number;
  movementMode: MovementMode;
}

export interface ReconciliationFrame {
  ack: ReconciliationAck;
  replay: PendingInput[];
}

export interface AbilityState {
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
}

export interface AbilityEventBatch {
  definitions: AbilityDefinition[];
  abilityState: AbilityState | null;
  ownedAbilityIds: number[] | null;
}

export interface NetSimulationConfig {
  enabled: boolean;
  ackDropRate: number;
  ackDelayMs: number;
  ackJitterMs: number;
}

export interface QueuedAbilityCommand {
  applyAssignment: boolean;
  assignTargetSlot: number;
  assignAbilityId: number;
  applyPrimaryMouseSlot: boolean;
  primaryMouseSlot: number;
  applySecondaryMouseSlot: boolean;
  secondaryMouseSlot: number;
  applyForgetAbility: boolean;
  forgetAbilityId: number;
}

export interface AbilityStateConsumeResult {
  abilityBatch: AbilityEventBatch | null;
  abilityUseEvents: AbilityUseEvent[];
}

export interface MapTransferInstruction {
  wsUrl: string;
  joinTicket: string;
  mapConfig: RuntimeMapConfig;
}

export type InventoryState = InventorySnapshot;

export interface SettingsState {
  settings: PlayerSettings;
}

export interface ServerAlertState {
  text: string;
  severity: AlertSeverity;
}


