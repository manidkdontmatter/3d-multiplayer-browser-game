/**
 * Purpose: This file defines the "blueprint" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import type {
  AbilityAttributeKey,
  AbilityCategory,
  AbilityDefinition,
  AbilityStatPoints,
  MeleeAbilityProfile,
  ProjectileAbilityProfile
} from "./abilities";
import type { ItemCategory, EquipmentSlot, ItemDefinition, ItemUseProfile } from "./items";
import type { PlatformArchetypeCatalog, PlatformDefinition } from "./platforms";

export type BlueprintComponentPayload = Record<string, unknown>;
export type BlueprintJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly BlueprintJsonValue[]
  | { readonly [key: string]: BlueprintJsonValue };

export interface BlueprintTemplateFieldOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface BlueprintTemplateFieldBinding {
  readonly component: string;
  readonly propertyPath: string;
}

export interface BlueprintTemplateFieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly groupId?: string;
  readonly groupLabel?: string;
  readonly valueKind: "number" | "string" | "boolean" | "enum" | "json";
  readonly defaultValue?: BlueprintJsonValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly polarity?: "upside" | "downside";
  readonly options?: readonly BlueprintTemplateFieldOption[];
  readonly binding?: BlueprintTemplateFieldBinding;
}

export interface BlueprintTemplateProfile {
  readonly statBudget: number;
  readonly attributeBudget: number;
  readonly availableAttributeIds: readonly string[];
  readonly draftStats: Record<string, number>;
  readonly draftAttributes: Record<string, number>;
  readonly draftFieldValues?: Record<string, BlueprintJsonValue>;
  readonly fieldDefinitions?: readonly BlueprintTemplateFieldDefinition[];
}

export interface BlueprintEditorProjection {
  readonly baseTemplateId: number;
  readonly stats: Record<string, number>;
  readonly attributes: Record<string, number>;
  readonly fieldValues?: Record<string, BlueprintJsonValue>;
}

export interface BlueprintDefinition {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly components: Record<string, BlueprintComponentPayload>;
  readonly metadata?: {
    readonly authoredViaProfile?: string;
  };
  readonly templateProfiles?: Record<string, BlueprintTemplateProfile>;
  readonly editorProjectionByProfile?: Record<string, BlueprintEditorProjection>;
}

export interface BlueprintCatalogRaw {
  readonly version: unknown;
  readonly blueprints: unknown;
}

let BLUEPRINT_DEFINITIONS: readonly BlueprintDefinition[] = Object.freeze([]);
const BLUEPRINT_BY_ID = new Map<number, BlueprintDefinition>();

export function injectBlueprintCatalog(raw: BlueprintCatalogRaw): void {
  const blueprints = parseBlueprintCatalog(raw);
  BLUEPRINT_DEFINITIONS = Object.freeze([...blueprints]);
  BLUEPRINT_BY_ID.clear();
  for (const blueprint of blueprints) {
    BLUEPRINT_BY_ID.set(blueprint.id, blueprint);
  }
}

export function coerceBlueprintDefinition(
  raw: unknown,
  label = "blueprint"
): BlueprintDefinition {
  return parseBlueprintDefinition(raw, label);
}

export function getAllBlueprintDefinitions(): readonly BlueprintDefinition[] {
  return BLUEPRINT_DEFINITIONS;
}

export function getBlueprintDefinitionById(id: number): BlueprintDefinition | null {
  if (!Number.isFinite(id)) return null;
  return BLUEPRINT_BY_ID.get(Math.max(0, Math.floor(id))) ?? null;
}

export function getBlueprintTemplateProfile(
  blueprint: BlueprintDefinition,
  profileId: string
): BlueprintTemplateProfile | null {
  return blueprint.templateProfiles?.[profileId] ?? null;
}

export function getBlueprintDefinitionsForProfile(profileId: string): readonly BlueprintDefinition[] {
  return BLUEPRINT_DEFINITIONS.filter((blueprint) => Boolean(blueprint.templateProfiles?.[profileId]));
}

export function cloneBlueprintDefinition(
  blueprint: BlueprintDefinition,
  overrides?: Partial<Pick<BlueprintDefinition, "id" | "key" | "name" | "description" | "metadata" | "templateProfiles" | "editorProjectionByProfile">> & {
    components?: Record<string, BlueprintComponentPayload>;
  }
): BlueprintDefinition {
  return {
    id: overrides?.id ?? blueprint.id,
    key: overrides?.key ?? blueprint.key,
    name: overrides?.name ?? blueprint.name,
    description: overrides?.description ?? blueprint.description,
    components: deepCloneBlueprintComponents(overrides?.components ?? blueprint.components),
    metadata: overrides?.metadata ?? blueprint.metadata,
    templateProfiles: overrides?.templateProfiles ?? blueprint.templateProfiles,
    editorProjectionByProfile: overrides?.editorProjectionByProfile ?? blueprint.editorProjectionByProfile
  };
}

export function blueprintSupportsAbility(blueprint: BlueprintDefinition): boolean {
  return hasBlueprintComponent(blueprint, "ProjectileEmitter") || hasBlueprintComponent(blueprint, "MeleeAttack");
}

export function blueprintSupportsItem(blueprint: BlueprintDefinition): boolean {
  return hasBlueprintComponent(blueprint, "InventoryItem");
}

export function blueprintSupportsPlatform(blueprint: BlueprintDefinition): boolean {
  return hasBlueprintComponent(blueprint, "PlatformMotion");
}

export function buildAbilityDefinitionFromBlueprint(blueprint: BlueprintDefinition): AbilityDefinition | null {
  if (!blueprintSupportsAbility(blueprint)) {
    return null;
  }

  const stats = readAbilityStats(blueprint.components.AbilityStats);
  const attributeMap = readAttributeStacks(blueprint.components.AbilityAttributes);
  const attributes = Object.keys(attributeMap)
    .filter((attributeId) => attributeMap[attributeId]! > 0) as AbilityAttributeKey[];
  const projectile = readProjectileEmitter(blueprint.components.ProjectileEmitter);
  const melee = readMeleeAttack(blueprint.components.MeleeAttack);

  const category: AbilityCategory = projectile ? "projectile" : melee ? "melee" : "passive";
  const definition: AbilityDefinition = {
    id: blueprint.id,
    key: blueprint.key,
    name: blueprint.name,
    description: blueprint.description,
    category,
    points: stats,
    attributes
  };
  if (projectile) definition.projectile = projectile;
  if (melee) definition.melee = melee;
  return definition;
}

export function buildItemDefinitionFromBlueprint(blueprint: BlueprintDefinition): ItemDefinition | null {
  const inventoryItem = readInventoryItem(blueprint.components.InventoryItem);
  if (!inventoryItem) {
    return null;
  }
  const equippable = readEquippable(blueprint.components.Equippable);
  const consumable = readConsumableEffect(blueprint.components.ConsumableEffect);
  return {
    id: blueprint.id,
    key: blueprint.key,
    name: blueprint.name,
    description: blueprint.description,
    category: inventoryItem.category,
    modelId: inventoryItem.modelId,
    stackMax: inventoryItem.stackMax,
    equipSlot: equippable?.slot ?? null,
    use: consumable
  };
}

export function buildPlatformDefinitionFromBlueprint(blueprint: BlueprintDefinition): PlatformDefinition | null {
  const motion = readPlatformMotion(blueprint.components.PlatformMotion);
  if (!motion) {
    return null;
  }
  return {
    pid: blueprint.id,
    kind: motion.kind,
    halfX: motion.halfX,
    halfY: motion.halfY,
    halfZ: motion.halfZ,
    baseX: motion.baseX,
    baseY: motion.baseY,
    baseZ: motion.baseZ,
    baseYaw: motion.baseYaw,
    amplitudeX: motion.amplitudeX,
    amplitudeY: motion.amplitudeY,
    frequency: motion.frequency,
    phase: motion.phase,
    angularSpeed: motion.angularSpeed
  };
}

function hasBlueprintComponent(blueprint: BlueprintDefinition, componentName: string): boolean {
  return Boolean(blueprint.components[componentName]);
}

function deepCloneBlueprintComponents(
  components: Record<string, BlueprintComponentPayload>
): Record<string, BlueprintComponentPayload> {
  const cloned: Record<string, BlueprintComponentPayload> = {};
  for (const [key, value] of Object.entries(components)) {
    cloned[key] = JSON.parse(JSON.stringify(value ?? {})) as BlueprintComponentPayload;
  }
  return cloned;
}

function readAbilityStats(payload: BlueprintComponentPayload | undefined): AbilityStatPoints {
  return {
    power: readFiniteNumber(payload?.power, 0),
    velocity: readFiniteNumber(payload?.velocity, 0),
    efficiency: readFiniteNumber(payload?.efficiency, 0),
    control: readFiniteNumber(payload?.control, 0)
  };
}

function readAttributeStacks(payload: BlueprintComponentPayload | undefined): Record<string, number> {
  const source = isRecord(payload?.stacks) ? payload!.stacks as Record<string, unknown> : {};
  const stacks: Record<string, number> = {};
  for (const [attributeId, rawValue] of Object.entries(source)) {
    const value = readFiniteNumber(rawValue, 0);
    if (value > 0) {
      stacks[attributeId] = Math.max(0, Math.floor(value));
    }
  }
  return stacks;
}

function readProjectileEmitter(payload: BlueprintComponentPayload | undefined): ProjectileAbilityProfile | undefined {
  if (!isRecord(payload)) return undefined;
  return {
    kind: readFiniteNumber(payload.kind, 0),
    speed: readFiniteNumber(payload.speed, 0),
    damage: readFiniteNumber(payload.damage, 0),
    radius: readFiniteNumber(payload.radius, 0),
    cooldownSeconds: readFiniteNumber(payload.cooldownSeconds, 0),
    lifetimeSeconds: readFiniteNumber(payload.lifetimeSeconds, 0),
    maxRange: readOptionalFiniteNumber(payload.maxRange),
    gravity: readOptionalFiniteNumber(payload.gravity),
    drag: readOptionalFiniteNumber(payload.drag),
    maxSpeed: readOptionalFiniteNumber(payload.maxSpeed),
    minSpeed: readOptionalFiniteNumber(payload.minSpeed),
    pierceCount: readOptionalFiniteNumber(payload.pierceCount),
    despawnOnDamageableHit: readOptionalBoolean(payload.despawnOnDamageableHit),
    despawnOnWorldHit: readOptionalBoolean(payload.despawnOnWorldHit),
    spawnForwardOffset: readFiniteNumber(payload.spawnForwardOffset, 0),
    spawnVerticalOffset: readFiniteNumber(payload.spawnVerticalOffset, 0)
  };
}

function readMeleeAttack(payload: BlueprintComponentPayload | undefined): MeleeAbilityProfile | undefined {
  if (!isRecord(payload)) return undefined;
  return {
    damage: readFiniteNumber(payload.damage, 0),
    range: readFiniteNumber(payload.range, 0),
    radius: readFiniteNumber(payload.radius, 0),
    cooldownSeconds: readFiniteNumber(payload.cooldownSeconds, 0),
    arcDegrees: readFiniteNumber(payload.arcDegrees, 0)
  };
}

function readInventoryItem(payload: BlueprintComponentPayload | undefined): {
  category: ItemCategory;
  modelId: number;
  stackMax: number;
} | null {
  if (!isRecord(payload)) return null;
  const rawCategory = typeof payload.category === "string" ? payload.category : "";
  if (rawCategory !== "consumable" && rawCategory !== "equipment" && rawCategory !== "material") {
    return null;
  }
  return {
    category: rawCategory,
    modelId: readFiniteNumber(payload.modelId, 0),
    stackMax: Math.max(1, Math.floor(readFiniteNumber(payload.stackMax, 1)))
  };
}

function readEquippable(payload: BlueprintComponentPayload | undefined): { slot: EquipmentSlot | null } | null {
  if (!isRecord(payload)) return null;
  const rawSlot = typeof payload.slot === "string" ? payload.slot : "";
  const slot = rawSlot === "weapon" || rawSlot === "head" || rawSlot === "body" || rawSlot === "legs" || rawSlot === "accessory"
    ? rawSlot
    : null;
  return { slot };
}

function readConsumableEffect(payload: BlueprintComponentPayload | undefined): ItemUseProfile | null {
  if (!isRecord(payload)) return null;
  if (Array.isArray(payload.actions)) {
    const actions = payload.actions
      .map((rawAction) => {
        if (!isRecord(rawAction)) {
          return null;
        }
        const key = typeof rawAction.key === "string" && rawAction.key.trim().length > 0 ? rawAction.key.trim() : "";
        const label = typeof rawAction.label === "string" && rawAction.label.trim().length > 0 ? rawAction.label.trim() : "";
        if (key.length <= 0 || label.length <= 0) {
          return null;
        }
        return {
          key,
          label,
          restoreHealth: readOptionalFiniteNumber(rawAction.restoreHealth),
          consumeQuantity: Math.max(1, Math.floor(readFiniteNumber(rawAction.consumeQuantity, 1)))
        };
      })
      .filter((action): action is NonNullable<typeof action> => Boolean(action));
    if (actions.length > 0) {
      return { actions };
    }
  }
  const restoreHealth = readOptionalFiniteNumber(payload.restoreHealth);
  const consumeQuantity = readOptionalFiniteNumber(payload.consumeQuantity);
  const actionLabel = typeof payload.label === "string" && payload.label.trim().length > 0 ? payload.label.trim() : "Use";
  if (restoreHealth === undefined && consumeQuantity === undefined) {
    return null;
  }
  return {
    actions: [
      {
        key: "default",
        label: actionLabel,
        restoreHealth,
        consumeQuantity: consumeQuantity === undefined ? 1 : Math.max(1, Math.floor(consumeQuantity))
      }
    ]
  };
}

function readPlatformMotion(payload: BlueprintComponentPayload | undefined): PlatformDefinition | null {
  if (!isRecord(payload)) return null;
  const rawKind = Math.max(0, Math.floor(readFiniteNumber(payload.kind, 0)));
  const kind = rawKind === 2 ? 2 : 1;
  return {
    pid: 0,
    kind,
    halfX: readFiniteNumber(payload.halfX, 0),
    halfY: readFiniteNumber(payload.halfY, 0),
    halfZ: readFiniteNumber(payload.halfZ, 0),
    baseX: readFiniteNumber(payload.baseX, 0),
    baseY: readFiniteNumber(payload.baseY, 0),
    baseZ: readFiniteNumber(payload.baseZ, 0),
    baseYaw: readFiniteNumber(payload.baseYaw, 0),
    amplitudeX: readFiniteNumber(payload.amplitudeX, 0),
    amplitudeY: readFiniteNumber(payload.amplitudeY, 0),
    frequency: readFiniteNumber(payload.frequency, 0),
    phase: readFiniteNumber(payload.phase, 0),
    angularSpeed: readFiniteNumber(payload.angularSpeed, 0)
  };
}

function parseBlueprintCatalog(raw: BlueprintCatalogRaw): BlueprintDefinition[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("blueprint catalog must be an object.");
  }
  const version =
    typeof raw.version === "number" && Number.isFinite(raw.version) ? Math.floor(raw.version) : -1;
  if (version !== 1) {
    throw new Error(`Unsupported blueprint catalog version: ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.blueprints) || raw.blueprints.length === 0) {
    throw new Error("blueprint catalog must contain a non-empty blueprints array.");
  }
  const blueprints = raw.blueprints.map((entry, index) =>
    parseBlueprintDefinition(entry, `blueprints[${index}]`)
  );
  const ids = new Set<number>();
  for (const blueprint of blueprints) {
    if (ids.has(blueprint.id)) {
      throw new Error(`blueprint catalog contains duplicate id ${blueprint.id}.`);
    }
    ids.add(blueprint.id);
  }
  return blueprints;
}

function parseBlueprintDefinition(value: unknown, label: string): BlueprintDefinition {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const components = parseComponents(value.components, `${label}.components`);
  const metadata = parseMetadata(value.metadata, `${label}.metadata`);
  const templateProfiles = parseTemplateProfiles(value.templateProfiles, `${label}.templateProfiles`);
  const editorProjectionByProfile = parseEditorProjectionByProfile(
    value.editorProjectionByProfile,
    `${label}.editorProjectionByProfile`
  );

  return {
    id: parseNonNegativeInt(value.id, `${label}.id`),
    key: parseString(value.key, `${label}.key`),
    name: parseString(value.name, `${label}.name`),
    description: parseString(value.description, `${label}.description`),
    components,
    metadata,
    templateProfiles,
    editorProjectionByProfile
  };
}

function parseComponents(
  value: unknown,
  label: string
): Record<string, BlueprintComponentPayload> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const components: Record<string, BlueprintComponentPayload> = {};
  for (const [componentName, payload] of Object.entries(value)) {
    if (!isRecord(payload)) {
      throw new Error(`${label}.${componentName} must be an object.`);
    }
    components[componentName] = Object.freeze({ ...payload });
  }
  return Object.freeze(components);
}

function parseMetadata(
  value: unknown,
  label: string
): BlueprintDefinition["metadata"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return {
    authoredViaProfile: typeof value.authoredViaProfile === "string" ? value.authoredViaProfile : undefined
  };
}

function parseTemplateProfiles(
  value: unknown,
  label: string
): Record<string, BlueprintTemplateProfile> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const profiles: Record<string, BlueprintTemplateProfile> = {};
  for (const [profileId, rawProfile] of Object.entries(value)) {
    if (!isRecord(rawProfile)) {
      throw new Error(`${label}.${profileId} must be an object.`);
    }
    profiles[profileId] = {
      statBudget: parseNonNegativeInt(rawProfile.statBudget, `${label}.${profileId}.statBudget`),
      attributeBudget: parseNonNegativeInt(rawProfile.attributeBudget, `${label}.${profileId}.attributeBudget`),
      availableAttributeIds: Object.freeze(parseStringArray(
        rawProfile.availableAttributeIds,
        `${label}.${profileId}.availableAttributeIds`
      )),
      draftStats: parseRecordOfNumbers(rawProfile.draftStats, `${label}.${profileId}.draftStats`),
      draftAttributes: parseRecordOfNumbers(rawProfile.draftAttributes, `${label}.${profileId}.draftAttributes`),
      draftFieldValues: parseOptionalJsonRecord(
        rawProfile.draftFieldValues,
        `${label}.${profileId}.draftFieldValues`
      ),
      fieldDefinitions: parseOptionalTemplateFieldDefinitions(
        rawProfile.fieldDefinitions,
        `${label}.${profileId}.fieldDefinitions`
      )
    };
  }
  return Object.freeze(profiles);
}

function parseEditorProjectionByProfile(
  value: unknown,
  label: string
): Record<string, BlueprintEditorProjection> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const projections: Record<string, BlueprintEditorProjection> = {};
  for (const [profileId, rawProjection] of Object.entries(value)) {
    if (!isRecord(rawProjection)) {
      throw new Error(`${label}.${profileId} must be an object.`);
    }
    projections[profileId] = {
      baseTemplateId: parseNonNegativeInt(rawProjection.baseTemplateId, `${label}.${profileId}.baseTemplateId`),
      stats: parseRecordOfNumbers(rawProjection.stats, `${label}.${profileId}.stats`),
      attributes: parseRecordOfNumbers(rawProjection.attributes, `${label}.${profileId}.attributes`),
      fieldValues: parseOptionalJsonRecord(
        rawProjection.fieldValues,
        `${label}.${profileId}.fieldValues`
      )
    };
  }
  return Object.freeze(projections);
}

function parseOptionalJsonRecord(
  value: unknown,
  label: string
): Record<string, BlueprintJsonValue> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseJsonRecord(value, label);
}

function parseOptionalTemplateFieldDefinitions(
  value: unknown,
  label: string
): readonly BlueprintTemplateFieldDefinition[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return Object.freeze(
    value.map((entry, index) => parseTemplateFieldDefinition(entry, `${label}[${index}]`))
  );
}

function parseRecordOfNumbers(value: unknown, label: string): Record<string, number> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      throw new Error(`${label}.${key} must be a finite number.`);
    }
    record[key] = rawValue;
  }
  return Object.freeze(record);
}

function parseJsonRecord(value: unknown, label: string): Record<string, BlueprintJsonValue> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record: Record<string, BlueprintJsonValue> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    record[key] = parseJsonValue(rawValue, `${label}.${key}`);
  }
  return Object.freeze(record);
}

function parseTemplateFieldDefinition(
  value: unknown,
  label: string
): BlueprintTemplateFieldDefinition {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const valueKind = parseFieldValueKind(value.valueKind, `${label}.valueKind`);
  const options = parseOptionalFieldOptions(value.options, `${label}.options`);
  return {
    id: parseString(value.id, `${label}.id`),
    label: parseString(value.label, `${label}.label`),
    description: parseString(value.description, `${label}.description`),
    groupId: typeof value.groupId === "string" ? value.groupId.trim() : undefined,
    groupLabel: typeof value.groupLabel === "string" ? value.groupLabel.trim() : undefined,
    valueKind,
    defaultValue: value.defaultValue === undefined
      ? undefined
      : parseJsonValue(value.defaultValue, `${label}.defaultValue`),
    min: parseOptionalFiniteNumberStrict(value.min, `${label}.min`),
    max: parseOptionalFiniteNumberStrict(value.max, `${label}.max`),
    step: parseOptionalFiniteNumberStrict(value.step, `${label}.step`),
    polarity: value.polarity === "upside" || value.polarity === "downside"
      ? value.polarity
      : undefined,
    options,
    binding: parseOptionalFieldBinding(value.binding, `${label}.binding`)
  };
}

function parseOptionalFieldOptions(
  value: unknown,
  label: string
): readonly BlueprintTemplateFieldOption[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return Object.freeze(
    value.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`${label}[${index}] must be an object.`);
      }
      return {
        value: parseString(entry.value, `${label}[${index}].value`),
        label: parseString(entry.label, `${label}[${index}].label`),
        description: typeof entry.description === "string"
          ? entry.description.trim()
          : undefined
      };
    })
  );
}

function parseFieldValueKind(
  value: unknown,
  label: string
): BlueprintTemplateFieldDefinition["valueKind"] {
  if (
    value === "number" ||
    value === "string" ||
    value === "boolean" ||
    value === "enum" ||
    value === "json"
  ) {
    return value;
  }
  throw new Error(`${label} must be a supported field value kind.`);
}

function parseOptionalFieldBinding(
  value: unknown,
  label: string
): BlueprintTemplateFieldBinding | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return {
    component: parseString(value.component, `${label}.component`),
    propertyPath: parseString(value.propertyPath, `${label}.propertyPath`)
  };
}

function parseJsonValue(value: unknown, label: string): BlueprintJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => parseJsonValue(entry, `${label}[${index}]`)));
  }
  if (isRecord(value)) {
    const nested: Record<string, BlueprintJsonValue> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      nested[key] = parseJsonValue(nestedValue, `${label}.${key}`);
    }
    return Object.freeze(nested);
  }
  throw new Error(`${label} must be JSON-compatible.`);
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => parseString(entry, `${label}[${index}]`));
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

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseOptionalFiniteNumberStrict(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

