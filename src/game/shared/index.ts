// Game-specific archetype data bootstrap.
// Imports JSON archetype definitions and injects them into the engine's catalogs.
// This is the bridge between game data and engine capabilities.

import abilityArchetypesRaw from "./archetypes/ability-archetypes.json";
import itemArchetypesRaw from "./archetypes/item-archetypes.json";
import platformArchetypesRaw from "./archetypes/platform-archetypes.json";
import { injectAbilityCatalog, type AbilityArchetypeCatalogRaw } from "../../engine/shared/abilities";
import { injectItemCatalog, type ItemCatalogRaw } from "../../engine/shared/items";
import { injectPlatformCatalog, type PlatformArchetypeCatalog } from "../../engine/shared/platforms";

export function initializeGameData(): void {
  injectAbilityCatalog(abilityArchetypesRaw as AbilityArchetypeCatalogRaw);
  injectItemCatalog(itemArchetypesRaw as ItemCatalogRaw);
  injectPlatformCatalog(platformArchetypesRaw as PlatformArchetypeCatalog);
}
