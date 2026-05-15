// Unified archetype system — one type for all entity kinds.
// Characters, items, abilities, platforms, projectiles, doors, vehicles — they are all
// archetypes. The engine reads archetype data generically; the game layer injects the
// specific definitions at startup.

import type {
  AbilityAttributeKey,
  AbilityCategory,
  AbilityStatPoints,
  MeleeAbilityProfile,
  ProjectileAbilityProfile
} from "./abilities";
import type { ItemCategory, EquipmentSlot, ItemUseDefinition } from "./items";

export interface ComponentTemplate {
  readonly component: string;
  readonly initial: Record<string, unknown>;
}

export interface ArchetypeDefinition {
  readonly id: number;
  readonly kind: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly modelId: number;
  readonly components: readonly ComponentTemplate[];
  readonly baseStats: Record<string, number>;
  readonly statBudget: number;
  readonly traitBudget: number;
  readonly availableTraits: readonly string[];
  readonly abilityCategory?: AbilityCategory;
  readonly abilityPoints?: AbilityStatPoints;
  readonly abilityAttributes?: readonly AbilityAttributeKey[];
  readonly projectileProfile?: ProjectileAbilityProfile;
  readonly meleeProfile?: MeleeAbilityProfile;
  readonly itemCategory?: ItemCategory;
  readonly itemStackMax?: number;
  readonly itemEquipSlot?: EquipmentSlot | null;
  readonly itemUse?: ItemUseDefinition | null;
  readonly npcMoveSpeed?: number;
  readonly npcPerceptionRadius?: number;
  readonly npcAttackRange?: number;
  readonly npcAttackDamage?: number;
  readonly npcAttackCooldownSeconds?: number;
  readonly npcActivationRadius?: number;
  readonly npcDeactivationRadius?: number;
  readonly npcBehaviorTreeId?: string;
  readonly npcCapsuleHalfHeight?: number;
  readonly npcCapsuleRadius?: number;
  // Platform-specific
  readonly platformKind?: number;
  readonly platformHalfX?: number;
  readonly platformHalfY?: number;
  readonly platformHalfZ?: number;
  readonly platformAmplitudeX?: number;
  readonly platformAmplitudeY?: number;
  readonly platformFrequency?: number;
  readonly platformPhase?: number;
  readonly platformAngularSpeed?: number;
  readonly platformBaseX?: number;
  readonly platformBaseY?: number;
  readonly platformBaseZ?: number;
  readonly platformBaseYaw?: number;
}

export interface CustomizedArchetype {
  readonly id: number;
  readonly baseArchetypeId: number;
  readonly kind: string;
  readonly name: string;
  readonly description: string;
  readonly statAllocations: Record<string, number>;
  readonly selectedTraits: readonly string[];
  readonly resolvedStats: Record<string, number>;
  readonly resolvedComponents: readonly ComponentTemplate[];
  readonly modelId: number;
  readonly abilityCategory?: AbilityCategory;
  readonly projectileProfile?: ProjectileAbilityProfile;
  readonly meleeProfile?: MeleeAbilityProfile;
  readonly itemCategory?: ItemCategory;
  readonly itemStackMax?: number;
  readonly itemEquipSlot?: EquipmentSlot | null;
  readonly itemUse?: ItemUseDefinition | null;
}

export interface ArchetypeCatalogRaw {
  readonly version: unknown;
  readonly archetypes: unknown;
}

let ARCHETYPE_DEFINITIONS: readonly ArchetypeDefinition[] = Object.freeze([]);
const ARCHETYPE_BY_ID = new Map<number, ArchetypeDefinition>();
const ARCHETYPES_BY_KIND = new Map<string, ArchetypeDefinition[]>();

export function injectArchetypeCatalog(raw: ArchetypeCatalogRaw): void {
  const archetypes = parseArchetypeCatalog(raw);
  ARCHETYPE_DEFINITIONS = Object.freeze([...archetypes]);
  ARCHETYPE_BY_ID.clear();
  ARCHETYPES_BY_KIND.clear();
  for (const archetype of archetypes) {
    ARCHETYPE_BY_ID.set(archetype.id, archetype);
    const kindList = ARCHETYPES_BY_KIND.get(archetype.kind) ?? [];
    kindList.push(archetype);
    ARCHETYPES_BY_KIND.set(archetype.kind, kindList);
  }
}

export function getAllArchetypeDefinitions(): readonly ArchetypeDefinition[] {
  return ARCHETYPE_DEFINITIONS;
}

export function getArchetypeDefinitionById(id: number): ArchetypeDefinition | null {
  if (!Number.isFinite(id)) return null;
  return ARCHETYPE_BY_ID.get(Math.max(0, Math.floor(id))) ?? null;
}

export function getArchetypesByKind(kind: string): readonly ArchetypeDefinition[] {
  return Object.freeze(ARCHETYPES_BY_KIND.get(kind) ?? []);
}

function parseArchetypeCatalog(raw: ArchetypeCatalogRaw): ArchetypeDefinition[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("archetype catalog must be an object.");
  }
  const version =
    typeof raw.version === "number" && Number.isFinite(raw.version) ? Math.floor(raw.version) : -1;
  if (version !== 1) {
    throw new Error(`Unsupported archetype catalog version: ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.archetypes) || raw.archetypes.length === 0) {
    throw new Error("archetype catalog must contain a non-empty archetypes array.");
  }
  const archetypes = raw.archetypes.map((entry, index) =>
    parseArchetypeDefinition(entry, `archetypes[${index}]`)
  );
  const ids = new Set<number>();
  for (const archetype of archetypes) {
    if (ids.has(archetype.id)) {
      throw new Error(`archetype catalog contains duplicate id ${archetype.id}.`);
    }
    ids.add(archetype.id);
  }
  return archetypes;
}

function parseArchetypeDefinition(value: unknown, label: string): ArchetypeDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const kind = parseString(entry.kind, `${label}.kind`);
  const components = Array.isArray(entry.components)
    ? entry.components.map((comp: unknown, i: number) => parseComponentTemplate(comp, `${label}.components[${i}]`))
    : [];
  const baseStats = parseRecordOfNumbers(entry.baseStats, `${label}.baseStats`);
  const statBudget = parseNonNegativeInt(entry.statBudget, `${label}.statBudget`);
  const traitBudget = parseNonNegativeInt(entry.traitBudget, `${label}.traitBudget`);
  const availableTraits = Array.isArray(entry.availableTraits)
    ? entry.availableTraits.map((t: unknown, i: number) => parseString(t, `${label}.availableTraits[${i}]`))
    : [];

  const abilityCategory = parseOptionalAbilityCategory(entry.abilityCategory);
  const abilityPoints = parseOptionalRecord(entry.abilityPoints);
  const abilityAttributes = parseOptionalStringArray(entry.abilityAttributes);
  const projectileProfile = parseOptionalRecord(entry.projectileProfile) as ProjectileAbilityProfile | undefined;
  const meleeProfile = parseOptionalRecord(entry.meleeProfile) as MeleeAbilityProfile | undefined;
  const itemCategory = parseOptionalItemCategory(entry.itemCategory);
  const itemStackMax = maybeParseNumber(entry.itemStackMax);
  const itemEquipSlot = parseOptionalEquipSlot(entry.itemEquipSlot);
  const itemUse = parseOptionalRecord(entry.itemUse) as ItemUseDefinition | null | undefined;
  // Platform fields
  const platformKind = maybeParseNumber(entry.platformKind);
  const platformHalfX = maybeParseNumber(entry.platformHalfX);
  const platformHalfY = maybeParseNumber(entry.platformHalfY);
  const platformHalfZ = maybeParseNumber(entry.platformHalfZ);
  const platformAmplitudeX = maybeParseNumber(entry.platformAmplitudeX);
  const platformAmplitudeY = maybeParseNumber(entry.platformAmplitudeY);
  const platformFrequency = maybeParseNumber(entry.platformFrequency);
  const platformPhase = maybeParseNumber(entry.platformPhase);
  const platformAngularSpeed = maybeParseNumber(entry.platformAngularSpeed);
  const platformBaseX = maybeParseNumber(entry.platformBaseX);
  const platformBaseY = maybeParseNumber(entry.platformBaseY);
  const platformBaseZ = maybeParseNumber(entry.platformBaseZ);
  const platformBaseYaw = maybeParseNumber(entry.platformBaseYaw);

  return {
    id: parseNonNegativeInt(entry.id, `${label}.id`),
    kind,
    key: parseString(entry.key, `${label}.key`),
    name: parseString(entry.name, `${label}.name`),
    description: parseString(entry.description, `${label}.description`),
    modelId: parseNonNegativeInt(entry.modelId, `${label}.modelId`),
    components: Object.freeze(components),
    baseStats,
    statBudget,
    traitBudget,
    availableTraits: Object.freeze(availableTraits),
    abilityCategory,
    abilityPoints: abilityPoints as AbilityStatPoints | undefined,
    abilityAttributes: abilityAttributes ? Object.freeze(abilityAttributes) as readonly AbilityAttributeKey[] : undefined,
    projectileProfile,
    meleeProfile,
    itemCategory,
    itemStackMax,
    itemEquipSlot,
    itemUse,
    platformKind,
    platformHalfX,
    platformHalfY,
    platformHalfZ,
    platformAmplitudeX,
    platformAmplitudeY,
    platformFrequency,
    platformPhase,
    platformAngularSpeed,
    platformBaseX,
    platformBaseY,
    platformBaseZ,
    platformBaseYaw,
    npcMoveSpeed: maybeParseNumber(entry.npcMoveSpeed),
    npcPerceptionRadius: maybeParseNumber(entry.npcPerceptionRadius),
    npcAttackRange: maybeParseNumber(entry.npcAttackRange),
    npcAttackDamage: maybeParseNumber(entry.npcAttackDamage),
    npcAttackCooldownSeconds: maybeParseNumber(entry.npcAttackCooldownSeconds),
    npcActivationRadius: maybeParseNumber(entry.npcActivationRadius),
    npcDeactivationRadius: maybeParseNumber(entry.npcDeactivationRadius),
    npcBehaviorTreeId: maybeParseString(entry.npcBehaviorTreeId),
    npcCapsuleHalfHeight: maybeParseNumber(entry.npcCapsuleHalfHeight),
    npcCapsuleRadius: maybeParseNumber(entry.npcCapsuleRadius)
  };
}

function parseComponentTemplate(value: unknown, label: string): ComponentTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  return {
    component: parseString(entry.component, `${label}.component`),
    initial: typeof entry.initial === "object" && entry.initial !== null && !Array.isArray(entry.initial)
      ? Object.freeze({ ...(entry.initial as Record<string, unknown>) })
      : Object.freeze({})
  };
}

function parseRecordOfNumbers(value: unknown, _label: string): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record: Record<string, number> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) record[key] = val;
  }
  return record;
}

function parseString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function parseNonNegativeInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return Math.max(0, Math.floor(value));
}

function maybeParseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function maybeParseString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return result.length > 0 ? result : undefined;
}

function parseOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function parseOptionalAbilityCategory(value: unknown): AbilityCategory | undefined {
  if (typeof value !== "string") return undefined;
  const valid: AbilityCategory[] = ["projectile", "melee", "passive", "beam", "aoe", "buff", "movement"];
  return valid.includes(value as AbilityCategory) ? (value as AbilityCategory) : undefined;
}

function parseOptionalItemCategory(value: unknown): ItemCategory | undefined {
  if (typeof value !== "string") return undefined;
  const valid: ItemCategory[] = ["consumable", "equipment", "material"];
  return valid.includes(value as ItemCategory) ? (value as ItemCategory) : undefined;
}

function parseOptionalEquipSlot(value: unknown): EquipmentSlot | null | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const valid: EquipmentSlot[] = ["weapon", "head", "body", "legs", "accessory"];
  return valid.includes(value as EquipmentSlot) ? (value as EquipmentSlot) : null;
}
