/**
 * Purpose: Validate creator appearance runtime coverage against client render registries.
 * Scope: It belongs to repository guard-rail scripts.
 * Human Summary: Fails when creator appearance bindings resolve to missing render archetypes or missing projectile palettes.
 */
import {
  getCreatorAppearanceOptions,
  resolveActivationAppearanceRuntimeBinding,
  resolveReadyAppearanceRuntimeBinding
} from "../src/engine/shared/index";
import { getRenderArchetype } from "../src/engine/client/runtime/rendering/VisualRegistry";
import { getProjectilePalette } from "../src/engine/client/runtime/rendering/ProjectileVisualSystem";
import { initVisuals } from "../src/game/client/visuals";
import { registerGameContent } from "../src/game/shared/registration";

function main(): void {
  registerGameContent();
  initVisuals();

  const errors: string[] = [];
  const appearanceIds = getCreatorAppearanceOptions().map((option) => option.value);

  for (const appearanceId of appearanceIds) {
    const readyBinding = resolveReadyAppearanceRuntimeBinding(appearanceId);
    const activationBinding = resolveActivationAppearanceRuntimeBinding(appearanceId);
    validateReadyArchetype(errors, appearanceId, "equipped", readyBinding.equipped.renderArchetypeId);
    validateReadyArchetype(errors, appearanceId, "pickup", readyBinding.pickup.renderArchetypeId);
    validateActivationPalette(errors, appearanceId, activationBinding.projectileKind);
  }

  if (errors.length > 0) {
    console.error("[check-creator-appearance-runtime-coverage] failed");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  console.log("[check-creator-appearance-runtime-coverage] passed");
}

function validateReadyArchetype(
  errors: string[],
  appearanceId: string,
  context: "equipped" | "pickup",
  renderArchetypeId: number | null
): void {
  if (typeof renderArchetypeId !== "number" || !Number.isFinite(renderArchetypeId) || renderArchetypeId <= 0) {
    errors.push(`ready:${appearanceId}:${context}.renderArchetypeId must be a positive number.`);
    return;
  }
  if (!getRenderArchetype(renderArchetypeId)) {
    errors.push(`ready:${appearanceId}:${context}.renderArchetypeId ${renderArchetypeId} has no registered client render archetype.`);
  }
}

function validateActivationPalette(errors: string[], appearanceId: string, projectileKind: number): void {
  if (!Number.isFinite(projectileKind) || projectileKind <= 0) {
    errors.push(`activation:${appearanceId}.projectileKind must be a positive number.`);
    return;
  }
  if (!getProjectilePalette(projectileKind)) {
    errors.push(`activation:${appearanceId}.projectileKind ${projectileKind} has no registered projectile palette.`);
  }
}

main();

