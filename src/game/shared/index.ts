// Shared game-data bootstrap used by both client and server entry points.
import { initGameConfig } from "./config";
import { registerGameContent } from "./registration";
import { initWorldData } from "./worldData";

export function initializeSharedGameData(): void {
  initGameConfig();
  registerGameContent();
  initWorldData();
}
