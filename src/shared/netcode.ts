import { Binary, Context, defineSchema } from "nengi";

export enum NType {
  InputCommand = 1,
  PlayerEntity = 2,
  IdentityMessage = 3,
  PlatformEntity = 4,
  InputAckMessage = 5,
  ProjectileEntity = 6
}

export const inputCommandSchema = defineSchema({
  sequence: Binary.UInt16,
  forward: Binary.Float32,
  strafe: Binary.Float32,
  jump: Binary.Boolean,
  sprint: Binary.Boolean,
  usePrimaryPressed: Binary.Boolean,
  activeHotbarSlot: Binary.UInt8,
  selectedAbilityId: Binary.UInt16,
  yawDelta: Binary.Float32,
  pitch: Binary.Rotation32,
  delta: Binary.Float32
});

export const playerEntitySchema = defineSchema({
  x: { type: Binary.Float32, interp: true },
  y: { type: Binary.Float32, interp: true },
  z: { type: Binary.Float32, interp: true },
  yaw: { type: Binary.Rotation32, interp: true },
  pitch: { type: Binary.Rotation32, interp: true },
  serverTick: Binary.UInt32,
  grounded: Binary.Boolean,
  health: Binary.UInt8,
  upperBodyAction: Binary.UInt8,
  upperBodyActionNonce: Binary.UInt16
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

export const platformEntitySchema = defineSchema({
  pid: Binary.UInt16,
  kind: Binary.UInt8,
  x: { type: Binary.Float32, interp: true },
  y: { type: Binary.Float32, interp: true },
  z: { type: Binary.Float32, interp: true },
  yaw: { type: Binary.Rotation32, interp: true },
  serverTick: Binary.UInt32,
  halfX: Binary.Float32,
  halfY: Binary.Float32,
  halfZ: Binary.Float32
});

export const projectileEntitySchema = defineSchema({
  ownerNid: Binary.UInt16,
  kind: Binary.UInt8,
  x: { type: Binary.Float32, interp: true },
  y: { type: Binary.Float32, interp: true },
  z: { type: Binary.Float32, interp: true },
  serverTick: Binary.UInt32
});

export const ncontext = new Context();
ncontext.register(NType.InputCommand, inputCommandSchema);
ncontext.register(NType.PlayerEntity, playerEntitySchema);
ncontext.register(NType.IdentityMessage, identityMessageSchema);
ncontext.register(NType.PlatformEntity, platformEntitySchema);
ncontext.register(NType.InputAckMessage, inputAckMessageSchema);
ncontext.register(NType.ProjectileEntity, projectileEntitySchema);

export interface InputCommand {
  ntype: NType.InputCommand;
  sequence: number;
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
  usePrimaryPressed: boolean;
  activeHotbarSlot: number;
  selectedAbilityId: number;
  yawDelta: number;
  pitch: number;
  delta: number;
}

export interface PlayerEntity {
  nid: number;
  ntype: NType.PlayerEntity;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  serverTick: number;
  grounded: boolean;
  health: number;
  upperBodyAction: number;
  upperBodyActionNonce: number;
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

export interface PlatformEntity {
  nid: number;
  ntype: NType.PlatformEntity;
  pid: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  serverTick: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}

export interface ProjectileEntity {
  nid: number;
  ntype: NType.ProjectileEntity;
  ownerNid: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  serverTick: number;
}
