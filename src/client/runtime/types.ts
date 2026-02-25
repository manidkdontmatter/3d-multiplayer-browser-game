import type { AbilityCategory } from "../../shared/index";

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
  modelId: number;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  health: number;
  maxHealth: number;
}

export interface PlatformState {
  nid: number;
  modelId: number;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number; w: number };
}

export interface ProjectileState {
  nid: number;
  modelId: number;
  x: number;
  y: number;
  z: number;
}

export interface TrainingDummyState {
  nid: number;
  modelId: number;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number; w: number };
  health: number;
  maxHealth: number;
}

export interface AbilityUseEvent {
  ownerNid: number;
  abilityId: number;
  category: AbilityCategory;
  serverTick: number;
}

export interface RenderFrameSnapshot {
  frameDeltaSeconds: number;
  localPose: PlayerPose;
  localGrounded: boolean;
  localPlayerNid: number | null;
  remotePlayers: RemotePlayerState[];
  abilityUseEvents: AbilityUseEvent[];
  platforms: PlatformState[];
  projectiles: ProjectileState[];
  trainingDummies: TrainingDummyState[];
}
