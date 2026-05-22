/**
 * Purpose: This file runs regression checks to catch behavior drift early.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import assert from "node:assert/strict";
import { AppearanceSystem } from "../src/engine/server/appearance/AppearanceSystem";
import type { SimulationEcs } from "../src/engine/server/ecs/SimulationEcs";
import type { EntityAppearancePatch } from "../src/engine/shared/appearance/AppearancePolicy";

class FakeSimulationEcs {
  public readonly world = {
    components: {
      ModelId: { value: [] as number[] },
      RenderArchetypeId: { value: [] as number[] },
      MaterialVariantId: { value: [] as number[] },
      TintColorRgb: { value: [] as number[] },
      UniformScalePct: { value: [] as number[] },
      EquippedWeaponArchetypeId: { value: [] as number[] },
      EquippedWeaponTintColorRgb: { value: [] as number[] },
      EquippedHeadArchetypeId: { value: [] as number[] },
      EquippedHeadTintColorRgb: { value: [] as number[] },
      EquippedBodyArchetypeId: { value: [] as number[] },
      EquippedBodyTintColorRgb: { value: [] as number[] },
      EquippedLegsArchetypeId: { value: [] as number[] },
      EquippedLegsTintColorRgb: { value: [] as number[] },
      EquippedAccessoryArchetypeId: { value: [] as number[] },
      EquippedAccessoryTintColorRgb: { value: [] as number[] }
    }
  };

  public setEntityRenderAppearanceByEid(eid: number, patch: EntityAppearancePatch): boolean {
    const c = this.world.components;
    let changed = false;
    changed = this.apply(c.RenderArchetypeId.value, eid, patch.renderArchetypeId) || changed;
    changed = this.apply(c.MaterialVariantId.value, eid, patch.materialVariantId) || changed;
    changed = this.apply(c.TintColorRgb.value, eid, patch.tintColorRgb) || changed;
    changed = this.apply(c.UniformScalePct.value, eid, patch.uniformScalePct) || changed;
    changed = this.apply(c.EquippedWeaponArchetypeId.value, eid, patch.equippedWeaponArchetypeId) || changed;
    changed = this.apply(c.EquippedWeaponTintColorRgb.value, eid, patch.equippedWeaponTintColorRgb) || changed;
    changed = this.apply(c.EquippedHeadArchetypeId.value, eid, patch.equippedHeadArchetypeId) || changed;
    changed = this.apply(c.EquippedHeadTintColorRgb.value, eid, patch.equippedHeadTintColorRgb) || changed;
    changed = this.apply(c.EquippedBodyArchetypeId.value, eid, patch.equippedBodyArchetypeId) || changed;
    changed = this.apply(c.EquippedBodyTintColorRgb.value, eid, patch.equippedBodyTintColorRgb) || changed;
    changed = this.apply(c.EquippedLegsArchetypeId.value, eid, patch.equippedLegsArchetypeId) || changed;
    changed = this.apply(c.EquippedLegsTintColorRgb.value, eid, patch.equippedLegsTintColorRgb) || changed;
    changed = this.apply(c.EquippedAccessoryArchetypeId.value, eid, patch.equippedAccessoryArchetypeId) || changed;
    changed = this.apply(c.EquippedAccessoryTintColorRgb.value, eid, patch.equippedAccessoryTintColorRgb) || changed;
    return changed;
  }

  private apply(values: number[], eid: number, next: number | undefined): boolean {
    if (typeof next !== "number") {
      return false;
    }
    const prev = values[eid] ?? 0;
    values[eid] = next;
    return prev !== next;
  }
}

const ecs = new FakeSimulationEcs();
const eid = 5;
ecs.world.components.ModelId.value[eid] = 99;
ecs.world.components.RenderArchetypeId.value[eid] = 99;
ecs.world.components.MaterialVariantId.value[eid] = 0;
ecs.world.components.TintColorRgb.value[eid] = 0xffffff;
ecs.world.components.UniformScalePct.value[eid] = 100;

const system = new AppearanceSystem(
  ecs as unknown as SimulationEcs,
  () => {}
);

// Same-priority slot tint sources should compose independently and deterministically.
system.applyAppearancePatch(eid, "equipment_slot_tint_weapon", { equippedWeaponTintColorRgb: 0xaa0000 });
system.applyAppearancePatch(eid, "equipment_slot_tint_head", { equippedHeadTintColorRgb: 0x00aa00 });
system.applyAppearancePatch(eid, "equipment_slot_tint_body", { equippedBodyTintColorRgb: 0x0000aa });

const c = ecs.world.components;
assert.equal(c.EquippedWeaponTintColorRgb.value[eid], 0xaa0000, "weapon slot tint should remain scoped to weapon");
assert.equal(c.EquippedHeadTintColorRgb.value[eid], 0x00aa00, "head slot tint should remain scoped to head");
assert.equal(c.EquippedBodyTintColorRgb.value[eid], 0x0000aa, "body slot tint should remain scoped to body");

// Higher-priority runtime effect should override selected fields only.
system.applyAppearancePatch(eid, "runtime_effect", {
  equippedHeadTintColorRgb: 0x777777,
  uniformScalePct: 140
});
assert.equal(c.EquippedHeadTintColorRgb.value[eid], 0x777777, "runtime effect should override head tint");
assert.equal(c.UniformScalePct.value[eid], 140, "runtime effect should override scale");
assert.equal(c.EquippedWeaponTintColorRgb.value[eid], 0xaa0000, "runtime effect should not overwrite unrelated weapon tint");

// Clearing runtime should restore slot-composed values deterministically.
system.clearAppearanceIntent(eid, "runtime_effect");
assert.equal(c.EquippedHeadTintColorRgb.value[eid], 0x00aa00, "clearing runtime should restore prior head slot tint");
assert.equal(c.UniformScalePct.value[eid], 100, "clearing runtime should restore baseline scale");

// Clearing specific slot sources should only affect those slots.
system.clearAppearanceIntentSources(eid, ["equipment_slot_tint_head", "equipment_slot_tint_body"]);
assert.equal(c.EquippedHeadTintColorRgb.value[eid], 0xffffff, "clearing head slot source should restore head baseline tint");
assert.equal(c.EquippedBodyTintColorRgb.value[eid], 0xffffff, "clearing body slot source should restore body baseline tint");
assert.equal(c.EquippedWeaponTintColorRgb.value[eid], 0xaa0000, "weapon tint should remain from its slot source");

console.log("appearance-system-determinism-regression passed");
