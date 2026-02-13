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
}

export interface PlatformState {
  nid: number;
  pid: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}
