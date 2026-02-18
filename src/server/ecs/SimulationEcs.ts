import { addComponent, addEntity, createWorld, query, removeEntity } from "bitecs";
import type RAPIER from "@dimforge/rapier3d-compat";
import { HOTBAR_SLOT_COUNT } from "../../shared/index";

type SimObject = {
  nid: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  health: number;
  maxHealth: number;
  grounded: boolean;
};

type PlayerObject = SimObject & {
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

type DummyObject = SimObject & {
  nid: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

type WorldWithComponents = {
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
    ReplicatedTag: number[];
    PlayerTag: number[];
    PlatformTag: number[];
    ProjectileTag: number[];
    DummyTag: number[];
  };
};

export class SimulationEcs {
  private readonly world = createWorld({
    components: {
      NengiNid: { value: [] as number[] },
      ModelId: { value: [] as number[] },
      Position: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Rotation: { x: [] as number[], y: [] as number[], z: [] as number[], w: [] as number[] },
      Velocity: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Health: { value: [] as number[], max: [] as number[] },
      Grounded: { value: [] as number[] },
      GroundedPlatformPid: { value: [] as number[] },
      AccountId: { value: [] as number[] },
      Yaw: { value: [] as number[] },
      Pitch: { value: [] as number[] },
      LastProcessedSequence: { value: [] as number[] },
      LastPrimaryFireAtSeconds: { value: [] as number[] },
      PrimaryHeld: { value: [] as number[] },
      ProjectileOwnerNid: { value: [] as number[] },
      ProjectileKind: { value: [] as number[] },
      ProjectileRadius: { value: [] as number[] },
      ProjectileDamage: { value: [] as number[] },
      ProjectileTtl: { value: [] as number[] },
      ProjectileRemainingRange: { value: [] as number[] },
      ProjectileGravity: { value: [] as number[] },
      ProjectileDrag: { value: [] as number[] },
      ProjectileMaxSpeed: { value: [] as number[] },
      ProjectileMinSpeed: { value: [] as number[] },
      ProjectileRemainingPierces: { value: [] as number[] },
      ProjectileDespawnOnDamageableHit: { value: [] as number[] },
      ProjectileDespawnOnWorldHit: { value: [] as number[] },
      ActiveHotbarSlot: { value: [] as number[] },
      Hotbar: {
        slot0: [] as number[],
        slot1: [] as number[],
        slot2: [] as number[],
        slot3: [] as number[],
        slot4: [] as number[]
      },
      ReplicatedTag: [] as number[],
      PlayerTag: [] as number[],
      PlatformTag: [] as number[],
      ProjectileTag: [] as number[],
      DummyTag: [] as number[]
    }
  }) as WorldWithComponents;

  private readonly objectToEid = new WeakMap<object, number>();
  private readonly eidToObject = new Map<number, object>();
  private readonly boundEntities = new WeakSet<object>();
  private readonly playerEidByUserId = new Map<number, number>();
  private readonly playerEidByNid = new Map<number, number>();
  private readonly playerEidByAccountId = new Map<number, number>();
  private readonly playerBodyByEid = new Map<number, RAPIER.RigidBody>();
  private readonly playerColliderByEid = new Map<number, RAPIER.Collider>();
  private readonly dummyBodyByEid = new Map<number, RAPIER.RigidBody>();
  private readonly dummyColliderByEid = new Map<number, RAPIER.Collider>();
  private readonly unlockedAbilityIdsByPlayerEid = new Map<number, Set<number>>();

  public registerPlayer(player: PlayerObject): void {
    const eid = this.getOrCreateEid(player);
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.ReplicatedTag);
    addComponent(this.world, eid, this.world.components.PlayerTag);
    addComponent(this.world, eid, this.world.components.Velocity);
    addComponent(this.world, eid, this.world.components.GroundedPlatformPid);
    addComponent(this.world, eid, this.world.components.AccountId);
    addComponent(this.world, eid, this.world.components.Yaw);
    addComponent(this.world, eid, this.world.components.Pitch);
    addComponent(this.world, eid, this.world.components.LastProcessedSequence);
    addComponent(this.world, eid, this.world.components.LastPrimaryFireAtSeconds);
    addComponent(this.world, eid, this.world.components.PrimaryHeld);
    addComponent(this.world, eid, this.world.components.ActiveHotbarSlot);
    addComponent(this.world, eid, this.world.components.Hotbar);
    this.playerBodyByEid.set(eid, player.body);
    this.playerColliderByEid.set(eid, player.collider);
    this.unlockedAbilityIdsByPlayerEid.set(eid, new Set<number>(player.unlockedAbilityIds));
    this.syncPlayer(player);
    this.bindPlayerAccessors(player, eid);
  }

  public syncPlayer(player: PlayerObject): void {
    const eid = this.getEid(player);
    this.syncBase(eid, player);
    this.world.components.Velocity.x[eid] = player.vx;
    this.world.components.Velocity.y[eid] = player.vy;
    this.world.components.Velocity.z[eid] = player.vz;
    this.world.components.GroundedPlatformPid.value[eid] =
      player.groundedPlatformPid === null ? -1 : Math.floor(player.groundedPlatformPid);
    this.world.components.AccountId.value[eid] = Math.max(0, Math.floor(player.accountId));
    this.world.components.Yaw.value[eid] = player.yaw;
    this.world.components.Pitch.value[eid] = player.pitch;
    this.world.components.LastProcessedSequence.value[eid] = Math.max(
      0,
      Math.floor(player.lastProcessedSequence)
    );
    this.world.components.LastPrimaryFireAtSeconds.value[eid] = player.lastPrimaryFireAtSeconds;
    this.world.components.PrimaryHeld.value[eid] = player.primaryHeld ? 1 : 0;
    this.world.components.ActiveHotbarSlot.value[eid] = Math.max(
      0,
      Math.floor(player.activeHotbarSlot)
    );
    this.world.components.Hotbar.slot0[eid] = Math.max(0, Math.floor(player.hotbarAbilityIds[0] ?? 0));
    this.world.components.Hotbar.slot1[eid] = Math.max(0, Math.floor(player.hotbarAbilityIds[1] ?? 0));
    this.world.components.Hotbar.slot2[eid] = Math.max(0, Math.floor(player.hotbarAbilityIds[2] ?? 0));
    this.world.components.Hotbar.slot3[eid] = Math.max(0, Math.floor(player.hotbarAbilityIds[3] ?? 0));
    this.world.components.Hotbar.slot4[eid] = Math.max(0, Math.floor(player.hotbarAbilityIds[4] ?? 0));
  }

  public registerPlatform(platform: SimObject): void {
    const eid = this.getOrCreateEid(platform);
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.ReplicatedTag);
    addComponent(this.world, eid, this.world.components.PlatformTag);
    this.syncPlatform(platform);
    this.bindPlatformAccessors(platform, eid);
  }

  public syncPlatform(platform: SimObject): void {
    const eid = this.getEid(platform);
    this.syncBase(eid, platform);
  }

  public createProjectile(projectile: {
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
  }): number {
    const eid = addEntity(this.world);
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.ReplicatedTag);
    addComponent(this.world, eid, this.world.components.ProjectileTag);
    addComponent(this.world, eid, this.world.components.Velocity);
    addComponent(this.world, eid, this.world.components.ProjectileOwnerNid);
    addComponent(this.world, eid, this.world.components.ProjectileKind);
    addComponent(this.world, eid, this.world.components.ProjectileRadius);
    addComponent(this.world, eid, this.world.components.ProjectileDamage);
    addComponent(this.world, eid, this.world.components.ProjectileTtl);
    addComponent(this.world, eid, this.world.components.ProjectileRemainingRange);
    addComponent(this.world, eid, this.world.components.ProjectileGravity);
    addComponent(this.world, eid, this.world.components.ProjectileDrag);
    addComponent(this.world, eid, this.world.components.ProjectileMaxSpeed);
    addComponent(this.world, eid, this.world.components.ProjectileMinSpeed);
    addComponent(this.world, eid, this.world.components.ProjectileRemainingPierces);
    addComponent(this.world, eid, this.world.components.ProjectileDespawnOnDamageableHit);
    addComponent(this.world, eid, this.world.components.ProjectileDespawnOnWorldHit);
    this.world.components.NengiNid.value[eid] = 0;
    this.world.components.ModelId.value[eid] = Math.max(0, Math.floor(projectile.modelId));
    this.world.components.Position.x[eid] = projectile.x;
    this.world.components.Position.y[eid] = projectile.y;
    this.world.components.Position.z[eid] = projectile.z;
    this.world.components.Rotation.x[eid] = 0;
    this.world.components.Rotation.y[eid] = 0;
    this.world.components.Rotation.z[eid] = 0;
    this.world.components.Rotation.w[eid] = 1;
    this.world.components.Grounded.value[eid] = 0;
    this.world.components.Health.value[eid] = 0;
    this.world.components.Health.max[eid] = 0;
    this.world.components.Velocity.x[eid] = projectile.vx;
    this.world.components.Velocity.y[eid] = projectile.vy;
    this.world.components.Velocity.z[eid] = projectile.vz;
    this.world.components.ProjectileOwnerNid.value[eid] = Math.max(0, Math.floor(projectile.ownerNid));
    this.world.components.ProjectileKind.value[eid] = Math.max(0, Math.floor(projectile.kind));
    this.world.components.ProjectileRadius.value[eid] = Math.max(0, projectile.radius);
    this.world.components.ProjectileDamage.value[eid] = Math.max(0, projectile.damage);
    this.world.components.ProjectileTtl.value[eid] = projectile.ttlSeconds;
    this.world.components.ProjectileRemainingRange.value[eid] = projectile.remainingRange;
    this.world.components.ProjectileGravity.value[eid] = projectile.gravity;
    this.world.components.ProjectileDrag.value[eid] = Math.max(0, projectile.drag);
    this.world.components.ProjectileMaxSpeed.value[eid] = Math.max(0, projectile.maxSpeed);
    this.world.components.ProjectileMinSpeed.value[eid] = Math.max(0, projectile.minSpeed);
    this.world.components.ProjectileRemainingPierces.value[eid] = Math.max(
      0,
      Math.floor(projectile.remainingPierces)
    );
    this.world.components.ProjectileDespawnOnDamageableHit.value[eid] = projectile.despawnOnDamageableHit
      ? 1
      : 0;
    this.world.components.ProjectileDespawnOnWorldHit.value[eid] = projectile.despawnOnWorldHit ? 1 : 0;
    return eid;
  }

  public registerDummy(dummy: DummyObject): void {
    const eid = this.getOrCreateEid(dummy);
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.ReplicatedTag);
    addComponent(this.world, eid, this.world.components.DummyTag);
    this.dummyBodyByEid.set(eid, dummy.body);
    this.dummyColliderByEid.set(eid, dummy.collider);
    this.syncDummy(dummy);
    this.bindDummyAccessors(dummy, eid);
  }

  public syncDummy(dummy: DummyObject): void {
    const eid = this.getEid(dummy);
    this.syncBase(eid, dummy);
  }

  public unregister(entity: object): void {
    const eid = this.objectToEid.get(entity);
    if (typeof eid !== "number") {
      return;
    }
    this.removeEntityByEid(eid);
  }

  public getEidForObject(entity: object): number | null {
    const eid = this.objectToEid.get(entity);
    return typeof eid === "number" ? eid : null;
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
    const entity = this.eidToObject.get(eid);
    if (!entity) {
      return null;
    }
    return {
      accountId: Math.max(1, Math.floor(this.world.components.AccountId.value[eid] ?? 1)),
      x: this.world.components.Position.x[eid] ?? 0,
      y: this.world.components.Position.y[eid] ?? 0,
      z: this.world.components.Position.z[eid] ?? 0,
      yaw: this.world.components.Yaw.value[eid] ?? 0,
      pitch: this.world.components.Pitch.value[eid] ?? 0,
      vx: this.world.components.Velocity.x[eid] ?? 0,
      vy: this.world.components.Velocity.y[eid] ?? 0,
      vz: this.world.components.Velocity.z[eid] ?? 0,
      health: Math.max(0, Math.floor(this.world.components.Health.value[eid] ?? 0)),
      activeHotbarSlot: Math.max(0, Math.floor(this.world.components.ActiveHotbarSlot.value[eid] ?? 0)),
      hotbarAbilityIds: [
        this.world.components.Hotbar.slot0[eid] ?? 0,
        this.world.components.Hotbar.slot1[eid] ?? 0,
        this.world.components.Hotbar.slot2[eid] ?? 0,
        this.world.components.Hotbar.slot3[eid] ?? 0,
        this.world.components.Hotbar.slot4[eid] ?? 0
      ]
    };
  }

  public bindPlayerLookupIndexes(entity: object, userId: number): void {
    const eid = this.objectToEid.get(entity);
    if (typeof eid !== "number") {
      return;
    }
    this.playerEidByUserId.set(userId, eid);
    this.playerEidByNid.set(Math.max(0, Math.floor(this.world.components.NengiNid.value[eid] ?? 0)), eid);
    this.playerEidByAccountId.set(Math.max(1, Math.floor(this.world.components.AccountId.value[eid] ?? 1)), eid);
  }

  public unbindPlayerLookupIndexes(entity: object, userId: number): void {
    const eid = this.objectToEid.get(entity);
    if (typeof eid !== "number") {
      this.playerEidByUserId.delete(userId);
      return;
    }
    this.playerEidByUserId.delete(userId);
    this.playerEidByNid.delete(Math.max(0, Math.floor(this.world.components.NengiNid.value[eid] ?? 0)));
    this.playerEidByAccountId.delete(Math.max(1, Math.floor(this.world.components.AccountId.value[eid] ?? 1)));
  }

  public getPlayerObjectByUserId<T extends object>(userId: number): T | undefined {
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return undefined;
    }
    const entity = this.eidToObject.get(eid) as T | undefined;
    return entity;
  }

  public getPlayerNidByUserId(userId: number): number | null {
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return null;
    }
    return this.world.components.NengiNid.value[eid] ?? null;
  }

  public getPlayerAccountIdByUserId(userId: number): number | null {
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return null;
    }
    return this.world.components.AccountId.value[eid] ?? null;
  }

  public getOnlinePlayerUserIds(): number[] {
    return Array.from(this.playerEidByUserId.keys());
  }

  public getPlayerColliderByNid(nid: number): RAPIER.Collider | undefined {
    const eid = this.playerEidByNid.get(Math.max(0, Math.floor(nid)));
    if (typeof eid !== "number") {
      return undefined;
    }
    return this.playerColliderByEid.get(eid);
  }

  public getActiveProjectileEids(): number[] {
    return Array.from(query(this.world, [this.world.components.ProjectileTag]));
  }

  public setProjectileNidByEid(eid: number, nid: number): void {
    this.world.components.NengiNid.value[eid] = Math.max(0, Math.floor(nid));
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
    return {
      nid: this.world.components.NengiNid.value[eid] ?? 0,
      modelId: this.world.components.ModelId.value[eid] ?? 0,
      position: {
        x: this.world.components.Position.x[eid] ?? 0,
        y: this.world.components.Position.y[eid] ?? 0,
        z: this.world.components.Position.z[eid] ?? 0
      },
      rotation: {
        x: this.world.components.Rotation.x[eid] ?? 0,
        y: this.world.components.Rotation.y[eid] ?? 0,
        z: this.world.components.Rotation.z[eid] ?? 0,
        w: this.world.components.Rotation.w[eid] ?? 1
      },
      grounded: (this.world.components.Grounded.value[eid] ?? 0) !== 0,
      health: this.world.components.Health.value[eid] ?? 0,
      maxHealth: this.world.components.Health.max[eid] ?? 0
    };
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
    const nid = this.world.components.NengiNid.value[eid];
    if (typeof nid !== "number") {
      return null;
    }
    return {
      ownerNid: this.world.components.ProjectileOwnerNid.value[eid] ?? 0,
      kind: this.world.components.ProjectileKind.value[eid] ?? 0,
      x: this.world.components.Position.x[eid] ?? 0,
      y: this.world.components.Position.y[eid] ?? 0,
      z: this.world.components.Position.z[eid] ?? 0,
      vx: this.world.components.Velocity.x[eid] ?? 0,
      vy: this.world.components.Velocity.y[eid] ?? 0,
      vz: this.world.components.Velocity.z[eid] ?? 0,
      radius: this.world.components.ProjectileRadius.value[eid] ?? 0,
      damage: this.world.components.ProjectileDamage.value[eid] ?? 0,
      ttlSeconds: this.world.components.ProjectileTtl.value[eid] ?? 0,
      remainingRange: this.world.components.ProjectileRemainingRange.value[eid] ?? 0,
      gravity: this.world.components.ProjectileGravity.value[eid] ?? 0,
      drag: this.world.components.ProjectileDrag.value[eid] ?? 0,
      maxSpeed: this.world.components.ProjectileMaxSpeed.value[eid] ?? 0,
      minSpeed: this.world.components.ProjectileMinSpeed.value[eid] ?? 0,
      remainingPierces: this.world.components.ProjectileRemainingPierces.value[eid] ?? 0,
      despawnOnDamageableHit: (this.world.components.ProjectileDespawnOnDamageableHit.value[eid] ?? 0) !== 0,
      despawnOnWorldHit: (this.world.components.ProjectileDespawnOnWorldHit.value[eid] ?? 0) !== 0
    };
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
    this.world.components.Position.x[eid] = state.x;
    this.world.components.Position.y[eid] = state.y;
    this.world.components.Position.z[eid] = state.z;
    this.world.components.Velocity.x[eid] = state.vx;
    this.world.components.Velocity.y[eid] = state.vy;
    this.world.components.Velocity.z[eid] = state.vz;
    this.world.components.ProjectileTtl.value[eid] = state.ttlSeconds;
    this.world.components.ProjectileRemainingRange.value[eid] = state.remainingRange;
    this.world.components.ProjectileRemainingPierces.value[eid] = Math.max(
      0,
      Math.floor(state.remainingPierces)
    );
  }

  public removeEntityByEid(eid: number): void {
    const entity = this.eidToObject.get(eid);
    if (entity) {
      this.objectToEid.delete(entity);
      this.eidToObject.delete(eid);
    }
    this.removePlayerLookupIndexesForEid(eid);
    this.playerBodyByEid.delete(eid);
    this.playerColliderByEid.delete(eid);
    this.dummyBodyByEid.delete(eid);
    this.dummyColliderByEid.delete(eid);
    this.unlockedAbilityIdsByPlayerEid.delete(eid);
    removeEntity(this.world, eid);
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
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return null;
    }
    const body = this.playerBodyByEid.get(eid);
    const collider = this.playerColliderByEid.get(eid);
    if (!body || !collider) {
      return null;
    }
    const groundedPlatformPidRaw = this.world.components.GroundedPlatformPid.value[eid] ?? -1;
    return {
      accountId: Math.max(1, Math.floor(this.world.components.AccountId.value[eid] ?? 1)),
      nid: this.world.components.NengiNid.value[eid] ?? 0,
      x: this.world.components.Position.x[eid] ?? 0,
      y: this.world.components.Position.y[eid] ?? 0,
      z: this.world.components.Position.z[eid] ?? 0,
      yaw: this.world.components.Yaw.value[eid] ?? 0,
      pitch: this.world.components.Pitch.value[eid] ?? 0,
      vx: this.world.components.Velocity.x[eid] ?? 0,
      vy: this.world.components.Velocity.y[eid] ?? 0,
      vz: this.world.components.Velocity.z[eid] ?? 0,
      grounded: (this.world.components.Grounded.value[eid] ?? 0) !== 0,
      groundedPlatformPid: groundedPlatformPidRaw < 0 ? null : groundedPlatformPidRaw,
      lastProcessedSequence: this.world.components.LastProcessedSequence.value[eid] ?? 0,
      lastPrimaryFireAtSeconds:
        this.world.components.LastPrimaryFireAtSeconds.value[eid] ?? Number.NEGATIVE_INFINITY,
      primaryHeld: (this.world.components.PrimaryHeld.value[eid] ?? 0) !== 0,
      activeHotbarSlot: Math.max(0, Math.floor(this.world.components.ActiveHotbarSlot.value[eid] ?? 0)),
      hotbarAbilityIds: [
        this.world.components.Hotbar.slot0[eid] ?? 0,
        this.world.components.Hotbar.slot1[eid] ?? 0,
        this.world.components.Hotbar.slot2[eid] ?? 0,
        this.world.components.Hotbar.slot3[eid] ?? 0,
        this.world.components.Hotbar.slot4[eid] ?? 0
      ],
      unlockedAbilityIds: new Set<number>(this.unlockedAbilityIdsByPlayerEid.get(eid) ?? []),
      position: {
        x: this.world.components.Position.x[eid] ?? 0,
        y: this.world.components.Position.y[eid] ?? 0,
        z: this.world.components.Position.z[eid] ?? 0
      },
      rotation: {
        x: this.world.components.Rotation.x[eid] ?? 0,
        y: this.world.components.Rotation.y[eid] ?? 0,
        z: this.world.components.Rotation.z[eid] ?? 0,
        w: this.world.components.Rotation.w[eid] ?? 1
      },
      body,
      collider
    };
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
    const body = this.playerBodyByEid.get(eid);
    if (!body) {
      return null;
    }
    const groundedPlatformPidRaw = this.world.components.GroundedPlatformPid.value[eid] ?? -1;
    return {
      accountId: Math.max(1, Math.floor(this.world.components.AccountId.value[eid] ?? 1)),
      nid: this.world.components.NengiNid.value[eid] ?? 0,
      health: this.world.components.Health.value[eid] ?? 0,
      maxHealth: this.world.components.Health.max[eid] ?? 0,
      x: this.world.components.Position.x[eid] ?? 0,
      y: this.world.components.Position.y[eid] ?? 0,
      z: this.world.components.Position.z[eid] ?? 0,
      vx: this.world.components.Velocity.x[eid] ?? 0,
      vy: this.world.components.Velocity.y[eid] ?? 0,
      vz: this.world.components.Velocity.z[eid] ?? 0,
      grounded: (this.world.components.Grounded.value[eid] ?? 0) !== 0,
      groundedPlatformPid: groundedPlatformPidRaw < 0 ? null : groundedPlatformPidRaw,
      body
    };
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
    this.world.components.Health.value[eid] = Math.max(0, Math.floor(state.health));
    this.world.components.Health.max[eid] = Math.max(0, Math.floor(state.maxHealth));
    this.world.components.Position.x[eid] = state.x;
    this.world.components.Position.y[eid] = state.y;
    this.world.components.Position.z[eid] = state.z;
    this.world.components.Velocity.x[eid] = state.vx;
    this.world.components.Velocity.y[eid] = state.vy;
    this.world.components.Velocity.z[eid] = state.vz;
    this.world.components.Grounded.value[eid] = state.grounded ? 1 : 0;
    this.world.components.GroundedPlatformPid.value[eid] =
      state.groundedPlatformPid === null ? -1 : Math.floor(state.groundedPlatformPid);
  }

  public getDummyDamageStateByEid(eid: number): { health: number; maxHealth: number } | null {
    if (!this.dummyBodyByEid.has(eid)) {
      return null;
    }
    return {
      health: this.world.components.Health.value[eid] ?? 0,
      maxHealth: this.world.components.Health.max[eid] ?? 0
    };
  }

  public applyDummyDamageStateByEid(eid: number, state: { health: number; maxHealth: number }): void {
    this.world.components.Health.value[eid] = Math.max(0, Math.floor(state.health));
    this.world.components.Health.max[eid] = Math.max(0, Math.floor(state.maxHealth));
  }

  public resolveCombatTargetRuntime(target: { kind: "player" | "dummy"; eid: number }): {
    nid: number;
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  } | null {
    if (target.kind === "player") {
      const body = this.playerBodyByEid.get(target.eid);
      const collider = this.playerColliderByEid.get(target.eid);
      if (!body || !collider) {
        return null;
      }
      return {
        nid: this.world.components.NengiNid.value[target.eid] ?? 0,
        body,
        collider
      };
    }
    const body = this.dummyBodyByEid.get(target.eid);
    const collider = this.dummyColliderByEid.get(target.eid);
    if (!body || !collider) {
      return null;
    }
    return {
      nid: this.world.components.NengiNid.value[target.eid] ?? 0,
      body,
      collider
    };
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
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return;
    }
    this.world.components.Position.x[eid] = state.x;
    this.world.components.Position.y[eid] = state.y;
    this.world.components.Position.z[eid] = state.z;
    this.world.components.Yaw.value[eid] = state.yaw;
    this.world.components.Pitch.value[eid] = state.pitch;
    this.world.components.Velocity.x[eid] = state.vx;
    this.world.components.Velocity.y[eid] = state.vy;
    this.world.components.Velocity.z[eid] = state.vz;
    this.world.components.Grounded.value[eid] = state.grounded ? 1 : 0;
    this.world.components.GroundedPlatformPid.value[eid] =
      state.groundedPlatformPid === null ? -1 : Math.floor(state.groundedPlatformPid);
    this.world.components.LastProcessedSequence.value[eid] = Math.max(
      0,
      Math.floor(state.lastProcessedSequence)
    );
    this.world.components.LastPrimaryFireAtSeconds.value[eid] = state.lastPrimaryFireAtSeconds;
    this.world.components.PrimaryHeld.value[eid] = state.primaryHeld ? 1 : 0;
    this.world.components.Rotation.x[eid] = state.rotation.x;
    this.world.components.Rotation.y[eid] = state.rotation.y;
    this.world.components.Rotation.z[eid] = state.rotation.z;
    this.world.components.Rotation.w[eid] = state.rotation.w;
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
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return null;
    }
    const groundedPlatformPidRaw = this.world.components.GroundedPlatformPid.value[eid] ?? -1;
    return {
      nid: this.world.components.NengiNid.value[eid] ?? 0,
      lastProcessedSequence: this.world.components.LastProcessedSequence.value[eid] ?? 0,
      x: this.world.components.Position.x[eid] ?? 0,
      y: this.world.components.Position.y[eid] ?? 0,
      z: this.world.components.Position.z[eid] ?? 0,
      yaw: this.world.components.Yaw.value[eid] ?? 0,
      pitch: this.world.components.Pitch.value[eid] ?? 0,
      vx: this.world.components.Velocity.x[eid] ?? 0,
      vy: this.world.components.Velocity.y[eid] ?? 0,
      vz: this.world.components.Velocity.z[eid] ?? 0,
      grounded: (this.world.components.Grounded.value[eid] ?? 0) !== 0,
      groundedPlatformPid: groundedPlatformPidRaw < 0 ? null : groundedPlatformPidRaw
    };
  }

  public getPlayerLoadoutStateByUserId(userId: number): {
    activeHotbarSlot: number;
    hotbarAbilityIds: number[];
    unlockedAbilityIds: number[];
  } | null {
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return null;
    }
    return {
      activeHotbarSlot: Math.max(0, Math.floor(this.world.components.ActiveHotbarSlot.value[eid] ?? 0)),
      hotbarAbilityIds: [
        this.world.components.Hotbar.slot0[eid] ?? 0,
        this.world.components.Hotbar.slot1[eid] ?? 0,
        this.world.components.Hotbar.slot2[eid] ?? 0,
        this.world.components.Hotbar.slot3[eid] ?? 0,
        this.world.components.Hotbar.slot4[eid] ?? 0
      ],
      unlockedAbilityIds: Array.from(this.unlockedAbilityIdsByPlayerEid.get(eid) ?? [])
    };
  }

  public setPlayerActiveHotbarSlotByUserId(userId: number, slot: number): boolean {
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return false;
    }
    const normalized = Math.max(0, Math.floor(Number.isFinite(slot) ? slot : 0));
    const previous = this.world.components.ActiveHotbarSlot.value[eid] ?? 0;
    this.world.components.ActiveHotbarSlot.value[eid] = normalized;
    return previous !== normalized;
  }

  public setPlayerHotbarAbilityByUserId(userId: number, slot: number, abilityId: number): boolean {
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return false;
    }
    const normalizedAbilityId = Math.max(0, Math.floor(Number.isFinite(abilityId) ? abilityId : 0));
    const normalizedSlot = Math.max(0, Math.floor(Number.isFinite(slot) ? slot : 0));
    if (normalizedSlot === 0) {
      const previous = this.world.components.Hotbar.slot0[eid] ?? 0;
      this.world.components.Hotbar.slot0[eid] = normalizedAbilityId;
      return previous !== normalizedAbilityId;
    }
    if (normalizedSlot === 1) {
      const previous = this.world.components.Hotbar.slot1[eid] ?? 0;
      this.world.components.Hotbar.slot1[eid] = normalizedAbilityId;
      return previous !== normalizedAbilityId;
    }
    if (normalizedSlot === 2) {
      const previous = this.world.components.Hotbar.slot2[eid] ?? 0;
      this.world.components.Hotbar.slot2[eid] = normalizedAbilityId;
      return previous !== normalizedAbilityId;
    }
    if (normalizedSlot === 3) {
      const previous = this.world.components.Hotbar.slot3[eid] ?? 0;
      this.world.components.Hotbar.slot3[eid] = normalizedAbilityId;
      return previous !== normalizedAbilityId;
    }
    if (normalizedSlot === 4) {
      const previous = this.world.components.Hotbar.slot4[eid] ?? 0;
      this.world.components.Hotbar.slot4[eid] = normalizedAbilityId;
      return previous !== normalizedAbilityId;
    }
    return false;
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
    const eid = this.playerEidByAccountId.get(Math.max(1, Math.floor(accountId)));
    if (typeof eid !== "number") {
      return null;
    }
    return this.getPlayerPersistenceSnapshotByEid(eid);
  }

  public getOnlinePlayerCount(): number {
    return this.playerEidByUserId.size;
  }

  public getStats(): {
    players: number;
    platforms: number;
    projectiles: number;
    dummies: number;
    total: number;
  } {
    const players = query(this.world, [this.world.components.PlayerTag]).length;
    const platforms = query(this.world, [this.world.components.PlatformTag]).length;
    const projectiles = query(this.world, [this.world.components.ProjectileTag]).length;
    const dummies = query(this.world, [this.world.components.DummyTag]).length;
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
    const replicatedEids = query(this.world, [this.world.components.ReplicatedTag]);
    for (const eid of replicatedEids) {
      visitor(eid, {
        nid: this.world.components.NengiNid.value[eid] ?? 0,
        modelId: this.world.components.ModelId.value[eid] ?? 0,
        position: {
          x: this.world.components.Position.x[eid] ?? 0,
          y: this.world.components.Position.y[eid] ?? 0,
          z: this.world.components.Position.z[eid] ?? 0
        },
        rotation: {
          x: this.world.components.Rotation.x[eid] ?? 0,
          y: this.world.components.Rotation.y[eid] ?? 0,
          z: this.world.components.Rotation.z[eid] ?? 0,
          w: this.world.components.Rotation.w[eid] ?? 1
        },
        grounded: (this.world.components.Grounded.value[eid] ?? 0) !== 0,
        health: this.world.components.Health.value[eid] ?? 0,
        maxHealth: this.world.components.Health.max[eid] ?? 0
      });
    }
  }

  public getOnlinePlayerPositionsXZ(): Array<{ x: number; z: number }> {
    const occupied: Array<{ x: number; z: number }> = [];
    for (const eid of this.playerEidByUserId.values()) {
      occupied.push({
        x: this.world.components.Position.x[eid] ?? 0,
        z: this.world.components.Position.z[eid] ?? 0
      });
    }
    return occupied;
  }

  private ensureBaseComponents(eid: number): void {
    addComponent(this.world, eid, this.world.components.NengiNid);
    addComponent(this.world, eid, this.world.components.ModelId);
    addComponent(this.world, eid, this.world.components.Position);
    addComponent(this.world, eid, this.world.components.Rotation);
    addComponent(this.world, eid, this.world.components.Grounded);
    addComponent(this.world, eid, this.world.components.Health);
  }

  private syncBase(eid: number, entity: SimObject): void {
    this.world.components.NengiNid.value[eid] = entity.nid;
    this.world.components.ModelId.value[eid] = entity.modelId;
    this.world.components.Position.x[eid] = entity.position.x;
    this.world.components.Position.y[eid] = entity.position.y;
    this.world.components.Position.z[eid] = entity.position.z;
    this.world.components.Rotation.x[eid] = entity.rotation.x;
    this.world.components.Rotation.y[eid] = entity.rotation.y;
    this.world.components.Rotation.z[eid] = entity.rotation.z;
    this.world.components.Rotation.w[eid] = entity.rotation.w;
    this.world.components.Grounded.value[eid] = entity.grounded ? 1 : 0;
    this.world.components.Health.value[eid] = Math.max(0, Math.floor(entity.health));
    this.world.components.Health.max[eid] = Math.max(0, Math.floor(entity.maxHealth));
  }

  private getOrCreateEid(entity: object): number {
    const existingEid = this.objectToEid.get(entity);
    if (typeof existingEid === "number") {
      return existingEid;
    }
    const eid = addEntity(this.world);
    this.objectToEid.set(entity, eid);
    this.eidToObject.set(eid, entity);
    return eid;
  }

  private getEid(entity: object): number {
    const eid = this.objectToEid.get(entity);
    if (typeof eid !== "number") {
      throw new Error("SimulationEcs entity was not registered");
    }
    return eid;
  }

  private bindPlayerAccessors(player: PlayerObject, eid: number): void {
    if (this.boundEntities.has(player)) {
      return;
    }
    this.bindBaseAccessors(player, eid, true);
    this.defineNumberProxy(player, "vx", () => this.world.components.Velocity.x[eid] ?? 0, (value) => {
      this.world.components.Velocity.x[eid] = value;
    });
    this.defineNumberProxy(player, "vy", () => this.world.components.Velocity.y[eid] ?? 0, (value) => {
      this.world.components.Velocity.y[eid] = value;
    });
    this.defineNumberProxy(player, "vz", () => this.world.components.Velocity.z[eid] ?? 0, (value) => {
      this.world.components.Velocity.z[eid] = value;
    });
    this.defineNumberProxy(player, "accountId", () => this.world.components.AccountId.value[eid] ?? 0, (value) => {
      this.world.components.AccountId.value[eid] = Math.max(0, Math.floor(value));
    });
    this.defineNumberProxy(player, "yaw", () => this.world.components.Yaw.value[eid] ?? 0, (value) => {
      this.world.components.Yaw.value[eid] = value;
    });
    this.defineNumberProxy(player, "pitch", () => this.world.components.Pitch.value[eid] ?? 0, (value) => {
      this.world.components.Pitch.value[eid] = value;
    });
    this.defineNumberProxy(
      player,
      "lastProcessedSequence",
      () => this.world.components.LastProcessedSequence.value[eid] ?? 0,
      (value) => {
        this.world.components.LastProcessedSequence.value[eid] = Math.max(0, Math.floor(value));
      }
    );
    this.defineNumberProxy(
      player,
      "lastPrimaryFireAtSeconds",
      () => this.world.components.LastPrimaryFireAtSeconds.value[eid] ?? Number.NEGATIVE_INFINITY,
      (value) => {
        this.world.components.LastPrimaryFireAtSeconds.value[eid] = value;
      }
    );
    this.defineNumberProxy(
      player,
      "activeHotbarSlot",
      () => this.world.components.ActiveHotbarSlot.value[eid] ?? 0,
      (value) => {
        this.world.components.ActiveHotbarSlot.value[eid] = Math.max(0, Math.floor(value));
      }
    );
    Object.defineProperty(player, "primaryHeld", {
      get: () => (this.world.components.PrimaryHeld.value[eid] ?? 0) !== 0,
      set: (value: boolean) => {
        this.world.components.PrimaryHeld.value[eid] = value ? 1 : 0;
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(player, "unlockedAbilityIds", {
      get: () => this.unlockedAbilityIdsByPlayerEid.get(eid) ?? new Set<number>(),
      set: (value: Set<number>) => {
        this.unlockedAbilityIdsByPlayerEid.set(
          eid,
          value instanceof Set ? new Set<number>(value) : new Set<number>()
        );
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(player, "hotbarAbilityIds", {
      value: this.createHotbarProxy(eid),
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(player, "groundedPlatformPid", {
      get: () => {
        const raw = this.world.components.GroundedPlatformPid.value[eid] ?? -1;
        return raw < 0 ? null : raw;
      },
      set: (value: number | null) => {
        this.world.components.GroundedPlatformPid.value[eid] = value === null ? -1 : Math.floor(value);
      },
      enumerable: true,
      configurable: true
    });
    this.boundEntities.add(player);
  }

  private bindPlatformAccessors(platform: SimObject, eid: number): void {
    if (this.boundEntities.has(platform)) {
      return;
    }
    this.bindBaseAccessors(platform, eid, true);
    this.boundEntities.add(platform);
  }

  private bindDummyAccessors(dummy: DummyObject, eid: number): void {
    if (this.boundEntities.has(dummy)) {
      return;
    }
    this.bindBaseAccessors(dummy, eid, true);
    this.boundEntities.add(dummy);
  }

  private bindBaseAccessors(entity: SimObject, eid: number, includeWorldPositionFields: boolean): void {
    const world = this.world;
    this.defineNumberProxy(entity, "nid", () => this.world.components.NengiNid.value[eid] ?? 0, (value) => {
      this.world.components.NengiNid.value[eid] = Math.max(0, Math.floor(value));
    });
    this.defineNumberProxy(entity, "modelId", () => this.world.components.ModelId.value[eid] ?? 0, (value) => {
      this.world.components.ModelId.value[eid] = Math.max(0, Math.floor(value));
    });
    this.defineNumberProxy(entity, "health", () => this.world.components.Health.value[eid] ?? 0, (value) => {
      this.world.components.Health.value[eid] = Math.max(0, Math.floor(value));
    });
    this.defineNumberProxy(entity, "maxHealth", () => this.world.components.Health.max[eid] ?? 0, (value) => {
      this.world.components.Health.max[eid] = Math.max(0, Math.floor(value));
    });
    Object.defineProperty(entity, "grounded", {
      get: () => (this.world.components.Grounded.value[eid] ?? 0) !== 0,
      set: (value: boolean) => {
        this.world.components.Grounded.value[eid] = value ? 1 : 0;
      },
      enumerable: true,
      configurable: true
    });

    if (includeWorldPositionFields) {
      this.defineNumberProxy(entity as SimObject & { x: number }, "x", () => this.world.components.Position.x[eid] ?? 0, (value) => {
        this.world.components.Position.x[eid] = value;
      });
      this.defineNumberProxy(entity as SimObject & { y: number }, "y", () => this.world.components.Position.y[eid] ?? 0, (value) => {
        this.world.components.Position.y[eid] = value;
      });
      this.defineNumberProxy(entity as SimObject & { z: number }, "z", () => this.world.components.Position.z[eid] ?? 0, (value) => {
        this.world.components.Position.z[eid] = value;
      });
    }

    Object.defineProperty(entity, "position", {
      value: {
        get x(): number {
          return world.components.Position.x[eid] ?? 0;
        },
        set x(value: number) {
          world.components.Position.x[eid] = value;
        },
        get y(): number {
          return world.components.Position.y[eid] ?? 0;
        },
        set y(value: number) {
          world.components.Position.y[eid] = value;
        },
        get z(): number {
          return world.components.Position.z[eid] ?? 0;
        },
        set z(value: number) {
          world.components.Position.z[eid] = value;
        }
      },
      enumerable: true,
      configurable: true
    });

    Object.defineProperty(entity, "rotation", {
      value: {
        get x(): number {
          return world.components.Rotation.x[eid] ?? 0;
        },
        set x(value: number) {
          world.components.Rotation.x[eid] = value;
        },
        get y(): number {
          return world.components.Rotation.y[eid] ?? 0;
        },
        set y(value: number) {
          world.components.Rotation.y[eid] = value;
        },
        get z(): number {
          return world.components.Rotation.z[eid] ?? 0;
        },
        set z(value: number) {
          world.components.Rotation.z[eid] = value;
        },
        get w(): number {
          return world.components.Rotation.w[eid] ?? 1;
        },
        set w(value: number) {
          world.components.Rotation.w[eid] = value;
        }
      },
      enumerable: true,
      configurable: true
    });
  }

  private defineNumberProxy<T extends object>(
    target: T,
    key: keyof T & string,
    getter: () => number,
    setter: (value: number) => void
  ): void {
    Object.defineProperty(target, key, {
      get: getter,
      set: (value: number) => {
        setter(Number.isFinite(value) ? value : 0);
      },
      enumerable: true,
      configurable: true
    });
  }

  private removePlayerLookupIndexesForEid(eid: number): void {
    for (const [userId, indexedEid] of this.playerEidByUserId.entries()) {
      if (indexedEid === eid) {
        this.playerEidByUserId.delete(userId);
        break;
      }
    }
    for (const [nid, indexedEid] of this.playerEidByNid.entries()) {
      if (indexedEid === eid) {
        this.playerEidByNid.delete(nid);
        break;
      }
    }
    for (const [accountId, indexedEid] of this.playerEidByAccountId.entries()) {
      if (indexedEid === eid) {
        this.playerEidByAccountId.delete(accountId);
        break;
      }
    }
  }

  private createHotbarProxy(eid: number): number[] {
    const hotbar = this.world.components.Hotbar;
    const getSlot = (slot: number): number => {
      if (slot === 0) return hotbar.slot0[eid] ?? 0;
      if (slot === 1) return hotbar.slot1[eid] ?? 0;
      if (slot === 2) return hotbar.slot2[eid] ?? 0;
      if (slot === 3) return hotbar.slot3[eid] ?? 0;
      if (slot === 4) return hotbar.slot4[eid] ?? 0;
      return 0;
    };
    const setSlot = (slot: number, value: number): void => {
      const normalized = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
      if (slot === 0) hotbar.slot0[eid] = normalized;
      if (slot === 1) hotbar.slot1[eid] = normalized;
      if (slot === 2) hotbar.slot2[eid] = normalized;
      if (slot === 3) hotbar.slot3[eid] = normalized;
      if (slot === 4) hotbar.slot4[eid] = normalized;
    };

    const target: number[] = [];
    return new Proxy(target, {
      get: (_obj, prop) => {
        if (prop === "length") {
          return HOTBAR_SLOT_COUNT;
        }
        if (prop === Symbol.iterator) {
          return function* iterator(): IterableIterator<number> {
            for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
              yield getSlot(slot);
            }
          };
        }
        if (prop === "includes") {
          return (value: unknown): boolean => {
            const normalized = typeof value === "number" && Number.isFinite(value) ? value : 0;
            for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
              if (getSlot(slot) === normalized) {
                return true;
              }
            }
            return false;
          };
        }
        if (prop === "findIndex") {
          return (predicate: (value: number, index: number, array: number[]) => boolean): number => {
            for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
              if (predicate(getSlot(slot), slot, target)) {
                return slot;
              }
            }
            return -1;
          };
        }
        if (prop === "slice") {
          return (start?: number, end?: number): number[] => {
            const copy = Array.from({ length: HOTBAR_SLOT_COUNT }, (_, slot) => getSlot(slot));
            return copy.slice(start, end);
          };
        }
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
          return getSlot(Number(prop));
        }
        return Reflect.get(target, prop);
      },
      set: (_obj, prop, value) => {
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
          setSlot(Number(prop), typeof value === "number" ? value : 0);
          return true;
        }
        return Reflect.set(target, prop, value);
      },
      ownKeys: () => ["0", "1", "2", "3", "4", "length"],
      getOwnPropertyDescriptor: (_obj, prop) => {
        if (prop === "length") {
          return {
            configurable: true,
            enumerable: false,
            value: HOTBAR_SLOT_COUNT,
            writable: false
          };
        }
        if (typeof prop === "string" && /^[0-9]+$/.test(prop)) {
          return {
            configurable: true,
            enumerable: true,
            value: getSlot(Number(prop)),
            writable: true
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      }
    });
  }
}
