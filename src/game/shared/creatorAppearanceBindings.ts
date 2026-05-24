/**
 * Purpose: This file defines game-level runtime bindings for creator appearance ids.
 * Scope: It belongs to the game-specific shared data layer.
 * Human Summary: Shared by client and server so both sides resolve creator appearance ids the same way.
 */
import type { CreatorAppearanceBindingCatalog } from "../../engine/shared/creatorAppearance";
import creatorAppearanceBindingsRaw from "./creatorAppearanceBindings.json";

export const GAME_CREATOR_APPEARANCE_BINDINGS: CreatorAppearanceBindingCatalog =
  creatorAppearanceBindingsRaw as CreatorAppearanceBindingCatalog;
