import { addComponent, addEntity, createWorld, query, removeEntity } from "bitecs";

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
      PlayerTag: [] as number[],
      PlatformTag: [] as number[],
      ProjectileTag: [] as number[],
      DummyTag: [] as number[]
    }
  }) as WorldWithComponents;

  private readonly objectToEid = new WeakMap<object, number>();
  private readonly eidToObject = new Map<number, object>();
  private readonly boundEntities = new WeakSet<object>();

  public registerPlayer(player: PlayerObject): void {
    const eid = this.getOrCreateEid(player);
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.PlayerTag);
    addComponent(this.world, eid, this.world.components.Velocity);
    addComponent(this.world, eid, this.world.components.GroundedPlatformPid);
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
  }

  public registerPlatform(platform: SimObject): void {
    const eid = this.getOrCreateEid(platform);
    this.ensureBaseComponents(eid);
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
    removeEntity(this.world, eid);
    this.objectToEid.delete(entity);
    this.eidToObject.delete(eid);
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
      entity: object,
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
    for (const [eid, entity] of this.eidToObject.entries()) {
      visitor(entity, {
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

  public forEachPlayerObject(visitor: (entity: object) => void): void {
    const playerEids = query(this.world, [this.world.components.PlayerTag]);
    for (const eid of playerEids) {
      const entity = this.eidToObject.get(eid);
      if (entity) {
        visitor(entity);
      }
    }
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
}
