import {
  MAGIC_BOLT_DAMAGE,
  MAGIC_BOLT_KIND_PRIMARY,
  MAGIC_BOLT_LIFETIME_SECONDS,
  MAGIC_BOLT_RADIUS,
  MAGIC_BOLT_SPAWN_FORWARD_OFFSET,
  MAGIC_BOLT_SPAWN_VERTICAL_OFFSET,
  MAGIC_BOLT_SPEED,
  PRIMARY_FIRE_COOLDOWN_SECONDS
} from "./config";

export type AbilityCategory = "projectile" | "melee" | "passive";

export interface AbilityStatPoints {
  power: number;
  velocity: number;
  efficiency: number;
  control: number;
}

export interface ProjectileAbilityProfile {
  kind: number;
  speed: number;
  damage: number;
  radius: number;
  cooldownSeconds: number;
  lifetimeSeconds: number;
  spawnForwardOffset: number;
  spawnVerticalOffset: number;
}

export interface AbilityDefinition {
  id: number;
  key: string;
  name: string;
  description: string;
  category: AbilityCategory;
  points: AbilityStatPoints;
  attributes: string[];
  projectile?: ProjectileAbilityProfile;
}

export const ABILITY_ID_NONE = 0;
export const ABILITY_ID_ARC_BOLT = 1;
export const HOTBAR_SLOT_COUNT = 5;

const ABILITY_DEFINITIONS: ReadonlyArray<AbilityDefinition> = [
  {
    id: ABILITY_ID_ARC_BOLT,
    key: "arc-bolt",
    name: "Arc Bolt",
    description: "Fast energy projectile used as a baseline combat ability.",
    category: "projectile",
    points: {
      power: 6,
      velocity: 6,
      efficiency: 4,
      control: 4
    },
    attributes: ["single-target", "precision-friendly", "mod-ready"],
    projectile: {
      kind: MAGIC_BOLT_KIND_PRIMARY,
      speed: MAGIC_BOLT_SPEED,
      damage: MAGIC_BOLT_DAMAGE,
      radius: MAGIC_BOLT_RADIUS,
      cooldownSeconds: PRIMARY_FIRE_COOLDOWN_SECONDS,
      lifetimeSeconds: MAGIC_BOLT_LIFETIME_SECONDS,
      spawnForwardOffset: MAGIC_BOLT_SPAWN_FORWARD_OFFSET,
      spawnVerticalOffset: MAGIC_BOLT_SPAWN_VERTICAL_OFFSET
    }
  }
];

const ABILITY_DEFINITIONS_BY_ID = new Map<number, AbilityDefinition>(
  ABILITY_DEFINITIONS.map((ability) => [ability.id, ability])
);

export const DEFAULT_HOTBAR_ABILITY_IDS: ReadonlyArray<number> = Object.freeze([
  ABILITY_ID_ARC_BOLT,
  ABILITY_ID_NONE,
  ABILITY_ID_NONE,
  ABILITY_ID_NONE,
  ABILITY_ID_NONE
]);

export const DEFAULT_UNLOCKED_ABILITY_IDS: ReadonlyArray<number> = Object.freeze([
  ABILITY_ID_ARC_BOLT
]);

export function getAllAbilityDefinitions(): ReadonlyArray<AbilityDefinition> {
  return ABILITY_DEFINITIONS;
}

export function getAbilityDefinitionById(abilityId: number): AbilityDefinition | null {
  return ABILITY_DEFINITIONS_BY_ID.get(abilityId) ?? null;
}

export function isKnownAbilityId(abilityId: number): boolean {
  return ABILITY_DEFINITIONS_BY_ID.has(abilityId);
}

export function clampHotbarSlotIndex(slot: number): number {
  if (!Number.isFinite(slot)) {
    return 0;
  }
  return Math.max(0, Math.min(HOTBAR_SLOT_COUNT - 1, Math.floor(slot)));
}
