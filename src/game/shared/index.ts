/**
 * Purpose: This file re-exports this module group through a single import surface.
 * Scope: It belongs to the game-specific shared data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import { initGameConfig } from "./config";
import { registerGameContent } from "./registration";
import { initWorldData } from "./worldData";

export function initializeSharedGameData(): void {
  initGameConfig();
  registerGameContent();
  initWorldData();
}
