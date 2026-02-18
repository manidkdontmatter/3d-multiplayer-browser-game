import { addComponent, addEntity, createWorld, query, removeEntity } from "bitecs";
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
  vx: number;
  vy: number;
  vz: number;
  groundedPlatformPid: number | null;
};

type ProjectileObject = SimObject & {
  vx: number;
  vy: number;
  vz: number;
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

  public registerProjectile(projectile: ProjectileObject): void {
    const eid = this.getOrCreateEid(projectile);
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.ReplicatedTag);
    addComponent(this.world, eid, this.world.components.ProjectileTag);
    addComponent(this.world, eid, this.world.components.Velocity);
    this.syncProjectile(projectile);
    this.bindProjectileAccessors(projectile, eid);
  }

  public syncProjectile(projectile: ProjectileObject): void {
    const eid = this.getEid(projectile);
    this.syncBase(eid, projectile);
    this.world.components.Velocity.x[eid] = projectile.vx;
    this.world.components.Velocity.y[eid] = projectile.vy;
    this.world.components.Velocity.z[eid] = projectile.vz;
  }

  public registerDummy(dummy: SimObject): void {
    const eid = this.getOrCreateEid(dummy);
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.ReplicatedTag);
    addComponent(this.world, eid, this.world.components.DummyTag);
    this.syncDummy(dummy);
    this.bindDummyAccessors(dummy, eid);
  }

  public syncDummy(dummy: SimObject): void {
    const eid = this.getEid(dummy);
    this.syncBase(eid, dummy);
  }

  public unregister(entity: object): void {
    const eid = this.objectToEid.get(entity);
    if (typeof eid !== "number") {
      return;
    }
    this.removePlayerLookupIndexesForEid(eid);
    this.unlockedAbilityIdsByPlayerEid.delete(eid);
    removeEntity(this.world, eid);
    this.objectToEid.delete(entity);
    this.eidToObject.delete(eid);
  }

  public getEidForObject(entity: object): number | null {
    const eid = this.objectToEid.get(entity);
    return typeof eid === "number" ? eid : null;
  }

  public getObjectByEid(eid: number): object | null {
    return this.eidToObject.get(eid) ?? null;
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

  public getPlayerObjectByNid<T extends object>(nid: number): T | undefined {
    const eid = this.playerEidByNid.get(Math.max(0, Math.floor(nid)));
    if (typeof eid !== "number") {
      return undefined;
    }
    const entity = this.eidToObject.get(eid) as T | undefined;
    return entity;
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

  public forEachOnlinePlayer<T extends object>(
    visitor: (userId: number, entity: T) => void
  ): void {
    for (const [userId, eid] of this.playerEidByUserId.entries()) {
      const entity = this.eidToObject.get(eid) as T | undefined;
      if (entity) {
        visitor(userId, entity);
      }
    }
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

  private bindProjectileAccessors(projectile: ProjectileObject, eid: number): void {
    if (this.boundEntities.has(projectile)) {
      return;
    }
    this.bindBaseAccessors(projectile, eid, true);
    this.defineNumberProxy(projectile, "vx", () => this.world.components.Velocity.x[eid] ?? 0, (value) => {
      this.world.components.Velocity.x[eid] = value;
    });
    this.defineNumberProxy(projectile, "vy", () => this.world.components.Velocity.y[eid] ?? 0, (value) => {
      this.world.components.Velocity.y[eid] = value;
    });
    this.defineNumberProxy(projectile, "vz", () => this.world.components.Velocity.z[eid] ?? 0, (value) => {
      this.world.components.Velocity.z[eid] = value;
    });
    this.boundEntities.add(projectile);
  }

  private bindDummyAccessors(dummy: SimObject, eid: number): void {
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
