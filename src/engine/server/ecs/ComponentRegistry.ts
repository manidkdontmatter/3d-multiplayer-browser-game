/**
 * Purpose: This file tracks known definitions and lookup mappings in one place.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type { WorldWithComponents } from "./SimulationEcsTypes";

type ComponentDef = Record<string, unknown>;

export class ComponentRegistry {
  private readonly map = new Map<string, ComponentDef>();

  public constructor(components: WorldWithComponents["components"]) {
    const c = components as unknown as Record<string, ComponentDef>;
    for (const name of Object.keys(c)) {
      const comp = c[name];
      if (comp && typeof comp === "object") {
        this.map.set(name, comp);
      }
    }
  }

  public resolve(name: string): ComponentDef | null {
    return this.map.get(name) ?? null;
  }

  public has(name: string): boolean {
    return this.map.has(name);
  }
}

// Maps high-level runtime component groups to the bitecs components they expand to.
// These are construction presets only; runtime behavior is still component-driven.
export const KIND_COMPONENT_SETS: Record<string, readonly string[]> = {
  // Base components shared by all replicated entities
  base: [
    "NetworkId", "ModelId", "RenderArchetypeId", "MaterialVariantId", "TintColorRgb", "UniformScalePct",
    "EquippedWeaponArchetypeId", "EquippedWeaponTintColorRgb",
    "EquippedHeadArchetypeId", "EquippedHeadTintColorRgb",
    "EquippedBodyArchetypeId", "EquippedBodyTintColorRgb",
    "EquippedLegsArchetypeId", "EquippedLegsTintColorRgb",
    "EquippedAccessoryArchetypeId", "EquippedAccessoryTintColorRgb",
    "Position", "Rotation",
    "Grounded", "MovementMode", "Health",
    "ItemArchetypeId", "ItemQuantity",
    "LocationPid", "LocationKind", "LocationArchetypeId", "LocationSeed",
    "LocationEnvironmentId", "LocationStreamingRadius", "LocationInfluenceRadius",
    "CharacterArchetypeId", "ControllerKind"
  ],
  // Character components (added on top of base)
  character: [
    "Velocity", "GroundedPlatformPid", "CarriedFramePid",
    "Yaw", "Pitch", "LastProcessedSequence",
    "PrimaryHeld", "SecondaryHeld", "PrimaryMouseSlot", "SecondaryMouseSlot",
    "UnlockedAbilityIds", "CharacterTag"
  ],
  // Player extras (added on top of character)
  player: ["PlayerTag", "ReplicatedTag", "AccountId"],
  // NPC extras (added on top of character)
  npc: ["NpcTag", "ReplicatedTag"],
  // Projectile
  projectile: [
    "Velocity", "ProjectileOwnerEid", "ProjectileOwnerNid", "ProjectileKind",
    "ProjectileRadius", "ProjectileDamage", "ProjectileTtl",
    "ProjectileInitialTtl",
    "ProjectileRemainingRange", "ProjectileGravity", "ProjectileDrag",
    "ProjectileMaxSpeed", "ProjectileMinSpeed", "ProjectileRemainingPierces",
    "ProjectilePatternSeed", "ProjectilePatternKind", "ProjectilePatternSpiralFrequencyHz",
    "ProjectilePatternSpiralStrength", "ProjectileBaseDirection",
    "ProjectileTargetAllowSelf", "ProjectileTargetAllowPlayers", "ProjectileTargetAllowNpcs", "ProjectileTargetAllowDummies",
    "ProjectileDespawnOnDamageableHit", "ProjectileDespawnOnWorldHit",
    "ProjectileTag", "ReplicatedTag"
  ],
  // Platform
  platform: ["PlatformTag"],
  // Location root
  locationRoot: ["LocationRootTag", "ReplicatedTag"],
  // Dummy
  dummy: ["DummyTag", "ReplicatedTag"],
  // World item
  worldItem: ["WorldItemTag", "ReplicatedTag"]
};

// Map from runtime construction preset to the component set keys to use.
export const ENTITY_PRESET_COMPONENT_SETS = {
  character: ["base", "character", "player"],
  npc: ["base", "character", "npc"],
  projectile: ["base", "projectile"],
  platform: ["base", "platform"],
  location: ["base", "locationRoot"],
  dummy: ["base", "dummy"],
  item: ["base", "worldItem"]
} as const;

export type EntityPresetId = keyof typeof ENTITY_PRESET_COMPONENT_SETS;

export function isEntityPresetId(value: string): value is EntityPresetId {
  return Object.prototype.hasOwnProperty.call(ENTITY_PRESET_COMPONENT_SETS, value);
}
