/**
 * Purpose: This file holds tunable settings and constants for this module area.
 * Scope: It belongs to the game-specific shared data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import { injectGameConfig, type GameConfig } from "../../engine/shared/config";

const gameConfig: GameConfig = {
  worldGroundHalfExtent: 128,
  worldGroundHalfThickness: 0.5,
  playerWalkSpeed: 6,
  playerSprintSpeed: 9,
  playerGroundAccel: 60,
  playerAirAccel: 20,
  playerGroundFriction: 10,
  playerFlySpeed: 50,
  playerFlySprintSpeed: 70,
  playerFlyAccel: 200,
  playerFlyDrag: 6,
  playerEyeHeight: 1.8,
  playerCapsuleHalfHeight: 0.45,
  playerCapsuleRadius: 0.35,
  playerJumpVelocity: 12,
  gravity: -18,
  playerGroundStickVelocity: -2,
  playerMaxHealth: 100,
  primaryFireCooldownSeconds: 0.2,
  magicBoltKindPrimary: 1,
  magicBoltSpeed: 24,
  magicBoltRadius: 0.2,
  magicBoltDamage: 25,
  magicBoltLifetimeSeconds: 2.2,
  magicBoltSpawnForwardOffset: 0.75,
  magicBoltSpawnVerticalOffset: -0.08,
  modelIdPlayer: 1,
  modelIdPlatformLinear: 2,
  modelIdPlatformRotating: 3,
  modelIdProjectilePrimary: 4,
  modelIdTrainingDummy: 5,
  modelIdNpcHostileGuard: 6,
  modelIdNpcDocileFlee: 7,
  modelIdNpcWanderer: 8,
  modelIdLocationTerrainIsland: 20,
  modelIdLocationStaticCastle: 21,
  modelIdLocationMovingCastle: 22,
  modelIdLocationTestArena: 23,
  modelIdLocationMovingTestPlatform: 24,
  modelIdItemVitalityShard: 40,
  modelIdItemFocusBlade: 41,
  modelIdItemEtherCrystal: 42,
};

export function initGameConfig(): void {
  injectGameConfig(gameConfig);
}
