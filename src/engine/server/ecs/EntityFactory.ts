/**
 * Purpose: This file creates entities/objects from structured definitions.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { addComponent, addEntity } from "bitecs";
import {
  MOVEMENT_MODE_GROUNDED,
  clampHotbarSlotIndex
} from "../../shared/index";
import {
  DEFAULT_MATERIAL_VARIANT_ID,
  DEFAULT_TINT_COLOR_RGB,
  DEFAULT_UNIFORM_SCALE_PCT,
  sanitizeMaterialVariantId,
  sanitizeRenderArchetypeId,
  sanitizeTintColorRgb,
  sanitizeUniformScalePct
} from "../../shared/appearance/AppearancePolicy";
import { normalizeSortedUniqueUInt } from "../../shared/sortedNumberList";
import {
  ComponentRegistry,
  ENTITY_PRESET_COMPONENT_SETS,
  KIND_COMPONENT_SETS,
  type EntityPresetId
} from "./ComponentRegistry";
import { setHotbarArray } from "./HotbarComponents";
import type { WorldWithComponents } from "./SimulationEcsTypes";

export interface EntityFactoryOverrides {
  modelId?: number;
  renderArchetypeId?: number;
  materialVariantId?: number;
  tintColorRgb?: number;
  uniformScalePct?: number;
  equippedWeaponArchetypeId?: number;
  equippedWeaponTintColorRgb?: number;
  equippedHeadArchetypeId?: number;
  equippedHeadTintColorRgb?: number;
  equippedBodyArchetypeId?: number;
  equippedBodyTintColorRgb?: number;
  equippedLegsArchetypeId?: number;
  equippedLegsTintColorRgb?: number;
  equippedAccessoryArchetypeId?: number;
  equippedAccessoryTintColorRgb?: number;
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
  pickupDefinitionId?: number;
  itemQuantity?: number;
  // Location
  locationPid?: number;
  locationKind?: number;
  locationArchetypeId?: number;
  locationSeed?: number;
  locationEnvironmentId?: number;
  locationStreamingRadius?: number;
  locationInfluenceRadius?: number;
  worldAnchorId?: number;
  worldAnchorKind?: number;
  worldAnchorArchetypeId?: number;
  worldAnchorSeed?: number;
  worldAnchorEnvironmentId?: number;
  worldAnchorStreamingRadius?: number;
  worldAnchorInfluenceRadius?: number;
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

  public createEntityFromPreset(presetId: EntityPresetId, overrides?: EntityFactoryOverrides): number {
    const eid = this.createEid();
    const setKeys = ENTITY_PRESET_COMPONENT_SETS[presetId];
    this.addComponents(eid, setKeys);
    this.applyOverrides(eid, overrides);
    return eid;
  }

  private addComponents(eid: number, setKeys: readonly string[]): void {
    for (const setKey of setKeys) {
      const componentNames = KIND_COMPONENT_SETS[setKey];
      if (!componentNames) {
        throw new Error(`Unknown ECS component set "${setKey}".`);
      }
      for (const compName of componentNames) {
        const comp = this.registry.resolve(compName);
        if (!comp) {
          throw new Error(`ECS component set "${setKey}" references missing component "${compName}".`);
        }
        addComponent(this.world, eid, comp);
      }
    }
  }

  private applyOverrides(eid: number, overrides?: EntityFactoryOverrides): void {

    const c = this.world.components;
    // Set default base values
    c.NetworkId.value[eid] = 0;
    c.ModelId.value[eid] = overrides?.modelId ?? 0;
    c.RenderArchetypeId.value[eid] = sanitizeRenderArchetypeId(overrides?.renderArchetypeId ?? (overrides?.modelId ?? 0));
    c.MaterialVariantId.value[eid] = sanitizeMaterialVariantId(overrides?.materialVariantId ?? DEFAULT_MATERIAL_VARIANT_ID);
    c.TintColorRgb.value[eid] = sanitizeTintColorRgb(overrides?.tintColorRgb ?? DEFAULT_TINT_COLOR_RGB);
    c.UniformScalePct.value[eid] = sanitizeUniformScalePct(overrides?.uniformScalePct ?? DEFAULT_UNIFORM_SCALE_PCT);
    c.EquippedWeaponArchetypeId.value[eid] = sanitizeRenderArchetypeId(overrides?.equippedWeaponArchetypeId ?? 0);
    c.EquippedWeaponTintColorRgb.value[eid] = sanitizeTintColorRgb(overrides?.equippedWeaponTintColorRgb ?? DEFAULT_TINT_COLOR_RGB);
    c.EquippedHeadArchetypeId.value[eid] = sanitizeRenderArchetypeId(overrides?.equippedHeadArchetypeId ?? 0);
    c.EquippedHeadTintColorRgb.value[eid] = sanitizeTintColorRgb(overrides?.equippedHeadTintColorRgb ?? DEFAULT_TINT_COLOR_RGB);
    c.EquippedBodyArchetypeId.value[eid] = sanitizeRenderArchetypeId(overrides?.equippedBodyArchetypeId ?? 0);
    c.EquippedBodyTintColorRgb.value[eid] = sanitizeTintColorRgb(overrides?.equippedBodyTintColorRgb ?? DEFAULT_TINT_COLOR_RGB);
    c.EquippedLegsArchetypeId.value[eid] = sanitizeRenderArchetypeId(overrides?.equippedLegsArchetypeId ?? 0);
    c.EquippedLegsTintColorRgb.value[eid] = sanitizeTintColorRgb(overrides?.equippedLegsTintColorRgb ?? DEFAULT_TINT_COLOR_RGB);
    c.EquippedAccessoryArchetypeId.value[eid] = sanitizeRenderArchetypeId(overrides?.equippedAccessoryArchetypeId ?? 0);
    c.EquippedAccessoryTintColorRgb.value[eid] = sanitizeTintColorRgb(overrides?.equippedAccessoryTintColorRgb ?? DEFAULT_TINT_COLOR_RGB);
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
    c.ItemArchetypeId.value[eid] = overrides?.pickupDefinitionId ?? 0;
    c.ItemQuantity.value[eid] = overrides?.itemQuantity ?? 0;
    c.LocationPid.value[eid] = overrides?.worldAnchorId ?? overrides?.locationPid ?? 0;
    c.LocationKind.value[eid] = overrides?.worldAnchorKind ?? overrides?.locationKind ?? 0;
    c.LocationArchetypeId.value[eid] = overrides?.worldAnchorArchetypeId ?? overrides?.locationArchetypeId ?? 0;
    c.LocationSeed.value[eid] = overrides?.worldAnchorSeed ?? overrides?.locationSeed ?? 0;
    c.LocationEnvironmentId.value[eid] = overrides?.worldAnchorEnvironmentId ?? overrides?.locationEnvironmentId ?? 0;
    c.LocationStreamingRadius.value[eid] = overrides?.worldAnchorStreamingRadius ?? overrides?.locationStreamingRadius ?? 0;
    c.LocationInfluenceRadius.value[eid] = overrides?.worldAnchorInfluenceRadius ?? overrides?.locationInfluenceRadius ?? 0;
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
      setHotbarArray(c, eid, overrides.hotbarAbilityIds);
    }

    // Unlocked abilities
    if (overrides?.unlockedAbilityIds !== undefined) {
      c.UnlockedAbilityIds.value[eid] = normalizeSortedUniqueUInt(overrides.unlockedAbilityIds, {
        maxInclusive: 0xffff,
        includeZero: false
      });
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

