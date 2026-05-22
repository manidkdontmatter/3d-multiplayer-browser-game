/**
 * Purpose: This file composes authoritative entity appearance from prioritized intents.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type { SimulationEcs } from "../ecs/SimulationEcs";
import type { WorldWithComponents } from "../ecs/SimulationEcsTypes";
import type { EntityAppearancePatch } from "../../shared/appearance/AppearancePolicy";
import {
  DEFAULT_MATERIAL_VARIANT_ID,
  DEFAULT_TINT_COLOR_RGB,
  DEFAULT_UNIFORM_SCALE_PCT,
  sanitizeMaterialVariantId,
  sanitizeRenderArchetypeId,
  sanitizeTintColorRgb,
  sanitizeUniformScalePct
} from "../../shared/appearance/AppearancePolicy";

export type AppearanceIntentSource =
  | "runtime_effect"
  | "equipment_profile"
  | "equipment_slot_tint_weapon"
  | "equipment_slot_tint_head"
  | "equipment_slot_tint_body"
  | "equipment_slot_tint_legs"
  | "equipment_slot_tint_accessory"
  | "npc_behavior";

interface AppearanceIntent {
  readonly source: AppearanceIntentSource;
  readonly priority: number;
  readonly patch: EntityAppearancePatch;
}

interface ResolvedAppearanceState {
  renderArchetypeId: number;
  materialVariantId: number;
  tintColorRgb: number;
  uniformScalePct: number;
  equippedWeaponArchetypeId: number;
  equippedWeaponTintColorRgb: number;
  equippedHeadArchetypeId: number;
  equippedHeadTintColorRgb: number;
  equippedBodyArchetypeId: number;
  equippedBodyTintColorRgb: number;
  equippedLegsArchetypeId: number;
  equippedLegsTintColorRgb: number;
  equippedAccessoryArchetypeId: number;
  equippedAccessoryTintColorRgb: number;
}

const APPEARANCE_INTENT_PRIORITY: Readonly<Record<AppearanceIntentSource, number>> = Object.freeze({
  equipment_profile: 10,
  equipment_slot_tint_weapon: 20,
  equipment_slot_tint_head: 20,
  equipment_slot_tint_body: 20,
  equipment_slot_tint_legs: 20,
  equipment_slot_tint_accessory: 20,
  npc_behavior: 30,
  runtime_effect: 40
});

export class AppearanceSystem {
  private readonly components: WorldWithComponents["components"];
  private readonly intentByEid = new Map<number, Map<AppearanceIntentSource, AppearanceIntent>>();
  private readonly baselineByEid = new Map<number, ResolvedAppearanceState>();

  public constructor(
    private readonly ecs: SimulationEcs,
    private readonly syncEntityFromEcs: (eid: number) => void
  ) {
    this.components = this.ecs.world.components;
  }

  public applyAppearancePatch(
    eid: number,
    source: AppearanceIntentSource,
    patch: EntityAppearancePatch
  ): boolean {
    const intents = this.getOrCreateIntentMap(eid);
    intents.set(source, {
      source,
      priority: APPEARANCE_INTENT_PRIORITY[source],
      patch
    });
    return this.composeAndApply(eid);
  }

  public clearAppearanceIntent(eid: number, source: AppearanceIntentSource): boolean {
    const intents = this.intentByEid.get(eid);
    if (!intents || !intents.has(source)) {
      return false;
    }
    intents.delete(source);
    if (intents.size <= 0) {
      this.intentByEid.delete(eid);
    }
    return this.composeAndApply(eid);
  }

  public clearAppearanceIntentSources(eid: number, sources: readonly AppearanceIntentSource[]): boolean {
    const intents = this.intentByEid.get(eid);
    if (!intents || intents.size <= 0 || sources.length <= 0) {
      return false;
    }
    let changed = false;
    for (const source of sources) {
      if (intents.delete(source)) {
        changed = true;
      }
    }
    if (!changed) {
      return false;
    }
    if (intents.size <= 0) {
      this.intentByEid.delete(eid);
    }
    return this.composeAndApply(eid);
  }

  public clearAllAppearanceIntents(eid: number): boolean {
    if (!this.intentByEid.has(eid)) {
      return false;
    }
    this.intentByEid.delete(eid);
    return this.composeAndApply(eid);
  }

  private composeAndApply(eid: number): boolean {
    const composed = this.composeAppearanceState(eid);
    const changed = this.ecs.setEntityRenderAppearanceByEid(eid, composed);
    if (changed) {
      this.syncEntityFromEcs(eid);
    }
    return changed;
  }

  private composeAppearanceState(eid: number): ResolvedAppearanceState {
    const base = this.getOrCreateBaseline(eid);
    const composed: ResolvedAppearanceState = { ...base };
    const intents = this.intentByEid.get(eid);
    if (!intents || intents.size <= 0) {
      return composed;
    }
    const ordered = [...intents.values()].sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.source.localeCompare(right.source);
    });
    for (const intent of ordered) {
      this.applyPatchToResolvedState(composed, intent.patch);
    }
    return composed;
  }

  private getOrCreateIntentMap(eid: number): Map<AppearanceIntentSource, AppearanceIntent> {
    let intents = this.intentByEid.get(eid);
    if (!intents) {
      intents = new Map<AppearanceIntentSource, AppearanceIntent>();
      this.intentByEid.set(eid, intents);
    }
    return intents;
  }

  private getOrCreateBaseline(eid: number): ResolvedAppearanceState {
    const existing = this.baselineByEid.get(eid);
    if (existing) {
      return existing;
    }
    const c = this.components;
    const created: ResolvedAppearanceState = {
      renderArchetypeId: sanitizeRenderArchetypeId(c.RenderArchetypeId.value[eid] ?? (c.ModelId.value[eid] ?? 0)),
      materialVariantId: sanitizeMaterialVariantId(c.MaterialVariantId.value[eid] ?? DEFAULT_MATERIAL_VARIANT_ID),
      tintColorRgb: sanitizeTintColorRgb(c.TintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB),
      uniformScalePct: sanitizeUniformScalePct(c.UniformScalePct.value[eid] ?? DEFAULT_UNIFORM_SCALE_PCT),
      equippedWeaponArchetypeId: sanitizeRenderArchetypeId(c.EquippedWeaponArchetypeId.value[eid] ?? 0),
      equippedWeaponTintColorRgb: sanitizeTintColorRgb(c.EquippedWeaponTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB),
      equippedHeadArchetypeId: sanitizeRenderArchetypeId(c.EquippedHeadArchetypeId.value[eid] ?? 0),
      equippedHeadTintColorRgb: sanitizeTintColorRgb(c.EquippedHeadTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB),
      equippedBodyArchetypeId: sanitizeRenderArchetypeId(c.EquippedBodyArchetypeId.value[eid] ?? 0),
      equippedBodyTintColorRgb: sanitizeTintColorRgb(c.EquippedBodyTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB),
      equippedLegsArchetypeId: sanitizeRenderArchetypeId(c.EquippedLegsArchetypeId.value[eid] ?? 0),
      equippedLegsTintColorRgb: sanitizeTintColorRgb(c.EquippedLegsTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB),
      equippedAccessoryArchetypeId: sanitizeRenderArchetypeId(c.EquippedAccessoryArchetypeId.value[eid] ?? 0),
      equippedAccessoryTintColorRgb: sanitizeTintColorRgb(c.EquippedAccessoryTintColorRgb.value[eid] ?? DEFAULT_TINT_COLOR_RGB)
    };
    this.baselineByEid.set(eid, created);
    return created;
  }

  private applyPatchToResolvedState(target: ResolvedAppearanceState, patch: EntityAppearancePatch): void {
    if (typeof patch.renderArchetypeId === "number" && Number.isFinite(patch.renderArchetypeId)) {
      target.renderArchetypeId = sanitizeRenderArchetypeId(patch.renderArchetypeId);
    }
    if (typeof patch.materialVariantId === "number" && Number.isFinite(patch.materialVariantId)) {
      target.materialVariantId = sanitizeMaterialVariantId(patch.materialVariantId);
    }
    if (typeof patch.tintColorRgb === "number" && Number.isFinite(patch.tintColorRgb)) {
      target.tintColorRgb = sanitizeTintColorRgb(patch.tintColorRgb);
    }
    if (typeof patch.uniformScalePct === "number" && Number.isFinite(patch.uniformScalePct)) {
      target.uniformScalePct = sanitizeUniformScalePct(patch.uniformScalePct);
    }
    if (typeof patch.equippedWeaponArchetypeId === "number" && Number.isFinite(patch.equippedWeaponArchetypeId)) {
      target.equippedWeaponArchetypeId = sanitizeRenderArchetypeId(patch.equippedWeaponArchetypeId);
    }
    if (typeof patch.equippedWeaponTintColorRgb === "number" && Number.isFinite(patch.equippedWeaponTintColorRgb)) {
      target.equippedWeaponTintColorRgb = sanitizeTintColorRgb(patch.equippedWeaponTintColorRgb);
    }
    if (typeof patch.equippedHeadArchetypeId === "number" && Number.isFinite(patch.equippedHeadArchetypeId)) {
      target.equippedHeadArchetypeId = sanitizeRenderArchetypeId(patch.equippedHeadArchetypeId);
    }
    if (typeof patch.equippedHeadTintColorRgb === "number" && Number.isFinite(patch.equippedHeadTintColorRgb)) {
      target.equippedHeadTintColorRgb = sanitizeTintColorRgb(patch.equippedHeadTintColorRgb);
    }
    if (typeof patch.equippedBodyArchetypeId === "number" && Number.isFinite(patch.equippedBodyArchetypeId)) {
      target.equippedBodyArchetypeId = sanitizeRenderArchetypeId(patch.equippedBodyArchetypeId);
    }
    if (typeof patch.equippedBodyTintColorRgb === "number" && Number.isFinite(patch.equippedBodyTintColorRgb)) {
      target.equippedBodyTintColorRgb = sanitizeTintColorRgb(patch.equippedBodyTintColorRgb);
    }
    if (typeof patch.equippedLegsArchetypeId === "number" && Number.isFinite(patch.equippedLegsArchetypeId)) {
      target.equippedLegsArchetypeId = sanitizeRenderArchetypeId(patch.equippedLegsArchetypeId);
    }
    if (typeof patch.equippedLegsTintColorRgb === "number" && Number.isFinite(patch.equippedLegsTintColorRgb)) {
      target.equippedLegsTintColorRgb = sanitizeTintColorRgb(patch.equippedLegsTintColorRgb);
    }
    if (typeof patch.equippedAccessoryArchetypeId === "number" && Number.isFinite(patch.equippedAccessoryArchetypeId)) {
      target.equippedAccessoryArchetypeId = sanitizeRenderArchetypeId(patch.equippedAccessoryArchetypeId);
    }
    if (typeof patch.equippedAccessoryTintColorRgb === "number" && Number.isFinite(patch.equippedAccessoryTintColorRgb)) {
      target.equippedAccessoryTintColorRgb = sanitizeTintColorRgb(patch.equippedAccessoryTintColorRgb);
    }
  }
}
