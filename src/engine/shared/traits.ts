// Universal trait system — composable, budgeted modifiers that can attach to any archetype kind.
// Traits are the customization primitive: a player spends trait budget to select traits
// that modify an entity's stats and grant runtime effects.

import type { StatModifier } from "./stats";

export type StackPolicy = "replace" | "refresh" | "stack_add" | "max";

export type EffectModifier =
  // Stat/damage modifiers (existing)
  | { type: "block_damage" }
  | { type: "damage_multiplier"; value: number }
  | { type: "flat_damage_delta"; value: number }
  | { type: "min_damage"; value: number }
  | { type: "max_damage"; value: number }
  | { type: "immunity_tag"; tag: string }
  // Gameplay effects (new)
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

export interface TraitBudget {
  total: number;
  spent: number;
  remaining: number;
}

export function computeTraitBudget(
  baseBudget: number,
  selectedTraitIds: readonly string[]
): TraitBudget {
  let spent = 0;
  for (const traitId of selectedTraitIds) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) continue;
    if (trait.polarity === "upside") {
      spent += Math.abs(trait.budgetDelta);
    } else {
      spent -= Math.abs(trait.budgetDelta);
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
  selectedTraitIds: readonly string[],
  kind: string
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const selected = new Set(selectedTraitIds);

  for (const traitId of selectedTraitIds) {
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
  selectedTraitIds: readonly string[]
): StatModifier[] {
  const modifiers: StatModifier[] = [];
  for (const traitId of selectedTraitIds) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) continue;
    modifiers.push(...trait.statModifiers);
  }
  return modifiers;
}

export function collectEffectTemplates(
  selectedTraitIds: readonly string[]
): EffectTemplate[] {
  const effects: EffectTemplate[] = [];
  for (const traitId of selectedTraitIds) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) continue;
    effects.push(...trait.effects);
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
  selectedTraitIds: readonly string[],
  upsideMax: number,
  downsideMax: number
): TraitSlotInfo {
  let upsideUsed = 0;
  let downsideUsed = 0;
  for (const traitId of selectedTraitIds) {
    const trait = TRAIT_BY_ID.get(traitId);
    if (!trait) continue;
    if (trait.polarity === "upside") upsideUsed += 1;
    else downsideUsed += 1;
  }
  const effectiveUpsideMax = upsideMax + downsideUsed;
  return { upsideUsed, downsideUsed, upsideMax: effectiveUpsideMax, downsideMax };
}
