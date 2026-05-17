/**
 * Purpose: This file holds tunable settings and constants for this module area.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
export const SERVER_PORT = 9001;
export const SERVER_TICK_RATE = 30;
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;
export const SERVER_TICK_SECONDS = 1 / SERVER_TICK_RATE;
export const MAX_COMMAND_DELTA_SECONDS = 0.1;

// Game-specific constants — injected by the game layer at startup via injectGameConfig().
// Defaults here are placeholder; real values come from game/shared/config.ts.
export let WORLD_GROUND_HALF_EXTENT = 128;
export let WORLD_GROUND_HALF_THICKNESS = 0.5;
export let PLAYER_WALK_SPEED = 6;
export let PLAYER_SPRINT_SPEED = 9;
export let PLAYER_GROUND_ACCEL = 60;
export let PLAYER_AIR_ACCEL = 20;
export let PLAYER_GROUND_FRICTION = 10;
export let PLAYER_FLY_SPEED = 50;
export let PLAYER_FLY_SPRINT_SPEED = 70;
export let PLAYER_FLY_ACCEL = 200;
export let PLAYER_FLY_DRAG = 6;
export let PLAYER_EYE_HEIGHT = 1.8;
export let PLAYER_CAPSULE_HALF_HEIGHT = 0.45;
export let PLAYER_CAPSULE_RADIUS = 0.35;
export let PLAYER_BODY_CENTER_HEIGHT = PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS;
export let PLAYER_CAMERA_OFFSET_Y = PLAYER_EYE_HEIGHT - PLAYER_BODY_CENTER_HEIGHT;
export let PLAYER_GROUND_Y = PLAYER_EYE_HEIGHT;
export let PLAYER_JUMP_VELOCITY = 12;
export let GRAVITY = -18;
export let PLAYER_GROUND_STICK_VELOCITY = -2;
export let PLAYER_MAX_HEALTH = 100;
export let PRIMARY_FIRE_COOLDOWN_SECONDS = 0.2;
export let MAGIC_BOLT_KIND_PRIMARY = 1;
export let MAGIC_BOLT_SPEED = 24;
export let MAGIC_BOLT_RADIUS = 0.2;
export let MAGIC_BOLT_DAMAGE = 25;
export let MAGIC_BOLT_LIFETIME_SECONDS = 2.2;
export let MAGIC_BOLT_SPAWN_FORWARD_OFFSET = 0.75;
export let MAGIC_BOLT_SPAWN_VERTICAL_OFFSET = -0.08;

export let MODEL_ID_PLAYER = 1;
export let MODEL_ID_PLATFORM_LINEAR = 2;
export let MODEL_ID_PLATFORM_ROTATING = 3;
export let MODEL_ID_PROJECTILE_PRIMARY = 4;
export let MODEL_ID_TRAINING_DUMMY = 5;
export let MODEL_ID_NPC_HOSTILE_GUARD = 6;
export let MODEL_ID_NPC_DOCILE_FLEE = 7;
export let MODEL_ID_NPC_WANDERER = 8;
export let MODEL_ID_LOCATION_TERRAIN_ISLAND = 20;
export let MODEL_ID_LOCATION_STATIC_CASTLE = 21;
export let MODEL_ID_LOCATION_MOVING_CASTLE = 22;
export let MODEL_ID_LOCATION_TEST_ARENA = 23;
export let MODEL_ID_LOCATION_MOVING_TEST_PLATFORM = 24;
export let MODEL_ID_ITEM_VITALITY_SHARD = 40;
export let MODEL_ID_ITEM_FOCUS_BLADE = 41;
export let MODEL_ID_ITEM_ETHER_CRYSTAL = 42;

export interface GameConfig {
  worldGroundHalfExtent?: number;
  worldGroundHalfThickness?: number;
  playerWalkSpeed?: number;
  playerSprintSpeed?: number;
  playerGroundAccel?: number;
  playerAirAccel?: number;
  playerGroundFriction?: number;
  playerFlySpeed?: number;
  playerFlySprintSpeed?: number;
  playerFlyAccel?: number;
  playerFlyDrag?: number;
  playerEyeHeight?: number;
  playerCapsuleHalfHeight?: number;
  playerCapsuleRadius?: number;
  playerJumpVelocity?: number;
  gravity?: number;
  playerGroundStickVelocity?: number;
  playerMaxHealth?: number;
  primaryFireCooldownSeconds?: number;
  magicBoltKindPrimary?: number;
  magicBoltSpeed?: number;
  magicBoltRadius?: number;
  magicBoltDamage?: number;
  magicBoltLifetimeSeconds?: number;
  magicBoltSpawnForwardOffset?: number;
  magicBoltSpawnVerticalOffset?: number;
  modelIdPlayer?: number;
  modelIdPlatformLinear?: number;
  modelIdPlatformRotating?: number;
  modelIdProjectilePrimary?: number;
  modelIdTrainingDummy?: number;
  modelIdNpcHostileGuard?: number;
  modelIdNpcDocileFlee?: number;
  modelIdNpcWanderer?: number;
  modelIdLocationTerrainIsland?: number;
  modelIdLocationStaticCastle?: number;
  modelIdLocationMovingCastle?: number;
  modelIdLocationTestArena?: number;
  modelIdLocationMovingTestPlatform?: number;
  modelIdItemVitalityShard?: number;
  modelIdItemFocusBlade?: number;
  modelIdItemEtherCrystal?: number;
}

export function injectGameConfig(cfg: GameConfig): void {
  if (cfg.worldGroundHalfExtent !== undefined) WORLD_GROUND_HALF_EXTENT = cfg.worldGroundHalfExtent;
  if (cfg.worldGroundHalfThickness !== undefined) WORLD_GROUND_HALF_THICKNESS = cfg.worldGroundHalfThickness;
  if (cfg.playerWalkSpeed !== undefined) PLAYER_WALK_SPEED = cfg.playerWalkSpeed;
  if (cfg.playerSprintSpeed !== undefined) PLAYER_SPRINT_SPEED = cfg.playerSprintSpeed;
  if (cfg.playerGroundAccel !== undefined) PLAYER_GROUND_ACCEL = cfg.playerGroundAccel;
  if (cfg.playerAirAccel !== undefined) PLAYER_AIR_ACCEL = cfg.playerAirAccel;
  if (cfg.playerGroundFriction !== undefined) PLAYER_GROUND_FRICTION = cfg.playerGroundFriction;
  if (cfg.playerFlySpeed !== undefined) PLAYER_FLY_SPEED = cfg.playerFlySpeed;
  if (cfg.playerFlySprintSpeed !== undefined) PLAYER_FLY_SPRINT_SPEED = cfg.playerFlySprintSpeed;
  if (cfg.playerFlyAccel !== undefined) PLAYER_FLY_ACCEL = cfg.playerFlyAccel;
  if (cfg.playerFlyDrag !== undefined) PLAYER_FLY_DRAG = cfg.playerFlyDrag;
  if (cfg.playerEyeHeight !== undefined) PLAYER_EYE_HEIGHT = cfg.playerEyeHeight;
  if (cfg.playerCapsuleHalfHeight !== undefined) PLAYER_CAPSULE_HALF_HEIGHT = cfg.playerCapsuleHalfHeight;
  if (cfg.playerCapsuleRadius !== undefined) PLAYER_CAPSULE_RADIUS = cfg.playerCapsuleRadius;
  if (cfg.playerJumpVelocity !== undefined) PLAYER_JUMP_VELOCITY = cfg.playerJumpVelocity;
  if (cfg.gravity !== undefined) GRAVITY = cfg.gravity;
  if (cfg.playerGroundStickVelocity !== undefined) PLAYER_GROUND_STICK_VELOCITY = cfg.playerGroundStickVelocity;
  if (cfg.playerMaxHealth !== undefined) PLAYER_MAX_HEALTH = cfg.playerMaxHealth;
  if (cfg.primaryFireCooldownSeconds !== undefined) PRIMARY_FIRE_COOLDOWN_SECONDS = cfg.primaryFireCooldownSeconds;
  if (cfg.magicBoltKindPrimary !== undefined) MAGIC_BOLT_KIND_PRIMARY = cfg.magicBoltKindPrimary;
  if (cfg.magicBoltSpeed !== undefined) MAGIC_BOLT_SPEED = cfg.magicBoltSpeed;
  if (cfg.magicBoltRadius !== undefined) MAGIC_BOLT_RADIUS = cfg.magicBoltRadius;
  if (cfg.magicBoltDamage !== undefined) MAGIC_BOLT_DAMAGE = cfg.magicBoltDamage;
  if (cfg.magicBoltLifetimeSeconds !== undefined) MAGIC_BOLT_LIFETIME_SECONDS = cfg.magicBoltLifetimeSeconds;
  if (cfg.magicBoltSpawnForwardOffset !== undefined) MAGIC_BOLT_SPAWN_FORWARD_OFFSET = cfg.magicBoltSpawnForwardOffset;
  if (cfg.magicBoltSpawnVerticalOffset !== undefined) MAGIC_BOLT_SPAWN_VERTICAL_OFFSET = cfg.magicBoltSpawnVerticalOffset;
  if (cfg.modelIdPlayer !== undefined) MODEL_ID_PLAYER = cfg.modelIdPlayer;
  if (cfg.modelIdPlatformLinear !== undefined) MODEL_ID_PLATFORM_LINEAR = cfg.modelIdPlatformLinear;
  if (cfg.modelIdPlatformRotating !== undefined) MODEL_ID_PLATFORM_ROTATING = cfg.modelIdPlatformRotating;
  if (cfg.modelIdProjectilePrimary !== undefined) MODEL_ID_PROJECTILE_PRIMARY = cfg.modelIdProjectilePrimary;
  if (cfg.modelIdTrainingDummy !== undefined) MODEL_ID_TRAINING_DUMMY = cfg.modelIdTrainingDummy;
  if (cfg.modelIdNpcHostileGuard !== undefined) MODEL_ID_NPC_HOSTILE_GUARD = cfg.modelIdNpcHostileGuard;
  if (cfg.modelIdNpcDocileFlee !== undefined) MODEL_ID_NPC_DOCILE_FLEE = cfg.modelIdNpcDocileFlee;
  if (cfg.modelIdNpcWanderer !== undefined) MODEL_ID_NPC_WANDERER = cfg.modelIdNpcWanderer;
  if (cfg.modelIdLocationTerrainIsland !== undefined) MODEL_ID_LOCATION_TERRAIN_ISLAND = cfg.modelIdLocationTerrainIsland;
  if (cfg.modelIdLocationStaticCastle !== undefined) MODEL_ID_LOCATION_STATIC_CASTLE = cfg.modelIdLocationStaticCastle;
  if (cfg.modelIdLocationMovingCastle !== undefined) MODEL_ID_LOCATION_MOVING_CASTLE = cfg.modelIdLocationMovingCastle;
  if (cfg.modelIdLocationTestArena !== undefined) MODEL_ID_LOCATION_TEST_ARENA = cfg.modelIdLocationTestArena;
  if (cfg.modelIdLocationMovingTestPlatform !== undefined) MODEL_ID_LOCATION_MOVING_TEST_PLATFORM = cfg.modelIdLocationMovingTestPlatform;
  if (cfg.modelIdItemVitalityShard !== undefined) MODEL_ID_ITEM_VITALITY_SHARD = cfg.modelIdItemVitalityShard;
  if (cfg.modelIdItemFocusBlade !== undefined) MODEL_ID_ITEM_FOCUS_BLADE = cfg.modelIdItemFocusBlade;
  if (cfg.modelIdItemEtherCrystal !== undefined) MODEL_ID_ITEM_ETHER_CRYSTAL = cfg.modelIdItemEtherCrystal;

  // Recalculate derived values
  PLAYER_BODY_CENTER_HEIGHT = PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS;
  PLAYER_CAMERA_OFFSET_Y = PLAYER_EYE_HEIGHT - PLAYER_BODY_CENTER_HEIGHT;
  PLAYER_GROUND_Y = PLAYER_EYE_HEIGHT;
}
