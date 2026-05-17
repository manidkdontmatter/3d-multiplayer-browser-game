// Projects the unified blueprint catalog into runtime catalogs consumed by legacy systems.
import {
  buildAbilityDefinitionFromBlueprint,
  buildItemDefinitionFromBlueprint,
  buildPlatformDefinitionFromBlueprint,
  type BlueprintDefinition
} from "../../engine/shared/index";
import type { AbilityArchetypeCatalogRaw } from "../../engine/shared/abilities";
import type { ItemCatalogRaw } from "../../engine/shared/items";
import type { PlatformArchetypeCatalog } from "../../engine/shared/platforms";

export interface BlueprintRuntimeCatalogProjection {
  readonly abilities: AbilityArchetypeCatalogRaw;
  readonly items: ItemCatalogRaw;
  readonly platforms: PlatformArchetypeCatalog;
}

export function projectBlueprintsToRuntimeCatalogs(
  blueprints: readonly BlueprintDefinition[]
): BlueprintRuntimeCatalogProjection {
  return {
    abilities: projectAbilityCatalog(blueprints),
    items: projectItemCatalog(blueprints),
    platforms: projectPlatformCatalog(blueprints)
  };
}

function projectAbilityCatalog(blueprints: readonly BlueprintDefinition[]): AbilityArchetypeCatalogRaw {
  const abilities = blueprints
    .map((blueprint) => buildAbilityDefinitionFromBlueprint(blueprint))
    .filter((ability): ability is NonNullable<typeof ability> => Boolean(ability));
  return {
    version: 1,
    baseAbilities: abilities.map((ability) => ({
      id: ability.id,
      key: ability.key,
      name: ability.name,
      description: ability.description,
      category: ability.category,
      points: ability.points,
      attributes: ability.attributes,
      projectile: ability.projectile ?? undefined,
      melee: ability.melee ?? undefined
    })),
    defaults: {
      hotbarAbilityIds: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0],
      unlockedAbilityIds: [1, 2],
      primaryMouseSlot: 0,
      secondaryMouseSlot: 1
    }
  };
}

function projectItemCatalog(blueprints: readonly BlueprintDefinition[]): ItemCatalogRaw {
  const items = blueprints
    .map((blueprint) => buildItemDefinitionFromBlueprint(blueprint))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    version: 1,
    inventory: { maxSlots: 32 },
    items: items.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      category: item.category,
      modelId: item.modelId,
      stackMax: item.stackMax,
      equipSlot: item.equipSlot ?? null,
      use: item.use ?? null
    })),
    starterWorldItems: [
      { archetypeId: 200, quantity: 3, x: 2.35, y: 21.05, z: -2.4 },
      { archetypeId: 201, quantity: 1, x: 2.15, y: 21.05, z: -2.65 },
      { archetypeId: 202, quantity: 8, x: 3.55, y: 21.05, z: -2.95 }
    ]
  };
}

function projectPlatformCatalog(blueprints: readonly BlueprintDefinition[]): PlatformArchetypeCatalog {
  const platforms = blueprints
    .map((blueprint) => buildPlatformDefinitionFromBlueprint(blueprint))
    .filter((platform): platform is NonNullable<typeof platform> => Boolean(platform));
  return {
    version: 1,
    platforms
  };
}
