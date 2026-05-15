// Universal stat allocation + derivation system shared by server and client.
// The engine provides the derivation function; the game layer injects which stat
// buckets and derived effects exist for each archetype kind at startup.

export interface StatAllocationDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly appliesTo: readonly string[];
}

export interface DerivedEffectDefinition {
  readonly id: string;
  readonly label: string;
  readonly sourceStat: string;
  readonly baseValue: number;
  readonly perPoint: number;
  readonly appliesTo: readonly string[];
}

let STAT_ALLOCATION_DEFINITIONS: readonly StatAllocationDefinition[] = Object.freeze([]);
let DERIVED_EFFECT_DEFINITIONS: readonly DerivedEffectDefinition[] = Object.freeze([]);

export function injectStatDefinitions(defs: readonly StatAllocationDefinition[]): void {
  STAT_ALLOCATION_DEFINITIONS = Object.freeze([...defs]);
}

export function injectDerivedEffectDefinitions(defs: readonly DerivedEffectDefinition[]): void {
  DERIVED_EFFECT_DEFINITIONS = Object.freeze([...defs]);
}

export function getStatAllocationDefinitions(): readonly StatAllocationDefinition[] {
  return STAT_ALLOCATION_DEFINITIONS;
}

export function getDerivedEffectDefinitions(): readonly DerivedEffectDefinition[] {
  return DERIVED_EFFECT_DEFINITIONS;
}

export function getStatDefinitionsForKind(kind: string): readonly StatAllocationDefinition[] {
  return STAT_ALLOCATION_DEFINITIONS.filter((s) => s.appliesTo.includes(kind));
}

export function getDerivedEffectsForKind(kind: string): readonly DerivedEffectDefinition[] {
  return DERIVED_EFFECT_DEFINITIONS.filter((e) => e.appliesTo.includes(kind));
}

export type AllocationStatId = string;
export type AllocatedStats = Record<string, number>;
export type DerivedStatId = string;
export type DerivedStats = Record<string, number>;

export interface StatModifier {
  readonly stat: string;
  readonly additive?: number;
  readonly multiplier?: number;
}

export function createEmptyAllocations(kind: string): AllocatedStats {
  const allocations: AllocatedStats = {};
  for (const def of STAT_ALLOCATION_DEFINITIONS) {
    if (def.appliesTo.includes(kind)) {
      allocations[def.id] = 0;
    }
  }
  return allocations;
}

export function totalAllocatedPoints(allocations: AllocatedStats): number {
  return Object.values(allocations).reduce((sum, value) => sum + value, 0);
}

export function deriveStats(
  kind: string,
  baseStats: Record<string, number>,
  allocations: AllocatedStats,
  modifiers: readonly StatModifier[]
): DerivedStats {
  const derived: Record<string, number> = {};

  for (const [key, value] of Object.entries(baseStats)) {
    derived[key] = value;
  }

  for (const effect of DERIVED_EFFECT_DEFINITIONS) {
    if (!effect.appliesTo.includes(kind)) continue;
    const points = allocations[effect.sourceStat] ?? 0;
    derived[effect.id] = effect.baseValue + points * effect.perPoint;
  }

  for (const modifier of modifiers) {
    const base = derived[modifier.stat];
    if (base === undefined) continue;
    let result = base;
    if (modifier.additive !== undefined) result += modifier.additive;
    if (modifier.multiplier !== undefined) result *= modifier.multiplier;
    derived[modifier.stat] = result;
  }

  return derived as DerivedStats;
}
