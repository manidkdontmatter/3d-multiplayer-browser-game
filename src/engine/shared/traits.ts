// Universal trait system — composable, budgeted modifiers that can attach to any archetype kind.
// Traits are the customization primitive: a player spends trait budget to select traits
// that modify an entity's stats and grant runtime effects.

import type { StatModifier } from "./stats";

export type StackPolicy = "replace" | "refresh" | "stack_add" | "max";

export type EffectModifier =
  // Stat/damage modifiers — applied passively by combat systems
  | { type: "block_damage" }
  | { type: "damage_multiplier"; value: number }
  | { type: "flat_damage_delta"; value: number }
  | { type: "min_damage"; value: number }
  | { type: "max_damage"; value: number }
  | { type: "immunity_tag"; tag: string }
  // Gameplay effects — resolved at runtime by EffectResolver
  | { type: "apply_status"; statusId: string; durationMs: number; stacks: number }
  | { type: "deal_damage"; element: string; amount: number }
  | { type: "heal"; amount: number; percentMaxHealth?: number }
  | { type: "modify_stat"; stat: string; additive?: number; multiplier?: number; durationMs: number }
  | { type: "modify_speed"; multiplier: number; durationMs: number }
  | { type: "spawn_entity"; archetypeId: number; durationMs?: number }
  | { type: "teleport"; range: number; direction: "forward" | "random" | "target" };

export interface EffectTemplate {
  readonly effectId: string;
  readonly durationMs: number | null;
  readonly stackPolicy: StackPolicy;
  readonly maxStacks: number;
  readonly modifiers: readonly EffectModifier[];
}

export interface TraitDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly polarity: "upside" | "downside";
  readonly budgetDelta: number;
  readonly maxStacks?: number;
  readonly statModifiers: readonly StatModifier[];
  readonly effects: readonly EffectTemplate[];
  readonly constraints: readonly string[];
  readonly appliesTo: readonly string[];
}

let TRAIT_DEFINITIONS: readonly TraitDefinition[] = Object.freeze([]);
const TRAIT_BY_ID = new Map<string, TraitDefinition>();

export function injectTraitDefinitions(defs: readonly TraitDefinition[]): void {
  TRAIT_DEFINITIONS = Object.freeze([...defs]);
  TRAIT_BY_ID.clear();
  for (const trait of defs) {
    TRAIT_BY_ID.set(trait.id, trait);
  }
}

export function getAllTraitDefinitions(): readonly TraitDefinition[] {
  return TRAIT_DEFINITIONS;
}

export function getTraitDefinitionById(id: string): TraitDefinition | null {
  return TRAIT_BY_ID.get(id) ?? null;
}

export function getTraitsForKind(kind: string): readonly TraitDefinition[] {
  return TRAIT_DEFINITIONS.filter((t) => t.appliesTo.includes(kind));
}

type TraitSelectionInput = readonly string[] | Record<string, number>;

// Compiler: collects all EffectModifiers from a set of selected traits.
// This is the bridge between player trait choices and the EffectResolver.
export function collectTraitEffects(traitIds: TraitSelectionInput): EffectModifier[] {
  const effects: EffectModifier[] = [];
  for (const [traitId, stacks] of normalizeTraitSelection(traitIds).entries()) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) continue;
    for (let stack = 0; stack < stacks; stack += 1) {
      for (const effect of trait.effects) {
        for (const modifier of effect.modifiers) {
          effects.push(modifier);
        }
      }
    }
  }
  return effects;
}

export interface TraitBudget {
  total: number;
  spent: number;
  remaining: number;
}

export function computeTraitBudget(
  baseBudget: number,
  selectedTraitIds: TraitSelectionInput
): TraitBudget {
  let spent = 0;
  for (const [traitId, stacks] of normalizeTraitSelection(selectedTraitIds).entries()) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) continue;
    if (trait.polarity === "upside") {
      spent += Math.abs(trait.budgetDelta) * stacks;
    } else {
      spent -= Math.abs(trait.budgetDelta) * stacks;
    }
  }
  const total = baseBudget;
  return {
    total,
    spent: Math.max(0, spent),
    remaining: Math.max(0, total - Math.max(0, spent))
  };
}

export interface ConstraintViolation {
  traitId: string;
  message: string;
}

export function checkTraitConstraints(
  selectedTraitIds: TraitSelectionInput,
  kind: string
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const normalizedSelection = normalizeTraitSelection(selectedTraitIds);
  const selected = new Set(normalizedSelection.keys());

  for (const [traitId, stacks] of normalizedSelection.entries()) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) {
      violations.push({ traitId, message: `Unknown trait "${traitId}".` });
      continue;
    }

    if (!trait.appliesTo.includes(kind)) {
      violations.push({
        traitId,
        message: `Trait "${trait.label}" cannot be applied to kind "${kind}".`
      });
    }

    const maxStacks = Math.max(1, Math.floor(trait.maxStacks ?? 1));
    if (stacks > maxStacks) {
      violations.push({
        traitId,
        message: `Trait "${trait.label}" exceeds max stacks (${stacks}/${maxStacks}).`
      });
    }

    for (const constraint of trait.constraints) {
      if (constraint.startsWith("requires:")) {
        const requiredId = constraint.slice("requires:".length);
        if (!selected.has(requiredId)) {
          violations.push({
            traitId,
            message: `Trait "${trait.label}" requires trait "${requiredId}".`
          });
        }
      }
      if (constraint.startsWith("conflicts:")) {
        const conflictId = constraint.slice("conflicts:".length);
        if (selected.has(conflictId)) {
          violations.push({
            traitId,
            message: `Trait "${trait.label}" conflicts with trait "${conflictId}".`
          });
        }
      }
    }
  }

  return violations;
}

export function collectStatModifiers(
  selectedTraitIds: TraitSelectionInput
): StatModifier[] {
  const modifiers: StatModifier[] = [];
  for (const [traitId, stacks] of normalizeTraitSelection(selectedTraitIds).entries()) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) continue;
    for (let stack = 0; stack < stacks; stack += 1) {
      modifiers.push(...trait.statModifiers);
    }
  }
  return modifiers;
}

export function collectEffectTemplates(
  selectedTraitIds: TraitSelectionInput
): EffectTemplate[] {
  const effects: EffectTemplate[] = [];
  for (const [traitId, stacks] of normalizeTraitSelection(selectedTraitIds).entries()) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) continue;
    for (let stack = 0; stack < stacks; stack += 1) {
      effects.push(...trait.effects);
    }
  }
  return effects;
}

export interface TraitSlotInfo {
  upsideUsed: number;
  downsideUsed: number;
  upsideMax: number;
  downsideMax: number;
}

export function computeTraitSlots(
  selectedTraitIds: TraitSelectionInput,
  upsideMax: number,
  downsideMax: number
): TraitSlotInfo {
  let upsideUsed = 0;
  let downsideUsed = 0;
  for (const [traitId, stacks] of normalizeTraitSelection(selectedTraitIds).entries()) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) continue;
    if (trait.polarity === "upside") upsideUsed += stacks;
    else downsideUsed += stacks;
  }
  const effectiveUpsideMax = upsideMax + downsideUsed;
  return { upsideUsed, downsideUsed, upsideMax: effectiveUpsideMax, downsideMax };
}

function normalizeTraitSelection(selectedTraitIds: TraitSelectionInput): Map<string, number> {
  const normalized = new Map<string, number>();
  if (Array.isArray(selectedTraitIds)) {
    for (const traitId of selectedTraitIds) {
      if (typeof traitId !== "string" || traitId.trim().length === 0) continue;
      normalized.set(traitId, (normalized.get(traitId) ?? 0) + 1);
    }
    return normalized;
  }

  for (const [traitId, rawStacks] of Object.entries(selectedTraitIds)) {
    if (typeof traitId !== "string" || traitId.trim().length === 0) continue;
    const stacks =
      typeof rawStacks === "number" && Number.isFinite(rawStacks)
        ? Math.max(0, Math.floor(rawStacks))
        : 0;
    if (stacks > 0) {
      normalized.set(traitId, stacks);
    }
  }
  return normalized;
}
