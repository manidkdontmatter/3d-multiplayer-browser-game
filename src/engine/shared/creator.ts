// Generalized creator system contracts — shared between server and client.
// One creator handles all archetype kinds (characters, abilities, items, etc.).
// The engine provides validation and capacity computation; the game layer
// configures what stats and traits are available per kind.

import type { ArchetypeDefinition, getArchetypeDefinitionById as getArchetypeById } from "./archetype";
import type { AllocatedStats } from "./stats";
import { getStatDefinitionsForKind } from "./stats";
import { computeTraitBudget, computeTraitSlots, checkTraitConstraints, getTraitDefinitionById } from "./traits";

export interface CreatorDraft {
  name: string;
  baseArchetypeId: number;
  kind: string;
  statAllocations: AllocatedStats;
  selectedTraits: string[];
}

export interface CreatorCapacity {
  statBudgetTotal: number;
  statBudgetSpent: number;
  statBudgetRemaining: number;
  traitBudget: {
    total: number;
    spent: number;
    remaining: number;
  };
  traitSlots: {
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
  kind: string;
  draft: CreatorDraft;
  capacity: CreatorCapacity;
  validation: CreatorValidation;
  ownedArchetypeCount: number;
}

export const CREATOR_MIN_TIER = 1;
export const CREATOR_MAX_NAME_LENGTH = 24;
export const CREATOR_MAX_ARCHETYPES_PER_PLAYER = 100;
export const CUSTOM_ARCHETYPE_ID_START = 1024;

// Backward-compat aliases for consumers that used the old abilityCreator module
export const ABILITY_CREATOR_MAX_ABILITIES = CREATOR_MAX_ARCHETYPES_PER_PLAYER;
export const ABILITY_CREATOR_MAX_TIER = 5;
export const ABILITY_CREATOR_MIN_TIER = 1;
export type AbilityCreatorSessionSnapshot = CreatorSessionSnapshot;

export function sanitizeCreatorName(rawName: string): string {
  const source = typeof rawName === "string" ? rawName : "";
  return source.replace(/\s+/g, " ").trim().slice(0, CREATOR_MAX_NAME_LENGTH);
}

export function sanitizeCreatorStat(rawValue: number): number {
  if (!Number.isFinite(rawValue)) return 0;
  return Math.max(0, Math.floor(rawValue));
}

function isDownside(traitId: string): boolean {
  const trait = getTraitDefinitionById(traitId);
  return trait?.polarity === "downside";
}

export function getCreatorCapacity(
  draft: CreatorDraft,
  baseArchetype: ArchetypeDefinition
): CreatorCapacity {
  const statBudgetTotal = baseArchetype.statBudget;
  const statBudgetSpent = Object.values(draft.statAllocations).reduce((a, b) => a + b, 0);
  const statBudgetRemaining = Math.max(0, statBudgetTotal - statBudgetSpent);
  const traitBudget = computeTraitBudget(baseArchetype.traitBudget, draft.selectedTraits);

  const upsideSlots = 2 + draft.selectedTraits.filter((t) => isDownside(t)).length;
  const traitSlots = computeTraitSlots(draft.selectedTraits, upsideSlots, 3);

  return {
    statBudgetTotal,
    statBudgetSpent,
    statBudgetRemaining,
    traitBudget,
    traitSlots
  };
}

export function validateCreatorDraft(
  draft: CreatorDraft,
  baseArchetype: ArchetypeDefinition,
  ownedCount: number
): CreatorValidation {
  const errors: string[] = [];

  const name = sanitizeCreatorName(draft.name);
  if (name.length < 3) {
    errors.push("Name must be at least 3 characters.");
  }

  if (draft.baseArchetypeId <= 0) {
    errors.push("No base archetype selected.");
  }

  const validStatIds = new Set(
    getStatDefinitionsForKind(draft.kind).map((s) => s.id)
  );

  for (const [statId, value] of Object.entries(draft.statAllocations)) {
    if (!validStatIds.has(statId)) {
      errors.push(`Stat "${statId}" is not valid for kind "${draft.kind}".`);
    } else if (value < 0) {
      errors.push(`Stat "${statId}" cannot be negative.`);
    }
  }

  const totalAllocated = Object.values(draft.statAllocations).reduce((a, b) => a + b, 0);
  if (totalAllocated > baseArchetype.statBudget) {
    errors.push(`Stat budget exceeded (${totalAllocated}/${baseArchetype.statBudget}).`);
  }

  const validTraitIds = new Set(baseArchetype.availableTraits);
  for (const traitId of draft.selectedTraits) {
    if (!validTraitIds.has(traitId)) {
      errors.push(`Trait "${traitId}" is not available for this archetype.`);
    }
  }

  const constraintViolations = checkTraitConstraints(draft.selectedTraits, draft.kind);
  for (const violation of constraintViolations) {
    errors.push(violation.message);
  }

  const traitBudget = computeTraitBudget(baseArchetype.traitBudget, draft.selectedTraits);
  if (traitBudget.spent > traitBudget.total) {
    errors.push(`Trait budget exceeded (${traitBudget.spent}/${traitBudget.total}).`);
  }

  if (ownedCount >= CREATOR_MAX_ARCHETYPES_PER_PLAYER) {
    errors.push(`Archetype limit reached (${CREATOR_MAX_ARCHETYPES_PER_PLAYER}).`);
  }

  if (errors.length > 0) {
    return { valid: false, message: errors[0] ?? "Validation failed.", errors };
  }
  return { valid: true, message: "Ready to create.", errors: [] };
}
