/**
 * Purpose: This file defines the "blueprint content projection" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the game-specific shared data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import {
  buildAbilityDefinitionFromBlueprint,
  buildItemDefinitionFromBlueprint,
  buildPlatformDefinitionFromBlueprint,
  type RuntimeActivationSpec,
  type RuntimeActivationEffectSpec,
  type BlueprintRuntimeCapabilityEntry,
  type BlueprintDefinition
} from "../../engine/shared/index";
import type { AbilityArchetypeCatalogRaw } from "../../engine/shared/abilities";
import type { ItemCatalogRaw } from "../../engine/shared/items";
import type { PlatformArchetypeCatalog } from "../../engine/shared/platforms";
import { ABILITY_ID_NONE, HOTBAR_SLOT_COUNT } from "../../engine/shared/abilities";

export type BlueprintRuntimeEntry = BlueprintRuntimeCapabilityEntry;

export interface BlueprintRuntimeCatalogProjection {
  readonly entries: readonly BlueprintRuntimeEntry[];
  readonly abilities: AbilityArchetypeCatalogRaw;
  readonly items: ItemCatalogRaw;
  readonly platforms: PlatformArchetypeCatalog;
}

export function projectBlueprintsToRuntimeCatalogs(
  blueprints: readonly BlueprintDefinition[]
): BlueprintRuntimeCatalogProjection {
  const entries = projectBlueprintRuntimeEntries(blueprints);
  return {
    entries,
    abilities: buildAbilityCatalogFromRuntime(entries),
    items: buildItemCatalogFromRuntime(entries),
    platforms: buildPlatformCatalogFromRuntime(entries)
  };
}

export function projectBlueprintRuntimeEntries(
  blueprints: readonly BlueprintDefinition[]
): readonly BlueprintRuntimeEntry[] {
  return blueprints.map((blueprint) => {
    const ability = buildAbilityDefinitionFromBlueprint(blueprint);
    const item = buildItemDefinitionFromBlueprint(blueprint);
    const platform = buildPlatformDefinitionFromBlueprint(blueprint);
    return {
      blueprintId: blueprint.id,
      ability,
      item,
      platform,
      activations: buildRuntimeActivationSpecs(ability, item)
    };
  });
}

function buildRuntimeActivationSpecs(
  ability: BlueprintRuntimeEntry["ability"],
  item: BlueprintRuntimeEntry["item"]
): readonly RuntimeActivationSpec[] {
  const specs: RuntimeActivationSpec[] = [];
  if (ability) {
    const effects: RuntimeActivationEffectSpec[] = [];
    if (ability.projectile) {
      effects.push({ type: "spawn_projectile", projectile: ability.projectile });
      specs.push({
        activationId: `ability:${ability.id}:primary`,
        source: "ability",
        channel: 0,
        cooldownSeconds: Math.max(0, ability.projectile.cooldownSeconds),
        consumeQuantity: 0,
        effects
      });
    } else if (ability.melee) {
      effects.push({ type: "apply_melee_hit", melee: ability.melee });
      specs.push({
        activationId: `ability:${ability.id}:primary`,
        source: "ability",
        channel: 0,
        cooldownSeconds: Math.max(0, ability.melee.cooldownSeconds),
        consumeQuantity: 0,
        effects
      });
    }
  }
  if (item?.use?.actions) {
    for (let channel = 0; channel < item.use.actions.length; channel += 1) {
      const action = item.use.actions[channel];
      if (!action) continue;
      const effects: RuntimeActivationEffectSpec[] = [];
      const restoreHealth = Math.max(0, Math.floor(action.restoreHealth ?? 0));
      if (restoreHealth > 0) {
        effects.push({ type: "restore_health", amount: restoreHealth });
      }
      for (const effect of action.effects ?? []) {
        if (effect.type === "restore_health" && effect.amount > 0) {
          effects.push({ type: "restore_health", amount: Math.floor(effect.amount) });
          continue;
        }
        if (effect.type === "set_player_render_appearance") {
          effects.push({
            type: "set_player_render_appearance",
            renderArchetypeId:
              typeof effect.renderArchetypeId === "number" ? Math.max(0, Math.floor(effect.renderArchetypeId)) : undefined,
            materialVariantId:
              typeof effect.materialVariantId === "number" ? Math.max(0, Math.floor(effect.materialVariantId)) : undefined,
            tintColorRgb:
              typeof effect.tintColorRgb === "number" ? Math.max(0, Math.min(0xffffff, Math.floor(effect.tintColorRgb))) : undefined,
            uniformScalePct:
              typeof effect.uniformScalePct === "number" ? Math.max(1, Math.min(1000, Math.floor(effect.uniformScalePct))) : undefined
          });
          continue;
        }
        if (effect.type === "set_equipped_slot_tint") {
          effects.push({
            type: "set_equipped_slot_tint",
            slot: effect.slot,
            tintColorRgb: Math.max(0, Math.min(0xffffff, Math.floor(effect.tintColorRgb)))
          });
        }
      }
      specs.push({
        activationId: `item:${item.id}:channel:${channel}`,
        source: "item",
        channel,
        cooldownSeconds: 0,
        consumeQuantity: Math.max(1, Math.floor(action.consumeQuantity)),
        effects
      });
    }
  }
  return specs;
}

function buildAbilityCatalogFromRuntime(entries: readonly BlueprintRuntimeEntry[]): AbilityArchetypeCatalogRaw {
  const abilities = entries
    .map((entry) => entry.ability)
    .filter((ability): ability is NonNullable<typeof ability> => Boolean(ability));
  const activationAbilityIds = entries
    .filter((entry) => entry.activations.some((activation) => activation.source === "ability"))
    .map((entry) => entry.blueprintId)
    .sort((a, b) => a - b);
  const unlockedAbilityIds = activationAbilityIds;
  const hotbarAbilityIds = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
  for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
    hotbarAbilityIds[slot] = unlockedAbilityIds[slot] ?? ABILITY_ID_NONE;
  }
  return {
    version: 1,
    baseAbilities: abilities.map((ability) => ({
      id: ability.id,
      key: ability.key,
      name: ability.name,
      description: ability.description,
      category: ability.category,
      activationAppearanceId: ability.activationAppearanceId ?? null,
      activationAppearanceAssetId: ability.activationAppearanceAssetId ?? null,
      points: ability.points,
      attributes: ability.attributes,
      projectile: ability.projectile ?? undefined,
      melee: ability.melee ?? undefined
    })),
    defaults: {
      hotbarAbilityIds,
      unlockedAbilityIds,
      primaryMouseSlot: 0,
      secondaryMouseSlot: 1
    }
  };
}

function buildItemCatalogFromRuntime(entries: readonly BlueprintRuntimeEntry[]): ItemCatalogRaw {
  const items = entries
    .map((entry) => entry.item)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    version: 1,
    inventory: { maxSlots: 160 },
    items: items.map((item) => ({
      id: item.id,
      key: item.key,
      name: item.name,
      description: item.description,
      category: item.category,
      modelId: item.modelId,
      readyAppearanceId: item.readyAppearanceId ?? null,
      readyAppearanceEquippedAssetId: item.readyAppearanceEquippedAssetId ?? null,
      readyAppearancePickupAssetId: item.readyAppearancePickupAssetId ?? null,
      readyAppearanceAssetId: item.readyAppearanceAssetId ?? null,
      activationAppearanceId: item.activationAppearanceId ?? null,
      activationAppearanceAssetId: item.activationAppearanceAssetId ?? null,
      stackMax: item.stackMax,
      equipSlot: item.equipSlot ?? null,
      use: item.use ?? null
    })),
    starterWorldItems: [
      { definitionId: 200, quantity: 5, x: 2.35, y: 34.05, z: -2.4 },
      { definitionId: 201, quantity: 5, x: 2.15, y: 34.05, z: -2.65 },
      { definitionId: 202, quantity: 5, x: 3.55, y: 34.05, z: -2.95 },
      { definitionId: 200, quantity: 5, x: -4.15, y: 34.05, z: 2.2 },
      { definitionId: 201, quantity: 5, x: -3.45, y: 34.05, z: 2.55 },
      { definitionId: 202, quantity: 5, x: -2.75, y: 34.05, z: 2.85 }
    ],
    stations: [
      {
        id: 1,
        key: "starter-station",
        name: "Starter Station",
        x: 0.5,
        y: 34,
        z: 3.5,
        interactRadius: 3.25
      }
    ]
  };
}

function buildPlatformCatalogFromRuntime(entries: readonly BlueprintRuntimeEntry[]): PlatformArchetypeCatalog {
  const platforms = entries
    .map((entry) => entry.platform)
    .filter((platform): platform is NonNullable<typeof platform> => Boolean(platform));
  return {
    version: 1,
    platforms
  };
}

