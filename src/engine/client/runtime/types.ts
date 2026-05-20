/**
 * Purpose: This file defines data/type contracts that keep connected systems compatible.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import type { MovementMode } from "../../shared/index";
import type { AbilityCategory } from "../../shared/index";
import type { PickupState } from "../../shared/index";

export interface MovementInput {
  forward: number;
  strafe: number;
  jump: boolean;
  toggleFlyPressed: boolean;
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
  movementMode: MovementMode;
  health: number;
  maxHealth: number;
}

export interface LocationRootState {
  nid: number;
  modelId: number;
  locationPid: number;
  locationKind: number;
  locationArchetypeId: number;
  locationSeed: number;
  locationEnvironmentId: number;
  locationStreamingRadius: number;
  locationInfluenceRadius: number;
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

export interface WorldEntityState {
  nid: number;
  modelId: number;
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  rotationW: number;
  health: number;
  maxHealth: number;
  pickupDefinitionId: number;
  itemQuantity: number;
}

export interface AbilityUseEvent {
  ownerNid: number;
  abilityId: number;
  category: AbilityCategory;
  serverTick: number;
}

export interface RenderFrameSnapshot {
  frameDeltaSeconds: number;
  renderServerTimeSeconds: number;
  localPose: PlayerPose;
  localGrounded: boolean;
  localMovementMode: MovementMode;
  localPlayerNid: number | null;
  remotePlayers: RemotePlayerState[];
  abilityUseEvents: AbilityUseEvent[];
  locationRoots: LocationRootState[];
  worldEntities: WorldEntityState[];
  projectiles: ProjectileState[];
}

