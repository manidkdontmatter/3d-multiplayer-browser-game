// Shared nengi protocol schemas and typed wire contracts for client/server communication.
import { Binary, Context, defineSchema } from "nengi";

export enum NType {
  InputCommand = 1,
  BaseEntity = 2,
  IdentityMessage = 3,
  InputAckMessage = 5,
  AbilityDefinitionMessage = 8,
  AbilityStateMessage = 9,
  AbilityCommand = 11,
  AbilityUseMessage = 13,
  ServerPopulationMessage = 14,
  AbilityOwnershipMessage = 15,
  AbilityCreatorCommand = 16,
  AbilityCreatorStateMessage = 17
}

export const inputCommandSchema = defineSchema({
  sequence: Binary.UInt16,
  forward: Binary.Float32,
  strafe: Binary.Float32,
  jump: Binary.Boolean,
  sprint: Binary.Boolean,
  usePrimaryPressed: Binary.Boolean,
  usePrimaryHeld: Binary.Boolean,
  useSecondaryPressed: Binary.Boolean,
  useSecondaryHeld: Binary.Boolean,
  castSlotPressed: Binary.Boolean,
  castSlotIndex: Binary.UInt8,
  yaw: Binary.Rotation32,
  yawDelta: Binary.Float32,
  pitch: Binary.Rotation32
});

export const abilityCommandSchema = defineSchema({
  applyAssignment: Binary.Boolean,
  assignTargetSlot: Binary.UInt8,
  assignAbilityId: Binary.UInt16,
  applyPrimaryMouseSlot: Binary.Boolean,
  primaryMouseSlot: Binary.UInt8,
  applySecondaryMouseSlot: Binary.Boolean,
  secondaryMouseSlot: Binary.UInt8,
  applyForgetAbility: Binary.Boolean,
  forgetAbilityId: Binary.UInt16
});

export const abilityCreatorCommandSchema = defineSchema({
  sessionId: Binary.UInt16,
  sequence: Binary.UInt16,
  applyName: Binary.Boolean,
  abilityName: Binary.String,
  applyType: Binary.Boolean,
  abilityType: Binary.UInt8,
  applyTier: Binary.Boolean,
  tier: Binary.UInt8,
  incrementExampleStat: Binary.Boolean,
  decrementExampleStat: Binary.Boolean,
  applyExampleUpsideEnabled: Binary.Boolean,
  exampleUpsideEnabled: Binary.Boolean,
  applyExampleDownsideEnabled: Binary.Boolean,
  exampleDownsideEnabled: Binary.Boolean,
  applyTemplateAbilityId: Binary.Boolean,
  templateAbilityId: Binary.UInt16,
  submitCreate: Binary.Boolean
});

export const baseEntitySchema = defineSchema({
  modelId: Binary.UInt16,
  position: { type: Binary.Vector3, interp: true },
  rotation: { type: Binary.Quaternion, interp: true },
  grounded: Binary.Boolean,
  health: Binary.UInt8,
  maxHealth: Binary.UInt8
});

export const identityMessageSchema = defineSchema({
  playerNid: Binary.UInt16
});

export const inputAckMessageSchema = defineSchema({
  sequence: Binary.UInt16,
  serverTick: Binary.UInt32,
  x: Binary.Float32,
  y: Binary.Float32,
  z: Binary.Float32,
  vx: Binary.Float32,
  vy: Binary.Float32,
  vz: Binary.Float32,
  grounded: Binary.Boolean,
  groundedPlatformPid: Binary.Int16
});

export const abilityDefinitionMessageSchema = defineSchema({
  abilityId: Binary.UInt16,
  name: Binary.String,
  category: Binary.UInt8,
  creatorTier: Binary.UInt8,
  creatorCoreExampleStat: Binary.UInt8,
  creatorFlags: Binary.UInt8,
  pointsPower: Binary.UInt8,
  pointsVelocity: Binary.UInt8,
  pointsEfficiency: Binary.UInt8,
  pointsControl: Binary.UInt8,
  attributeMask: Binary.UInt16,
  kind: Binary.UInt8,
  speed: Binary.Float32,
  damage: Binary.Float32,
  radius: Binary.Float32,
  cooldownSeconds: Binary.Float32,
  lifetimeSeconds: Binary.Float32,
  spawnForwardOffset: Binary.Float32,
  spawnVerticalOffset: Binary.Float32,
  meleeRange: Binary.Float32,
  meleeArcDegrees: Binary.Float32
});

export const abilityStateMessageSchema = defineSchema({
  primaryMouseSlot: Binary.UInt8,
  secondaryMouseSlot: Binary.UInt8,
  slot0AbilityId: Binary.UInt16,
  slot1AbilityId: Binary.UInt16,
  slot2AbilityId: Binary.UInt16,
  slot3AbilityId: Binary.UInt16,
  slot4AbilityId: Binary.UInt16,
  slot5AbilityId: Binary.UInt16,
  slot6AbilityId: Binary.UInt16,
  slot7AbilityId: Binary.UInt16,
  slot8AbilityId: Binary.UInt16,
  slot9AbilityId: Binary.UInt16
});

export const abilityUseMessageSchema = defineSchema({
  ownerNid: Binary.UInt16,
  abilityId: Binary.UInt16,
  category: Binary.UInt8,
  serverTick: Binary.UInt32,
  x: Binary.Float32,
  y: Binary.Float32,
  z: Binary.Float32
});

export const abilityOwnershipMessageSchema = defineSchema({
  unlockedAbilityIdsCsv: Binary.String
});

export const abilityCreatorStateMessageSchema = defineSchema({
  sessionId: Binary.UInt16,
  ackSequence: Binary.UInt16,
  maxCreatorTier: Binary.UInt8,
  selectedTier: Binary.UInt8,
  selectedType: Binary.UInt8,
  abilityName: Binary.String,
  coreExampleStat: Binary.UInt8,
  exampleUpsideEnabled: Binary.Boolean,
  exampleDownsideEnabled: Binary.Boolean,
  usingTemplate: Binary.Boolean,
  templateAbilityId: Binary.UInt16,
  totalPointBudget: Binary.UInt8,
  spentPoints: Binary.UInt8,
  remainingPoints: Binary.UInt8,
  upsideSlots: Binary.UInt8,
  downsideMax: Binary.UInt8,
  usedUpsideSlots: Binary.UInt8,
  usedDownsideSlots: Binary.UInt8,
  derivedExamplePower: Binary.Float32,
  derivedExampleStability: Binary.Float32,
  derivedExampleComplexity: Binary.Float32,
  isValid: Binary.Boolean,
  validationMessage: Binary.String,
  ownedAbilityCount: Binary.UInt8
});

export const serverPopulationMessageSchema = defineSchema({
  onlinePlayers: Binary.UInt16
});

export const ncontext = new Context();
ncontext.register(NType.InputCommand, inputCommandSchema);
ncontext.register(NType.AbilityCommand, abilityCommandSchema);
ncontext.register(NType.AbilityCreatorCommand, abilityCreatorCommandSchema);
ncontext.register(NType.BaseEntity, baseEntitySchema);
ncontext.register(NType.IdentityMessage, identityMessageSchema);
ncontext.register(NType.InputAckMessage, inputAckMessageSchema);
ncontext.register(NType.AbilityDefinitionMessage, abilityDefinitionMessageSchema);
ncontext.register(NType.AbilityStateMessage, abilityStateMessageSchema);
ncontext.register(NType.AbilityUseMessage, abilityUseMessageSchema);
ncontext.register(NType.ServerPopulationMessage, serverPopulationMessageSchema);
ncontext.register(NType.AbilityOwnershipMessage, abilityOwnershipMessageSchema);
ncontext.register(NType.AbilityCreatorStateMessage, abilityCreatorStateMessageSchema);

export interface InputCommand {
  ntype: NType.InputCommand;
  sequence: number;
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
  usePrimaryPressed: boolean;
  usePrimaryHeld: boolean;
  useSecondaryPressed: boolean;
  useSecondaryHeld: boolean;
  castSlotPressed: boolean;
  castSlotIndex: number;
  yaw: number;
  yawDelta: number;
  pitch: number;
}

export interface AbilityCommand {
  ntype: NType.AbilityCommand;
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

export interface AbilityCreatorCommand {
  ntype: NType.AbilityCreatorCommand;
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

export interface BaseEntity {
  nid: number;
  ntype: NType.BaseEntity;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  health: number;
  maxHealth: number;
}

export interface IdentityMessage {
  ntype: NType.IdentityMessage;
  playerNid: number;
}

export interface InputAckMessage {
  ntype: NType.InputAckMessage;
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

export interface AbilityDefinitionMessage {
  ntype: NType.AbilityDefinitionMessage;
  abilityId: number;
  name: string;
  category: number;
  creatorTier: number;
  creatorCoreExampleStat: number;
  creatorFlags: number;
  pointsPower: number;
  pointsVelocity: number;
  pointsEfficiency: number;
  pointsControl: number;
  attributeMask: number;
  kind: number;
  speed: number;
  damage: number;
  radius: number;
  cooldownSeconds: number;
  lifetimeSeconds: number;
  spawnForwardOffset: number;
  spawnVerticalOffset: number;
  meleeRange: number;
  meleeArcDegrees: number;
}

export interface AbilityStateMessage {
  ntype: NType.AbilityStateMessage;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  slot0AbilityId: number;
  slot1AbilityId: number;
  slot2AbilityId: number;
  slot3AbilityId: number;
  slot4AbilityId: number;
  slot5AbilityId: number;
  slot6AbilityId: number;
  slot7AbilityId: number;
  slot8AbilityId: number;
  slot9AbilityId: number;
}

export interface AbilityUseMessage {
  ntype: NType.AbilityUseMessage;
  ownerNid: number;
  abilityId: number;
  category: number;
  serverTick: number;
  x: number;
  y: number;
  z: number;
}

export interface AbilityOwnershipMessage {
  ntype: NType.AbilityOwnershipMessage;
  unlockedAbilityIdsCsv: string;
}

export interface AbilityCreatorStateMessage {
  ntype: NType.AbilityCreatorStateMessage;
  sessionId: number;
  ackSequence: number;
  maxCreatorTier: number;
  selectedTier: number;
  selectedType: number;
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

export interface ServerPopulationMessage {
  ntype: NType.ServerPopulationMessage;
  onlinePlayers: number;
}
