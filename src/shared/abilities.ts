import {
  MAGIC_BOLT_KIND_PRIMARY,
  MAGIC_BOLT_SPAWN_FORWARD_OFFSET,
  MAGIC_BOLT_SPAWN_VERTICAL_OFFSET
} from "./config";

export type AbilityCategory = "projectile" | "melee" | "passive";
export type AbilityAttributeKey = "homing-lite" | "wide-impact" | "quick-cast" | "long-reach";

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

export interface MeleeAbilityProfile {
  damage: number;
  range: number;
  radius: number;
  cooldownSeconds: number;
  arcDegrees: number;
}

export interface AbilityDefinition {
  id: number;
  key: string;
  name: string;
  description: string;
  category: AbilityCategory;
  points: AbilityStatPoints;
  attributes: AbilityAttributeKey[];
  projectile?: ProjectileAbilityProfile;
  melee?: MeleeAbilityProfile;
}

export interface AbilityCreationDraft {
  name: string;
  category: AbilityCategory;
  points: AbilityStatPoints;
  attributes: AbilityAttributeKey[];
}

export interface AbilityDraftValidationResult {
  ok: boolean;
  errors: string[];
  normalized?: AbilityCreationDraft;
}

export interface AbilityAttributeDefinition {
  key: AbilityAttributeKey;
  bit: number;
  name: string;
  description: string;
}

const ABILITY_CATEGORY_WIRE_VALUE: Readonly<Record<AbilityCategory, number>> = Object.freeze({
  projectile: 1,
  melee: 2,
  passive: 3
});

const WIRE_VALUE_TO_ABILITY_CATEGORY = new Map<number, AbilityCategory>(
  Object.entries(ABILITY_CATEGORY_WIRE_VALUE).map(([key, value]) => [value, key as AbilityCategory])
);

export const ABILITY_ID_NONE = 0;
export const ABILITY_ID_ARC_BOLT = 1;
export const ABILITY_ID_PUNCH = 2;
export const ABILITY_DYNAMIC_ID_START = 1024;
export const HOTBAR_SLOT_COUNT = 5;
export const ABILITY_CREATOR_TOTAL_POINTS = 20;
export const ABILITY_CREATOR_MAX_POINTS_PER_STAT = 10;
export const ABILITY_CREATOR_MAX_ATTRIBUTES = 2;
export const ABILITY_NAME_MAX_LENGTH = 24;

export const ABILITY_ATTRIBUTE_DEFINITIONS: ReadonlyArray<AbilityAttributeDefinition> = Object.freeze([
  {
    key: "homing-lite",
    bit: 1 << 0,
    name: "Homing Lite",
    description: "Mild target guidance with a small speed tradeoff."
  },
  {
    key: "wide-impact",
    bit: 1 << 1,
    name: "Wide Impact",
    description: "Larger projectile radius, lower precision damage."
  },
  {
    key: "quick-cast",
    bit: 1 << 2,
    name: "Quick Cast",
    description: "Shorter cooldown at reduced per-hit damage."
  },
  {
    key: "long-reach",
    bit: 1 << 3,
    name: "Long Reach",
    description: "Longer lifetime/range with lighter impact."
  }
]);

const ABILITY_ATTRIBUTE_BY_KEY = new Map(
  ABILITY_ATTRIBUTE_DEFINITIONS.map((attribute) => [attribute.key, attribute])
);

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
    attributes: ["quick-cast"],
    projectile: {
      kind: MAGIC_BOLT_KIND_PRIMARY,
      speed: 24,
      damage: 25,
      radius: 0.2,
      cooldownSeconds: 0.2,
      lifetimeSeconds: 2.2,
      spawnForwardOffset: MAGIC_BOLT_SPAWN_FORWARD_OFFSET,
      spawnVerticalOffset: MAGIC_BOLT_SPAWN_VERTICAL_OFFSET
    }
  },
  {
    id: ABILITY_ID_PUNCH,
    key: "punch",
    name: "Punch",
    description: "Fast close-range melee strike.",
    category: "melee",
    points: {
      power: 7,
      velocity: 4,
      efficiency: 5,
      control: 4
    },
    attributes: ["quick-cast"],
    melee: {
      damage: 18,
      range: 1.95,
      radius: 0.34,
      cooldownSeconds: 2,
      arcDegrees: 62
    }
  }
];

const ABILITY_DEFINITIONS_BY_ID = new Map<number, AbilityDefinition>(
  ABILITY_DEFINITIONS.map((ability) => [ability.id, ability])
);

export const DEFAULT_HOTBAR_ABILITY_IDS: ReadonlyArray<number> = Object.freeze([
  ABILITY_ID_ARC_BOLT,
  ABILITY_ID_PUNCH,
  ABILITY_ID_NONE,
  ABILITY_ID_NONE,
  ABILITY_ID_NONE
]);

export const DEFAULT_UNLOCKED_ABILITY_IDS: ReadonlyArray<number> = Object.freeze([
  ABILITY_ID_ARC_BOLT,
  ABILITY_ID_PUNCH
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

export function getAbilityCategoryOptions(): ReadonlyArray<AbilityCategory> {
  return ["projectile", "melee", "passive"];
}

export function getAbilityAttributeDefinitions(): ReadonlyArray<AbilityAttributeDefinition> {
  return ABILITY_ATTRIBUTE_DEFINITIONS;
}

export function abilityCategoryToWireValue(category: AbilityCategory): number {
  return ABILITY_CATEGORY_WIRE_VALUE[category];
}

export function abilityCategoryFromWireValue(rawCategory: number): AbilityCategory | null {
  if (!Number.isFinite(rawCategory)) {
    return null;
  }
  return WIRE_VALUE_TO_ABILITY_CATEGORY.get(Math.floor(rawCategory)) ?? null;
}

export function encodeAbilityAttributeMask(attributes: ReadonlyArray<AbilityAttributeKey>): number {
  let mask = 0;
  for (const key of attributes) {
    const attribute = ABILITY_ATTRIBUTE_BY_KEY.get(key);
    if (!attribute) {
      continue;
    }
    mask |= attribute.bit;
  }
  return mask;
}

export function decodeAbilityAttributeMask(mask: number): AbilityAttributeKey[] {
  if (!Number.isFinite(mask)) {
    return [];
  }
  const normalizedMask = Math.floor(mask);
  const keys: AbilityAttributeKey[] = [];
  for (const attribute of ABILITY_ATTRIBUTE_DEFINITIONS) {
    if ((normalizedMask & attribute.bit) !== 0) {
      keys.push(attribute.key);
    }
  }
  return keys;
}

export function createAbilityDefinitionFromDraft(
  abilityId: number,
  draft: AbilityCreationDraft
): AbilityDefinition | null {
  const validation = validateAbilityDraft(draft);
  if (!validation.ok || !validation.normalized) {
    return null;
  }
  const normalized = validation.normalized;
  const projectileProfile = buildAbilityProjectileProfile(normalized);
  const meleeProfile = buildAbilityMeleeProfile(normalized);
  const resolvedAbilityId = Number.isFinite(abilityId)
    ? Math.max(ABILITY_DYNAMIC_ID_START, Math.floor(abilityId))
    : ABILITY_DYNAMIC_ID_START;

  return {
    id: resolvedAbilityId,
    key: `custom-${resolvedAbilityId}`,
    name: normalized.name,
    description: buildAbilityDescription(normalized),
    category: normalized.category,
    points: normalized.points,
    attributes: normalized.attributes,
    projectile: projectileProfile,
    melee: meleeProfile
  };
}

export function validateAbilityDraft(draft: AbilityCreationDraft): AbilityDraftValidationResult {
  const errors: string[] = [];

  const category: AbilityCategory | null = getAbilityCategoryOptions().includes(draft.category)
    ? draft.category
    : null;
  if (!category) {
    errors.push("Invalid ability category.");
  }

  const normalizedName = sanitizeAbilityName(draft.name);
  if (normalizedName.length < 3) {
    errors.push("Ability name must be at least 3 characters.");
  }

  const normalizedPoints = {
    power: normalizePointValue(draft.points.power),
    velocity: normalizePointValue(draft.points.velocity),
    efficiency: normalizePointValue(draft.points.efficiency),
    control: normalizePointValue(draft.points.control)
  };
  const totalPoints =
    normalizedPoints.power +
    normalizedPoints.velocity +
    normalizedPoints.efficiency +
    normalizedPoints.control;

  if (totalPoints > ABILITY_CREATOR_TOTAL_POINTS) {
    errors.push(`Point budget exceeded (${totalPoints}/${ABILITY_CREATOR_TOTAL_POINTS}).`);
  }
  if (totalPoints <= 0) {
    errors.push("Assign at least 1 point.");
  }

  const normalizedAttributes = normalizeAttributes(draft.attributes);
  if (normalizedAttributes.length > ABILITY_CREATOR_MAX_ATTRIBUTES) {
    errors.push(`Choose at most ${ABILITY_CREATOR_MAX_ATTRIBUTES} attributes.`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    normalized: {
      name: normalizedName,
      category: category ?? "projectile",
      points: normalizedPoints,
      attributes: normalizedAttributes
    }
  };
}

function normalizePointValue(rawValue: number): number {
  if (!Number.isFinite(rawValue)) {
    return 0;
  }
  return Math.max(0, Math.min(ABILITY_CREATOR_MAX_POINTS_PER_STAT, Math.floor(rawValue)));
}

function normalizeAttributes(rawAttributes: ReadonlyArray<AbilityAttributeKey>): AbilityAttributeKey[] {
  const normalized: AbilityAttributeKey[] = [];
  for (const key of rawAttributes) {
    if (!ABILITY_ATTRIBUTE_BY_KEY.has(key)) {
      continue;
    }
    if (normalized.includes(key)) {
      continue;
    }
    normalized.push(key);
  }
  return normalized;
}

function sanitizeAbilityName(rawName: string): string {
  const source = typeof rawName === "string" ? rawName : "";
  return source.replace(/\s+/g, " ").trim().slice(0, ABILITY_NAME_MAX_LENGTH);
}

function buildAbilityProjectileProfile(
  draft: AbilityCreationDraft
): ProjectileAbilityProfile | undefined {
  if (draft.category !== "projectile") {
    return undefined;
  }

  const points = draft.points;
  let damage = 7 + points.power * 2.8;
  let speed = 10 + points.velocity * 1.9;
  let radius = 0.12 + points.control * 0.014;
  let cooldown = 0.75 - points.efficiency * 0.025;
  let lifetime = 1.2 + points.efficiency * 0.09 + points.velocity * 0.04;

  if (draft.attributes.includes("homing-lite")) {
    speed *= 0.92;
    damage *= 0.95;
    cooldown += 0.04;
  }
  if (draft.attributes.includes("wide-impact")) {
    radius += 0.09;
    damage *= 0.9;
  }
  if (draft.attributes.includes("quick-cast")) {
    cooldown *= 0.78;
    damage *= 0.9;
  }
  if (draft.attributes.includes("long-reach")) {
    lifetime += 0.55;
    damage *= 0.93;
  }

  return {
    kind: MAGIC_BOLT_KIND_PRIMARY,
    speed: clampNumber(speed, 8, 34),
    damage: clampNumber(damage, 4, 42),
    radius: clampNumber(radius, 0.1, 0.45),
    cooldownSeconds: clampNumber(cooldown, 0.12, 1.2),
    lifetimeSeconds: clampNumber(lifetime, 0.9, 4.2),
    spawnForwardOffset: MAGIC_BOLT_SPAWN_FORWARD_OFFSET,
    spawnVerticalOffset: MAGIC_BOLT_SPAWN_VERTICAL_OFFSET
  };
}

function buildAbilityMeleeProfile(draft: AbilityCreationDraft): MeleeAbilityProfile | undefined {
  if (draft.category !== "melee") {
    return undefined;
  }

  const points = draft.points;
  let damage = 9 + points.power * 2.35;
  let range = 1.1 + points.velocity * 0.08 + points.control * 0.05;
  let radius = 0.2 + points.control * 0.02;
  let cooldown = 0.92 - points.efficiency * 0.035;
  let arcDegrees = 42 + points.control * 4;

  if (draft.attributes.includes("homing-lite")) {
    arcDegrees += 10;
    range += 0.1;
    damage *= 0.94;
  }
  if (draft.attributes.includes("wide-impact")) {
    radius += 0.14;
    arcDegrees += 14;
    damage *= 0.9;
  }
  if (draft.attributes.includes("quick-cast")) {
    cooldown *= 0.75;
    damage *= 0.92;
  }
  if (draft.attributes.includes("long-reach")) {
    range += 0.55;
    cooldown += 0.07;
    damage *= 0.9;
  }

  return {
    damage: clampNumber(damage, 6, 46),
    range: clampNumber(range, 0.9, 3.2),
    radius: clampNumber(radius, 0.16, 0.72),
    cooldownSeconds: clampNumber(cooldown, 0.12, 1.4),
    arcDegrees: clampNumber(arcDegrees, 30, 140)
  };
}

function buildAbilityDescription(draft: AbilityCreationDraft): string {
  const attributesLabel = draft.attributes.length > 0 ? draft.attributes.join(", ") : "none";
  return `${draft.category} | attrs: ${attributesLabel}`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
