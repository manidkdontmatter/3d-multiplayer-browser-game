/**
 * Purpose: Validate creator appearance binding content and runtime compatibility contracts.
 * Scope: It belongs to repository guard-rail scripts.
 * Human Summary: Fails when appearance ids, bindings, or activation projectile kinds drift out of sync.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getCreatorAppearanceOptions,
  resolveActivationAppearanceRuntimeBinding,
  resolveReadyAppearanceRuntimeBinding
} from "../src/engine/shared/index";
import { ASSET_CATALOG_DEFINITIONS } from "../src/game/client/assetCatalog";
import { registerGameContent } from "../src/game/shared/registration";

interface ProjectileKindsCatalog {
  readonly projectileKinds?: ReadonlyArray<{ kind?: number; modelId?: number }>;
}

function main(): void {
  registerGameContent();
  const errors: string[] = [];
  const options = getCreatorAppearanceOptions();
  const appearanceIds = options.map((option) => option.value);
  const activationKinds = new Set<number>();
  const forbiddenPlaceholderArchetypes = new Set<number>([47, 48, 49]);
  const knownAssetIds = new Set(ASSET_CATALOG_DEFINITIONS.map((entry) => entry.id));

  for (const appearanceId of appearanceIds) {
    const readyBinding = resolveReadyAppearanceRuntimeBinding(appearanceId);
    const activationBinding = resolveActivationAppearanceRuntimeBinding(appearanceId);
    validateTint(errors, `ready:${appearanceId}:equipped.tintColorRgb`, readyBinding.equipped.tintColorRgb);
    validateTint(errors, `ready:${appearanceId}:pickup.tintColorRgb`, readyBinding.pickup.tintColorRgb);
    validateOptionalArchetype(errors, `ready:${appearanceId}:equipped.renderArchetypeId`, readyBinding.equipped.renderArchetypeId);
    validateOptionalArchetype(errors, `ready:${appearanceId}:pickup.renderArchetypeId`, readyBinding.pickup.renderArchetypeId);
    validateOptionalAssetId(errors, `ready:${appearanceId}:equipped.assetId`, readyBinding.equipped.assetId);
    validateOptionalAssetId(errors, `ready:${appearanceId}:pickup.assetId`, readyBinding.pickup.assetId);
    validateOptionalPublicAssetUrl(
      errors,
      `ready:${appearanceId}:equipped.previewTextureUrl`,
      readyBinding.equipped.previewTextureUrl
    );
    validateOptionalPublicAssetUrl(
      errors,
      `ready:${appearanceId}:pickup.previewTextureUrl`,
      readyBinding.pickup.previewTextureUrl
    );
    validatePublicAssetFileExists(
      errors,
      `ready:${appearanceId}:equipped.previewTextureUrl`,
      readyBinding.equipped.previewTextureUrl
    );
    validatePublicAssetFileExists(
      errors,
      `ready:${appearanceId}:pickup.previewTextureUrl`,
      readyBinding.pickup.previewTextureUrl
    );
    validateAssetIdReference(errors, knownAssetIds, `ready:${appearanceId}:equipped.assetId`, readyBinding.equipped.assetId);
    validateAssetIdReference(errors, knownAssetIds, `ready:${appearanceId}:pickup.assetId`, readyBinding.pickup.assetId);
    validateForbiddenPlaceholderArchetype(
      errors,
      forbiddenPlaceholderArchetypes,
      `ready:${appearanceId}:equipped.renderArchetypeId`,
      readyBinding.equipped.renderArchetypeId
    );
    validateForbiddenPlaceholderArchetype(
      errors,
      forbiddenPlaceholderArchetypes,
      `ready:${appearanceId}:pickup.renderArchetypeId`,
      readyBinding.pickup.renderArchetypeId
    );
    if (!Number.isFinite(activationBinding.projectileKind) || activationBinding.projectileKind <= 0) {
      errors.push(`activation:${appearanceId}:projectileKind must be a positive finite number.`);
    } else {
      activationKinds.add(Math.floor(activationBinding.projectileKind));
    }
    validateTint(errors, `activation:${appearanceId}:previewTintColorRgb`, activationBinding.previewTintColorRgb);
    validateOptionalAssetId(errors, `activation:${appearanceId}:assetId`, activationBinding.assetId);
    validateOptionalPublicAssetUrl(errors, `activation:${appearanceId}:previewTextureUrl`, activationBinding.previewTextureUrl);
    validatePublicAssetFileExists(errors, `activation:${appearanceId}:previewTextureUrl`, activationBinding.previewTextureUrl);
    validateAssetIdReference(errors, knownAssetIds, `activation:${appearanceId}:assetId`, activationBinding.assetId);
  }

  const declaredProjectileKinds = loadDeclaredProjectileKinds();
  for (const kind of activationKinds) {
    if (!declaredProjectileKinds.has(kind)) {
      errors.push(`activation projectile kind ${kind} is not declared in server archetype catalog.`);
    }
  }

  if (errors.length > 0) {
    console.error("[check-creator-appearance-bindings] failed");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  console.log("[check-creator-appearance-bindings] passed");
}

function validateTint(errors: string[], label: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 0xffffff) {
    errors.push(`${label} must be a finite rgb integer in [0, 0xffffff].`);
  }
}

function validateOptionalArchetype(errors: string[], label: string, value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${label} must be null or a positive finite integer.`);
  }
}

function validateForbiddenPlaceholderArchetype(
  errors: string[],
  forbidden: ReadonlySet<number>,
  label: string,
  value: unknown
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }
  const normalized = Math.floor(value);
  if (forbidden.has(normalized)) {
    errors.push(`${label} must not reference legacy placeholder archetype id ${normalized}.`);
  }
}

function validateOptionalAssetId(errors: string[], label: string, value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "string" || value.trim().length <= 0) {
    errors.push(`${label} must be null or a non-empty string.`);
  }
}

function validateOptionalPublicAssetUrl(errors: string[], label: string, value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "string" || value.trim().length <= 0) {
    errors.push(`${label} must be null or a non-empty string.`);
    return;
  }
  const normalized = value.trim();
  if (!normalized.startsWith("/assets/")) {
    errors.push(`${label} must start with "/assets/".`);
  }
}

function validatePublicAssetFileExists(errors: string[], label: string, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const normalized = value.trim();
  if (normalized.length <= 0 || !normalized.startsWith("/assets/")) {
    return;
  }
  const localPath = resolve(process.cwd(), "public", normalized.slice(1));
  if (!existsSync(localPath)) {
    errors.push(`${label} file does not exist at ${localPath}.`);
  }
}

function validateAssetIdReference(
  errors: string[],
  knownAssetIds: ReadonlySet<string>,
  label: string,
  value: unknown
): void {
  if (typeof value !== "string") {
    return;
  }
  const normalized = value.trim();
  if (normalized.length <= 0) {
    return;
  }
  if (normalized.endsWith("_placeholder")) {
    return;
  }
  if (!knownAssetIds.has(normalized)) {
    errors.push(`${label} references unknown asset id "${normalized}" (must exist in client asset catalog or end with _placeholder).`);
  }
}

function loadDeclaredProjectileKinds(): ReadonlySet<number> {
  const path = resolve(process.cwd(), "src/game/server/archetypes/server-archetypes.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ProjectileKindsCatalog;
  const kinds = new Set<number>();
  for (const entry of parsed.projectileKinds ?? []) {
    const kind = typeof entry.kind === "number" ? Math.floor(entry.kind) : 0;
    if (kind > 0) {
      kinds.add(kind);
    }
  }
  return kinds;
}

main();
