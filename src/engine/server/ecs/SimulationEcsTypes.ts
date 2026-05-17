// Type contracts for the bitecs world component layout.
import type { MovementMode } from "../../shared/index";

export type WorldWithComponents = {
  components: {
    NetworkId: { value: number[] };
    ModelId: { value: number[] };
    Position: { x: number[]; y: number[]; z: number[] };
    Rotation: { x: number[]; y: number[]; z: number[]; w: number[] };
    Velocity: { x: number[]; y: number[]; z: number[] };
    Health: { value: number[]; max: number[] };
    ItemArchetypeId: { value: number[] };
    ItemQuantity: { value: number[] };
    LocationKind: { value: number[] };
    LocationArchetypeId: { value: number[] };
    LocationSeed: { value: number[] };
    LocationEnvironmentId: { value: number[] };
    LocationStreamingRadius: { value: number[] };
    LocationInfluenceRadius: { value: number[] };
    CharacterArchetypeId: { value: number[] };
    ControllerKind: { value: number[] };
    Grounded: { value: number[] };
    MovementMode: { value: number[] };
    GroundedPlatformPid: { value: number[] };
    CarriedFramePid: { value: number[] };
    AccountId: { value: number[] };
    Yaw: { value: number[] };
    Pitch: { value: number[] };
    LastProcessedSequence: { value: number[] };
    LastPrimaryFireAtSeconds: { value: number[] };
    PrimaryHeld: { value: number[] };
    SecondaryHeld: { value: number[] };
    PrimaryMouseSlot: { value: number[] };
    SecondaryMouseSlot: { value: number[] };
    ProjectileOwnerNid: { value: number[] };
    ProjectileKind: { value: number[] };
    ProjectileRadius: { value: number[] };
    ProjectileDamage: { value: number[] };
    ProjectileTtl: { value: number[] };
    ProjectileRemainingRange: { value: number[] };
    ProjectileGravity: { value: number[] };
    ProjectileDrag: { value: number[] };
    ProjectileMaxSpeed: { value: number[] };
    ProjectileMinSpeed: { value: number[] };
    ProjectileRemainingPierces: { value: number[] };
    ProjectileDespawnOnDamageableHit: { value: number[] };
    ProjectileDespawnOnWorldHit: { value: number[] };
    Hotbar: {
      slot0: number[];
      slot1: number[];
      slot2: number[];
      slot3: number[];
      slot4: number[];
      slot5: number[];
      slot6: number[];
      slot7: number[];
      slot8: number[];
      slot9: number[];
    };
    UnlockedAbilityIds: { value: number[][] };
    ReplicatedTag: number[];
    PlayerTag: number[];
    PlatformTag: number[];
    ProjectileTag: number[];
    WorldItemTag: number[];
    CharacterTag: number[];
    NpcTag: number[];
    DummyTag: number[];
    LocationRootTag: number[];
  };
};

// Runtime player state assembled from components — used as a temporary
// working struct by systems that read/write ECS components directly.
import type RAPIER from "@dimforge/rapier3d-compat";

export interface PlayerStateSnapshot {
  eid: number;
  accountId: number;
  nid: number;
  modelId: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vx: number; vy: number; vz: number;
  grounded: boolean;
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
  carriedFramePid: number | null;
  lastProcessedSequence: number;
  lastPrimaryFireAtSeconds: number;
  primaryHeld: boolean;
  secondaryHeld: boolean;
  health: number;
  maxHealth: number;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: readonly number[];
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export type DamageState = {
  accountId: number;
  nid: number;
  health: number;
  maxHealth: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  grounded: boolean;
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
  carriedFramePid: number | null;
  body: RAPIER.RigidBody;
};

export type InputAckState = {
  nid: number;
  lastProcessedSequence: number;
  x: number; y: number; z: number;
  yaw: number;
  pitch: number;
  vx: number; vy: number; vz: number;
  grounded: boolean;
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
  carriedFramePid: number | null;
};

export type PersistenceState = {
  accountId: number;
  x: number; y: number; z: number;
  yaw: number;
  pitch: number;
  vx: number; vy: number; vz: number;
  health: number;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
};

export type AbilityState = {
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: number[];
};
