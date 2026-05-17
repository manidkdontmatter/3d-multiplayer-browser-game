/**
 * Purpose: This file defines data/type contracts that keep connected systems compatible, and coordinates authoritative server behavior.
 * Scope: It belongs to the game-specific server composition layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { injectServerArchetypeRaw } from "../../engine/server/content/ArchetypeCatalog";
import serverArchetypesRaw from "./archetypes/server-archetypes.json";

export function initServerArchetypes(): void {
  injectServerArchetypeRaw(serverArchetypesRaw);
}
