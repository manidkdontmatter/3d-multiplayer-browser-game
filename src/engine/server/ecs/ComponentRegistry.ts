// Maps abstract component names to bitecs component objects.
// Used by EntityFactory to resolve runtime component set membership.
import type { WorldWithComponents } from "./SimulationEcsTypes";

type ComponentDef = Record<string, unknown>;

export class ComponentRegistry {
  private readonly map = new Map<string, ComponentDef>();

  public constructor(components: WorldWithComponents["components"]) {
    const c = components as unknown as Record<string, ComponentDef>;
    for (const name of Object.keys(c)) {
      const comp = c[name];
      if (comp && typeof comp === "object") {
        this.map.set(name, comp);
      }
    }
  }

  public resolve(name: string): ComponentDef | null {
    return this.map.get(name) ?? null;
  }

  public has(name: string): boolean {
    return this.map.has(name);
  }
}

// Maps high-level runtime component groups to the bitecs components they expand to.
// e.g. "CharacterController" → the set of components a character entity needs.
export const KIND_COMPONENT_SETS: Record<string, readonly string[]> = {
  // Base components shared by all replicated entities
  base: [
    "NetworkId", "ModelId", "Position", "Rotation",
    "Grounded", "MovementMode", "Health",
    "ItemArchetypeId", "ItemQuantity",
    "LocationKind", "LocationArchetypeId", "LocationSeed",
    "LocationEnvironmentId", "LocationStreamingRadius", "LocationInfluenceRadius",
    "CharacterArchetypeId", "ControllerKind"
  ],
  // Character components (added on top of base)
  character: [
    "Velocity", "GroundedPlatformPid", "CarriedFramePid",
    "Yaw", "Pitch", "LastProcessedSequence", "LastPrimaryFireAtSeconds",
    "PrimaryHeld", "SecondaryHeld", "PrimaryMouseSlot", "SecondaryMouseSlot",
    "Hotbar", "UnlockedAbilityCsv", "CharacterTag"
  ],
  // Player extras (added on top of character)
  player: ["PlayerTag", "ReplicatedTag", "AccountId"],
  // NPC extras (added on top of character)
  npc: ["NpcTag", "ReplicatedTag"],
  // Projectile
  projectile: [
    "Velocity", "ProjectileOwnerNid", "ProjectileKind",
    "ProjectileRadius", "ProjectileDamage", "ProjectileTtl",
    "ProjectileRemainingRange", "ProjectileGravity", "ProjectileDrag",
    "ProjectileMaxSpeed", "ProjectileMinSpeed", "ProjectileRemainingPierces",
    "ProjectileDespawnOnDamageableHit", "ProjectileDespawnOnWorldHit",
    "ProjectileTag", "ReplicatedTag"
  ],
  // Platform
  platform: ["PlatformTag"],
  // Location root
  locationRoot: ["LocationRootTag", "ReplicatedTag"],
  // Dummy
  dummy: ["DummyTag", "ReplicatedTag"],
  // World item
  worldItem: ["WorldItemTag", "ReplicatedTag"]
};

// Map from runtime spawn kind to the component set keys to use.
export const KIND_TO_COMPONENT_SET: Record<string, readonly string[]> = {
  character: ["base", "character", "player"],
  npc: ["base", "character", "npc"],
  projectile: ["base", "projectile"],
  platform: ["base", "platform"],
  location: ["base", "locationRoot"],
  dummy: ["base", "dummy"],
  item: ["base", "worldItem"]
};
