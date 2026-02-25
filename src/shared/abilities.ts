// Shared ability catalogs and helpers used by both client and server runtime code.
import {
  MAGIC_BOLT_KIND_PRIMARY,
  MAGIC_BOLT_SPAWN_FORWARD_OFFSET,
  MAGIC_BOLT_SPAWN_VERTICAL_OFFSET
} from "./config";
import {
  ABILITY_CREATOR_EXAMPLE_DOWNSIDE_KEY,
  ABILITY_CREATOR_EXAMPLE_UPSIDE_KEY,
  type AbilityCreatorType
} from "./abilityCreator";
import abilityArchetypesRaw from "../../data/archetypes/ability-archetypes.json";

export type AbilityCategory =
  | "projectile"
  | "melee"
  | "passive"
  | "beam"
  | "aoe"
  | "buff"
  | "movement";
export type AbilityAttributeKey =
  | "homing-lite"
  | "wide-impact"
  | "quick-cast"
  | "long-reach"
  | "example-upside"
  | "example-downside";

export interface AbilityCreatorMetadata {
  type: AbilityCreatorType;
  tier: number;
  coreExampleStat: number;
  exampleUpsideEnabled: boolean;
  exampleDownsideEnabled: boolean;
}

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
  maxRange?: number;
  gravity?: number;
  drag?: number;
  maxSpeed?: number;
  minSpeed?: number;
  pierceCount?: number;
  despawnOnDamageableHit?: boolean;
  despawnOnWorldHit?: boolean;
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
  creator?: AbilityCreatorMetadata;
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
  passive: 3,
  beam: 4,
  aoe: 5,
  buff: 6,
  movement: 7
});

const WIRE_VALUE_TO_ABILITY_CATEGORY = new Map<number, AbilityCategory>(
  Object.entries(ABILITY_CATEGORY_WIRE_VALUE).map(([key, value]) => [value, key as AbilityCategory])
);

export const ABILITY_ID_NONE = 0;
export const ABILITY_ID_ARC_BOLT = 1;
export const ABILITY_ID_PUNCH = 2;
export const ABILITY_DYNAMIC_ID_START = 1024;
export const HOTBAR_SLOT_COUNT = 10;
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
  },
  {
    key: "example-upside",
    bit: 1 << 4,
    name: "Example Upside",
    description: "Placeholder creator upside attribute used for authoring flow tests."
  },
  {
    key: "example-downside",
    bit: 1 << 5,
    name: "Example Downside",
    description: "Placeholder creator downside attribute used for authoring flow tests."
  }
]);

const ABILITY_ATTRIBUTE_BY_KEY = new Map(
  ABILITY_ATTRIBUTE_DEFINITIONS.map((attribute) => [attribute.key, attribute])
);

type AbilityArchetypeCatalogRaw = {
  version: unknown;
  baseAbilities: unknown;
  defaults: {
    hotbarAbilityIds: unknown;
    unlockedAbilityIds: unknown;
    primaryMouseSlot?: unknown;
    secondaryMouseSlot?: unknown;
  };
};

const parsedAbilityArchetypes = parseAbilityArchetypes(abilityArchetypesRaw as AbilityArchetypeCatalogRaw);
const ABILITY_DEFINITIONS: ReadonlyArray<AbilityDefinition> = Object.freeze(parsedAbilityArchetypes.baseAbilities);

const ABILITY_DEFINITIONS_BY_ID = new Map<number, AbilityDefinition>(
  ABILITY_DEFINITIONS.map((ability) => [ability.id, ability])
);

export const DEFAULT_HOTBAR_ABILITY_IDS: ReadonlyArray<number> = Object.freeze(
  parsedAbilityArchetypes.defaults.hotbarAbilityIds
);

export const DEFAULT_UNLOCKED_ABILITY_IDS: ReadonlyArray<number> = Object.freeze(
  parsedAbilityArchetypes.defaults.unlockedAbilityIds
);

export const DEFAULT_PRIMARY_MOUSE_SLOT = clampHotbarSlotIndex(
  parsedAbilityArchetypes.defaults.primaryMouseSlot
);

export const DEFAULT_SECONDARY_MOUSE_SLOT = clampHotbarSlotIndex(
  parsedAbilityArchetypes.defaults.secondaryMouseSlot
);

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
  return ["projectile", "melee", "passive", "beam", "aoe", "buff", "movement"];
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

export interface ResolvedProjectileProfile {
  kind: number;
  speed: number;
  damage: number;
  radius: number;
  cooldownSeconds: number;
  lifetimeSeconds: number;
  maxRange: number;
  gravity: number;
  drag: number;
  maxSpeed: number;
  minSpeed: number;
  pierceCount: number;
  despawnOnDamageableHit: boolean;
  despawnOnWorldHit: boolean;
  spawnForwardOffset: number;
  spawnVerticalOffset: number;
}

export function resolveProjectileProfile(profile: ProjectileAbilityProfile): ResolvedProjectileProfile {
  const speed = clampNumber(profile.speed, 0, 160);
  const radius = clampNumber(profile.radius, 0.01, 6);
  const lifetimeSeconds = clampNumber(profile.lifetimeSeconds, 0.05, 20);
  const maxRangeFromLifetime = speed * lifetimeSeconds;
  const maxRange = clampNumber(
    typeof profile.maxRange === "number" && Number.isFinite(profile.maxRange)
      ? profile.maxRange
      : maxRangeFromLifetime,
    0,
    1000
  );
  const drag = clampNumber(
    typeof profile.drag === "number" && Number.isFinite(profile.drag) ? profile.drag : 0,
    0,
    60
  );
  const maxSpeed = clampNumber(
    typeof profile.maxSpeed === "number" && Number.isFinite(profile.maxSpeed)
      ? profile.maxSpeed
      : speed,
    0,
    160
  );
  const minSpeed = clampNumber(
    typeof profile.minSpeed === "number" && Number.isFinite(profile.minSpeed)
      ? profile.minSpeed
      : 0,
    0,
    maxSpeed
  );
  return {
    kind: Math.max(0, Math.floor(profile.kind)),
    speed,
    damage: clampNumber(profile.damage, 0, 5000),
    radius,
    cooldownSeconds: clampNumber(profile.cooldownSeconds, 0, 20),
    lifetimeSeconds,
    maxRange,
    gravity:
      typeof profile.gravity === "number" && Number.isFinite(profile.gravity)
        ? clampNumber(profile.gravity, -200, 200)
        : 0,
    drag,
    maxSpeed,
    minSpeed,
    pierceCount:
      typeof profile.pierceCount === "number" && Number.isFinite(profile.pierceCount)
        ? Math.max(0, Math.floor(profile.pierceCount))
        : 0,
    despawnOnDamageableHit:
      typeof profile.despawnOnDamageableHit === "boolean" ? profile.despawnOnDamageableHit : true,
    despawnOnWorldHit: typeof profile.despawnOnWorldHit === "boolean" ? profile.despawnOnWorldHit : true,
    spawnForwardOffset: clampNumber(profile.spawnForwardOffset, -8, 8),
    spawnVerticalOffset: clampNumber(profile.spawnVerticalOffset, -8, 8)
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

function parseAbilityArchetypes(raw: AbilityArchetypeCatalogRaw): {
  baseAbilities: AbilityDefinition[];
  defaults: {
    hotbarAbilityIds: number[];
    unlockedAbilityIds: number[];
    primaryMouseSlot: number;
    secondaryMouseSlot: number;
  };
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("ability-archetypes catalog must be an object.");
  }
  const version =
    typeof raw.version === "number" && Number.isFinite(raw.version)
      ? Math.floor(raw.version)
      : -1;
  if (version !== 1) {
    throw new Error(`Unsupported ability-archetypes version: ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.baseAbilities) || raw.baseAbilities.length === 0) {
    throw new Error("ability-archetypes.baseAbilities must be a non-empty array.");
  }
  const baseAbilities = raw.baseAbilities.map((entry, index) =>
    parseAbilityDefinition(entry, `ability-archetypes.baseAbilities[${index}]`)
  );
  const ids = new Set<number>();
  for (const ability of baseAbilities) {
    if (ids.has(ability.id)) {
      throw new Error(`ability-archetypes contains duplicate ability id ${ability.id}.`);
    }
    ids.add(ability.id);
  }
  if (!raw.defaults || typeof raw.defaults !== "object") {
    throw new Error("ability-archetypes.defaults must be an object.");
  }
  const hotbarAbilityIds = parseAbilityIdList(raw.defaults.hotbarAbilityIds, "ability-archetypes.defaults.hotbarAbilityIds");
  const unlockedAbilityIds = parseAbilityIdList(raw.defaults.unlockedAbilityIds, "ability-archetypes.defaults.unlockedAbilityIds");
  if (hotbarAbilityIds.length !== HOTBAR_SLOT_COUNT) {
    throw new Error(`ability-archetypes.defaults.hotbarAbilityIds must contain exactly ${HOTBAR_SLOT_COUNT} ids.`);
  }
  for (const abilityId of [...hotbarAbilityIds, ...unlockedAbilityIds]) {
    if (abilityId !== ABILITY_ID_NONE && !ids.has(abilityId)) {
      throw new Error(`ability-archetypes defaults reference unknown ability id ${abilityId}.`);
    }
  }
  return {
    baseAbilities,
    defaults: {
      hotbarAbilityIds,
      unlockedAbilityIds,
      primaryMouseSlot: parseOptionalHotbarSlot(raw.defaults.primaryMouseSlot, 0),
      secondaryMouseSlot: parseOptionalHotbarSlot(raw.defaults.secondaryMouseSlot, 1)
    }
  };
}

function parseOptionalHotbarSlot(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return clampHotbarSlotIndex(fallback);
  }
  return clampHotbarSlotIndex(value);
}

function parseAbilityDefinition(value: unknown, label: string): AbilityDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const id = parseFiniteInt(entry.id, `${label}.id`);
  const key = parseString(entry.key, `${label}.key`);
  const name = parseString(entry.name, `${label}.name`);
  const description = parseString(entry.description, `${label}.description`);
  const category = parseAbilityCategory(entry.category, `${label}.category`);
  const points = parseAbilityPoints(entry.points, `${label}.points`);
  const attributes = parseAbilityAttributes(entry.attributes, `${label}.attributes`);
  const projectile = parseProjectileProfile(entry.projectile, category, `${label}.projectile`);
  const melee = parseMeleeProfile(entry.melee, category, `${label}.melee`);
  const creator = parseAbilityCreatorMetadata(entry.creator, category, points, attributes, `${label}.creator`);
  return {
    id,
    key,
    name,
    description,
    category,
    points,
    attributes,
    projectile,
    melee,
    creator
  };
}

function parseAbilityCreatorMetadata(
  value: unknown,
  category: AbilityCategory,
  points: AbilityStatPoints,
  attributes: AbilityAttributeKey[],
  label: string
): AbilityCreatorMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const rawType = entry.type;
  if (
    rawType !== "melee" &&
    rawType !== "projectile" &&
    rawType !== "beam" &&
    rawType !== "aoe" &&
    rawType !== "buff" &&
    rawType !== "movement"
  ) {
    throw new Error(`${label}.type must be one of melee|projectile|beam|aoe|buff|movement.`);
  }
  const tier = Math.max(1, Math.floor(parseFiniteNumber(entry.tier, `${label}.tier`)));
  const coreExampleStat = Math.max(
    0,
    Math.floor(parseFiniteNumber(entry.coreExampleStat, `${label}.coreExampleStat`))
  );
  const exampleUpsideEnabled =
    typeof entry.exampleUpsideEnabled === "boolean"
      ? entry.exampleUpsideEnabled
      : typeof entry.exampleAttributeEnabled === "boolean"
        ? entry.exampleAttributeEnabled
        : attributes.includes(ABILITY_CREATOR_EXAMPLE_UPSIDE_KEY);
  const exampleDownsideEnabled =
    typeof entry.exampleDownsideEnabled === "boolean"
      ? entry.exampleDownsideEnabled
      : attributes.includes(ABILITY_CREATOR_EXAMPLE_DOWNSIDE_KEY);
  return {
    type: rawType,
    tier,
    coreExampleStat:
      Number.isFinite(coreExampleStat) && coreExampleStat > 0
        ? coreExampleStat
        : Math.max(0, Math.floor(points.power)),
    exampleUpsideEnabled,
    exampleDownsideEnabled
  };
}

function parseAbilityPoints(value: unknown, label: string): AbilityStatPoints {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  return {
    power: parseFiniteInt(entry.power, `${label}.power`),
    velocity: parseFiniteInt(entry.velocity, `${label}.velocity`),
    efficiency: parseFiniteInt(entry.efficiency, `${label}.efficiency`),
    control: parseFiniteInt(entry.control, `${label}.control`)
  };
}

function parseAbilityAttributes(value: unknown, label: string): AbilityAttributeKey[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  const normalized: AbilityAttributeKey[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (typeof raw !== "string") {
      throw new Error(`${label}[${index}] must be a string.`);
    }
    if (!ABILITY_ATTRIBUTE_BY_KEY.has(raw as AbilityAttributeKey)) {
      throw new Error(`${label}[${index}] is not a known ability attribute.`);
    }
    const attribute = raw as AbilityAttributeKey;
    if (!normalized.includes(attribute)) {
      normalized.push(attribute);
    }
  }
  return normalized;
}

function parseProjectileProfile(
  value: unknown,
  category: AbilityCategory,
  label: string
): ProjectileAbilityProfile | undefined {
  if (category !== "projectile") {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object for projectile abilities.`);
  }
  const entry = value as Record<string, unknown>;
  return {
    kind: parseFiniteInt(entry.kind, `${label}.kind`),
    speed: parseFiniteNumber(entry.speed, `${label}.speed`),
    damage: parseFiniteNumber(entry.damage, `${label}.damage`),
    radius: parseFiniteNumber(entry.radius, `${label}.radius`),
    cooldownSeconds: parseFiniteNumber(entry.cooldownSeconds, `${label}.cooldownSeconds`),
    lifetimeSeconds: parseFiniteNumber(entry.lifetimeSeconds, `${label}.lifetimeSeconds`),
    spawnForwardOffset: parseFiniteNumber(entry.spawnForwardOffset, `${label}.spawnForwardOffset`),
    spawnVerticalOffset: parseFiniteNumber(entry.spawnVerticalOffset, `${label}.spawnVerticalOffset`)
  };
}

function parseMeleeProfile(
  value: unknown,
  category: AbilityCategory,
  label: string
): MeleeAbilityProfile | undefined {
  if (category !== "melee") {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object for melee abilities.`);
  }
  const entry = value as Record<string, unknown>;
  return {
    damage: parseFiniteNumber(entry.damage, `${label}.damage`),
    range: parseFiniteNumber(entry.range, `${label}.range`),
    radius: parseFiniteNumber(entry.radius, `${label}.radius`),
    cooldownSeconds: parseFiniteNumber(entry.cooldownSeconds, `${label}.cooldownSeconds`),
    arcDegrees: parseFiniteNumber(entry.arcDegrees, `${label}.arcDegrees`)
  };
}

function parseAbilityIdList(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => parseFiniteInt(entry, `${label}[${index}]`));
}

function parseAbilityCategory(value: unknown, label: string): AbilityCategory {
  if (
    value === "projectile" ||
    value === "melee" ||
    value === "passive" ||
    value === "beam" ||
    value === "aoe" ||
    value === "buff" ||
    value === "movement"
  ) {
    return value;
  }
  throw new Error(`${label} must be one of projectile|melee|passive|beam|aoe|buff|movement.`);
}

function parseString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function parseFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function parseFiniteInt(value: unknown, label: string): number {
  return Math.max(0, Math.floor(parseFiniteNumber(value, label)));
}
