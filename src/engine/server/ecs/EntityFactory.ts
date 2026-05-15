// Data-driven entity creation from archetype kinds or ArchetypeDefinitions.
import { addComponent, addEntity } from "bitecs";
import {
  HOTBAR_SLOT_COUNT,
  MOVEMENT_MODE_GROUNDED,
  clampHotbarSlotIndex
} from "../../shared/index";
import type { ArchetypeDefinition } from "../../shared/archetype";
import { ComponentRegistry, KIND_TO_COMPONENT_SET, KIND_COMPONENT_SETS } from "./ComponentRegistry";
import type { WorldWithComponents } from "./SimulationEcsTypes";

export interface EntityFactoryOverrides {
  modelId?: number;
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  health?: number;
  maxHealth?: number;
  velocity?: { x: number; y: number; z: number };
  yaw?: number;
  pitch?: number;
  accountId?: number;
  characterArchetypeId?: number;
  controllerKind?: number;
  grounded?: boolean;
  movementMode?: number;
  groundedPlatformPid?: number | null;
  carriedFramePid?: number | null;
  lastProcessedSequence?: number;
  lastPrimaryFireAtSeconds?: number;
  primaryHeld?: boolean;
  secondaryHeld?: boolean;
  primaryMouseSlot?: number;
  secondaryMouseSlot?: number;
  hotbarAbilityIds?: number[];
  unlockedAbilityIds?: number[];
  // Item
  itemArchetypeId?: number;
  itemQuantity?: number;
  // Location
  locationKind?: number;
  locationArchetypeId?: number;
  locationSeed?: number;
  locationEnvironmentId?: number;
  locationStreamingRadius?: number;
  locationInfluenceRadius?: number;
  // Projectile
  projectileOwnerNid?: number;
  projectileKind?: number;
  projectileRadius?: number;
  projectileDamage?: number;
  projectileTtl?: number;
  projectileRemainingRange?: number;
  projectileGravity?: number;
  projectileDrag?: number;
  projectileMaxSpeed?: number;
  projectileMinSpeed?: number;
  projectileRemainingPierces?: number;
  projectileDespawnOnDamageableHit?: boolean;
  projectileDespawnOnWorldHit?: boolean;
}

const DEFAULT_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

export class EntityFactory {
  public constructor(
    private readonly registry: ComponentRegistry,
    private readonly world: WorldWithComponents
  ) {}

  public createEid(): number {
    return addEntity(this.world);
  }

  public createEntityByKind(kind: string, overrides?: EntityFactoryOverrides): number {
    const eid = this.createEid();
    const setKeys = KIND_TO_COMPONENT_SET[kind] ?? ["base"];
    this.addComponents(eid, setKeys);
    this.applyOverrides(eid, overrides);
    return eid;
  }

  public createEntity(
    archetype: ArchetypeDefinition,
    overrides?: EntityFactoryOverrides
  ): number {
    return this.createEntityByKind(archetype.kind, {
      modelId: archetype.modelId,
      ...overrides
    });
  }

  private addComponents(eid: number, setKeys: readonly string[]): void {
    for (const setKey of setKeys) {
      const componentNames = KIND_COMPONENT_SETS[setKey];
      if (!componentNames) continue;
      for (const compName of componentNames) {
        const comp = this.registry.resolve(compName);
        if (comp) {
          addComponent(this.world, eid, comp);
        }
      }
    }
  }

  private applyOverrides(eid: number, overrides?: EntityFactoryOverrides): void {

    const c = this.world.components;
    // Set default base values
    c.NetworkId.value[eid] = 0;
    c.ModelId.value[eid] = overrides?.modelId ?? 0;
    c.Position.x[eid] = overrides?.position?.x ?? 0;
    c.Position.y[eid] = overrides?.position?.y ?? 0;
    c.Position.z[eid] = overrides?.position?.z ?? 0;
    c.Rotation.x[eid] = overrides?.rotation?.x ?? DEFAULT_ROTATION.x;
    c.Rotation.y[eid] = overrides?.rotation?.y ?? DEFAULT_ROTATION.y;
    c.Rotation.z[eid] = overrides?.rotation?.z ?? DEFAULT_ROTATION.z;
    c.Rotation.w[eid] = overrides?.rotation?.w ?? DEFAULT_ROTATION.w;
    c.Grounded.value[eid] = overrides?.grounded ? 1 : 0;
    c.MovementMode.value[eid] = overrides?.movementMode ?? MOVEMENT_MODE_GROUNDED;
    c.Health.value[eid] = overrides?.health ?? 0;
    c.Health.max[eid] = overrides?.maxHealth ?? 0;
    c.ItemArchetypeId.value[eid] = overrides?.itemArchetypeId ?? 0;
    c.ItemQuantity.value[eid] = overrides?.itemQuantity ?? 0;
    c.LocationKind.value[eid] = overrides?.locationKind ?? 0;
    c.LocationArchetypeId.value[eid] = overrides?.locationArchetypeId ?? 0;
    c.LocationSeed.value[eid] = overrides?.locationSeed ?? 0;
    c.LocationEnvironmentId.value[eid] = overrides?.locationEnvironmentId ?? 0;
    c.LocationStreamingRadius.value[eid] = overrides?.locationStreamingRadius ?? 0;
    c.LocationInfluenceRadius.value[eid] = overrides?.locationInfluenceRadius ?? 0;
    c.CharacterArchetypeId.value[eid] = overrides?.characterArchetypeId ?? 0;
    c.ControllerKind.value[eid] = overrides?.controllerKind ?? 0;

    // Character overrides
    if (overrides?.velocity) {
      c.Velocity.x[eid] = overrides.velocity.x;
      c.Velocity.y[eid] = overrides.velocity.y;
      c.Velocity.z[eid] = overrides.velocity.z;
    }
    if (overrides?.yaw !== undefined) c.Yaw.value[eid] = overrides.yaw;
    if (overrides?.pitch !== undefined) c.Pitch.value[eid] = overrides.pitch;
    if (overrides?.accountId !== undefined) c.AccountId.value[eid] = overrides.accountId;
    if (overrides?.lastProcessedSequence !== undefined) c.LastProcessedSequence.value[eid] = overrides.lastProcessedSequence;
    if (overrides?.lastPrimaryFireAtSeconds !== undefined) c.LastPrimaryFireAtSeconds.value[eid] = overrides.lastPrimaryFireAtSeconds;
    if (overrides?.primaryHeld !== undefined) c.PrimaryHeld.value[eid] = overrides.primaryHeld ? 1 : 0;
    if (overrides?.secondaryHeld !== undefined) c.SecondaryHeld.value[eid] = overrides.secondaryHeld ? 1 : 0;
    if (overrides?.primaryMouseSlot !== undefined) c.PrimaryMouseSlot.value[eid] = clampHotbarSlotIndex(overrides.primaryMouseSlot);
    if (overrides?.secondaryMouseSlot !== undefined) c.SecondaryMouseSlot.value[eid] = clampHotbarSlotIndex(overrides.secondaryMouseSlot);
    if (overrides?.groundedPlatformPid !== undefined) {
      c.GroundedPlatformPid.value[eid] = overrides.groundedPlatformPid === null ? -1 : overrides.groundedPlatformPid;
    }
    if (overrides?.carriedFramePid !== undefined) {
      c.CarriedFramePid.value[eid] = overrides.carriedFramePid === null ? -1 : overrides.carriedFramePid;
    }

    // Hotbar
    if (overrides?.hotbarAbilityIds) {
      const h = c.Hotbar;
      for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot++) {
        const val = overrides.hotbarAbilityIds[slot] ?? 0;
        if (slot === 0) h.slot0[eid] = val;
        else if (slot === 1) h.slot1[eid] = val;
        else if (slot === 2) h.slot2[eid] = val;
        else if (slot === 3) h.slot3[eid] = val;
        else if (slot === 4) h.slot4[eid] = val;
        else if (slot === 5) h.slot5[eid] = val;
        else if (slot === 6) h.slot6[eid] = val;
        else if (slot === 7) h.slot7[eid] = val;
        else if (slot === 8) h.slot8[eid] = val;
        else if (slot === 9) h.slot9[eid] = val;
      }
    }

    // Unlocked abilities
    if (overrides?.unlockedAbilityIds !== undefined) {
      const ids = Array.from(new Set(
        overrides.unlockedAbilityIds.map(id => Math.max(0, Math.floor(Number.isFinite(id) ? id : 0)))
      )).sort((a, b) => a - b);
      c.UnlockedAbilityCsv.value[eid] = ids.join(",");
    }

    // Projectile overrides
    if (overrides?.projectileOwnerNid !== undefined) c.ProjectileOwnerNid.value[eid] = overrides.projectileOwnerNid;
    if (overrides?.projectileKind !== undefined) c.ProjectileKind.value[eid] = overrides.projectileKind;
    if (overrides?.projectileRadius !== undefined) c.ProjectileRadius.value[eid] = overrides.projectileRadius;
    if (overrides?.projectileDamage !== undefined) c.ProjectileDamage.value[eid] = overrides.projectileDamage;
    if (overrides?.projectileTtl !== undefined) c.ProjectileTtl.value[eid] = overrides.projectileTtl;
    if (overrides?.projectileRemainingRange !== undefined) c.ProjectileRemainingRange.value[eid] = overrides.projectileRemainingRange;
    if (overrides?.projectileGravity !== undefined) c.ProjectileGravity.value[eid] = overrides.projectileGravity;
    if (overrides?.projectileDrag !== undefined) c.ProjectileDrag.value[eid] = overrides.projectileDrag;
    if (overrides?.projectileMaxSpeed !== undefined) c.ProjectileMaxSpeed.value[eid] = overrides.projectileMaxSpeed;
    if (overrides?.projectileMinSpeed !== undefined) c.ProjectileMinSpeed.value[eid] = overrides.projectileMinSpeed;
    if (overrides?.projectileRemainingPierces !== undefined) c.ProjectileRemainingPierces.value[eid] = overrides.projectileRemainingPierces;
    if (overrides?.projectileDespawnOnDamageableHit !== undefined) c.ProjectileDespawnOnDamageableHit.value[eid] = overrides.projectileDespawnOnDamageableHit ? 1 : 0;
    if (overrides?.projectileDespawnOnWorldHit !== undefined) c.ProjectileDespawnOnWorldHit.value[eid] = overrides.projectileDespawnOnWorldHit ? 1 : 0;
  }
}
