/**
 * Purpose: This file defines the "creator" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import {
  createAbilityDefinitionFromDraft,
  type AbilityAttributeKey,
  type AbilityCategory,
  type AbilityCreationDraft
} from "./abilities";
import {
  buildAbilityDefinitionFromBlueprint,
  cloneBlueprintDefinition,
  getBlueprintTemplateProfile,
  type BlueprintDefinition,
  type BlueprintEditorProjection,
  type BlueprintJsonValue,
  type BlueprintTemplateFieldBinding,
  type BlueprintTemplateFieldDefinition
} from "./blueprint";
import { deriveStats, getStatDefinitionsForKind } from "./stats";
import {
  checkTraitConstraints,
  collectTraitEffects,
  collectStatModifiers,
  computeTraitBudget,
  computeTraitSlots,
  getTraitDefinitionById,
  type EffectModifier
} from "./traits";

export type CreatorProfileId =
  | "ability_creator"
  | "character_creator"
  | "item_creator"
  | "mind_creator"
  | "tile_creator";

export type BlueprintAccessTag =
  | "ability.use"
  | "item.craft"
  | "character.spawn"
  | "mind.assign"
  | "tile.paint"
  | "blueprint.template";

export type CreatorFieldValue = BlueprintJsonValue;
export type CreatorFieldKind = "number" | "string" | "boolean" | "enum" | "json";
export type CreatorFieldGroupId =
  | "stats"
  | "attributes"
  | "details"
  | "behavior"
  | "visual"
  | "properties";

export interface CreatorFieldOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface CreatorFieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly groupId: CreatorFieldGroupId | string;
  readonly groupLabel: string;
  readonly valueKind: CreatorFieldKind;
  readonly defaultValue: CreatorFieldValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly polarity?: "upside" | "downside";
  readonly options?: readonly CreatorFieldOption[];
  readonly binding?: BlueprintTemplateFieldBinding;
}

export interface CreatorDraft {
  name: string;
  profileId: CreatorProfileId;
  baseBlueprintId: number;
  fieldValues: Record<string, CreatorFieldValue>;
}

export interface CreatorCapacity {
  statBudgetTotal: number;
  statBudgetSpent: number;
  statBudgetRemaining: number;
  attributeBudget: {
    total: number;
    spent: number;
    remaining: number;
  };
  attributeSlots: {
    upsideUsed: number;
    downsideUsed: number;
    upsideMax: number;
    downsideMax: number;
  };
}

export interface CreatorValidation {
  valid: boolean;
  message: string;
  errors: string[];
}

export interface CreatorSessionSnapshot {
  sessionId: number;
  ackSequence: number;
  profileId: CreatorProfileId;
  draft: CreatorDraft;
  capacity: CreatorCapacity;
  validation: CreatorValidation;
  availableBlueprintCount: number;
  availableBlueprints: readonly BlueprintDefinition[];
}

export interface CompiledBlueprintResult {
  blueprint: BlueprintDefinition;
  resolvedEffects: readonly EffectModifier[];
}

interface CreatorProfileDefinition {
  readonly id: CreatorProfileId;
  readonly label: string;
  readonly runtimeKind: string;
  readonly grantedAccessTags: readonly BlueprintAccessTag[];
  readonly buildFieldDefinitions: (baseBlueprint: BlueprintDefinition) => readonly CreatorFieldDefinition[];
  readonly getCapacity: (draft: CreatorDraft, baseBlueprint: BlueprintDefinition) => CreatorCapacity;
  readonly validateDraft: (draft: CreatorDraft, baseBlueprint: BlueprintDefinition) => CreatorValidation;
  readonly compileBlueprint: (params: CompileProfileParams) => CompiledBlueprintResult;
}

interface CompileProfileParams {
  readonly nextId: number;
  readonly name: string;
  readonly draft: CreatorDraft;
  readonly baseBlueprint: BlueprintDefinition;
  readonly statValues: Record<string, number>;
  readonly selectedAttributes: Record<string, number>;
  readonly resolvedEffects: readonly EffectModifier[];
}

const STAT_FIELD_PREFIX = "stat:";
const ATTRIBUTE_FIELD_PREFIX = "attribute:";
const GENERIC_FIELD_GROUP_LABELS: Record<string, string> = {
  stats: "Stats",
  attributes: "Attributes",
  details: "Details",
  behavior: "Behavior",
  visual: "Visual",
  properties: "Properties"
};

export const DEFAULT_CREATOR_PROFILE_ID: CreatorProfileId = "ability_creator";
export const CREATOR_MAX_NAME_LENGTH = 24;
export const CUSTOM_BLUEPRINT_ID_START = 1024;

const CREATOR_PROFILE_DEFINITIONS: ReadonlyMap<CreatorProfileId, CreatorProfileDefinition> = new Map([
  [
    "ability_creator",
    {
      id: "ability_creator",
      label: "Ability Creator",
      runtimeKind: "ability",
      grantedAccessTags: ["ability.use", "blueprint.template"],
      buildFieldDefinitions: (baseBlueprint) => buildDefaultFieldDefinitions(baseBlueprint, "ability_creator"),
      getCapacity: getBudgetedCreatorCapacity,
      validateDraft: validateBudgetedCreatorDraft,
      compileBlueprint: compileAbilityBlueprint
    }
  ],
  [
    "item_creator",
    {
      id: "item_creator",
      label: "Item Creator",
      runtimeKind: "item",
      grantedAccessTags: ["item.craft", "blueprint.template"],
      buildFieldDefinitions: (baseBlueprint) => buildDefaultFieldDefinitions(baseBlueprint, "item_creator"),
      getCapacity: getBudgetedCreatorCapacity,
      validateDraft: validateBudgetedCreatorDraft,
      compileBlueprint: compileItemBlueprint
    }
  ],
  [
    "character_creator",
    {
      id: "character_creator",
      label: "Character Creator",
      runtimeKind: "character",
      grantedAccessTags: ["character.spawn", "blueprint.template"],
      buildFieldDefinitions: (baseBlueprint) => buildDefaultFieldDefinitions(baseBlueprint, "character_creator"),
      getCapacity: getBudgetedCreatorCapacity,
      validateDraft: validateBudgetedCreatorDraft,
      compileBlueprint: compileCharacterBlueprint
    }
  ],
  [
    "mind_creator",
    {
      id: "mind_creator",
      label: "Mind Creator",
      runtimeKind: "mind",
      grantedAccessTags: ["mind.assign", "blueprint.template"],
      buildFieldDefinitions: (baseBlueprint) => buildDefaultFieldDefinitions(baseBlueprint, "mind_creator"),
      getCapacity: getBudgetedCreatorCapacity,
      validateDraft: validateBudgetedCreatorDraft,
      compileBlueprint: compileGenericProfileBlueprint
    }
  ],
  [
    "tile_creator",
    {
      id: "tile_creator",
      label: "Tile Creator",
      runtimeKind: "tile",
      grantedAccessTags: ["tile.paint", "blueprint.template"],
      buildFieldDefinitions: (baseBlueprint) => buildDefaultFieldDefinitions(baseBlueprint, "tile_creator"),
      getCapacity: getBudgetedCreatorCapacity,
      validateDraft: validateBudgetedCreatorDraft,
      compileBlueprint: compileGenericProfileBlueprint
    }
  ]
]);

export function isCreatorProfileId(value: unknown): value is CreatorProfileId {
  return CREATOR_PROFILE_DEFINITIONS.has(value as CreatorProfileId);
}

export function getCreatorProfileIds(): readonly CreatorProfileId[] {
  return Array.from(CREATOR_PROFILE_DEFINITIONS.keys());
}

export function getCreatorFieldDefinitions(
  draft: CreatorDraft,
  baseBlueprint: BlueprintDefinition
): readonly CreatorFieldDefinition[] {
  return getRequiredCreatorProfileDefinition(draft.profileId).buildFieldDefinitions(baseBlueprint);
}

export function sanitizeCreatorName(rawName: string): string {
  const source = typeof rawName === "string" ? rawName : "";
  return source.replace(/\s+/g, " ").trim().slice(0, CREATOR_MAX_NAME_LENGTH);
}

export function sanitizeCreatorStat(rawValue: number): number {
  if (!Number.isFinite(rawValue)) return 0;
  return Math.max(0, Math.floor(rawValue));
}

export function sanitizeAttributeStacks(
  rawAttributes: Record<string, number>
): Record<string, number> {
  const sanitized: Record<string, number> = {};
  for (const [attributeId, rawValue] of Object.entries(rawAttributes)) {
    const value = sanitizeCreatorStat(rawValue);
    if (value > 0) {
      sanitized[attributeId] = value;
    }
  }
  return sanitized;
}

export function sanitizeCreatorFieldValue(
  definition: CreatorFieldDefinition,
  rawValue: unknown
): CreatorFieldValue {
  if (definition.valueKind === "number") {
    return sanitizeNumericFieldValue(definition, rawValue);
  }
  if (definition.valueKind === "string") {
    return typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
  }
  if (definition.valueKind === "boolean") {
    return Boolean(rawValue);
  }
  if (definition.valueKind === "enum") {
    const rawText = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
    if (definition.options?.some((option) => option.value === rawText)) {
      return rawText;
    }
    if (typeof definition.defaultValue === "string") {
      return definition.defaultValue;
    }
    return definition.options?.[0]?.value ?? "";
  }
  return sanitizeJsonLikeValue(rawValue);
}

export function stepCreatorFieldValue(
  definition: CreatorFieldDefinition,
  currentValue: CreatorFieldValue | undefined,
  delta: number
): CreatorFieldValue {
  if (definition.valueKind !== "number") {
    return sanitizeCreatorFieldValue(definition, currentValue ?? definition.defaultValue);
  }
  const step = typeof definition.step === "number" && Number.isFinite(definition.step)
    ? definition.step
    : 1;
  const currentNumber = typeof currentValue === "number"
    ? currentValue
    : typeof definition.defaultValue === "number"
      ? definition.defaultValue
      : 0;
  return sanitizeNumericFieldValue(definition, currentNumber + step * delta);
}

export function getCreatorDraftStatValues(draft: CreatorDraft): Record<string, number> {
  const extracted: Record<string, number> = {};
  for (const [fieldId, value] of Object.entries(draft.fieldValues)) {
    if (!fieldId.startsWith(STAT_FIELD_PREFIX) || typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    extracted[fieldId.slice(STAT_FIELD_PREFIX.length)] = sanitizeCreatorStat(value);
  }
  return extracted;
}

export function getCreatorDraftAttributeValues(draft: CreatorDraft): Record<string, number> {
  const extracted: Record<string, number> = {};
  for (const [fieldId, value] of Object.entries(draft.fieldValues)) {
    if (!fieldId.startsWith(ATTRIBUTE_FIELD_PREFIX) || typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    const stacks = sanitizeCreatorStat(value);
    if (stacks > 0) {
      extracted[fieldId.slice(ATTRIBUTE_FIELD_PREFIX.length)] = stacks;
    }
  }
  return extracted;
}

export function getCreatorCapacity(
  draft: CreatorDraft,
  baseBlueprint: BlueprintDefinition
): CreatorCapacity {
  return getRequiredCreatorProfileDefinition(draft.profileId).getCapacity(draft, baseBlueprint);
}

export function validateCreatorDraft(
  draft: CreatorDraft,
  baseBlueprint: BlueprintDefinition,
  _availableBlueprintCount: number
): CreatorValidation {
  return getRequiredCreatorProfileDefinition(draft.profileId).validateDraft(draft, baseBlueprint);
}

function validateBudgetedCreatorDraft(
  draft: CreatorDraft,
  baseBlueprint: BlueprintDefinition
): CreatorValidation {
  const errors: string[] = [];
  const templateProfile = getRequiredTemplateProfile(baseBlueprint, draft.profileId);
  const profileDefinition = getRequiredCreatorProfileDefinition(draft.profileId);
  const fieldDefinitions = profileDefinition.buildFieldDefinitions(baseBlueprint);
  const fieldDefinitionById = new Map(fieldDefinitions.map((definition) => [definition.id, definition]));
  const statValues = getCreatorDraftStatValues(draft);
  const selectedAttributes = getCreatorDraftAttributeValues(draft);

  const name = sanitizeCreatorName(draft.name);
  if (name.length < 3) {
    errors.push("Name must be at least 3 characters.");
  }

  if (draft.baseBlueprintId <= 0) {
    errors.push("No base blueprint selected.");
  }

  for (const [fieldId, rawValue] of Object.entries(draft.fieldValues)) {
    const definition = fieldDefinitionById.get(fieldId);
    if (!definition) {
      errors.push(`Field "${fieldId}" is not valid for profile "${draft.profileId}".`);
      continue;
    }
    try {
      sanitizeCreatorFieldValue(definition, rawValue);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Field "${fieldId}" is invalid.`);
    }
  }

  const validStatIds = new Set(getStatDefinitionsForKind(profileDefinition.runtimeKind).map((definition) => definition.id));
  for (const [statId, value] of Object.entries(statValues)) {
    if (!validStatIds.has(statId)) {
      errors.push(`Stat "${statId}" is not valid for profile "${draft.profileId}".`);
    } else if (value < 0) {
      errors.push(`Stat "${statId}" cannot be negative.`);
    }
  }

  const totalStats = Object.values(statValues).reduce((sum, value) => sum + value, 0);
  if (totalStats > templateProfile.statBudget) {
    errors.push(`Stat budget exceeded (${totalStats}/${templateProfile.statBudget}).`);
  }

  const validAttributeIds = new Set(templateProfile.availableAttributeIds);
  for (const [attributeId, stacks] of Object.entries(selectedAttributes)) {
    if (!validAttributeIds.has(attributeId)) {
      errors.push(`Attribute "${attributeId}" is not available for this blueprint template.`);
      continue;
    }
    const definition = getTraitDefinitionById(attributeId);
    const maxStacks = Math.max(1, Math.floor(definition?.maxStacks ?? 1));
    if (stacks > maxStacks) {
      errors.push(`Attribute "${attributeId}" exceeds max stacks (${stacks}/${maxStacks}).`);
    }
  }

  const constraintViolations = checkTraitConstraints(selectedAttributes, profileDefinition.runtimeKind);
  for (const violation of constraintViolations) {
    errors.push(violation.message);
  }

  const attributeBudget = computeTraitBudget(templateProfile.attributeBudget, selectedAttributes);
  if (attributeBudget.spent > attributeBudget.total) {
    errors.push(`Attribute budget exceeded (${attributeBudget.spent}/${attributeBudget.total}).`);
  }

  if (errors.length > 0) {
    return { valid: false, message: errors[0] ?? "Validation failed.", errors };
  }
  return { valid: true, message: "Ready to create.", errors: [] };
}

function getBudgetedCreatorCapacity(
  draft: CreatorDraft,
  baseBlueprint: BlueprintDefinition
): CreatorCapacity {
  const templateProfile = getRequiredTemplateProfile(baseBlueprint, draft.profileId);
  const statValues = getCreatorDraftStatValues(draft);
  const statBudgetTotal = templateProfile.statBudget;
  const statBudgetSpent = Object.values(statValues).reduce((sum, value) => sum + value, 0);
  const statBudgetRemaining = Math.max(0, statBudgetTotal - statBudgetSpent);
  const selectedAttributes = getCreatorDraftAttributeValues(draft);
  const attributeBudget = computeTraitBudget(templateProfile.attributeBudget, selectedAttributes);
  const downsideStacks = countAttributeStacksByPolarity(selectedAttributes, "downside");
  const attributeSlots = computeTraitSlots(selectedAttributes, 2 + downsideStacks, 3);
  return {
    statBudgetTotal,
    statBudgetSpent,
    statBudgetRemaining,
    attributeBudget,
    attributeSlots
  };
}

export function createDraftFromBlueprint(
  blueprint: BlueprintDefinition,
  profileId: CreatorProfileId
): CreatorDraft {
  const templateProfile = getBlueprintTemplateProfile(blueprint, profileId);
  const editorProjection = blueprint.editorProjectionByProfile?.[profileId];
  return {
    name: blueprint.name,
    profileId,
    baseBlueprintId: blueprint.id,
    fieldValues: buildDraftFieldValues(blueprint, profileId, templateProfile, editorProjection)
  };
}

export function compileBlueprintFromCreatorDraft(params: {
  nextId: number;
  draft: CreatorDraft;
  baseBlueprint: BlueprintDefinition;
}): CompiledBlueprintResult {
  const { nextId, draft, baseBlueprint } = params;
  const profileDefinition = getRequiredCreatorProfileDefinition(draft.profileId);
  const name = sanitizeCreatorName(draft.name);
  const statValues = getCreatorDraftStatValues(draft);
  const selectedAttributes = getCreatorDraftAttributeValues(draft);
  const resolvedEffects = collectTraitEffects(selectedAttributes);
  return profileDefinition.compileBlueprint({
    nextId,
    name,
    draft,
    baseBlueprint,
    statValues,
    selectedAttributes,
    resolvedEffects
  });
}

export function creatorProfileIdToKind(profileId: CreatorProfileId): string {
  return getRequiredCreatorProfileDefinition(profileId).runtimeKind;
}

export function creatorProfileIdToGrantedAccessTags(
  profileId: CreatorProfileId
): readonly BlueprintAccessTag[] {
  return getRequiredCreatorProfileDefinition(profileId).grantedAccessTags;
}

function buildDefaultFieldDefinitions(
  baseBlueprint: BlueprintDefinition,
  profileId: CreatorProfileId
): readonly CreatorFieldDefinition[] {
  const profileDefinition = getRequiredCreatorProfileDefinition(profileId);
  const templateProfile = getRequiredTemplateProfile(baseBlueprint, profileId);
  const fieldDefinitions: CreatorFieldDefinition[] = [];

  for (const definition of getStatDefinitionsForKind(profileDefinition.runtimeKind)) {
    fieldDefinitions.push({
      id: toStatFieldId(definition.id),
      label: definition.label,
      description: definition.description,
      groupId: "stats",
      groupLabel: GENERIC_FIELD_GROUP_LABELS.stats ?? "Stats",
      valueKind: "number",
      defaultValue: 0,
      min: 0,
      step: 1
    });
  }

  for (const attributeId of templateProfile.availableAttributeIds) {
    const definition = getTraitDefinitionById(attributeId);
    fieldDefinitions.push({
      id: toAttributeFieldId(attributeId),
      label: definition?.label ?? attributeId,
      description: definition?.description ?? attributeId,
      groupId: "attributes",
      groupLabel: GENERIC_FIELD_GROUP_LABELS.attributes ?? "Attributes",
      valueKind: "number",
      defaultValue: 0,
      min: 0,
      max: Math.max(1, Math.floor(definition?.maxStacks ?? 1)),
      step: 1,
      polarity: definition?.polarity
    });
  }

  for (const field of templateProfile.fieldDefinitions ?? []) {
    fieldDefinitions.push(convertTemplateFieldDefinition(field));
  }

  return fieldDefinitions;
}

function compileAbilityBlueprint(params: CompileProfileParams): CompiledBlueprintResult {
  const baseAbility = buildAbilityDefinitionFromBlueprint(params.baseBlueprint);
  const category: AbilityCategory = baseAbility?.category ?? inferAbilityCategoryFromBlueprint(params.baseBlueprint);
  const attributeIds = Object.keys(params.selectedAttributes)
    .filter((attributeId) => params.selectedAttributes[attributeId]! > 0) as AbilityAttributeKey[];
  const abilityDraft: AbilityCreationDraft = {
    name: params.name,
    category,
    points: {
      power: params.statValues.power ?? 0,
      velocity: params.statValues.velocity ?? 0,
      efficiency: params.statValues.efficiency ?? 0,
      control: params.statValues.control ?? 0
    },
    attributes: attributeIds
  };
  const ability = createAbilityDefinitionFromDraft(params.nextId, abilityDraft);
  if (!ability) {
    throw new Error(`Creator profile "${params.draft.profileId}" produced an invalid ability draft.`);
  }

  const components: Record<string, Record<string, unknown>> = {
    AbilityStats: { ...ability.points },
    AbilityAttributes: { stacks: { ...params.selectedAttributes } }
  };
  if (ability.projectile) {
    components.ProjectileEmitter = { ...ability.projectile };
  }
  if (ability.melee) {
    components.MeleeAttack = { ...ability.melee };
  }
  if (params.resolvedEffects.length > 0) {
    components.CreatorEffects = { modifiers: params.resolvedEffects };
  }
  const canonicalComponents = applyBoundFieldValuesToComponents(
    params.baseBlueprint,
    params.draft,
    components
  );

  return {
    blueprint: {
      id: params.nextId,
      key: `custom-${params.nextId}`,
      name: ability.name,
      description: ability.description,
      metadata: { authoredViaProfile: params.draft.profileId },
      components: canonicalComponents,
      editorProjectionByProfile: {
        [params.draft.profileId]: createEditorProjection(params.draft, params.baseBlueprint.id)
      }
    },
    resolvedEffects: params.resolvedEffects
  };
}

function compileItemBlueprint(params: CompileProfileParams): CompiledBlueprintResult {
  const baseComponents: Record<string, Record<string, unknown>> = {
    ...params.baseBlueprint.components,
    ItemStats: params.statValues
  };
  if (params.resolvedEffects.length > 0) {
    baseComponents.CreatorEffects = { modifiers: params.resolvedEffects };
  }
  const components = applyBoundFieldValuesToComponents(
    params.baseBlueprint,
    params.draft,
    baseComponents
  );
  return {
    blueprint: cloneBlueprintDefinition(params.baseBlueprint, {
      id: params.nextId,
      key: `custom-${params.nextId}`,
      name: params.name,
      description: `${params.name} | profile: ${params.draft.profileId}`,
      metadata: { authoredViaProfile: params.draft.profileId },
      components,
      editorProjectionByProfile: {
        ...(params.baseBlueprint.editorProjectionByProfile ?? {}),
        [params.draft.profileId]: createEditorProjection(params.draft, params.baseBlueprint.id)
      }
    }),
    resolvedEffects: params.resolvedEffects
  };
}

function compileCharacterBlueprint(params: CompileProfileParams): CompiledBlueprintResult {
  const modifiers = collectStatModifiers(params.selectedAttributes);
  const derived = deriveStats("character", {}, params.statValues, modifiers);
  const baseVitals = params.baseBlueprint.components.Vitals ?? {};
  const baseMovement = params.baseBlueprint.components.MovementStats ?? {};
  const components = applyBoundFieldValuesToComponents(
    params.baseBlueprint,
    params.draft,
    {
    ...params.baseBlueprint.components,
    CharacterStats: params.statValues,
    Vitals: {
      healthCurrent: derived.maxHealth ?? readFiniteNumber(baseVitals.healthCurrent, 100),
      healthMax: derived.maxHealth ?? readFiniteNumber(baseVitals.healthMax, 100)
    },
    MovementStats: {
      ...baseMovement,
      moveSpeed: derived.moveSpeed ?? readFiniteNumber(baseMovement.moveSpeed, 6)
    }
    }
  );
  if (params.resolvedEffects.length > 0) {
    components.CreatorEffects = { modifiers: params.resolvedEffects };
  }
  return {
    blueprint: {
      id: params.nextId,
      key: `custom-${params.nextId}`,
      name: params.name,
      description: `${params.name} | profile: ${params.draft.profileId}`,
      metadata: { authoredViaProfile: params.draft.profileId },
      components,
      editorProjectionByProfile: {
        ...(params.baseBlueprint.editorProjectionByProfile ?? {}),
        [params.draft.profileId]: createEditorProjection(params.draft, params.baseBlueprint.id)
      }
    },
    resolvedEffects: params.resolvedEffects
  };
}

function compileGenericProfileBlueprint(params: CompileProfileParams): CompiledBlueprintResult {
  const components = applyBoundFieldValuesToComponents(
    params.baseBlueprint,
    params.draft,
    params.baseBlueprint.components
  );
  return {
    blueprint: cloneBlueprintDefinition(params.baseBlueprint, {
      id: params.nextId,
      key: `custom-${params.nextId}`,
      name: params.name,
      description: `${params.name} | profile: ${params.draft.profileId}`,
      metadata: { authoredViaProfile: params.draft.profileId },
      components,
      editorProjectionByProfile: {
        ...(params.baseBlueprint.editorProjectionByProfile ?? {}),
        [params.draft.profileId]: createEditorProjection(params.draft, params.baseBlueprint.id)
      }
    }),
    resolvedEffects: params.resolvedEffects
  };
}

function buildDraftFieldValues(
  blueprint: BlueprintDefinition,
  profileId: CreatorProfileId,
  templateProfile: ReturnType<typeof getBlueprintTemplateProfile>,
  editorProjection: BlueprintEditorProjection | undefined
): Record<string, CreatorFieldValue> {
  const fieldValues: Record<string, CreatorFieldValue> = {};
  const projectionStats = editorProjection?.stats
    ?? templateProfile?.draftStats
    ?? inferDraftStatsFromBlueprint(blueprint, profileId);
  for (const [statId, value] of Object.entries(projectionStats)) {
    fieldValues[toStatFieldId(statId)] = sanitizeCreatorStat(value);
  }

  const projectionAttributes = editorProjection?.attributes
    ?? templateProfile?.draftAttributes
    ?? inferDraftAttributesFromBlueprint(blueprint, profileId);
  for (const [attributeId, stacks] of Object.entries(projectionAttributes)) {
    fieldValues[toAttributeFieldId(attributeId)] = sanitizeCreatorStat(stacks);
  }

  const boundFieldValues = readBoundFieldValuesFromBlueprint(blueprint, profileId);
  for (const [fieldId, value] of Object.entries(boundFieldValues)) {
    fieldValues[fieldId] = sanitizeJsonLikeValue(value);
  }

  if (templateProfile?.draftFieldValues) {
    for (const [fieldId, value] of Object.entries(templateProfile.draftFieldValues)) {
      if (!(fieldId in fieldValues)) {
        fieldValues[fieldId] = sanitizeJsonLikeValue(value);
      }
    }
  }

  for (const field of templateProfile?.fieldDefinitions ?? []) {
    if (!(field.id in fieldValues)) {
      fieldValues[field.id] = sanitizeJsonLikeValue(field.defaultValue ?? defaultValueForFieldKind(field.valueKind));
    }
  }

  if (editorProjection?.fieldValues) {
    for (const [fieldId, value] of Object.entries(editorProjection.fieldValues)) {
      fieldValues[fieldId] = sanitizeJsonLikeValue(value);
    }
  }

  return fieldValues;
}

function inferDraftStatsFromBlueprint(
  blueprint: BlueprintDefinition,
  profileId: CreatorProfileId
): Record<string, number> {
  if (profileId === "ability_creator") {
    const ability = buildAbilityDefinitionFromBlueprint(blueprint);
    if (ability) {
      return { ...ability.points };
    }
  }
  if (profileId === "item_creator" && isRecord(blueprint.components.ItemStats)) {
    return sanitizeNumericRecord(blueprint.components.ItemStats as Record<string, unknown>);
  }
  if (profileId === "character_creator" && isRecord(blueprint.components.CharacterStats)) {
    return sanitizeNumericRecord(blueprint.components.CharacterStats as Record<string, unknown>);
  }
  const definitions = getStatDefinitionsForKind(creatorProfileIdToKind(profileId));
  const stats: Record<string, number> = {};
  for (const definition of definitions) {
    stats[definition.id] = 0;
  }
  return stats;
}

function inferDraftAttributesFromBlueprint(
  blueprint: BlueprintDefinition,
  profileId: CreatorProfileId
): Record<string, number> {
  if (profileId === "ability_creator" && isRecord(blueprint.components.AbilityAttributes?.stacks)) {
    return sanitizeAttributeStacks(blueprint.components.AbilityAttributes.stacks as Record<string, number>);
  }
  return {};
}

function getRequiredCreatorProfileDefinition(profileId: CreatorProfileId): CreatorProfileDefinition {
  const definition = CREATOR_PROFILE_DEFINITIONS.get(profileId);
  if (!definition) {
    throw new Error(`Unknown creator profile "${profileId}".`);
  }
  return definition;
}

function getRequiredTemplateProfile(
  blueprint: BlueprintDefinition,
  profileId: CreatorProfileId
) {
  const templateProfile = getBlueprintTemplateProfile(blueprint, profileId);
  if (!templateProfile) {
    throw new Error(`Blueprint ${blueprint.id} is not editable through profile "${profileId}".`);
  }
  return templateProfile;
}

function countAttributeStacksByPolarity(
  selectedAttributes: Record<string, number>,
  polarity: "upside" | "downside"
): number {
  let total = 0;
  for (const [attributeId, stacks] of Object.entries(selectedAttributes)) {
    const definition = getTraitDefinitionById(attributeId);
    if (definition?.polarity === polarity) {
      total += stacks;
    }
  }
  return total;
}

function createEditorProjection(
  draft: CreatorDraft,
  baseTemplateId: number
) {
  return {
    baseTemplateId,
    stats: getCreatorDraftStatValues(draft),
    attributes: getCreatorDraftAttributeValues(draft),
    fieldValues: cloneFieldValues(draft.fieldValues)
  };
}

function readBoundFieldValuesFromBlueprint(
  blueprint: BlueprintDefinition,
  profileId: CreatorProfileId
): Record<string, CreatorFieldValue> {
  const templateProfile = getBlueprintTemplateProfile(blueprint, profileId);
  if (!templateProfile?.fieldDefinitions || templateProfile.fieldDefinitions.length === 0) {
    return {};
  }
  const resolved: Record<string, CreatorFieldValue> = {};
  for (const field of templateProfile.fieldDefinitions) {
    if (!field.binding) {
      continue;
    }
    const value = readBoundFieldValue(blueprint.components, field.binding);
    if (value !== undefined) {
      resolved[field.id] = sanitizeJsonLikeValue(value);
    }
  }
  return resolved;
}

function applyBoundFieldValuesToComponents(
  baseBlueprint: BlueprintDefinition,
  draft: CreatorDraft,
  startingComponents: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  const components = cloneBlueprintComponents(startingComponents);
  const fieldDefinitions = getCreatorFieldDefinitions(draft, baseBlueprint);
  for (const definition of fieldDefinitions) {
    if (!definition.id || !definitionHasBinding(definition)) {
      continue;
    }
    if (!(definition.id in draft.fieldValues)) {
      continue;
    }
    const fieldValue = draft.fieldValues[definition.id];
    if (fieldValue === undefined) {
      continue;
    }
    writeBoundFieldValue(components, definition.binding, fieldValue);
  }
  return components;
}

function sanitizeNumericRecord(rawValues: Record<string, unknown>): Record<string, number> {
  const sanitized: Record<string, number> = {};
  for (const [statId, rawValue] of Object.entries(rawValues)) {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      continue;
    }
    sanitized[statId] = sanitizeCreatorStat(rawValue);
  }
  return sanitized;
}

function sanitizeNumericFieldValue(
  definition: CreatorFieldDefinition,
  rawValue: unknown
): number {
  const fallback = typeof definition.defaultValue === "number" ? definition.defaultValue : 0;
  let numeric = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : fallback;
  if (typeof definition.min === "number") {
    numeric = Math.max(definition.min, numeric);
  }
  if (typeof definition.max === "number") {
    numeric = Math.min(definition.max, numeric);
  }
  const step = typeof definition.step === "number" && Number.isFinite(definition.step) && definition.step > 0
    ? definition.step
    : 1;
  if (Math.abs(step - 1) < 1e-6) {
    return sanitizeCreatorStat(numeric);
  }
  return Math.round(numeric / step) * step;
}

function sanitizeJsonLikeValue(rawValue: unknown): CreatorFieldValue {
  if (
    rawValue === null ||
    typeof rawValue === "string" ||
    typeof rawValue === "boolean"
  ) {
    return rawValue;
  }
  if (typeof rawValue === "number") {
    return Number.isFinite(rawValue) ? rawValue : 0;
  }
  if (Array.isArray(rawValue)) {
    return rawValue.map((entry) => sanitizeJsonLikeValue(entry));
  }
  if (isRecord(rawValue)) {
    const sanitized: Record<string, CreatorFieldValue> = {};
    for (const [key, value] of Object.entries(rawValue)) {
      sanitized[key] = sanitizeJsonLikeValue(value);
    }
    return sanitized;
  }
  return null;
}

function cloneFieldValues(fieldValues: Record<string, CreatorFieldValue>): Record<string, CreatorFieldValue> {
  return JSON.parse(JSON.stringify(fieldValues ?? {})) as Record<string, CreatorFieldValue>;
}

function cloneBlueprintComponents(
  components: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  return JSON.parse(JSON.stringify(components ?? {})) as Record<string, Record<string, unknown>>;
}

function convertTemplateFieldDefinition(
  field: BlueprintTemplateFieldDefinition
): CreatorFieldDefinition {
  return {
    id: field.id,
    label: field.label,
    description: field.description,
    groupId: field.groupId ?? "details",
    groupLabel: field.groupLabel ?? GENERIC_FIELD_GROUP_LABELS[field.groupId ?? "details"] ?? "Details",
    valueKind: field.valueKind,
    defaultValue: sanitizeJsonLikeValue(field.defaultValue ?? defaultValueForFieldKind(field.valueKind)),
    min: field.min,
    max: field.max,
    step: field.step,
    polarity: field.polarity,
    options: field.options?.map((option) => ({ ...option })) ?? [],
    binding: field.binding
  };
}

function defaultValueForFieldKind(valueKind: CreatorFieldKind): CreatorFieldValue {
  if (valueKind === "number") return 0;
  if (valueKind === "boolean") return false;
  return "";
}

function definitionHasBinding(
  definition: CreatorFieldDefinition
): definition is CreatorFieldDefinition & { binding: BlueprintTemplateFieldBinding } {
  return "binding" in definition && Boolean((definition as CreatorFieldDefinition & { binding?: BlueprintTemplateFieldBinding }).binding);
}

function readBoundFieldValue(
  components: Record<string, Record<string, unknown>>,
  binding: BlueprintTemplateFieldBinding
): unknown {
  const componentPayload = components[binding.component];
  if (!isRecord(componentPayload)) {
    return undefined;
  }
  let current: unknown = componentPayload;
  for (const segment of splitPropertyPath(binding.propertyPath)) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function writeBoundFieldValue(
  components: Record<string, Record<string, unknown>>,
  binding: BlueprintTemplateFieldBinding,
  value: CreatorFieldValue
): void {
  let componentPayload = components[binding.component];
  if (!isRecord(componentPayload)) {
    componentPayload = {};
    components[binding.component] = componentPayload;
  }
  const segments = splitPropertyPath(binding.propertyPath);
  if (segments.length === 0) {
    return;
  }
  let current: Record<string, unknown> = componentPayload;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const next = current[segment];
    if (!isRecord(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = sanitizeJsonLikeValue(value);
}

function splitPropertyPath(propertyPath: string): string[] {
  return propertyPath
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function toStatFieldId(statId: string): string {
  return `${STAT_FIELD_PREFIX}${statId}`;
}

function toAttributeFieldId(attributeId: string): string {
  return `${ATTRIBUTE_FIELD_PREFIX}${attributeId}`;
}

function inferAbilityCategoryFromBlueprint(blueprint: BlueprintDefinition): AbilityCategory {
  return blueprint.components.ProjectileEmitter ? "projectile" : "melee";
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
