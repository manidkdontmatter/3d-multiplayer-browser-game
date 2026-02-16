export interface MovementInput {
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
}

export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface RemotePlayerState {
  nid: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  serverTick: number;
  grounded: boolean;
  health: number;
}

export interface PlatformState {
  nid: number;
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

export interface ProjectileState {
  nid: number;
  ownerNid: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  serverTick: number;
}

export interface TrainingDummyState {
  nid: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  serverTick: number;
  health: number;
  maxHealth: number;
}

export interface AbilityUseEvent {
  ownerNid: number;
  abilityId: number;
  category: "projectile" | "melee" | "passive";
  serverTick: number;
}
