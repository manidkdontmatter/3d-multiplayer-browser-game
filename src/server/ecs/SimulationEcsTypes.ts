import type RAPIER from "@dimforge/rapier3d-compat";

export type SimObject = {
  nid: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  health: number;
  maxHealth: number;
  grounded: boolean;
};

export type PlayerObject = SimObject & {
  accountId: number;
  yaw: number;
  pitch: number;
  lastProcessedSequence: number;
  lastPrimaryFireAtSeconds: number;
  primaryHeld: boolean;
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: Set<number>;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  vx: number;
  vy: number;
  vz: number;
  groundedPlatformPid: number | null;
};

export type DummyObject = SimObject & {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

export type ProjectileCreateRequest = {
  modelId: number;
  ownerNid: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  damage: number;
  ttlSeconds: number;
  remainingRange: number;
  gravity: number;
  drag: number;
  maxSpeed: number;
  minSpeed: number;
  remainingPierces: number;
  despawnOnDamageableHit: boolean;
  despawnOnWorldHit: boolean;
};

export type WorldWithComponents = {
  components: {
    NengiNid: { value: number[] };
    ModelId: { value: number[] };
    Position: { x: number[]; y: number[]; z: number[] };
    Rotation: { x: number[]; y: number[]; z: number[]; w: number[] };
    Velocity: { x: number[]; y: number[]; z: number[] };
    Health: { value: number[]; max: number[] };
    Grounded: { value: number[] };
    GroundedPlatformPid: { value: number[] };
    AccountId: { value: number[] };
    Yaw: { value: number[] };
    Pitch: { value: number[] };
    LastProcessedSequence: { value: number[] };
    LastPrimaryFireAtSeconds: { value: number[] };
    PrimaryHeld: { value: number[] };
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
    ActiveHotbarSlot: { value: number[] };
    Hotbar: {
      slot0: number[];
      slot1: number[];
      slot2: number[];
      slot3: number[];
      slot4: number[];
    };
    UnlockedAbilityCsv: { value: string[] };
    ReplicatedTag: number[];
    PlayerTag: number[];
    PlatformTag: number[];
    ProjectileTag: number[];
    DummyTag: number[];
  };
};
