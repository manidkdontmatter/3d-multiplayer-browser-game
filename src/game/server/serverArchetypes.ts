// Game-specific server-only archetype bootstrap.
import { injectServerArchetypeRaw } from "../../engine/server/content/ArchetypeCatalog";
import serverArchetypesRaw from "./archetypes/server-archetypes.json";

export function initServerArchetypes(): void {
  injectServerArchetypeRaw(serverArchetypesRaw);
}
