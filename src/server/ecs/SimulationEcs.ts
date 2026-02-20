import type RAPIER from "@dimforge/rapier3d-compat";
import { query } from "bitecs";
import { SimulationEcsIndexRegistry } from "./SimulationEcsIndexRegistry";
import { SimulationEcsProjectors } from "./SimulationEcsProjectors";
import { SimulationEcsStore } from "./SimulationEcsStore";
import type { DummyObject, PlayerObject, ProjectileCreateRequest, SimObject } from "./SimulationEcsTypes";

export class SimulationEcs {
  private readonly store = new SimulationEcsStore();
  private readonly indexes = new SimulationEcsIndexRegistry();
  private readonly projectors = new SimulationEcsProjectors(this.store, this.indexes);

  public registerPlayer(player: PlayerObject): void {
    const eid = this.indexes.getOrCreateEid(player, () => this.store.createEid());
    this.store.registerPlayerComponents(eid);
    this.indexes.registerPlayerRuntimeRefs(eid, player.body, player.collider);
    this.store.syncPlayerFromObject(eid, player);
  }

  public syncPlayer(player: PlayerObject): void {
    const eid = this.indexes.getEid(player);
    this.store.syncPlayerFromObject(eid, player);
  }

  public registerPlatform(platform: SimObject): void {
    const eid = this.indexes.getOrCreateEid(platform, () => this.store.createEid());
    this.store.registerPlatformComponents(eid);
    this.store.syncPlatformFromObject(eid, platform);
  }

  public syncPlatform(platform: SimObject): void {
    const eid = this.indexes.getEid(platform);
    this.store.syncPlatformFromObject(eid, platform);
  }

  public createProjectile(projectile: ProjectileCreateRequest): number {
    return this.store.createProjectile(projectile);
  }

  public registerDummy(dummy: DummyObject): void {
    const eid = this.indexes.getOrCreateEid(dummy, () => this.store.createEid());
    this.store.registerDummyComponents(eid);
    this.indexes.registerDummyRuntimeRefs(eid, dummy.body, dummy.collider);
    this.store.syncDummyFromObject(eid, dummy);
  }

  public syncDummy(dummy: DummyObject): void {
    const eid = this.indexes.getEid(dummy);
    this.store.syncDummyFromObject(eid, dummy);
  }

  public unregister(entity: object): void {
    const eid = this.indexes.getEidOrNull(entity);
    if (typeof eid !== "number") {
      return;
    }
    this.removeEntityByEid(eid);
  }

  public getEidForObject(entity: object): number | null {
    return this.indexes.getEidOrNull(entity);
  }

  public getPlayerPersistenceSnapshotByEid(eid: number): {
    accountId: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    vx: number;
    vy: number;
    vz: number;
    health: number;
    activeHotbarSlot: number;
    hotbarAbilityIds: number[];
  } | null {
    return this.projectors.getPlayerPersistenceSnapshotByEid(eid);
  }

  public bindPlayerLookupIndexes(entity: object, userId: number): void {
    const eid = this.indexes.getEidOrNull(entity);
    if (typeof eid !== "number") {
      return;
    }
    this.indexes.bindPlayerLookupIndexes(
      userId,
      eid,
      this.store.getEntityNid(eid),
      this.store.getEntityAccountId(eid)
    );
  }

  public unbindPlayerLookupIndexes(entity: object, userId: number): void {
    const eid = this.indexes.getEidOrNull(entity);
    if (typeof eid !== "number") {
      this.indexes.unbindPlayerLookupIndexesByUserId(userId);
      return;
    }

    this.indexes.unbindPlayerLookupIndexesByEntity(
      userId,
      eid,
      this.store.getEntityNid(eid),
      this.store.getEntityAccountId(eid)
    );
  }

  public getPlayerObjectByUserId<T extends object>(userId: number): T | undefined {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") {
      return undefined;
    }
    return this.indexes.getObjectByEid<T>(eid);
  }

  public getPlayerNidByUserId(userId: number): number | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") {
      return null;
    }
    return this.store.getEntityNid(eid);
  }

  public getPlayerAccountIdByUserId(userId: number): number | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") {
      return null;
    }
    return this.store.getEntityAccountId(eid);
  }

  public getOnlinePlayerUserIds(): number[] {
    return this.indexes.getOnlinePlayerUserIds();
  }

  public getPlayerColliderByNid(nid: number): RAPIER.Collider | undefined {
    const eid = this.indexes.getPlayerEidByNid(nid);
    if (typeof eid !== "number") {
      return undefined;
    }
    return this.indexes.getPlayerCollider(eid);
  }

  public getActiveProjectileEids(): number[] {
    return this.store.getProjectileTagEids();
  }

  public setProjectileNidByEid(eid: number, nid: number): void {
    this.setEntityNidByEid(eid, nid);
  }

  public setEntityNidByEid(eid: number, nid: number): void {
    const previousNid = this.store.getEntityNid(eid);
    this.store.setEntityNid(eid, nid);
    const nextNid = this.store.getEntityNid(eid);
    this.indexes.updatePlayerNidIndex(eid, previousNid, nextNid);
  }

  public getReplicationSnapshotByEid(eid: number): {
    nid: number;
    modelId: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    grounded: boolean;
    health: number;
    maxHealth: number;
  } {
    return this.projectors.getReplicationSnapshotByEid(eid);
  }

  public getProjectileRuntimeStateByEid(eid: number): {
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
  } | null {
    return this.projectors.getProjectileRuntimeStateByEid(eid);
  }

  public applyProjectileRuntimeStateByEid(
    eid: number,
    state: {
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      ttlSeconds: number;
      remainingRange: number;
      remainingPierces: number;
    }
  ): void {
    const c = this.store.world.components;
    c.Position.x[eid] = state.x;
    c.Position.y[eid] = state.y;
    c.Position.z[eid] = state.z;
    c.Velocity.x[eid] = state.vx;
    c.Velocity.y[eid] = state.vy;
    c.Velocity.z[eid] = state.vz;
    c.ProjectileTtl.value[eid] = state.ttlSeconds;
    c.ProjectileRemainingRange.value[eid] = state.remainingRange;
    c.ProjectileRemainingPierces.value[eid] = Math.max(0, Math.floor(state.remainingPierces));
  }

  public removeEntityByEid(eid: number): void {
    this.indexes.removeAllIndexesForEid(eid);
    this.store.destroyEid(eid);
  }

  public getPlayerRuntimeStateByUserId(userId: number): {
    accountId: number;
    nid: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    vx: number;
    vy: number;
    vz: number;
    grounded: boolean;
    groundedPlatformPid: number | null;
    lastProcessedSequence: number;
    lastPrimaryFireAtSeconds: number;
    primaryHeld: boolean;
    activeHotbarSlot: number;
    hotbarAbilityIds: number[];
    unlockedAbilityIds: Set<number>;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  } | null {
    return this.projectors.getPlayerRuntimeStateByUserId(userId);
  }

  public getPlayerDamageStateByEid(eid: number): {
    accountId: number;
    nid: number;
    health: number;
    maxHealth: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    grounded: boolean;
    groundedPlatformPid: number | null;
    body: RAPIER.RigidBody;
  } | null {
    return this.projectors.getPlayerDamageStateByEid(eid);
  }

  public applyPlayerDamageStateByEid(
    eid: number,
    state: {
      health: number;
      maxHealth: number;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      grounded: boolean;
      groundedPlatformPid: number | null;
    }
  ): void {
    const c = this.store.world.components;
    c.Health.value[eid] = Math.max(0, Math.floor(state.health));
    c.Health.max[eid] = Math.max(0, Math.floor(state.maxHealth));
    c.Position.x[eid] = state.x;
    c.Position.y[eid] = state.y;
    c.Position.z[eid] = state.z;
    c.Velocity.x[eid] = state.vx;
    c.Velocity.y[eid] = state.vy;
    c.Velocity.z[eid] = state.vz;
    c.Grounded.value[eid] = state.grounded ? 1 : 0;
    c.GroundedPlatformPid.value[eid] =
      state.groundedPlatformPid === null ? -1 : Math.floor(state.groundedPlatformPid);
  }

  public getDummyDamageStateByEid(eid: number): { health: number; maxHealth: number } | null {
    return this.projectors.getDummyDamageStateByEid(eid);
  }

  public applyDummyDamageStateByEid(eid: number, state: { health: number; maxHealth: number }): void {
    const c = this.store.world.components;
    c.Health.value[eid] = Math.max(0, Math.floor(state.health));
    c.Health.max[eid] = Math.max(0, Math.floor(state.maxHealth));
  }

  public resolveCombatTargetRuntime(target: { kind: "player" | "dummy"; eid: number }): {
    nid: number;
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  } | null {
    return this.projectors.resolveCombatTargetRuntime(target);
  }

  public applyPlayerRuntimeStateByUserId(
    userId: number,
    state: {
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
      vx: number;
      vy: number;
      vz: number;
      grounded: boolean;
      groundedPlatformPid: number | null;
      lastProcessedSequence: number;
      lastPrimaryFireAtSeconds: number;
      primaryHeld: boolean;
      rotation: { x: number; y: number; z: number; w: number };
    }
  ): void {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") {
      return;
    }
    const c = this.store.world.components;
    c.Position.x[eid] = state.x;
    c.Position.y[eid] = state.y;
    c.Position.z[eid] = state.z;
    c.Yaw.value[eid] = state.yaw;
    c.Pitch.value[eid] = state.pitch;
    c.Velocity.x[eid] = state.vx;
    c.Velocity.y[eid] = state.vy;
    c.Velocity.z[eid] = state.vz;
    c.Grounded.value[eid] = state.grounded ? 1 : 0;
    c.GroundedPlatformPid.value[eid] =
      state.groundedPlatformPid === null ? -1 : Math.floor(state.groundedPlatformPid);
    c.LastProcessedSequence.value[eid] = Math.max(0, Math.floor(state.lastProcessedSequence));
    c.LastPrimaryFireAtSeconds.value[eid] = state.lastPrimaryFireAtSeconds;
    c.PrimaryHeld.value[eid] = state.primaryHeld ? 1 : 0;
    c.Rotation.x[eid] = state.rotation.x;
    c.Rotation.y[eid] = state.rotation.y;
    c.Rotation.z[eid] = state.rotation.z;
    c.Rotation.w[eid] = state.rotation.w;
  }

  public getPlayerInputAckStateByUserId(userId: number): {
    nid: number;
    lastProcessedSequence: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    vx: number;
    vy: number;
    vz: number;
    grounded: boolean;
    groundedPlatformPid: number | null;
  } | null {
    return this.projectors.getPlayerInputAckStateByUserId(userId);
  }

  public getPlayerLoadoutStateByUserId(userId: number): {
    activeHotbarSlot: number;
    hotbarAbilityIds: number[];
    unlockedAbilityIds: number[];
  } | null {
    return this.projectors.getPlayerLoadoutStateByUserId(userId);
  }

  public setPlayerActiveHotbarSlotByUserId(userId: number, slot: number): boolean {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") {
      return false;
    }
    const c = this.store.world.components;
    const normalized = Math.max(0, Math.floor(Number.isFinite(slot) ? slot : 0));
    const previous = c.ActiveHotbarSlot.value[eid] ?? 0;
    c.ActiveHotbarSlot.value[eid] = normalized;
    return previous !== normalized;
  }

  public setPlayerHotbarAbilityByUserId(userId: number, slot: number, abilityId: number): boolean {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") {
      return false;
    }
    return this.store.setHotbarAbilityBySlot(eid, slot, abilityId);
  }

  public getPlayerPersistenceSnapshotByAccountId(accountId: number): {
    accountId: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    vx: number;
    vy: number;
    vz: number;
    health: number;
    activeHotbarSlot: number;
    hotbarAbilityIds: number[];
  } | null {
    const eid = this.indexes.getPlayerEidByAccountId(accountId);
    if (typeof eid !== "number") {
      return null;
    }
    return this.projectors.getPlayerPersistenceSnapshotByEid(eid);
  }

  public getOnlinePlayerCount(): number {
    return this.indexes.getOnlinePlayerCount();
  }

  public getStats(): {
    players: number;
    platforms: number;
    projectiles: number;
    dummies: number;
    total: number;
  } {
    const world = this.store.world;
    const players = query(world, [world.components.PlayerTag]).length;
    const platforms = query(world, [world.components.PlatformTag]).length;
    const projectiles = query(world, [world.components.ProjectileTag]).length;
    const dummies = query(world, [world.components.DummyTag]).length;
    return {
      players,
      platforms,
      projectiles,
      dummies,
      total: players + platforms + projectiles + dummies
    };
  }

  public forEachReplicatedSnapshot(
    visitor: (
      eid: number,
      snapshot: {
        nid: number;
        modelId: number;
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number; w: number };
        grounded: boolean;
        health: number;
        maxHealth: number;
      }
    ) => void
  ): void {
    const replicatedEids = this.store.getReplicatedTagEids();
    for (const eid of replicatedEids) {
      visitor(eid, this.projectors.getReplicationSnapshotByEid(eid));
    }
  }

  public forEachReplicatedState(
    visitor: (
      eid: number,
      nid: number,
      modelId: number,
      x: number,
      y: number,
      z: number,
      rx: number,
      ry: number,
      rz: number,
      rw: number,
      grounded: boolean,
      health: number,
      maxHealth: number
    ) => void
  ): void {
    const c = this.store.world.components;
    const replicatedEids = this.store.getReplicatedTagEids();
    for (const eid of replicatedEids) {
      visitor(
        eid,
        c.NengiNid.value[eid] ?? 0,
        c.ModelId.value[eid] ?? 0,
        c.Position.x[eid] ?? 0,
        c.Position.y[eid] ?? 0,
        c.Position.z[eid] ?? 0,
        c.Rotation.x[eid] ?? 0,
        c.Rotation.y[eid] ?? 0,
        c.Rotation.z[eid] ?? 0,
        c.Rotation.w[eid] ?? 1,
        (c.Grounded.value[eid] ?? 0) !== 0,
        c.Health.value[eid] ?? 0,
        c.Health.max[eid] ?? 0
      );
    }
  }

  public getOnlinePlayerPositionsXZ(): Array<{ x: number; z: number }> {
    return this.projectors.getOnlinePlayerPositionsXZ();
  }
}
