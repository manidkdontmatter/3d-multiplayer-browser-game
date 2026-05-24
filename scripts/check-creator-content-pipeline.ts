/**
 * Purpose: Validate creator template/tier/augment content contracts used by the creator + station production pipeline.
 * Scope: It belongs to repository guard-rail scripts.
 * Human Summary: Fails when blueprint content references invalid stats, traits, tiers, or augment mappings.
 */
import {
  creatorProfileIdToKind,
  type CreatorProfileId,
  getAllBlueprintDefinitions,
  getBlueprintTemplateProfile,
  getDerivedEffectsForKind,
  getAllItemDefinitions,
  getStatDefinitionsForKind,
  getTraitDefinitionById
} from "../src/engine/shared/index";
import { registerGameContent } from "../src/game/shared/registration";

function main(): void {
  registerGameContent();
  const blueprints = getAllBlueprintDefinitions();
  const errors: string[] = [];
  let augmentMappingTemplateCount = 0;

  for (const blueprint of blueprints) {
    const templateProfiles = blueprint.templateProfiles ?? {};
    for (const profileId of Object.keys(templateProfiles)) {
      const kind = creatorProfileIdToKind(profileId as CreatorProfileId);
      const profile = getBlueprintTemplateProfile(blueprint, profileId)!;
      const validStatIds = new Set(getStatDefinitionsForKind(kind).map((entry) => entry.id));
      const validDerivedIds = new Set(getDerivedEffectsForKind(kind).map((entry) => entry.id));

      for (const statId of Object.keys(profile.draftStats ?? {})) {
        if (!validStatIds.has(statId)) {
          errors.push(`Blueprint ${blueprint.id} profile ${profileId}: invalid draft stat "${statId}".`);
        }
      }

      for (const traitId of profile.availableAttributeIds ?? []) {
        const trait = getTraitDefinitionById(traitId);
        if (!trait) {
          errors.push(`Blueprint ${blueprint.id} profile ${profileId}: unknown trait "${traitId}".`);
          continue;
        }
        if (!trait.appliesTo.includes(kind)) {
          errors.push(`Blueprint ${blueprint.id} profile ${profileId}: trait "${traitId}" does not apply to kind "${kind}".`);
        }
        if (!Number.isFinite(trait.budgetDelta)) {
          errors.push(`Blueprint ${blueprint.id} profile ${profileId}: trait "${traitId}" has invalid budgetDelta.`);
        }
      }

      if (profileId === "item_creator") {
        const tierField = (profile.fieldDefinitions ?? []).find((field) => field.id === "tier");
        if (tierField) {
          if (tierField.valueKind !== "number") {
            errors.push(`Blueprint ${blueprint.id} item_creator: tier field must be numeric.`);
          }
          if (
            typeof tierField.min !== "number" ||
            typeof tierField.max !== "number" ||
            !Number.isFinite(tierField.min) ||
            !Number.isFinite(tierField.max)
          ) {
            errors.push(`Blueprint ${blueprint.id} item_creator: tier field must declare finite min/max.`);
          }
        }

        if (profile.augmentMappings && Object.keys(profile.augmentMappings).length > 0) {
          augmentMappingTemplateCount += 1;
          for (const [itemDefinitionIdRaw, modifiers] of Object.entries(profile.augmentMappings)) {
            const itemDefinitionId = Number(itemDefinitionIdRaw);
            if (!Number.isFinite(itemDefinitionId) || itemDefinitionId <= 0) {
              errors.push(`Blueprint ${blueprint.id} item_creator: augment mapping key "${itemDefinitionIdRaw}" invalid.`);
            }
            for (const modifier of modifiers) {
              if (!validDerivedIds.has(modifier.statId)) {
                errors.push(
                  `Blueprint ${blueprint.id} item_creator: augment mapping stat "${modifier.statId}" is not a valid derived item stat.`
                );
              }
              if (modifier.mode !== "add" && modifier.mode !== "multiply") {
                errors.push(`Blueprint ${blueprint.id} item_creator: augment mapping mode "${String(modifier.mode)}" invalid.`);
              }
              if (!Number.isFinite(modifier.value)) {
                errors.push(`Blueprint ${blueprint.id} item_creator: augment mapping value for "${modifier.statId}" invalid.`);
              }
            }
          }
        }
      }
    }
  }

  if (augmentMappingTemplateCount <= 0) {
    errors.push("No item_creator template defines augmentMappings content.");
  }

  const itemDefinitions = getAllItemDefinitions();
  for (const item of itemDefinitions) {
    const hasReadyAppearance = typeof item.readyAppearanceId === "string" && item.readyAppearanceId.length > 0;
    if (!hasReadyAppearance) {
      continue;
    }
    const equippedAsset = item.readyAppearanceEquippedAssetId;
    const pickupAsset = item.readyAppearancePickupAssetId;
    if (typeof equippedAsset !== "string" || equippedAsset.trim().length <= 0) {
      errors.push(
        `Item ${item.id} (${item.key}) has readyAppearanceId="${item.readyAppearanceId}" but missing readyAppearanceEquippedAssetId.`
      );
    }
    if (typeof pickupAsset !== "string" || pickupAsset.trim().length <= 0) {
      errors.push(
        `Item ${item.id} (${item.key}) has readyAppearanceId="${item.readyAppearanceId}" but missing readyAppearancePickupAssetId.`
      );
    }
  }

  if (errors.length > 0) {
    console.error("[check-creator-content-pipeline] failed");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  console.log("[check-creator-content-pipeline] passed");
}

main();
