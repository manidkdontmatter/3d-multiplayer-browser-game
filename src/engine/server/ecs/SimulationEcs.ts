/**
 * Purpose: This file runs core simulation state updates in tick order.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type RAPIER from "@dimforge/rapier3d-compat";
import { query } from "bitecs";
import {
  HOTBAR_SLOT_COUNT,
  MOVEMENT_MODE_GROUNDED,
  clampHotbarSlotIndex,
  sanitizeMovementMode
} from "../../shared/index";
import type { MovementMode } from "../../shared/index";
import type { EntityFactoryOverrides } from "./EntityFactory";
import type { EntityPresetId } from "./ComponentRegistry";
import { getHotbarArray } from "./HotbarComponents";
import { SimulationEcsIndexRegistry } from "./SimulationEcsIndexRegistry";
import { SimulationEcsStore } from "./SimulationEcsStore";
import type {
  AbilityState,
  DamageState,
  InputAckState,
  PersistenceState,
  PlayerStateSnapshot,
} from "./SimulationEcsTypes";

export class SimulationEcs {
  private readonly store = new SimulationEcsStore();
  private readonly indexes = new SimulationEcsIndexRegistry();

  public get world() { return this.store.world; }
  public get registry() { return this.store.registry; }
  public get factory() { return this.store.factory; }

  // ── Entity lifecycle ──────────────────────────────────────────────────────

  public createEntityFromPreset(presetId: EntityPresetId, overrides?: EntityFactoryOverrides): number {
    return this.store.createEntityFromPreset(presetId, overrides);
  }

  public destroyEid(eid: number): void {
    const nid = this.store.getEntityNid(eid);
    if (nid > 0) {
      this.indexes.removeGlobalNidIndex(nid);
    }
    this.indexes.removeAllIndexesForEid(eid);
    this.store.destroyEid(eid);
  }

  public setEntityNidByEid(eid: number, nid: number): void {
    const prev = this.store.getEntityNid(eid);
    this.store.setEntityNid(eid, nid);
    this.indexes.updateGlobalNidIndex(eid, prev, nid);
    this.indexes.updatePlayerNidIndex(eid, prev, nid);
  }

  public getAnyEidByNid(nid: number): number | undefined {
    return this.indexes.getEidByNid(nid);
  }

  // ── Player index management ───────────────────────────────────────────────

  public bindPlayerIndexes(userId: number, eid: number): void {
    const nid = this.store.getEntityNid(eid);
    const accountId = this.store.getEntityAccountId(eid);
    this.indexes.bindPlayerIndexes(userId, eid, nid, accountId);
  }

  public unbindPlayerIndexes(userId: number, eid: number): void {
    const nid = this.store.getEntityNid(eid);
    const accountId = this.store.getEntityAccountId(eid);
    this.indexes.unbindPlayerIndexes(userId, eid, nid, accountId);
  }

  public getPlayerEidByUserId(userId: number): number | undefined {
    return this.indexes.getPlayerEidByUserId(userId);
  }

  public getPlayerEidByNid(nid: number): number | undefined {
    return this.indexes.getPlayerEidByNid(nid);
  }

  public getCharacterEidByNid(nid: number): number | undefined {
    return this.indexes.getCharacterEidByNid(nid);
  }

  public getPlayerAccountIdByUserId(userId: number): number | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return null;
    return this.store.getEntityAccountId(eid);
  }

  public getOnlinePlayerUserIds(): number[] {
    return this.indexes.getOnlinePlayerUserIds();
  }

  public getOnlinePlayerCount(): number {
    return this.indexes.getOnlinePlayerCount();
  }

  // ── Physics refs ──────────────────────────────────────────────────────────

  public registerPlayerPhysicsRefs(eid: number, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
    this.indexes.registerPlayerRefs(eid, body, collider);
  }

  public registerCharacterPhysicsRefs(eid: number, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
    this.indexes.registerCharacterRefs(eid, body, collider);
  }

  public registerDummyPhysicsRefs(eid: number, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
    this.indexes.registerDummyRefs(eid, body, collider);
  }

  public getPlayerBody(eid: number): RAPIER.RigidBody | undefined {
    return this.indexes.getPlayerBody(eid);
  }

  public getPlayerCollider(eid: number): RAPIER.Collider | undefined {
    return this.indexes.getPlayerCollider(eid);
  }

  public getCharacterColliderByNid(nid: number): RAPIER.Collider | undefined {
    const eid = this.indexes.getCharacterEidByNid(nid);
    if (typeof eid !== "number") return undefined;
    return this.indexes.getCharacterCollider(eid);
  }

  public getCharacterBody(eid: number): RAPIER.RigidBody | undefined {
    return this.indexes.getCharacterBody(eid);
  }

  public getCharacterCollider(eid: number): RAPIER.Collider | undefined {
    return this.indexes.getCharacterCollider(eid);
  }

  public getPlayerColliderByNid(nid: number): RAPIER.Collider | undefined {
    const eid = this.indexes.getPlayerEidByNid(nid);
    if (typeof eid !== "number") return undefined;
    return this.indexes.getPlayerCollider(eid);
  }

  public resolveCombatTargetRuntime(target: { kind: "character" | "player" | "dummy"; eid: number }): {
    nid: number;
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  } | null {
    const c = this.world.components;
    if (target.kind === "character" || target.kind === "player") {
      const body = this.indexes.getCharacterBody(target.eid);
      const collider = this.indexes.getCharacterCollider(target.eid);
      if (!body || !collider) return null;
      return { nid: c.NetworkId.value[target.eid] ?? 0, body, collider };
    }
    const body = this.indexes.getDummyBody(target.eid);
    const collider = this.indexes.getDummyCollider(target.eid);
    if (!body || !collider) return null;
    return { nid: c.NetworkId.value[target.eid] ?? 0, body, collider };
  }

  // ── Player runtime state (snapshot from components) ───────────────────────

  public getPlayerRuntimeStateByUserId(userId: number): PlayerStateSnapshot | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return null;
    const body = this.indexes.getPlayerBody(eid);
    const collider = this.indexes.getPlayerCollider(eid);
    if (!body || !collider) return null;

    const c = this.world.components;
    const gp = c.GroundedPlatformPid.value[eid] ?? -1;
    const cf = c.CarriedFramePid.value[eid] ?? -1;
    const x = c.Position.x[eid] ?? 0;
    const y = c.Position.y[eid] ?? 0;
    const z = c.Position.z[eid] ?? 0;

    return {
      eid,
      accountId: Math.max(1, Math.floor(c.AccountId.value[eid] ?? 1)),
      nid: c.NetworkId.value[eid] ?? 0,
      modelId: c.ModelId.value[eid] ?? 0,
      x, y, z,
      yaw: c.Yaw.value[eid] ?? 0,
      pitch: c.Pitch.value[eid] ?? 0,
      vx: c.Velocity.x[eid] ?? 0,
      vy: c.Velocity.y[eid] ?? 0,
      vz: c.Velocity.z[eid] ?? 0,
      grounded: (c.Grounded.value[eid] ?? 0) !== 0,
      movementMode: sanitizeMovementMode(c.MovementMode.value[eid], MOVEMENT_MODE_GROUNDED),
      groundedPlatformPid: gp < 0 ? null : gp,
      carriedFramePid: cf < 0 ? null : cf,
      lastProcessedSequence: c.LastProcessedSequence.value[eid] ?? 0,
      lastPrimaryFireAtSeconds: c.LastPrimaryFireAtSeconds.value[eid] ?? Number.NEGATIVE_INFINITY,
      primaryHeld: (c.PrimaryHeld.value[eid] ?? 0) !== 0,
      secondaryHeld: (c.SecondaryHeld.value[eid] ?? 0) !== 0,
      health: c.Health.value[eid] ?? 0,
      maxHealth: c.Health.max[eid] ?? 0,
      primaryMouseSlot: Math.max(0, Math.floor(c.PrimaryMouseSlot.value[eid] ?? 0)),
      secondaryMouseSlot: Math.max(0, Math.floor(c.SecondaryMouseSlot.value[eid] ?? 1)),
      hotbarAbilityIds: getHotbarArray(c, eid),
      unlockedAbilityIds: this.store.getUnlockedAbilityIds(eid),
      position: { x, y, z },
      rotation: {
        x: c.Rotation.x[eid] ?? 0,
        y: c.Rotation.y[eid] ?? 0,
        z: c.Rotation.z[eid] ?? 0,
        w: c.Rotation.w[eid] ?? 1
      },
      body,
      collider
    };
  }

  // ── Input ack state ───────────────────────────────────────────────────────

  public getPlayerInputAckStateByUserId(userId: number): InputAckState | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return null;
    const c = this.world.components;
    const gp = c.GroundedPlatformPid.value[eid] ?? -1;
    const cf = c.CarriedFramePid.value[eid] ?? -1;
    return {
      nid: c.NetworkId.value[eid] ?? 0,
      lastProcessedSequence: c.LastProcessedSequence.value[eid] ?? 0,
      x: c.Position.x[eid] ?? 0,
      y: c.Position.y[eid] ?? 0,
      z: c.Position.z[eid] ?? 0,
      yaw: c.Yaw.value[eid] ?? 0,
      pitch: c.Pitch.value[eid] ?? 0,
      vx: c.Velocity.x[eid] ?? 0,
      vy: c.Velocity.y[eid] ?? 0,
      vz: c.Velocity.z[eid] ?? 0,
      grounded: (c.Grounded.value[eid] ?? 0) !== 0,
      movementMode: sanitizeMovementMode(c.MovementMode.value[eid], MOVEMENT_MODE_GROUNDED),
      groundedPlatformPid: gp < 0 ? null : gp,
      carriedFramePid: cf < 0 ? null : cf
    };
  }

  // ── Ability state ─────────────────────────────────────────────────────────

  public getPlayerAbilityStateByUserId(userId: number): AbilityState | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return null;
    return {
      primaryMouseSlot: Math.max(0, Math.floor(this.world.components.PrimaryMouseSlot.value[eid] ?? 0)),
      secondaryMouseSlot: Math.max(0, Math.floor(this.world.components.SecondaryMouseSlot.value[eid] ?? 1)),
      hotbarAbilityIds: getHotbarArray(this.world.components, eid),
      unlockedAbilityIds: [...this.store.getUnlockedAbilityIds(eid)]
    };
  }

  public setPlayerHotbarAbilityByUserId(userId: number, slot: number, abilityId: number): boolean {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return false;
    return this.store.setHotbarAbilityBySlot(eid, slot, abilityId);
  }

  public setPlayerPrimaryMouseSlotByUserId(userId: number, slot: number): boolean {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return false;
    const c = this.world.components;
    const normalized = clampHotbarSlotIndex(slot);
    const prev = c.PrimaryMouseSlot.value[eid] ?? 0;
    c.PrimaryMouseSlot.value[eid] = normalized;
    return prev !== normalized;
  }

  public setPlayerSecondaryMouseSlotByUserId(userId: number, slot: number): boolean {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return false;
    const c = this.world.components;
    const normalized = clampHotbarSlotIndex(slot);
    const prev = c.SecondaryMouseSlot.value[eid] ?? 1;
    c.SecondaryMouseSlot.value[eid] = normalized;
    return prev !== normalized;
  }

  public setPlayerUnlockedAbilityIdsByUserId(userId: number, ids: ReadonlyArray<number>): boolean {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return false;
    return this.store.setUnlockedAbilityIdsFromList(eid, ids);
  }

  public replacePlayerAbilityOnHotbarByUserId(userId: number, oldId: number, newId: number): boolean {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return false;
    const nOld = Math.max(0, Math.floor(Number.isFinite(oldId) ? oldId : 0));
    const nNew = Math.max(0, Math.floor(Number.isFinite(newId) ? newId : 0));
    if (nOld <= 0 || nNew <= 0) return false;
    let changed = false;
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot++) {
      if (this.store.getHotbarSlot(eid, slot) !== nOld) continue;
      changed = this.store.setHotbarAbilityBySlot(eid, slot, nNew) || changed;
    }
    return changed;
  }

  public clearPlayerAbilityOnHotbarByUserId(userId: number, abilityId: number): boolean {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return false;
    const nId = Math.max(0, Math.floor(Number.isFinite(abilityId) ? abilityId : 0));
    if (nId <= 0) return false;
    let changed = false;
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot++) {
      if (this.store.getHotbarSlot(eid, slot) !== nId) continue;
      changed = this.store.setHotbarAbilityBySlot(eid, slot, 0) || changed;
    }
    return changed;
  }

  public setPlayerHealthByUserId(userId: number, health: number): boolean {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return false;
    const c = this.world.components;
    const maxH = Math.max(0, Math.floor(c.Health.max[eid] ?? 0));
    const next = Math.max(0, Math.min(maxH, Math.floor(Number.isFinite(health) ? health : 0)));
    const prev = Math.max(0, Math.floor(c.Health.value[eid] ?? 0));
    c.Health.value[eid] = next;
    return prev !== next;
  }

  // ── Damage state ──────────────────────────────────────────────────────────

  public getPlayerDamageStateByEid(eid: number): DamageState | null {
    return this.getCharacterDamageStateByEid(eid);
  }

  public getCharacterDamageStateByEid(eid: number): DamageState | null {
    const body = this.indexes.getCharacterBody(eid);
    if (!body) return null;
    const c = this.world.components;
    const gp = c.GroundedPlatformPid.value[eid] ?? -1;
    const cf = c.CarriedFramePid.value[eid] ?? -1;
    return {
      accountId: Math.max(0, Math.floor(c.AccountId.value[eid] ?? 0)),
      nid: c.NetworkId.value[eid] ?? 0,
      health: c.Health.value[eid] ?? 0,
      maxHealth: c.Health.max[eid] ?? 0,
      x: c.Position.x[eid] ?? 0,
      y: c.Position.y[eid] ?? 0,
      z: c.Position.z[eid] ?? 0,
      vx: c.Velocity.x[eid] ?? 0,
      vy: c.Velocity.y[eid] ?? 0,
      vz: c.Velocity.z[eid] ?? 0,
      grounded: (c.Grounded.value[eid] ?? 0) !== 0,
      movementMode: sanitizeMovementMode(c.MovementMode.value[eid], MOVEMENT_MODE_GROUNDED),
      groundedPlatformPid: gp < 0 ? null : gp,
      carriedFramePid: cf < 0 ? null : cf,
      body
    };
  }

  public applyCharacterDamageStateByEid(eid: number, state: {
    health: number; maxHealth: number;
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    grounded: boolean;
    movementMode: MovementMode;
    groundedPlatformPid: number | null;
    carriedFramePid: number | null;
  }): void {
    const c = this.world.components;
    c.Health.value[eid] = Math.max(0, Math.floor(state.health));
    c.Health.max[eid] = Math.max(0, Math.floor(state.maxHealth));
    c.Position.x[eid] = state.x;
    c.Position.y[eid] = state.y;
    c.Position.z[eid] = state.z;
    c.Velocity.x[eid] = state.vx;
    c.Velocity.y[eid] = state.vy;
    c.Velocity.z[eid] = state.vz;
    c.Grounded.value[eid] = state.grounded ? 1 : 0;
    c.MovementMode.value[eid] = state.movementMode;
    c.GroundedPlatformPid.value[eid] = state.groundedPlatformPid === null ? -1 : state.groundedPlatformPid;
    c.CarriedFramePid.value[eid] = state.carriedFramePid === null ? -1 : state.carriedFramePid;
  }

  public getDummyDamageStateByEid(eid: number): { health: number; maxHealth: number } | null {
    if (!this.indexes.getDummyBody(eid)) return null;
    const c = this.world.components;
    return { health: c.Health.value[eid] ?? 0, maxHealth: c.Health.max[eid] ?? 0 };
  }

  public applyDummyDamageStateByEid(eid: number, state: { health: number; maxHealth: number }): void {
    const c = this.world.components;
    c.Health.value[eid] = Math.max(0, Math.floor(state.health));
    c.Health.max[eid] = Math.max(0, Math.floor(state.maxHealth));
  }

  // ── Movement state write-back ─────────────────────────────────────────────

  public applyPlayerMovementState(eid: number, state: {
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
    primaryMouseSlot: number;
    secondaryMouseSlot: number;
    rotation: { x: number; y: number; z: number; w: number };
  }): void {
    const c = this.world.components;
    c.Position.x[eid] = state.x;
    c.Position.y[eid] = state.y;
    c.Position.z[eid] = state.z;
    c.Yaw.value[eid] = state.yaw;
    c.Pitch.value[eid] = state.pitch;
    c.Velocity.x[eid] = state.vx;
    c.Velocity.y[eid] = state.vy;
    c.Velocity.z[eid] = state.vz;
    c.Grounded.value[eid] = state.grounded ? 1 : 0;
    c.MovementMode.value[eid] = state.movementMode;
    c.GroundedPlatformPid.value[eid] = state.groundedPlatformPid === null ? -1 : state.groundedPlatformPid;
    c.CarriedFramePid.value[eid] = state.carriedFramePid === null ? -1 : state.carriedFramePid;
    c.LastProcessedSequence.value[eid] = state.lastProcessedSequence;
    c.LastPrimaryFireAtSeconds.value[eid] = state.lastPrimaryFireAtSeconds;
    c.PrimaryHeld.value[eid] = state.primaryHeld ? 1 : 0;
    c.SecondaryHeld.value[eid] = state.secondaryHeld ? 1 : 0;
    c.PrimaryMouseSlot.value[eid] = clampHotbarSlotIndex(state.primaryMouseSlot);
    c.SecondaryMouseSlot.value[eid] = clampHotbarSlotIndex(state.secondaryMouseSlot);
    c.Rotation.x[eid] = state.rotation.x;
    c.Rotation.y[eid] = state.rotation.y;
    c.Rotation.z[eid] = state.rotation.z;
    c.Rotation.w[eid] = state.rotation.w;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  public getPlayerPersistenceSnapshotByAccountId(accountId: number): PersistenceState | null {
    const eid = this.indexes.getPlayerEidByAccountId(accountId);
    if (typeof eid !== "number") return null;
    const c = this.world.components;
    return {
      accountId: Math.max(1, Math.floor(c.AccountId.value[eid] ?? 1)),
      x: c.Position.x[eid] ?? 0,
      y: c.Position.y[eid] ?? 0,
      z: c.Position.z[eid] ?? 0,
      yaw: c.Yaw.value[eid] ?? 0,
      pitch: c.Pitch.value[eid] ?? 0,
      vx: c.Velocity.x[eid] ?? 0,
      vy: c.Velocity.y[eid] ?? 0,
      vz: c.Velocity.z[eid] ?? 0,
      health: Math.max(0, Math.floor(c.Health.value[eid] ?? 0)),
      primaryMouseSlot: Math.max(0, Math.floor(c.PrimaryMouseSlot.value[eid] ?? 0)),
      secondaryMouseSlot: Math.max(0, Math.floor(c.SecondaryMouseSlot.value[eid] ?? 1)),
      hotbarAbilityIds: getHotbarArray(c, eid)
    };
  }

  // ── Replication ───────────────────────────────────────────────────────────

  public getReplicatedEids(): number[] {
    return this.store.getReplicatedTagEids();
  }

  // ── Stats / queries ───────────────────────────────────────────────────────

  public getOnlinePlayerPositionsXZ(): Array<{ x: number; z: number }> {
    const occupied: Array<{ x: number; z: number }> = [];
    for (const userId of this.indexes.getOnlinePlayerUserIds()) {
      const eid = this.indexes.getPlayerEidByUserId(userId);
      if (typeof eid !== "number") continue;
      occupied.push({
        x: this.world.components.Position.x[eid] ?? 0,
        z: this.world.components.Position.z[eid] ?? 0
      });
    }
    return occupied;
  }

  public getStats(): {
    players: number; npcs: number; platforms: number;
    locationRoots: number; projectiles: number; worldItems: number;
    dummies: number; total: number;
  } {
    const w = this.world;
    const players = query(w, [w.components.PlayerTag]).length;
    const npcs = query(w, [w.components.NpcTag]).length;
    const platforms = query(w, [w.components.PlatformTag]).length;
    const locationRoots = query(w, [w.components.LocationRootTag]).length;
    const projectiles = query(w, [w.components.ProjectileTag]).length;
    const dummies = query(w, [w.components.DummyTag]).length;
    const worldItems = query(w, [w.components.WorldItemTag]).length;
    return {
      players, npcs, platforms, locationRoots, projectiles, worldItems, dummies,
      total: players + npcs + platforms + locationRoots + projectiles + worldItems + dummies
    };
  }
}
