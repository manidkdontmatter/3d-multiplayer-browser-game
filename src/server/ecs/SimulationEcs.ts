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

  public registerPlayer(player: PlayerObject): void {
    const eid = this.getOrCreateEid(player);
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.PlayerTag);
    addComponent(this.world, eid, this.world.components.Velocity);
    addComponent(this.world, eid, this.world.components.GroundedPlatformPid);
    this.syncPlayer(player);
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
}
