// ECS storage layer — owns the bitecs world with all component arrays.
// Entity creation is delegated to EntityFactory; the store provides
// low-level component accessors and hotbar/abilities helpers.
import { addComponent, addEntity, createWorld, query, removeEntity } from "bitecs";
import {
  HOTBAR_SLOT_COUNT,
  clampHotbarSlotIndex
} from "../../shared/index";
import type { WorldWithComponents } from "./SimulationEcsTypes";
import { ComponentRegistry } from "./ComponentRegistry";
import { EntityFactory } from "./EntityFactory";
import type { ArchetypeDefinition } from "../../shared/archetype";
import type { EntityFactoryOverrides } from "./EntityFactory";

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
      UnlockedAbilityCsv: { value: [] as string[] },
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

  public createEntity(archetype: ArchetypeDefinition, overrides?: EntityFactoryOverrides): number {
    return this.factory.createEntity(archetype, overrides);
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
    const normalizedSlot = clampHotbarSlotIndex(slot);
    const h = this.world.components.Hotbar;
    switch (normalizedSlot) {
      case 0: return h.slot0[eid] ?? 0;
      case 1: return h.slot1[eid] ?? 0;
      case 2: return h.slot2[eid] ?? 0;
      case 3: return h.slot3[eid] ?? 0;
      case 4: return h.slot4[eid] ?? 0;
      case 5: return h.slot5[eid] ?? 0;
      case 6: return h.slot6[eid] ?? 0;
      case 7: return h.slot7[eid] ?? 0;
      case 8: return h.slot8[eid] ?? 0;
      default: return h.slot9[eid] ?? 0;
    }
  }

  public setHotbarAbilityBySlot(eid: number, slot: number, abilityId: number): boolean {
    const normalizedAbilityId = Math.max(0, Math.floor(Number.isFinite(abilityId) ? abilityId : 0));
    const normalizedSlot = clampHotbarSlotIndex(slot);
    const h = this.world.components.Hotbar;
    let previous: number;
    switch (normalizedSlot) {
      case 0: previous = h.slot0[eid] ?? 0; h.slot0[eid] = normalizedAbilityId; break;
      case 1: previous = h.slot1[eid] ?? 0; h.slot1[eid] = normalizedAbilityId; break;
      case 2: previous = h.slot2[eid] ?? 0; h.slot2[eid] = normalizedAbilityId; break;
      case 3: previous = h.slot3[eid] ?? 0; h.slot3[eid] = normalizedAbilityId; break;
      case 4: previous = h.slot4[eid] ?? 0; h.slot4[eid] = normalizedAbilityId; break;
      case 5: previous = h.slot5[eid] ?? 0; h.slot5[eid] = normalizedAbilityId; break;
      case 6: previous = h.slot6[eid] ?? 0; h.slot6[eid] = normalizedAbilityId; break;
      case 7: previous = h.slot7[eid] ?? 0; h.slot7[eid] = normalizedAbilityId; break;
      case 8: previous = h.slot8[eid] ?? 0; h.slot8[eid] = normalizedAbilityId; break;
      default: previous = h.slot9[eid] ?? 0; h.slot9[eid] = normalizedAbilityId; break;
    }
    return previous !== normalizedAbilityId;
  }

  // ── Unlocked abilities ────────────────────────────────────────────────────

  public getUnlockedAbilities(eid: number): Set<number> {
    const unlocked = new Set<number>();
    const csv = this.world.components.UnlockedAbilityCsv.value[eid] ?? "";
    if (!csv) return unlocked;
    for (const part of csv.split(",")) {
      const value = Number.parseInt(part, 10);
      if (Number.isFinite(value)) {
        unlocked.add(Math.max(0, Math.floor(value)));
      }
    }
    return unlocked;
  }

  public getUnlockedAbilitiesArray(eid: number): number[] {
    return Array.from(this.getUnlockedAbilities(eid));
  }

  public setUnlockedAbilitiesFromList(eid: number, unlocked: ReadonlyArray<number>): boolean {
    const ids = Array.from(
      new Set(unlocked.map(id => Math.max(0, Math.floor(Number.isFinite(id) ? id : 0))))
    ).sort((a, b) => a - b);
    const nextCsv = ids.join(",");
    const previousCsv = this.world.components.UnlockedAbilityCsv.value[eid] ?? "";
    this.world.components.UnlockedAbilityCsv.value[eid] = nextCsv;
    return previousCsv !== nextCsv;
  }

  public setUnlockedAbilities(eid: number, unlocked: Set<number>): boolean {
    return this.setUnlockedAbilitiesFromList(eid, Array.from(unlocked));
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
