import { addComponent, addEntity, createWorld, query, removeEntity } from "bitecs";
import { HOTBAR_SLOT_COUNT } from "../../shared/index";
import type {
  DummyObject,
  PlayerObject,
  ProjectileCreateRequest,
  SimObject,
  WorldWithComponents
} from "./SimulationEcsTypes";

export class SimulationEcsStore {
  public readonly world = createWorld({
    components: {
      NetworkId: { value: [] as number[] },
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
      UnlockedAbilityCsv: { value: [] as string[] },
      ReplicatedTag: [] as number[],
      PlayerTag: [] as number[],
      PlatformTag: [] as number[],
      ProjectileTag: [] as number[],
      DummyTag: [] as number[]
    }
  }) as WorldWithComponents;

  public createEid(): number {
    return addEntity(this.world);
  }

  public destroyEid(eid: number): void {
    removeEntity(this.world, eid);
  }

  public registerPlayerComponents(eid: number): void {
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
    addComponent(this.world, eid, this.world.components.UnlockedAbilityCsv);
  }

  public registerPlatformComponents(eid: number): void {
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.PlatformTag);
  }

  public registerDummyComponents(eid: number): void {
    this.ensureBaseComponents(eid);
    addComponent(this.world, eid, this.world.components.ReplicatedTag);
    addComponent(this.world, eid, this.world.components.DummyTag);
  }

  public createProjectile(request: ProjectileCreateRequest): number {
    const eid = this.createEid();
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

    this.world.components.NetworkId.value[eid] = 0;
    this.world.components.ModelId.value[eid] = Math.max(0, Math.floor(request.modelId));
    this.world.components.Position.x[eid] = request.x;
    this.world.components.Position.y[eid] = request.y;
    this.world.components.Position.z[eid] = request.z;
    this.world.components.Rotation.x[eid] = 0;
    this.world.components.Rotation.y[eid] = 0;
    this.world.components.Rotation.z[eid] = 0;
    this.world.components.Rotation.w[eid] = 1;
    this.world.components.Grounded.value[eid] = 0;
    this.world.components.Health.value[eid] = 0;
    this.world.components.Health.max[eid] = 0;
    this.world.components.Velocity.x[eid] = request.vx;
    this.world.components.Velocity.y[eid] = request.vy;
    this.world.components.Velocity.z[eid] = request.vz;
    this.world.components.ProjectileOwnerNid.value[eid] = Math.max(0, Math.floor(request.ownerNid));
    this.world.components.ProjectileKind.value[eid] = Math.max(0, Math.floor(request.kind));
    this.world.components.ProjectileRadius.value[eid] = Math.max(0, request.radius);
    this.world.components.ProjectileDamage.value[eid] = Math.max(0, request.damage);
    this.world.components.ProjectileTtl.value[eid] = request.ttlSeconds;
    this.world.components.ProjectileRemainingRange.value[eid] = request.remainingRange;
    this.world.components.ProjectileGravity.value[eid] = request.gravity;
    this.world.components.ProjectileDrag.value[eid] = Math.max(0, request.drag);
    this.world.components.ProjectileMaxSpeed.value[eid] = Math.max(0, request.maxSpeed);
    this.world.components.ProjectileMinSpeed.value[eid] = Math.max(0, request.minSpeed);
    this.world.components.ProjectileRemainingPierces.value[eid] = Math.max(0, Math.floor(request.remainingPierces));
    this.world.components.ProjectileDespawnOnDamageableHit.value[eid] = request.despawnOnDamageableHit ? 1 : 0;
    this.world.components.ProjectileDespawnOnWorldHit.value[eid] = request.despawnOnWorldHit ? 1 : 0;
    return eid;
  }

  public syncBaseFromObject(eid: number, entity: SimObject): void {
    this.world.components.NetworkId.value[eid] = Math.max(0, Math.floor(entity.nid));
    this.world.components.ModelId.value[eid] = Math.max(0, Math.floor(entity.modelId));
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

  public syncPlayerFromObject(eid: number, player: PlayerObject): void {
    this.syncBaseFromObject(eid, player);
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
    this.world.components.ActiveHotbarSlot.value[eid] = Math.max(0, Math.floor(player.activeHotbarSlot));
    this.setHotbarAbilityBySlot(eid, 0, player.hotbarAbilityIds[0] ?? 0);
    this.setHotbarAbilityBySlot(eid, 1, player.hotbarAbilityIds[1] ?? 0);
    this.setHotbarAbilityBySlot(eid, 2, player.hotbarAbilityIds[2] ?? 0);
    this.setHotbarAbilityBySlot(eid, 3, player.hotbarAbilityIds[3] ?? 0);
    this.setHotbarAbilityBySlot(eid, 4, player.hotbarAbilityIds[4] ?? 0);
    this.setUnlockedAbilities(eid, player.unlockedAbilityIds);
  }

  public setUnlockedAbilities(eid: number, unlocked: Set<number>): void {
    const ids = Array.from(unlocked)
      .map((abilityId) => Math.max(0, Math.floor(Number.isFinite(abilityId) ? abilityId : 0)))
      .sort((a, b) => a - b);
    this.world.components.UnlockedAbilityCsv.value[eid] = ids.join(",");
  }

  public getUnlockedAbilities(eid: number): Set<number> {
    const unlocked = new Set<number>();
    const csv = this.world.components.UnlockedAbilityCsv.value[eid] ?? "";
    if (!csv) {
      return unlocked;
    }
    const parts = csv.split(",");
    for (const part of parts) {
      const value = Number.parseInt(part, 10);
      if (!Number.isFinite(value)) {
        continue;
      }
      unlocked.add(Math.max(0, Math.floor(value)));
    }
    return unlocked;
  }

  public getUnlockedAbilitiesArray(eid: number): number[] {
    return Array.from(this.getUnlockedAbilities(eid));
  }

  public syncPlatformFromObject(eid: number, platform: SimObject): void {
    this.syncBaseFromObject(eid, platform);
  }

  public syncDummyFromObject(eid: number, dummy: DummyObject): void {
    this.syncBaseFromObject(eid, dummy);
  }

  public setEntityNid(eid: number, nid: number): void {
    this.world.components.NetworkId.value[eid] = Math.max(0, Math.floor(nid));
  }

  public getEntityNid(eid: number): number {
    return this.world.components.NetworkId.value[eid] ?? 0;
  }

  public getEntityAccountId(eid: number): number {
    return this.world.components.AccountId.value[eid] ?? 0;
  }

  public getPlayerTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.PlayerTag]));
  }

  public getProjectileTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.ProjectileTag]));
  }

  public getPlatformTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.PlatformTag]));
  }

  public getDummyTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.DummyTag]));
  }

  public getReplicatedTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.ReplicatedTag]));
  }

  public getHotbarSlot(eid: number, slot: number): number {
    if (slot === 0) return this.world.components.Hotbar.slot0[eid] ?? 0;
    if (slot === 1) return this.world.components.Hotbar.slot1[eid] ?? 0;
    if (slot === 2) return this.world.components.Hotbar.slot2[eid] ?? 0;
    if (slot === 3) return this.world.components.Hotbar.slot3[eid] ?? 0;
    if (slot === 4) return this.world.components.Hotbar.slot4[eid] ?? 0;
    return 0;
  }

  public setHotbarAbilityBySlot(eid: number, slot: number, abilityId: number): boolean {
    const normalizedAbilityId = Math.max(0, Math.floor(Number.isFinite(abilityId) ? abilityId : 0));
    const normalizedSlot = Math.max(0, Math.floor(Number.isFinite(slot) ? slot : 0));
    if (normalizedSlot >= HOTBAR_SLOT_COUNT) {
      return false;
    }

    const hotbar = this.world.components.Hotbar;
    if (normalizedSlot === 0) {
      const previous = hotbar.slot0[eid] ?? 0;
      hotbar.slot0[eid] = normalizedAbilityId;
      return previous !== normalizedAbilityId;
    }
    if (normalizedSlot === 1) {
      const previous = hotbar.slot1[eid] ?? 0;
      hotbar.slot1[eid] = normalizedAbilityId;
      return previous !== normalizedAbilityId;
    }
    if (normalizedSlot === 2) {
      const previous = hotbar.slot2[eid] ?? 0;
      hotbar.slot2[eid] = normalizedAbilityId;
      return previous !== normalizedAbilityId;
    }
    if (normalizedSlot === 3) {
      const previous = hotbar.slot3[eid] ?? 0;
      hotbar.slot3[eid] = normalizedAbilityId;
      return previous !== normalizedAbilityId;
    }

    const previous = hotbar.slot4[eid] ?? 0;
    hotbar.slot4[eid] = normalizedAbilityId;
    return previous !== normalizedAbilityId;
  }

  private ensureBaseComponents(eid: number): void {
    addComponent(this.world, eid, this.world.components.NetworkId);
    addComponent(this.world, eid, this.world.components.ModelId);
    addComponent(this.world, eid, this.world.components.Position);
    addComponent(this.world, eid, this.world.components.Rotation);
    addComponent(this.world, eid, this.world.components.Grounded);
    addComponent(this.world, eid, this.world.components.Health);
  }
}
