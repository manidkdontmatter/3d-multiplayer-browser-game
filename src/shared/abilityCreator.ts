// Shared authoritative ability-creator contracts and rule helpers used by both server and client.
import type { AbilityCategory } from "./abilities";

export type AbilityCreatorType = "melee" | "projectile" | "beam" | "aoe" | "buff" | "movement";

export interface AbilityCreatorDraft {
  name: string;
  type: AbilityCreatorType;
  tier: number;
  coreExampleStat: number;
  exampleUpsideEnabled: boolean;
  exampleDownsideEnabled: boolean;
  templateAbilityId: number;
}

export interface AbilityCreatorDerivedStats {
  examplePower: number;
  exampleStability: number;
  exampleComplexity: number;
}

export interface AbilityCreatorCapacity {
  totalPointBudget: number;
  spentPoints: number;
  remainingPoints: number;
  upsideSlots: number;
  downsideMax: number;
  usedUpsideSlots: number;
  usedDownsideSlots: number;
}

export interface AbilityCreatorValidation {
  valid: boolean;
  message: string;
}

export interface AbilityCreatorSessionSnapshot {
  sessionId: number;
  ackSequence: number;
  maxCreatorTier: number;
  draft: AbilityCreatorDraft;
  capacity: AbilityCreatorCapacity;
  derived: AbilityCreatorDerivedStats;
  validation: AbilityCreatorValidation;
  ownedAbilityCount: number;
}

export const ABILITY_CREATOR_MIN_TIER = 1;
export const ABILITY_CREATOR_MAX_TIER = 5;
export const ABILITY_CREATOR_MAX_ABILITIES = 100;
export const ABILITY_CREATOR_NAME_MAX_LENGTH = 24;
export const ABILITY_CREATOR_EXAMPLE_UPSIDE_KEY = "example-upside";
export const ABILITY_CREATOR_EXAMPLE_UPSIDE_NAME = "Example Upside";
export const ABILITY_CREATOR_EXAMPLE_UPSIDE_DESCRIPTION =
  "Placeholder upside attribute for creator UX testing. No gameplay effect yet.";
export const ABILITY_CREATOR_EXAMPLE_DOWNSIDE_KEY = "example-downside";
export const ABILITY_CREATOR_EXAMPLE_DOWNSIDE_NAME = "Example Downside";
export const ABILITY_CREATOR_EXAMPLE_DOWNSIDE_DESCRIPTION =
  "Placeholder downside attribute for creator UX testing. No gameplay effect yet.";

export const ABILITY_CREATOR_TYPE_OPTIONS: ReadonlyArray<AbilityCreatorType> = Object.freeze([
  "melee",
  "projectile",
  "beam",
  "aoe",
  "buff",
  "movement"
]);

const CREATOR_TYPE_TO_CATEGORY: Readonly<Record<AbilityCreatorType, AbilityCategory>> = Object.freeze({
  melee: "melee",
  projectile: "projectile",
  beam: "beam",
  aoe: "aoe",
  buff: "buff",
  movement: "movement"
});

export function sanitizeAbilityCreatorName(rawName: string): string {
  const source = typeof rawName === "string" ? rawName : "";
  return source.replace(/\s+/g, " ").trim().slice(0, ABILITY_CREATOR_NAME_MAX_LENGTH);
}

export function sanitizeCreatorTier(rawTier: number, maxCreatorTier: number): number {
  const normalizedMax = Math.max(
    ABILITY_CREATOR_MIN_TIER,
    Math.min(ABILITY_CREATOR_MAX_TIER, Math.floor(Number.isFinite(maxCreatorTier) ? maxCreatorTier : 1))
  );
  if (!Number.isFinite(rawTier)) {
    return ABILITY_CREATOR_MIN_TIER;
  }
  return Math.max(ABILITY_CREATOR_MIN_TIER, Math.min(normalizedMax, Math.floor(rawTier)));
}

export function sanitizeCreatorCoreExampleStat(rawValue: number): number {
  if (!Number.isFinite(rawValue)) {
    return 0;
  }
  return Math.max(0, Math.floor(rawValue));
}

export function parseCreatorType(rawValue: unknown): AbilityCreatorType | null {
  if (typeof rawValue !== "string") {
    return null;
  }
  if (ABILITY_CREATOR_TYPE_OPTIONS.includes(rawValue as AbilityCreatorType)) {
    return rawValue as AbilityCreatorType;
  }
  return null;
}

export function abilityCreatorTypeToCategory(type: AbilityCreatorType): AbilityCategory {
  return CREATOR_TYPE_TO_CATEGORY[type];
}

export function abilityCategoryToCreatorType(category: AbilityCategory): AbilityCreatorType | null {
  if (category === "melee") {
    return "melee";
  }
  if (category === "projectile") {
    return "projectile";
  }
  if (category === "beam") {
    return "beam";
  }
  if (category === "aoe") {
    return "aoe";
  }
  if (category === "buff") {
    return "buff";
  }
  if (category === "movement") {
    return "movement";
  }
  return null;
}

export function getAbilityCreatorCapacity(
  draft: Pick<AbilityCreatorDraft, "tier" | "coreExampleStat" | "exampleUpsideEnabled" | "exampleDownsideEnabled">
): AbilityCreatorCapacity {
  const tier = sanitizeCreatorTier(draft.tier, ABILITY_CREATOR_MAX_TIER);
  const totalPointBudget = tier * 5;
  const spentPoints = sanitizeCreatorCoreExampleStat(draft.coreExampleStat);
  const remainingPoints = Math.max(0, totalPointBudget - spentPoints);
  const usedUpsideSlots = draft.exampleUpsideEnabled ? 1 : 0;
  const usedDownsideSlots = draft.exampleDownsideEnabled ? 1 : 0;
  const upsideSlots = tier + usedDownsideSlots;
  const downsideMax = tier;
  return {
    totalPointBudget,
    spentPoints,
    remainingPoints,
    upsideSlots,
    downsideMax,
    usedUpsideSlots,
    usedDownsideSlots
  };
}

export function computeAbilityCreatorDerivedStats(
  draft: Pick<AbilityCreatorDraft, "tier" | "coreExampleStat" | "exampleUpsideEnabled" | "exampleDownsideEnabled">
): AbilityCreatorDerivedStats {
  const tier = sanitizeCreatorTier(draft.tier, ABILITY_CREATOR_MAX_TIER);
  const core = sanitizeCreatorCoreExampleStat(draft.coreExampleStat);
  const upsideBonus = draft.exampleUpsideEnabled ? 1 : 0;
  const downsidePenalty = draft.exampleDownsideEnabled ? 1 : 0;
  return {
    examplePower: tier * 12 + core * 9 + upsideBonus * 14 - downsidePenalty * 7,
    exampleStability: Math.max(0, 100 - core * 2 + tier * 3 + upsideBonus * 8 - downsidePenalty * 12),
    exampleComplexity: tier * 20 + core * 6 + upsideBonus * 10 + downsidePenalty * 6
  };
}

export function validateAbilityCreatorDraft(
  draft: AbilityCreatorDraft,
  maxCreatorTier: number
): AbilityCreatorValidation {
  const name = sanitizeAbilityCreatorName(draft.name);
  if (name.length < 3) {
    return { valid: false, message: "Ability name must be at least 3 characters." };
  }
  if (!ABILITY_CREATOR_TYPE_OPTIONS.includes(draft.type)) {
    return { valid: false, message: "Invalid ability type." };
  }
  const tier = sanitizeCreatorTier(draft.tier, maxCreatorTier);
  if (tier !== draft.tier) {
    return { valid: false, message: "Selected tier is outside your current creator tier range." };
  }

  const capacity = getAbilityCreatorCapacity(draft);
  if (capacity.spentPoints > capacity.totalPointBudget) {
    return {
      valid: false,
      message: `Point budget exceeded (${capacity.spentPoints}/${capacity.totalPointBudget}).`
    };
  }
  if (capacity.usedUpsideSlots > capacity.upsideSlots) {
    return {
      valid: false,
      message: `Upside attribute slots exceeded (${capacity.usedUpsideSlots}/${capacity.upsideSlots}).`
    };
  }
  if (capacity.usedDownsideSlots > capacity.downsideMax) {
    return {
      valid: false,
      message: `Downside attribute slots exceeded (${capacity.usedDownsideSlots}/${capacity.downsideMax}).`
    };
  }
  return { valid: true, message: "Ready to create ability." };
}
