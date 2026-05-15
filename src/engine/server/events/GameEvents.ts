// Typed event constants and payload interfaces for the game event bus.
// Events are produced by simulation systems and consumed by any interested system.
// This decouples cross-cutting concerns from GameSimulation's constructor.

import type { MovementMode } from "../../shared/index";
import type { AbilityCategory } from "../../shared/index";
import type { AbilityState } from "../ecs/SimulationEcsTypes";

// ── Event type constants ────────────────────────────────────────────────────

export const GameEvent = {
  PLAYER_SPAWNED: "player.spawned",
  PLAYER_DESPAWNED: "player.despawned",
  PLAYER_MOVED: "player.moved",
  INPUT_PROCESSED: "input.processed",
  DAMAGE_DEALT: "damage.dealt",
  HEALTH_CHANGED: "health.changed",
  ENTITY_DESTROYED: "entity.destroyed",
  PROJECTILE_HIT: "projectile.hit",
  PROJECTILE_DESPAWNED: "projectile.despawned",
  ABILITY_USED: "ability.used",
  ABILITY_STATE_CHANGED: "ability.stateChanged",
  ITEM_PICKED_UP: "item.pickedUp",
  ITEM_DROPPED: "item.dropped",
  ITEM_EQUIPPED: "item.equipped",
  STATUS_APPLIED: "status.applied",
  STATUS_REMOVED: "status.removed",
  ENTITY_CREATED: "entity.created",
  TICK_POST_MOVEMENT: "tick.postMovement",
} as const;

export type GameEventType = (typeof GameEvent)[keyof typeof GameEvent];

// ── Payload interfaces ───────────────────────────────────────────────────────

export interface PlayerSpawnedPayload {
  userId: number;
  eid: number;
  accountId: number;
  colliderHandle: number;
}

export interface PlayerDespawnedPayload {
  userId: number;
  eid: number;
  accountId: number;
}

export interface PlayerMovedPayload {
  userId: number;
  eid: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vx: number; vy: number; vz: number;
  grounded: boolean;
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
  carriedFramePid: number | null;
  lastProcessedSequence: number;
}

export interface InputProcessedPayload {
  userId: number;
  eid: number;
  lastProcessedSequence: number;
}

export interface DamageDealtPayload {
  sourceEid: number | null;
  targetEid: number;
  amount: number;
  kind: "melee" | "projectile" | "status" | "fall" | "environment";
}

export interface HealthChangedPayload {
  eid: number;
  previous: number;
  current: number;
  max: number;
}

export interface EntityDestroyedPayload {
  eid: number;
}

export interface ProjectileHitPayload {
  projectileEid: number;
  targetEid: number;
  damage: number;
}

export interface ProjectileDespawnedPayload {
  projectileEid: number;
  reason: "ttl" | "range" | "world_hit" | "damageable_hit" | "speed";
}

export interface AbilityUsedPayload {
  ownerNid: number;
  abilityId: number;
  category: AbilityCategory;
  serverTick: number;
  x: number; y: number; z: number;
}

export interface AbilityStateChangedPayload {
  userId: number;
  state: AbilityState;
}

export interface ItemPickedUpPayload {
  userId: number;
  itemEid: number;
  itemArchetypeId: number;
  quantity: number;
}

export interface ItemDroppedPayload {
  userId: number;
  itemEid: number;
  x: number; y: number; z: number;
}

export interface ItemEquippedPayload {
  userId: number;
  itemEid: number;
  slot: string;
}

export interface StatusAppliedPayload {
  targetEid: number;
  statusId: string;
  durationMs: number;
  stacks: number;
  sourceEid: number | null;
}

export interface StatusRemovedPayload {
  targetEid: number;
  statusId: string;
  reason: "expired" | "dispelled" | "death";
}

export interface EntityCreatedPayload {
  eid: number;
  kind: string;
  archetypeId: number;
}

export interface TickPostMovementPayload {
  tickNumber: number;
  elapsedSeconds: number;
}
