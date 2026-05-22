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
  equippedWeaponArchetypeId: number;
  equippedWeaponTintColorRgb: number;
  equippedHeadArchetypeId: number;
  equippedHeadTintColorRgb: number;
  equippedBodyArchetypeId: number;
  equippedBodyTintColorRgb: number;
  equippedLegsArchetypeId: number;
  equippedLegsTintColorRgb: number;
  equippedAccessoryArchetypeId: number;
  equippedAccessoryTintColorRgb: number;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  movementMode: MovementMode;
  health: number;
  maxHealth: number;
}

export interface WorldAnchorState {
  nid: number;
  modelId: number;
  worldAnchorId: number;
  worldAnchorKind: number;
  worldAnchorArchetypeId: number;
  worldAnchorSeed: number;
  worldAnchorEnvironmentId: number;
  worldAnchorStreamingRadius: number;
  worldAnchorInfluenceRadius: number;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number; w: number };
}
export type LocationRootState = WorldAnchorState;

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
  renderArchetypeId: number;
  materialVariantId: number;
  tintColorRgb: number;
  uniformScalePct: number;
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
  localEquippedWeaponArchetypeId: number;
  localEquippedWeaponTintColorRgb: number;
  localEquippedHeadArchetypeId: number;
  localEquippedHeadTintColorRgb: number;
  localEquippedBodyArchetypeId: number;
  localEquippedBodyTintColorRgb: number;
  localEquippedLegsArchetypeId: number;
  localEquippedLegsTintColorRgb: number;
  localEquippedAccessoryArchetypeId: number;
  localEquippedAccessoryTintColorRgb: number;
  remotePlayers: RemotePlayerState[];
  abilityUseEvents: AbilityUseEvent[];
  worldAnchors: WorldAnchorState[];
  locationRoots: WorldAnchorState[];
  worldEntities: WorldEntityState[];
  projectiles: ProjectileState[];
}

