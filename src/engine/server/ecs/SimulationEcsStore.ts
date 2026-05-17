// ECS storage layer — owns the bitecs world with all component arrays.
// Entity creation is delegated to EntityFactory; the store provides
// low-level component accessors and hotbar/abilities helpers.
import { addEntity, createWorld, query, removeEntity } from "bitecs";
import type { WorldWithComponents } from "./SimulationEcsTypes";
import { ComponentRegistry } from "./ComponentRegistry";
import type { EntityPresetId } from "./ComponentRegistry";
import { EntityFactory } from "./EntityFactory";
import type { EntityFactoryOverrides } from "./EntityFactory";
import { getHotbarSlot, setHotbarSlot } from "./HotbarComponents";
import { normalizeSortedUniqueUInt, sortedUniqueEquals } from "../../shared/sortedNumberList";

export class SimulationEcsStore {
  public readonly world = createWorld({
    components: {
      NetworkId: { value: [] as number[] },
      ModelId: { value: [] as number[] },
      Position: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Rotation: { x: [] as number[], y: [] as number[], z: [] as number[], w: [] as number[] },
      Velocity: { x: [] as number[], y: [] as number[], z: [] as number[] },
      Health: { value: [] as number[], max: [] as number[] },
      ItemArchetypeId: { value: [] as number[] },
      ItemQuantity: { value: [] as number[] },
      LocationKind: { value: [] as number[] },
      LocationArchetypeId: { value: [] as number[] },
      LocationSeed: { value: [] as number[] },
      LocationEnvironmentId: { value: [] as number[] },
      LocationStreamingRadius: { value: [] as number[] },
      LocationInfluenceRadius: { value: [] as number[] },
      CharacterArchetypeId: { value: [] as number[] },
      ControllerKind: { value: [] as number[] },
      Grounded: { value: [] as number[] },
      MovementMode: { value: [] as number[] },
      GroundedPlatformPid: { value: [] as number[] },
      CarriedFramePid: { value: [] as number[] },
      AccountId: { value: [] as number[] },
      Yaw: { value: [] as number[] },
      Pitch: { value: [] as number[] },
      LastProcessedSequence: { value: [] as number[] },
      LastPrimaryFireAtSeconds: { value: [] as number[] },
      PrimaryHeld: { value: [] as number[] },
      SecondaryHeld: { value: [] as number[] },
      PrimaryMouseSlot: { value: [] as number[] },
      SecondaryMouseSlot: { value: [] as number[] },
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
      Hotbar: {
        slot0: [] as number[],
        slot1: [] as number[],
        slot2: [] as number[],
        slot3: [] as number[],
        slot4: [] as number[],
        slot5: [] as number[],
        slot6: [] as number[],
        slot7: [] as number[],
        slot8: [] as number[],
        slot9: [] as number[]
      },
      UnlockedAbilityIds: { value: [] as number[][] },
      ReplicatedTag: [] as number[],
      PlayerTag: [] as number[],
      PlatformTag: [] as number[],
      ProjectileTag: [] as number[],
      WorldItemTag: [] as number[],
      CharacterTag: [] as number[],
      NpcTag: [] as number[],
      DummyTag: [] as number[],
      LocationRootTag: [] as number[]
    }
  }) as WorldWithComponents;

  public readonly registry = new ComponentRegistry(this.world.components);
  public readonly factory = new EntityFactory(this.registry, this.world);

  // ── Entity lifecycle ──────────────────────────────────────────────────────

  public createEid(): number {
    return addEntity(this.world);
  }

  public destroyEid(eid: number): void {
    removeEntity(this.world, eid);
  }

  public createEntityFromPreset(presetId: EntityPresetId, overrides?: EntityFactoryOverrides): number {
    return this.factory.createEntityFromPreset(presetId, overrides);
  }

  // ── Component value helpers ───────────────────────────────────────────────

  public getEntityNid(eid: number): number {
    return this.world.components.NetworkId.value[eid] ?? 0;
  }

  public setEntityNid(eid: number, nid: number): void {
    this.world.components.NetworkId.value[eid] = Math.max(0, Math.floor(nid));
  }

  public getEntityAccountId(eid: number): number {
    return this.world.components.AccountId.value[eid] ?? 0;
  }

  public setPosition(eid: number, x: number, y: number, z: number): void {
    const c = this.world.components;
    c.Position.x[eid] = x;
    c.Position.y[eid] = y;
    c.Position.z[eid] = z;
  }

  public setRotation(eid: number, x: number, y: number, z: number, w: number): void {
    const c = this.world.components;
    c.Rotation.x[eid] = x;
    c.Rotation.y[eid] = y;
    c.Rotation.z[eid] = z;
    c.Rotation.w[eid] = w;
  }

  public setVelocity(eid: number, vx: number, vy: number, vz: number): void {
    const c = this.world.components;
    c.Velocity.x[eid] = vx;
    c.Velocity.y[eid] = vy;
    c.Velocity.z[eid] = vz;
  }

  public setHealth(eid: number, value: number, max: number): void {
    const c = this.world.components;
    c.Health.value[eid] = Math.max(0, value);
    c.Health.max[eid] = Math.max(0, max);
  }

  public setGrounded(eid: number, grounded: boolean): void {
    this.world.components.Grounded.value[eid] = grounded ? 1 : 0;
  }

  public setMovementMode(eid: number, mode: number): void {
    this.world.components.MovementMode.value[eid] = mode;
  }

  public setGroundedPlatformPid(eid: number, pid: number | null): void {
    this.world.components.GroundedPlatformPid.value[eid] = pid === null ? -1 : Math.floor(pid);
  }

  public setCarriedFramePid(eid: number, pid: number | null): void {
    this.world.components.CarriedFramePid.value[eid] = pid === null ? -1 : Math.floor(pid);
  }

  // ── Hotbar ────────────────────────────────────────────────────────────────

  public getHotbarSlot(eid: number, slot: number): number {
    return getHotbarSlot(this.world.components, eid, slot);
  }

  public setHotbarAbilityBySlot(eid: number, slot: number, abilityId: number): boolean {
    return setHotbarSlot(this.world.components, eid, slot, abilityId);
  }

  // ── Unlocked abilities ────────────────────────────────────────────────────

  public getUnlockedAbilityIds(eid: number): readonly number[] {
    return this.world.components.UnlockedAbilityIds.value[eid] ?? [];
  }

  public setUnlockedAbilityIdsFromList(eid: number, unlocked: ReadonlyArray<number>): boolean {
    const next = normalizeSortedUniqueUInt(unlocked, { maxInclusive: 0xffff, includeZero: false });
    const previous = this.world.components.UnlockedAbilityIds.value[eid] ?? [];
    if (sortedUniqueEquals(previous, next)) {
      return false;
    }
    this.world.components.UnlockedAbilityIds.value[eid] = next;
    return true;
  }

  // ── Tag queries ───────────────────────────────────────────────────────────

  public getPlayerTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.PlayerTag]));
  }
  public getNpcTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.NpcTag]));
  }
  public getProjectileTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.ProjectileTag]));
  }
  public getWorldItemTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.WorldItemTag]));
  }
  public getPlatformTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.PlatformTag]));
  }
  public getDummyTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.DummyTag]));
  }
  public getLocationRootTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.LocationRootTag]));
  }
  public getReplicatedTagEids(): number[] {
    return Array.from(query(this.world, [this.world.components.ReplicatedTag]));
  }
}
