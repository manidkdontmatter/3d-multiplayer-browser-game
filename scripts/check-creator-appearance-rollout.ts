/**
 * Purpose: Validate creator appearance rollout consistency across bindings, runtime projections, and client asset catalog grouping.
 * Scope: It belongs to repository guard-rail scripts.
 * Human Summary: Fails when creator appearance ids drift between bindings, runtime item/ability definitions, or catalog groups.
 */
import {
  getAllAbilityDefinitions,
  getAllItemDefinitions,
  getCreatorAppearanceOptions,
  resolveActivationAppearanceRuntimeBinding,
  resolveReadyAppearanceRuntimeBinding
} from "../src/engine/shared/index";
import { ASSET_GROUP_CREATOR_APPEARANCE } from "../src/engine/client/assets/assetManifest";
import { ASSET_CATALOG_DEFINITIONS } from "../src/game/client/assetCatalog";
import { registerGameContent } from "../src/game/shared/registration";

function main(): void {
  registerGameContent();
  const errors: string[] = [];
  const knownAppearanceIds = new Set(getCreatorAppearanceOptions().map((option) => option.value));
  const assetById = new Map(ASSET_CATALOG_DEFINITIONS.map((entry) => [entry.id, entry]));

  for (const appearanceId of knownAppearanceIds) {
    const ready = resolveReadyAppearanceRuntimeBinding(appearanceId);
    const activation = resolveActivationAppearanceRuntimeBinding(appearanceId);
    ensureCatalogAssetInCreatorGroup(errors, assetById, `ready:${appearanceId}:equipped`, ready.equipped.assetId);
    ensureCatalogAssetInCreatorGroup(errors, assetById, `ready:${appearanceId}:pickup`, ready.pickup.assetId);
    ensureCatalogAssetInCreatorGroup(errors, assetById, `activation:${appearanceId}`, activation.assetId);
  }

  for (const item of getAllItemDefinitions()) {
    if (!isKnownAppearanceId(knownAppearanceIds, item.readyAppearanceId)) {
      continue;
    }
    const ready = resolveReadyAppearanceRuntimeBinding(item.readyAppearanceId);
    const activation = resolveActivationAppearanceRuntimeBinding(item.activationAppearanceId ?? null);
    if ((item.readyAppearanceEquippedAssetId ?? null) !== (ready.equipped.assetId ?? null)) {
      errors.push(
        `Item ${item.id} (${item.key}) readyAppearanceEquippedAssetId mismatch: got "${item.readyAppearanceEquippedAssetId ?? "null"}", expected "${ready.equipped.assetId ?? "null"}".`
      );
    }
    if ((item.readyAppearancePickupAssetId ?? null) !== (ready.pickup.assetId ?? null)) {
      errors.push(
        `Item ${item.id} (${item.key}) readyAppearancePickupAssetId mismatch: got "${item.readyAppearancePickupAssetId ?? "null"}", expected "${ready.pickup.assetId ?? "null"}".`
      );
    }
    if ((item.activationAppearanceAssetId ?? null) !== (activation.assetId ?? null)) {
      errors.push(
        `Item ${item.id} (${item.key}) activationAppearanceAssetId mismatch: got "${item.activationAppearanceAssetId ?? "null"}", expected "${activation.assetId ?? "null"}".`
      );
    }
  }

  for (const ability of getAllAbilityDefinitions()) {
    if (!isKnownAppearanceId(knownAppearanceIds, ability.activationAppearanceId)) {
      continue;
    }
    const activation = resolveActivationAppearanceRuntimeBinding(ability.activationAppearanceId);
    if ((ability.activationAppearanceAssetId ?? null) !== (activation.assetId ?? null)) {
      errors.push(
        `Ability ${ability.id} (${ability.key}) activationAppearanceAssetId mismatch: got "${ability.activationAppearanceAssetId ?? "null"}", expected "${activation.assetId ?? "null"}".`
      );
    }
  }

  if (errors.length > 0) {
    console.error("[check-creator-appearance-rollout] failed");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  console.log("[check-creator-appearance-rollout] passed");
}

function ensureCatalogAssetInCreatorGroup(
  errors: string[],
  assetById: ReadonlyMap<string, { id: string; groups: string[] }>,
  label: string,
  assetId: string | null
): void {
  if (typeof assetId !== "string" || assetId.trim().length <= 0) {
    errors.push(`${label} assetId must be a non-empty string.`);
    return;
  }
  const catalog = assetById.get(assetId);
  if (!catalog) {
    errors.push(`${label} assetId "${assetId}" is missing from client asset catalog.`);
    return;
  }
  if (!catalog.groups.includes(ASSET_GROUP_CREATOR_APPEARANCE)) {
    errors.push(`${label} assetId "${assetId}" must be in asset group "${ASSET_GROUP_CREATOR_APPEARANCE}".`);
  }
}

function isKnownAppearanceId(knownIds: ReadonlySet<string>, value: string | null | undefined): value is string {
  return typeof value === "string" && knownIds.has(value);
}

main();
