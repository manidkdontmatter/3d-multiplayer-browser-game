import { Binary, Context, defineSchema } from "nengi";

export enum NType {
  InputCommand = 1,
  BaseEntity = 2,
  IdentityMessage = 3,
  InputAckMessage = 5,
  AbilityDefinitionMessage = 8,
  LoadoutStateMessage = 9,
  LoadoutCommand = 11,
  AbilityUseMessage = 13
}

export const inputCommandSchema = defineSchema({
  sequence: Binary.UInt16,
  forward: Binary.Float32,
  strafe: Binary.Float32,
  jump: Binary.Boolean,
  sprint: Binary.Boolean,
  usePrimaryPressed: Binary.Boolean,
  usePrimaryHeld: Binary.Boolean,
  yaw: Binary.Rotation32,
  yawDelta: Binary.Float32,
  pitch: Binary.Rotation32
});

export const loadoutCommandSchema = defineSchema({
  applySelectedHotbarSlot: Binary.Boolean,
  selectedHotbarSlot: Binary.UInt8,
  applyAssignment: Binary.Boolean,
  assignTargetSlot: Binary.UInt8,
  assignAbilityId: Binary.UInt16
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
  yaw: Binary.Rotation32,
  pitch: Binary.Rotation32,
  vx: Binary.Float32,
  vy: Binary.Float32,
  vz: Binary.Float32,
  grounded: Binary.Boolean,
  groundedPlatformPid: Binary.Int16,
  platformYawDelta: Binary.Float32
});

export const abilityDefinitionMessageSchema = defineSchema({
  abilityId: Binary.UInt16,
  name: Binary.String,
  category: Binary.UInt8,
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

export const loadoutStateMessageSchema = defineSchema({
  selectedHotbarSlot: Binary.UInt8,
  slot0AbilityId: Binary.UInt16,
  slot1AbilityId: Binary.UInt16,
  slot2AbilityId: Binary.UInt16,
  slot3AbilityId: Binary.UInt16,
  slot4AbilityId: Binary.UInt16
});

export const abilityUseMessageSchema = defineSchema({
  ownerNid: Binary.UInt16,
  abilityId: Binary.UInt16,
  category: Binary.UInt8,
  serverTick: Binary.UInt32
});

export const ncontext = new Context();
ncontext.register(NType.InputCommand, inputCommandSchema);
ncontext.register(NType.LoadoutCommand, loadoutCommandSchema);
ncontext.register(NType.BaseEntity, baseEntitySchema);
ncontext.register(NType.IdentityMessage, identityMessageSchema);
ncontext.register(NType.InputAckMessage, inputAckMessageSchema);
ncontext.register(NType.AbilityDefinitionMessage, abilityDefinitionMessageSchema);
ncontext.register(NType.LoadoutStateMessage, loadoutStateMessageSchema);
ncontext.register(NType.AbilityUseMessage, abilityUseMessageSchema);

export interface InputCommand {
  ntype: NType.InputCommand;
  sequence: number;
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
  usePrimaryPressed: boolean;
  usePrimaryHeld: boolean;
  yaw: number;
  yawDelta: number;
  pitch: number;
}

export interface LoadoutCommand {
  ntype: NType.LoadoutCommand;
  applySelectedHotbarSlot: boolean;
  selectedHotbarSlot: number;
  applyAssignment: boolean;
  assignTargetSlot: number;
  assignAbilityId: number;
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
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number;
  platformYawDelta: number;
}

export interface AbilityDefinitionMessage {
  ntype: NType.AbilityDefinitionMessage;
  abilityId: number;
  name: string;
  category: number;
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

export interface LoadoutStateMessage {
  ntype: NType.LoadoutStateMessage;
  selectedHotbarSlot: number;
  slot0AbilityId: number;
  slot1AbilityId: number;
  slot2AbilityId: number;
  slot3AbilityId: number;
  slot4AbilityId: number;
}

export interface AbilityUseMessage {
  ntype: NType.AbilityUseMessage;
  ownerNid: number;
  abilityId: number;
  category: number;
  serverTick: number;
}
