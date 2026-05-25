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
import {
  DEFAULT_TINT_COLOR_RGB,
  sanitizeMaterialVariantId,
  sanitizeRenderArchetypeId,
  sanitizeTintColorRgb,
  sanitizeUniformScalePct
} from "../../shared/appearance/AppearancePolicy";
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
  private static readonly DELAYED_RESPAWN_HIDE_Y_OFFSET = 5000;
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

  public getEntityNidByEid(eid: number): number {
    return Math.max(0, Math.floor(this.world.components.NetworkId.value[eid] ?? 0));
  }

  public resolveCombatOwnerIdentityByEid(eid: number): { eid: number; nid: number } | null {
    const normalizedEid = Math.max(0, Math.floor(eid));
    if (normalizedEid <= 0) {
      return null;
    }
    if ((this.world.components.ReplicatedTag[normalizedEid] ?? 0) === 0) {
      return null;
    }
    const nid = this.getEntityNidByEid(normalizedEid);
    if (nid <= 0) {
      return null;
    }
    return {
      eid: normalizedEid,
      nid
    };
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

  public getPlayerUserIdByEid(eid: number): number | undefined {
    return this.indexes.getPlayerUserIdByEid(eid);
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
    return this.indexes.getCharacterBody(eid);
  }

  public getPlayerCollider(eid: number): RAPIER.Collider | undefined {
    return this.indexes.getCharacterCollider(eid);
  }

  public getCharacterBody(eid: number): RAPIER.RigidBody | undefined {
    return this.indexes.getCharacterBody(eid);
  }

  public getCharacterCollider(eid: number): RAPIER.Collider | undefined {
    return this.indexes.getCharacterCollider(eid);
  }

  public getPlayerColliderByNid(nid: number): RAPIER.Collider | undefined {
    const eid = this.indexes.getCharacterEidByNid(nid);
    if (typeof eid !== "number") return undefined;
    return this.indexes.getCharacterCollider(eid);
  }

  public resolveCombatTargetRuntimeByEid(targetEid: number): {
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  } | null {
    const characterBody = this.indexes.getCharacterBody(targetEid);
    const characterCollider = this.indexes.getCharacterCollider(targetEid);
    if (characterBody && characterCollider) {
      return { body: characterBody, collider: characterCollider };
    }
    const dummyBody = this.indexes.getDummyBody(targetEid);
    const dummyCollider = this.indexes.getDummyCollider(targetEid);
    if (dummyBody && dummyCollider) {
      return { body: dummyBody, collider: dummyCollider };
    }
    return null;
  }

  public resolveCombatCollisionBoundsByEid(targetEid: number): {
    radius: number;
    halfHeight: number;
  } | null {
    const runtime = this.resolveCombatTargetRuntimeByEid(targetEid);
    if (!runtime) {
      return null;
    }
    const shape = runtime.collider.shape as {
      radius?: number;
      halfHeight?: number;
      halfExtents?: { x: number; y: number; z: number };
      borderRadius?: number;
    };
    const halfExtents = shape.halfExtents;
    if (halfExtents) {
      const borderRadius = Math.max(0, shape.borderRadius ?? 0);
      return {
        radius: Math.max(0, Math.max(halfExtents.x, halfExtents.z) + borderRadius),
        halfHeight: Math.max(0, halfExtents.y + borderRadius)
      };
    }
    if (typeof shape.radius === "number" && typeof shape.halfHeight === "number") {
      const borderRadius = Math.max(0, shape.borderRadius ?? 0);
      return {
        radius: Math.max(0, shape.radius + borderRadius),
        halfHeight: Math.max(0, shape.halfHeight + borderRadius)
      };
    }
    if (typeof shape.radius === "number") {
      const radius = Math.max(0, shape.radius);
      return {
        radius,
        halfHeight: radius
      };
    }
    return null;
  }

  // ── Player runtime state (snapshot from components) ───────────────────────

  public getPlayerRuntimeStateByUserId(userId: number): PlayerStateSnapshot | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return null;
    const body = this.indexes.getCharacterBody(eid);
    const collider = this.indexes.getCharacterCollider(eid);
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

  // ── Damage state ──────────────────────────────────────────────────────────

  public isPlayerEntity(eid: number): boolean {
    return (this.world.components.PlayerTag[eid] ?? 0) !== 0;
  }

  public isNpcEntity(eid: number): boolean {
    return (this.world.components.NpcTag[eid] ?? 0) !== 0;
  }

  public isDummyEntity(eid: number): boolean {
    return (this.world.components.DummyTag[eid] ?? 0) !== 0;
  }

  public getDamageableStateByEid(eid: number): { health: number; maxHealth: number; accountId: number } | null {
    const c = this.world.components;
    const maxHealth = c.Health.max[eid];
    const health = c.Health.value[eid];
    if (typeof maxHealth !== "number" || typeof health !== "number") {
      return null;
    }
    return {
      health,
      maxHealth,
      accountId: Math.max(0, Math.floor(c.AccountId.value[eid] ?? 0))
    };
  }

  public applyDamageableStateByEid(
    eid: number,
    state: { health: number; maxHealth: number; accountId: number }
  ): void {
    const c = this.world.components;
    c.Health.value[eid] = Math.max(0, Math.floor(state.health));
    c.Health.max[eid] = Math.max(0, Math.floor(state.maxHealth));
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

  public stageCharacterForDelayedRespawnByEid(
    eid: number,
    state: {
      spawnX: number;
      spawnY: number;
      spawnZ: number;
    }
  ): { hiddenX: number; hiddenY: number; hiddenZ: number } {
    const c = this.world.components;
    const hiddenX = state.spawnX;
    const hiddenY = state.spawnY - SimulationEcs.DELAYED_RESPAWN_HIDE_Y_OFFSET;
    const hiddenZ = state.spawnZ;
    c.Health.value[eid] = 0;
    c.Velocity.x[eid] = 0;
    c.Velocity.y[eid] = 0;
    c.Velocity.z[eid] = 0;
    c.Position.x[eid] = hiddenX;
    c.Position.y[eid] = hiddenY;
    c.Position.z[eid] = hiddenZ;
    return { hiddenX, hiddenY, hiddenZ };
  }

  public restoreNpcRespawnStateByEid(
    eid: number,
    state: {
      health: number;
      maxHealth: number;
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
    }
  ): void {
    const c = this.world.components;
    c.Position.x[eid] = state.x;
    c.Position.y[eid] = state.y;
    c.Position.z[eid] = state.z;
    c.Velocity.x[eid] = 0;
    c.Velocity.y[eid] = 0;
    c.Velocity.z[eid] = 0;
    c.Yaw.value[eid] = state.yaw;
    c.Pitch.value[eid] = state.pitch;
    c.Grounded.value[eid] = 0;
    c.MovementMode.value[eid] = MOVEMENT_MODE_GROUNDED;
    c.GroundedPlatformPid.value[eid] = -1;
    c.CarriedFramePid.value[eid] = -1;
    c.Health.value[eid] = Math.max(0, Math.floor(state.health));
    c.Health.max[eid] = Math.max(0, Math.floor(state.maxHealth));
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

  public getWorldItemEids(): number[] {
    return this.store.getWorldItemTagEids();
  }

  public setEntityRenderAppearanceByEid(
    eid: number,
    patch: Partial<{
      renderArchetypeId: number;
      materialVariantId: number;
      tintColorRgb: number;
      uniformScalePct: number;
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
    }>
  ): boolean {
    const c = this.world.components;
    let changed = false;
    if (typeof patch.renderArchetypeId === "number" && Number.isFinite(patch.renderArchetypeId)) {
      const next = sanitizeRenderArchetypeId(patch.renderArchetypeId);
      if ((c.RenderArchetypeId.value[eid] ?? 0) !== next) {
        c.RenderArchetypeId.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.materialVariantId === "number" && Number.isFinite(patch.materialVariantId)) {
      const next = sanitizeMaterialVariantId(patch.materialVariantId);
      if ((c.MaterialVariantId.value[eid] ?? 0) !== next) {
        c.MaterialVariantId.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.tintColorRgb === "number" && Number.isFinite(patch.tintColorRgb)) {
      const next = sanitizeTintColorRgb(patch.tintColorRgb);
      if ((c.TintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB) !== next) {
        c.TintColorRgb.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.uniformScalePct === "number" && Number.isFinite(patch.uniformScalePct)) {
      const next = sanitizeUniformScalePct(patch.uniformScalePct);
      if ((c.UniformScalePct.value[eid] ?? 100) !== next) {
        c.UniformScalePct.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedWeaponArchetypeId === "number" && Number.isFinite(patch.equippedWeaponArchetypeId)) {
      const next = sanitizeRenderArchetypeId(patch.equippedWeaponArchetypeId);
      if ((c.EquippedWeaponArchetypeId.value[eid] ?? 0) !== next) {
        c.EquippedWeaponArchetypeId.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedWeaponTintColorRgb === "number" && Number.isFinite(patch.equippedWeaponTintColorRgb)) {
      const next = sanitizeTintColorRgb(patch.equippedWeaponTintColorRgb);
      if ((c.EquippedWeaponTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB) !== next) {
        c.EquippedWeaponTintColorRgb.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedHeadArchetypeId === "number" && Number.isFinite(patch.equippedHeadArchetypeId)) {
      const next = sanitizeRenderArchetypeId(patch.equippedHeadArchetypeId);
      if ((c.EquippedHeadArchetypeId.value[eid] ?? 0) !== next) {
        c.EquippedHeadArchetypeId.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedHeadTintColorRgb === "number" && Number.isFinite(patch.equippedHeadTintColorRgb)) {
      const next = sanitizeTintColorRgb(patch.equippedHeadTintColorRgb);
      if ((c.EquippedHeadTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB) !== next) {
        c.EquippedHeadTintColorRgb.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedBodyArchetypeId === "number" && Number.isFinite(patch.equippedBodyArchetypeId)) {
      const next = sanitizeRenderArchetypeId(patch.equippedBodyArchetypeId);
      if ((c.EquippedBodyArchetypeId.value[eid] ?? 0) !== next) {
        c.EquippedBodyArchetypeId.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedBodyTintColorRgb === "number" && Number.isFinite(patch.equippedBodyTintColorRgb)) {
      const next = sanitizeTintColorRgb(patch.equippedBodyTintColorRgb);
      if ((c.EquippedBodyTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB) !== next) {
        c.EquippedBodyTintColorRgb.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedLegsArchetypeId === "number" && Number.isFinite(patch.equippedLegsArchetypeId)) {
      const next = sanitizeRenderArchetypeId(patch.equippedLegsArchetypeId);
      if ((c.EquippedLegsArchetypeId.value[eid] ?? 0) !== next) {
        c.EquippedLegsArchetypeId.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedLegsTintColorRgb === "number" && Number.isFinite(patch.equippedLegsTintColorRgb)) {
      const next = sanitizeTintColorRgb(patch.equippedLegsTintColorRgb);
      if ((c.EquippedLegsTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB) !== next) {
        c.EquippedLegsTintColorRgb.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedAccessoryArchetypeId === "number" && Number.isFinite(patch.equippedAccessoryArchetypeId)) {
      const next = sanitizeRenderArchetypeId(patch.equippedAccessoryArchetypeId);
      if ((c.EquippedAccessoryArchetypeId.value[eid] ?? 0) !== next) {
        c.EquippedAccessoryArchetypeId.value[eid] = next;
        changed = true;
      }
    }
    if (typeof patch.equippedAccessoryTintColorRgb === "number" && Number.isFinite(patch.equippedAccessoryTintColorRgb)) {
      const next = sanitizeTintColorRgb(patch.equippedAccessoryTintColorRgb);
      if ((c.EquippedAccessoryTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB) !== next) {
        c.EquippedAccessoryTintColorRgb.value[eid] = next;
        changed = true;
      }
    }
    return changed;
  }

  public setEntityRenderAppearanceByNid(
    nid: number,
    patch: Partial<{
      renderArchetypeId: number;
      materialVariantId: number;
      tintColorRgb: number;
      uniformScalePct: number;
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
    }>
  ): boolean {
    const eid = this.getAnyEidByNid(Math.max(0, Math.floor(nid)));
    if (typeof eid !== "number") {
      return false;
    }
    return this.setEntityRenderAppearanceByEid(eid, patch);
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
