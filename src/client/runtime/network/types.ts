// Client network-layer types used by reconciliation and ability-state message handling.
import type {
  AbilityDefinition,
  AbilityCreatorType,
  MovementMode
} from "../../../shared/index";
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

export interface AbilityCreatorState {
  sessionId: number;
  ackSequence: number;
  maxCreatorTier: number;
  selectedTier: number;
  selectedType: AbilityCreatorType;
  abilityName: string;
  coreExampleStat: number;
  exampleUpsideEnabled: boolean;
  exampleDownsideEnabled: boolean;
  usingTemplate: boolean;
  templateAbilityId: number;
  totalPointBudget: number;
  spentPoints: number;
  remainingPoints: number;
  upsideSlots: number;
  downsideMax: number;
  usedUpsideSlots: number;
  usedDownsideSlots: number;
  derivedExamplePower: number;
  derivedExampleStability: number;
  derivedExampleComplexity: number;
  isValid: boolean;
  validationMessage: string;
  ownedAbilityCount: number;
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

export interface QueuedAbilityCreatorCommand {
  sessionId: number;
  sequence: number;
  applyName: boolean;
  abilityName: string;
  applyType: boolean;
  abilityType: number;
  applyTier: boolean;
  tier: number;
  incrementExampleStat: boolean;
  decrementExampleStat: boolean;
  applyExampleUpsideEnabled: boolean;
  exampleUpsideEnabled: boolean;
  applyExampleDownsideEnabled: boolean;
  exampleDownsideEnabled: boolean;
  applyTemplateAbilityId: boolean;
  templateAbilityId: number;
  submitCreate: boolean;
}

export interface AbilityStateConsumeResult {
  abilityBatch: AbilityEventBatch | null;
  abilityUseEvents: AbilityUseEvent[];
}
