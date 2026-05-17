/**
 * Purpose: This file defines the "netcode" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
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
  MapTransferCommand = 18,
  MapTransferMessage = 19,
  LocationRootEntity = 20,
  ItemCommand = 21,
  InventoryStateMessage = 22,
  CreatorCommand = 23,
  CreatorStateMessage = 24,
  ServerNetDiagnosticsMessage = 25
}

export const inputCommandSchema = defineSchema({
  sequence: Binary.UInt16,
  forward: Binary.Float32,
  strafe: Binary.Float32,
  jump: Binary.Boolean,
  toggleFlyPressed: Binary.Boolean,
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

export const mapTransferCommandSchema = defineSchema({
  targetMapInstanceId: Binary.String
});

export const itemCommandSchema = defineSchema({
  action: Binary.UInt8,
  worldItemNid: Binary.UInt16,
  itemInstanceId: Binary.UInt32,
  quantity: Binary.UInt16,
  equipmentSlot: Binary.UInt8
});

export const baseEntitySchema = defineSchema({
  modelId: Binary.UInt16,
  position: { type: Binary.Vector3, interp: true },
  rotation: { type: Binary.Quaternion, interp: true },
  grounded: Binary.Boolean,
  movementMode: Binary.UInt8,
  health: Binary.UInt8,
  maxHealth: Binary.UInt8,
  itemArchetypeId: Binary.UInt16,
  itemQuantity: Binary.UInt16
});

export const locationRootEntitySchema = defineSchema({
  modelId: Binary.UInt16,
  locationKind: Binary.UInt8,
  locationArchetypeId: Binary.UInt16,
  locationSeed: Binary.Int32,
  locationEnvironmentId: Binary.UInt8,
  locationStreamingRadius: Binary.Float32,
  locationInfluenceRadius: Binary.Float32,
  position: { type: Binary.Vector3, interp: true },
  rotation: { type: Binary.Quaternion, interp: true }
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
  groundedPlatformPid: Binary.Int16,
  carriedFramePid: Binary.Int32,
  movementMode: Binary.UInt8
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
  unlockedAbilityIds: Binary.UInt16Array
});

export const serverPopulationMessageSchema = defineSchema({
  onlinePlayers: Binary.UInt16
});

export const mapTransferMessageSchema = defineSchema({
  wsUrl: Binary.String,
  joinTicket: Binary.String,
  mapId: Binary.String,
  instanceId: Binary.String,
  seed: Binary.Int32,
  groundHalfExtent: Binary.Float32,
  groundHalfThickness: Binary.Float32,
  cubeCount: Binary.UInt16
});

export const inventoryStateMessageSchema = defineSchema({
  inventoryJson: Binary.String
});

export const creatorCommandSchema = defineSchema({
  commandJson: Binary.String
});

export const creatorStateMessageSchema = defineSchema({
  stateJson: Binary.String
});

export const serverNetDiagnosticsMessageSchema = defineSchema({
  connectedPlayers: Binary.UInt16,
  windowSeconds: Binary.UInt8,
  avgInboundBytesPerSecond: Binary.Float32,
  avgOutboundBytesPerSecond: Binary.Float32,
  avgInboundMessagesPerSecond: Binary.Float32,
  avgOutboundMessagesPerSecond: Binary.Float32,
  p95InboundBytesPerSecond: Binary.Float32,
  p95OutboundBytesPerSecond: Binary.Float32,
  p95InboundMessagesPerSecond: Binary.Float32,
  p95OutboundMessagesPerSecond: Binary.Float32,
  warningMask: Binary.UInt8
});

export const ncontext = new Context();
ncontext.register(NType.InputCommand, inputCommandSchema);
ncontext.register(NType.AbilityCommand, abilityCommandSchema);
ncontext.register(NType.ItemCommand, itemCommandSchema);
ncontext.register(NType.BaseEntity, baseEntitySchema);
ncontext.register(NType.LocationRootEntity, locationRootEntitySchema);
ncontext.register(NType.IdentityMessage, identityMessageSchema);
ncontext.register(NType.InputAckMessage, inputAckMessageSchema);
ncontext.register(NType.AbilityDefinitionMessage, abilityDefinitionMessageSchema);
ncontext.register(NType.AbilityStateMessage, abilityStateMessageSchema);
ncontext.register(NType.AbilityUseMessage, abilityUseMessageSchema);
ncontext.register(NType.ServerPopulationMessage, serverPopulationMessageSchema);
ncontext.register(NType.AbilityOwnershipMessage, abilityOwnershipMessageSchema);
ncontext.register(NType.MapTransferCommand, mapTransferCommandSchema);
ncontext.register(NType.MapTransferMessage, mapTransferMessageSchema);
ncontext.register(NType.InventoryStateMessage, inventoryStateMessageSchema);
ncontext.register(NType.CreatorCommand, creatorCommandSchema);
ncontext.register(NType.CreatorStateMessage, creatorStateMessageSchema);
ncontext.register(NType.ServerNetDiagnosticsMessage, serverNetDiagnosticsMessageSchema);

export interface InputCommand {
  ntype: NType.InputCommand;
  sequence: number;
  forward: number;
  strafe: number;
  jump: boolean;
  toggleFlyPressed: boolean;
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

export interface MapTransferCommand {
  ntype: NType.MapTransferCommand;
  targetMapInstanceId: string;
}

export interface ItemCommand {
  ntype: NType.ItemCommand;
  action: number;
  worldItemNid: number;
  itemInstanceId: number;
  quantity: number;
  equipmentSlot: number;
}

export interface BaseEntity {
  nid: number;
  ntype: NType.BaseEntity;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  movementMode: number;
  health: number;
  maxHealth: number;
  itemArchetypeId: number;
  itemQuantity: number;
}

export interface LocationRootEntity {
  nid: number;
  ntype: NType.LocationRootEntity;
  modelId: number;
  locationKind: number;
  locationArchetypeId: number;
  locationSeed: number;
  locationEnvironmentId: number;
  locationStreamingRadius: number;
  locationInfluenceRadius: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
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
  carriedFramePid: number;
  movementMode: number;
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
  unlockedAbilityIds: number[];
}

export interface ServerPopulationMessage {
  ntype: NType.ServerPopulationMessage;
  onlinePlayers: number;
}

export interface MapTransferMessage {
  ntype: NType.MapTransferMessage;
  wsUrl: string;
  joinTicket: string;
  mapId: string;
  instanceId: string;
  seed: number;
  groundHalfExtent: number;
  groundHalfThickness: number;
  cubeCount: number;
}

export interface InventoryStateMessage {
  ntype: NType.InventoryStateMessage;
  inventoryJson: string;
}

// ── Generalized creator network messages ───────────────────────────────────────

export interface CreatorCommandWire {
  ntype: NType.CreatorCommand;
  commandJson: string;
}

export interface CreatorStateMessageWire {
  ntype: NType.CreatorStateMessage;
  stateJson: string;
}

export type CreatorCommandAction =
  | { kind: "set_name"; name: string }
  | { kind: "select_base_blueprint"; blueprintId: number }
  | { kind: "step_field"; fieldId: string; delta: number }
  | { kind: "set_field"; fieldId: string; valueJson: string }
  | { kind: "submit_create" }
  | { kind: "forget_blueprint"; blueprintId: number };

export interface CreatorCommandPayload {
  sessionId: number;
  sequence: number;
  actions: CreatorCommandAction[];
}

export interface CreatorStatePayload {
  sessionId: number;
  ackSequence: number;
  profileId: string;
  draftJson: string;
  capacityJson: string;
  validationJson: string;
  availableBlueprintCount: number;
  availableBlueprintsJson: string;
}

export interface ServerNetDiagnosticsMessage {
  ntype: NType.ServerNetDiagnosticsMessage;
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
}

export const NET_DIAGNOSTICS_WARNING_AVG_OUT_BYTES = 1 << 0;
export const NET_DIAGNOSTICS_WARNING_AVG_IN_BYTES = 1 << 1;
export const NET_DIAGNOSTICS_WARNING_AVG_OUT_MESSAGES = 1 << 2;
export const NET_DIAGNOSTICS_WARNING_AVG_IN_MESSAGES = 1 << 3;
export const NET_DIAGNOSTICS_WARNING_P95_OUT_BYTES = 1 << 4;
export const NET_DIAGNOSTICS_WARNING_P95_IN_BYTES = 1 << 5;
export const NET_DIAGNOSTICS_WARNING_P95_OUT_MESSAGES = 1 << 6;
export const NET_DIAGNOSTICS_WARNING_P95_IN_MESSAGES = 1 << 7;
