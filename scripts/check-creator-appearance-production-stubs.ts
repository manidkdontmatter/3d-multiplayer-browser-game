/**
 * Purpose: Enforce creator appearance production-stub path conventions in bindings and client asset catalog.
 * Scope: It belongs to repository guard-rail scripts.
 * Human Summary: Fails when creator appearance references regress to old placeholder-style path patterns.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ASSET_CATALOG_DEFINITIONS } from "../src/game/client/assetCatalog";
import {
  getCreatorAppearanceOptions,
  resolveActivationAppearanceRuntimeBinding,
  resolveReadyAppearanceRuntimeBinding
} from "../src/engine/shared/index";
import { registerGameContent } from "../src/game/shared/registration";

function main(): void {
  registerGameContent();
  const errors: string[] = [];
  const appearanceIds = getCreatorAppearanceOptions().map((option) => option.value);
  const catalogById = new Map(ASSET_CATALOG_DEFINITIONS.map((entry) => [entry.id, entry]));

  for (const appearanceId of appearanceIds) {
    const readyBinding = resolveReadyAppearanceRuntimeBinding(appearanceId);
    const activationBinding = resolveActivationAppearanceRuntimeBinding(appearanceId);

    validateProductionStubUrl(
      errors,
      `ready:${appearanceId}:equipped.previewTextureUrl`,
      readyBinding.equipped.previewTextureUrl,
      /^\/assets\/textures\/creator\/ready-equipped-[a-z0-9_-]+\.svg$/
    );
    validateProductionStubUrl(
      errors,
      `ready:${appearanceId}:pickup.previewTextureUrl`,
      readyBinding.pickup.previewTextureUrl,
      /^\/assets\/textures\/creator\/ready-pickup-[a-z0-9_-]+\.svg$/
    );
    validateProductionStubUrl(
      errors,
      `activation:${appearanceId}.previewTextureUrl`,
      activationBinding.previewTextureUrl,
      /^\/assets\/textures\/creator\/activation-projectile-[a-z0-9_-]+\.svg$/
    );

    validateCatalogSourceUrl(
      errors,
      catalogById,
      `ready:${appearanceId}:equipped.assetId`,
      readyBinding.equipped.assetId,
      /^\/assets\/textures\/creator\/ready-equipped-[a-z0-9_-]+\.svg$/
    );
    validateCatalogSourceUrl(
      errors,
      catalogById,
      `ready:${appearanceId}:pickup.assetId`,
      readyBinding.pickup.assetId,
      /^\/assets\/textures\/creator\/ready-pickup-[a-z0-9_-]+\.svg$/
    );
    validateCatalogSourceUrl(
      errors,
      catalogById,
      `activation:${appearanceId}.assetId`,
      activationBinding.assetId,
      /^\/assets\/textures\/creator\/activation-projectile-[a-z0-9_-]+\.svg$/
    );
  }

  if (errors.length > 0) {
    console.error("[check-creator-appearance-production-stubs] failed");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  console.log("[check-creator-appearance-production-stubs] passed");
}

function validateProductionStubUrl(
  errors: string[],
  label: string,
  value: string | null,
  pattern: RegExp
): void {
  if (typeof value !== "string" || value.trim().length <= 0) {
    errors.push(`${label} must be a non-empty string.`);
    return;
  }
  const normalized = value.trim();
  if (!pattern.test(normalized)) {
    errors.push(`${label} must match pattern ${pattern} (got "${normalized}").`);
    return;
  }
  const localPath = resolve(process.cwd(), "public", normalized.slice(1));
  if (!existsSync(localPath)) {
    errors.push(`${label} points to missing file: ${localPath}`);
  }
}

function validateCatalogSourceUrl(
  errors: string[],
  catalogById: ReadonlyMap<string, { sourceUrl?: string }>,
  label: string,
  assetId: string | null,
  pattern: RegExp
): void {
  if (typeof assetId !== "string" || assetId.trim().length <= 0) {
    errors.push(`${label} must be a non-empty asset id.`);
    return;
  }
  const entry = catalogById.get(assetId);
  if (!entry) {
    errors.push(`${label} asset id "${assetId}" missing from client asset catalog.`);
    return;
  }
  if (typeof entry.sourceUrl !== "string" || !pattern.test(entry.sourceUrl)) {
    errors.push(`${label} catalog sourceUrl must match ${pattern} (got "${entry.sourceUrl ?? "null"}").`);
  }
}

main();

