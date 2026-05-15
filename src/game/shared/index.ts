// Game-specific archetype data bootstrap.
// Injects game content into the engine's catalogs via the unified registration system.
// This is the bridge between game data and engine capabilities.

import { registerGameContent } from "./registration";
import { initGameConfig } from "./config";
import { initAssetCatalog } from "./assetCatalog";
import { initWorldData } from "./worldData";

export function initializeGameData(): void {
  initGameConfig();
  registerGameContent(); // unified stats, traits, archetypes (includes legacy injection)
  initAssetCatalog();
  initWorldData();
}

// Auto-initialize on import — the game entry points rely on this side-effect.
initializeGameData();
