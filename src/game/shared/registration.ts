// Game-specific stat, trait, and archetype registration.
// The unified archetypes.json is the single source of truth.
// Legacy gameplay systems (ability, item, platform) receive catalogs derived from it.

import {
  injectStatDefinitions,
  injectDerivedEffectDefinitions,
  injectTraitDefinitions,
  injectArchetypeCatalog,
  type StatAllocationDefinition,
  type DerivedEffectDefinition,
  type TraitDefinition
} from "../../engine/shared/index";

// Legacy catalog injection functions (fed from unified data)
import { injectAbilityCatalog, type AbilityArchetypeCatalogRaw } from "../../engine/shared/abilities";
import { injectItemCatalog, type ItemCatalogRaw } from "../../engine/shared/items";
import { injectPlatformCatalog, type PlatformArchetypeCatalog } from "../../engine/shared/platforms";

import archetypesRaw from "./archetypes.json";

// ═══════════════════════════════════════════════════════════════════════════
// STAT DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const GAME_STAT_DEFINITIONS: readonly StatAllocationDefinition[] = [
  { id: "power", label: "Power", description: "Raw damage output.", appliesTo: ["ability"] },
  { id: "velocity", label: "Velocity", description: "Projectile speed and melee range.", appliesTo: ["ability"] },
  { id: "efficiency", label: "Efficiency", description: "Shorter cooldown, longer lifetime.", appliesTo: ["ability"] },
  { id: "control", label: "Control", description: "Radius, arc width, precision.", appliesTo: ["ability"] },

  { id: "power", label: "Power", description: "Attack and ability damage.", appliesTo: ["character"] },
  { id: "durability", label: "Durability", description: "Defense and maximum health.", appliesTo: ["character"] },
  { id: "speed", label: "Speed", description: "Movement speed, attack delay reduction.", appliesTo: ["character"] },
  { id: "stamina", label: "Stamina", description: "Maximum stamina and regeneration.", appliesTo: ["character"] },
  { id: "vitality", label: "Vitality", description: "Health regeneration.", appliesTo: ["character"] },
  { id: "spirit", label: "Spirit", description: "Bonus damage proportional to missing health.", appliesTo: ["character"] },

  { id: "sharpness", label: "Sharpness", description: "Damage dealt by this weapon.", appliesTo: ["item"] },
  { id: "hardness", label: "Hardness", description: "Defense provided by this armor.", appliesTo: ["item"] },
  { id: "potency", label: "Potency", description: "Effect strength of consumables.", appliesTo: ["item"] },
];

// ═══════════════════════════════════════════════════════════════════════════
// DERIVED EFFECT DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const GAME_DERIVED_EFFECTS: readonly DerivedEffectDefinition[] = [
  { id: "abilityDamage", label: "Ability Damage", sourceStat: "power", baseValue: 7, perPoint: 2.8, appliesTo: ["ability"] },
  { id: "projectileSpeed", label: "Projectile Speed", sourceStat: "velocity", baseValue: 10, perPoint: 1.9, appliesTo: ["ability"] },
  { id: "cooldownSeconds", label: "Cooldown", sourceStat: "efficiency", baseValue: 0.75, perPoint: -0.025, appliesTo: ["ability"] },
  { id: "projectileRadius", label: "Projectile Radius", sourceStat: "control", baseValue: 0.12, perPoint: 0.014, appliesTo: ["ability"] },

  { id: "attackPower", label: "Attack Power", sourceStat: "power", baseValue: 100, perPoint: 30, appliesTo: ["character"] },
  { id: "abilityPower", label: "Ability Power", sourceStat: "power", baseValue: 100, perPoint: 20, appliesTo: ["character"] },
  { id: "defense", label: "Defense", sourceStat: "durability", baseValue: 100, perPoint: 20, appliesTo: ["character"] },
  { id: "maxHealth", label: "Max Health", sourceStat: "durability", baseValue: 100, perPoint: 40, appliesTo: ["character"] },
  { id: "moveSpeed", label: "Move Speed", sourceStat: "speed", baseValue: 6, perPoint: 0.3, appliesTo: ["character"] },
  { id: "attackDelayReduction", label: "Attack Delay Reduction", sourceStat: "speed", baseValue: 0, perPoint: 0.01, appliesTo: ["character"] },
  { id: "cooldownReduction", label: "Cooldown Reduction", sourceStat: "speed", baseValue: 0, perPoint: 0.015, appliesTo: ["character"] },
  { id: "maxStamina", label: "Max Stamina", sourceStat: "stamina", baseValue: 100, perPoint: 20, appliesTo: ["character"] },
  { id: "staminaRegen", label: "Stamina Regen", sourceStat: "stamina", baseValue: 0, perPoint: 1, appliesTo: ["character"] },
  { id: "healthRegen", label: "Health Regen", sourceStat: "vitality", baseValue: 0, perPoint: 0.4, appliesTo: ["character"] },
  { id: "spiritBonus", label: "Spirit Bonus", sourceStat: "spirit", baseValue: 0, perPoint: 0.10, appliesTo: ["character"] },

  { id: "itemDamage", label: "Item Damage", sourceStat: "sharpness", baseValue: 5, perPoint: 3, appliesTo: ["item"] },
  { id: "itemDefense", label: "Item Defense", sourceStat: "hardness", baseValue: 0, perPoint: 4, appliesTo: ["item"] },
  { id: "itemEffectStrength", label: "Effect Strength", sourceStat: "potency", baseValue: 10, perPoint: 5, appliesTo: ["item"] },
];

// ═══════════════════════════════════════════════════════════════════════════
// TRAIT DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const GAME_TRAIT_DEFINITIONS: readonly TraitDefinition[] = [
  {
    id: "homing-lite", label: "Homing Lite",
    description: "Mild target guidance with a small speed tradeoff.",
    polarity: "upside", budgetDelta: 1,
    statModifiers: [{ stat: "projectileSpeed", multiplier: 0.92 }, { stat: "abilityDamage", multiplier: 0.95 }],
    effects: [], constraints: [], appliesTo: ["ability"]
  },
  {
    id: "wide-impact", label: "Wide Impact",
    description: "Larger projectile radius, lower precision damage.",
    polarity: "upside", budgetDelta: 1,
    statModifiers: [{ stat: "projectileRadius", additive: 0.09 }, { stat: "abilityDamage", multiplier: 0.9 }],
    effects: [], constraints: [], appliesTo: ["ability"]
  },
  {
    id: "quick-cast", label: "Quick Cast",
    description: "Shorter cooldown at reduced per-hit damage.",
    polarity: "upside", budgetDelta: 1,
    statModifiers: [{ stat: "cooldownSeconds", multiplier: 0.78 }, { stat: "abilityDamage", multiplier: 0.9 }],
    effects: [], constraints: [], appliesTo: ["ability"]
  },
  {
    id: "long-reach", label: "Long Reach",
    description: "Longer lifetime/range with lighter impact.",
    polarity: "upside", budgetDelta: 1,
    statModifiers: [{ stat: "abilityDamage", multiplier: 0.93 }],
    effects: [], constraints: [], appliesTo: ["ability"]
  },
  {
    id: "berserker", label: "Berserker",
    description: "Deal more damage but take more damage.",
    polarity: "upside", budgetDelta: 1,
    statModifiers: [{ stat: "attackPower", multiplier: 1.15 }, { stat: "defense", multiplier: 0.85 }],
    effects: [], constraints: [], appliesTo: ["character"]
  },
  {
    id: "tank", label: "Tank",
    description: "More defense at the cost of speed.",
    polarity: "upside", budgetDelta: 1,
    statModifiers: [{ stat: "defense", multiplier: 1.2 }, { stat: "moveSpeed", multiplier: 0.9 }],
    effects: [], constraints: [], appliesTo: ["character"]
  },
  {
    id: "glass-cannon", label: "Glass Cannon",
    description: "High damage, low health.",
    polarity: "upside", budgetDelta: 1,
    statModifiers: [{ stat: "attackPower", multiplier: 1.3 }, { stat: "maxHealth", multiplier: 0.7 }],
    effects: [], constraints: ["conflicts:tank"], appliesTo: ["character"]
  },
  {
    id: "clumsy", label: "Clumsy",
    description: "Reduced speed, grants extra trait budget.",
    polarity: "downside", budgetDelta: 1,
    statModifiers: [{ stat: "moveSpeed", multiplier: 0.85 }],
    effects: [], constraints: [], appliesTo: ["character", "ability"]
  },
  {
    id: "sharpened", label: "Sharpened",
    description: "Increased weapon damage.",
    polarity: "upside", budgetDelta: 1,
    statModifiers: [{ stat: "itemDamage", multiplier: 1.2 }],
    effects: [], constraints: [], appliesTo: ["item"]
  },
  {
    id: "fortified", label: "Fortified",
    description: "Increased armor defense.",
    polarity: "upside", budgetDelta: 1,
    statModifiers: [{ stat: "itemDefense", multiplier: 1.25 }],
    effects: [], constraints: [], appliesTo: ["item"]
  },
  {
    id: "brittle", label: "Brittle",
    description: "Reduced durability, grants extra budget.",
    polarity: "downside", budgetDelta: 1,
    statModifiers: [{ stat: "itemDefense", multiplier: 0.8 }],
    effects: [], constraints: [], appliesTo: ["item"]
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

export function registerGameContent(): void {
  // Unified engine registries
  injectStatDefinitions(GAME_STAT_DEFINITIONS);
  injectDerivedEffectDefinitions(GAME_DERIVED_EFFECTS);
  injectTraitDefinitions(GAME_TRAIT_DEFINITIONS);
  injectArchetypeCatalog(archetypesRaw as { version: unknown; archetypes: unknown });

  // Build gameplay catalogs from unified archetypes
  injectAbilityCatalog(buildAbilityCatalog());
  injectItemCatalog(buildItemCatalog());
  injectPlatformCatalog(buildPlatformCatalog());
}

// ═══════════════════════════════════════════════════════════════════════════
// CATALOG BUILDERS — derive from unified archetypes
// ═══════════════════════════════════════════════════════════════════════════

type RawArchetype = Record<string, unknown>;

function allArchetypes(): RawArchetype[] {
  return (archetypesRaw as { archetypes: RawArchetype[] }).archetypes;
}

function buildAbilityCatalog(): AbilityArchetypeCatalogRaw {
  const abilities = allArchetypes().filter((a) => a.kind === "ability");
  return {
    version: 1,
    baseAbilities: abilities.map((a) => ({
      id: a.id,
      key: a.key,
      name: a.name,
      description: a.description,
      category: a.abilityCategory,
      points: a.abilityPoints ?? { power: 0, velocity: 0, efficiency: 0, control: 0 },
      attributes: a.abilityAttributes ?? [],
      projectile: a.projectileProfile ?? undefined,
      melee: a.meleeProfile ?? undefined
    })),
    defaults: {
      hotbarAbilityIds: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0],
      unlockedAbilityIds: [1, 2],
      primaryMouseSlot: 0,
      secondaryMouseSlot: 1
    }
  };
}

function buildItemCatalog(): ItemCatalogRaw {
  const items = allArchetypes().filter((a) => a.kind === "item");
  return {
    version: 1,
    inventory: { maxSlots: 32 },
    items: items.map((a) => ({
      id: a.id,
      key: a.key,
      name: a.name,
      description: a.description,
      category: a.itemCategory,
      modelId: a.modelId,
      stackMax: a.itemStackMax ?? 1,
      equipSlot: a.itemEquipSlot ?? null,
      use: a.itemUse ?? null
    })),
    starterWorldItems: [
      { archetypeId: 200, quantity: 3, x: 2.35, y: 21.05, z: -2.4 },
      { archetypeId: 201, quantity: 1, x: 2.15, y: 21.05, z: -2.65 },
      { archetypeId: 202, quantity: 8, x: 3.55, y: 21.05, z: -2.95 }
    ]
  };
}

function buildPlatformCatalog(): PlatformArchetypeCatalog {
  const platforms = allArchetypes().filter((a) => a.kind === "platform");
  return {
    version: 1,
    platforms: platforms.map((a) => ({
      pid: a.id,
      kind: a.platformKind,
      halfX: a.platformHalfX,
      halfY: a.platformHalfY,
      halfZ: a.platformHalfZ,
      baseX: a.platformBaseX ?? 0,
      baseY: a.platformBaseY ?? 29.05,
      baseZ: a.platformBaseZ ?? -8,
      baseYaw: a.platformBaseYaw ?? 0,
      amplitudeX: a.platformAmplitudeX,
      amplitudeY: a.platformAmplitudeY,
      frequency: a.platformFrequency,
      phase: a.platformPhase,
      angularSpeed: a.platformAngularSpeed
    }))
  };
}
