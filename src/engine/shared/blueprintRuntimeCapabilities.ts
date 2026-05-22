/**
 * Purpose: This file defines canonical runtime capability projections keyed by blueprint id.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import type { AbilityDefinition } from "./abilities";
import type { MeleeAbilityProfile, ProjectileAbilityProfile } from "./abilities";
import type { ItemDefinition } from "./items";
import type { PlatformDefinition } from "./platforms";

export type RuntimeActivationEffectSpec =
  | { type: "restore_health"; amount: number }
  | {
      type: "set_player_render_appearance";
      renderArchetypeId?: number;
      materialVariantId?: number;
      tintColorRgb?: number;
      uniformScalePct?: number;
    }
  | { type: "set_equipped_slot_tint"; slot: "weapon" | "head" | "body" | "legs" | "accessory"; tintColorRgb: number }
  | { type: "spawn_projectile"; projectile: ProjectileAbilityProfile }
  | { type: "apply_melee_hit"; melee: MeleeAbilityProfile };

export interface RuntimeActivationSpec {
  readonly activationId: string;
  readonly source: "ability" | "item";
  readonly channel: number;
  readonly cooldownSeconds: number;
  readonly consumeQuantity: number;
  readonly effects: readonly RuntimeActivationEffectSpec[];
}

export interface BlueprintRuntimeCapabilityEntry {
  readonly blueprintId: number;
  readonly ability: AbilityDefinition | null;
  readonly item: ItemDefinition | null;
  readonly platform: PlatformDefinition | null;
  readonly activations: readonly RuntimeActivationSpec[];
}

let BLUEPRINT_RUNTIME_CAPABILITIES: readonly BlueprintRuntimeCapabilityEntry[] = Object.freeze([]);
const BLUEPRINT_RUNTIME_CAPABILITIES_BY_ID = new Map<number, BlueprintRuntimeCapabilityEntry>();

export function injectBlueprintRuntimeCapabilities(
  entries: readonly BlueprintRuntimeCapabilityEntry[]
): void {
  BLUEPRINT_RUNTIME_CAPABILITIES = Object.freeze([...entries]);
  BLUEPRINT_RUNTIME_CAPABILITIES_BY_ID.clear();
  for (const entry of entries) {
    BLUEPRINT_RUNTIME_CAPABILITIES_BY_ID.set(entry.blueprintId, entry);
  }
}

export function getAllBlueprintRuntimeCapabilities(): readonly BlueprintRuntimeCapabilityEntry[] {
  return BLUEPRINT_RUNTIME_CAPABILITIES;
}

export function getBlueprintRuntimeCapabilityEntryByBlueprintId(
  blueprintId: number
): BlueprintRuntimeCapabilityEntry | null {
  if (!Number.isFinite(blueprintId)) {
    return null;
  }
  return BLUEPRINT_RUNTIME_CAPABILITIES_BY_ID.get(Math.max(0, Math.floor(blueprintId))) ?? null;
}

export function getBlueprintRuntimeAbilityByBlueprintId(blueprintId: number): AbilityDefinition | null {
  return getBlueprintRuntimeCapabilityEntryByBlueprintId(blueprintId)?.ability ?? null;
}

export function getBlueprintRuntimeItemByBlueprintId(blueprintId: number): ItemDefinition | null {
  return getBlueprintRuntimeCapabilityEntryByBlueprintId(blueprintId)?.item ?? null;
}

export function getBlueprintRuntimePlatformByBlueprintId(blueprintId: number): PlatformDefinition | null {
  return getBlueprintRuntimeCapabilityEntryByBlueprintId(blueprintId)?.platform ?? null;
}

export function getBlueprintRuntimeActivationSpecsByBlueprintId(
  blueprintId: number
): readonly RuntimeActivationSpec[] {
  return getBlueprintRuntimeCapabilityEntryByBlueprintId(blueprintId)?.activations ?? [];
}

export function upsertBlueprintRuntimeCapabilityEntry(
  entry: BlueprintRuntimeCapabilityEntry
): void {
  BLUEPRINT_RUNTIME_CAPABILITIES_BY_ID.set(entry.blueprintId, entry);
  BLUEPRINT_RUNTIME_CAPABILITIES = Object.freeze(
    Array.from(BLUEPRINT_RUNTIME_CAPABILITIES_BY_ID.values()).sort((a, b) => a.blueprintId - b.blueprintId)
  );
}
