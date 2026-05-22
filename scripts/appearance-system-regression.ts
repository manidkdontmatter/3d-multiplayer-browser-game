/**
 * Purpose: This file runs regression checks to catch behavior drift early.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import assert from "node:assert/strict";
import { AppearanceSystem } from "../src/engine/server/appearance/AppearanceSystem";
import type { SimulationEcs } from "../src/engine/server/ecs/SimulationEcs";
import type { EntityAppearancePatch } from "../src/engine/shared/appearance/AppearancePolicy";

type MutableAppearanceState = {
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
};

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

function getAppearanceState(ecs: FakeSimulationEcs, eid: number): MutableAppearanceState {
  const c = ecs.world.components;
  return {
    renderArchetypeId: c.RenderArchetypeId.value[eid] ?? 0,
    materialVariantId: c.MaterialVariantId.value[eid] ?? 0,
    tintColorRgb: c.TintColorRgb.value[eid] ?? 0,
    uniformScalePct: c.UniformScalePct.value[eid] ?? 0,
    equippedWeaponArchetypeId: c.EquippedWeaponArchetypeId.value[eid] ?? 0,
    equippedWeaponTintColorRgb: c.EquippedWeaponTintColorRgb.value[eid] ?? 0,
    equippedHeadArchetypeId: c.EquippedHeadArchetypeId.value[eid] ?? 0,
    equippedHeadTintColorRgb: c.EquippedHeadTintColorRgb.value[eid] ?? 0,
    equippedBodyArchetypeId: c.EquippedBodyArchetypeId.value[eid] ?? 0,
    equippedBodyTintColorRgb: c.EquippedBodyTintColorRgb.value[eid] ?? 0,
    equippedLegsArchetypeId: c.EquippedLegsArchetypeId.value[eid] ?? 0,
    equippedLegsTintColorRgb: c.EquippedLegsTintColorRgb.value[eid] ?? 0,
    equippedAccessoryArchetypeId: c.EquippedAccessoryArchetypeId.value[eid] ?? 0,
    equippedAccessoryTintColorRgb: c.EquippedAccessoryTintColorRgb.value[eid] ?? 0
  };
}

const ecs = new FakeSimulationEcs();
const eid = 4;
ecs.world.components.ModelId.value[eid] = 77;
ecs.world.components.RenderArchetypeId.value[eid] = 77;
ecs.world.components.MaterialVariantId.value[eid] = 0;
ecs.world.components.TintColorRgb.value[eid] = 0xffffff;
ecs.world.components.UniformScalePct.value[eid] = 100;

let syncCount = 0;
const system = new AppearanceSystem(
  ecs as unknown as SimulationEcs,
  () => {
    syncCount += 1;
  }
);

const changedA = system.applyAppearancePatch(eid, "equipment_profile", {
  equippedWeaponArchetypeId: 900,
  equippedWeaponTintColorRgb: 0x112233
});
assert.equal(changedA, true, "equipment profile patch should change appearance");
let state = getAppearanceState(ecs, eid);
assert.equal(state.equippedWeaponArchetypeId, 900, "equipment profile should set weapon archetype");
assert.equal(state.equippedWeaponTintColorRgb, 0x112233, "equipment profile should set weapon tint");

const changedB = system.applyAppearancePatch(eid, "equipment_slot_tint_weapon", {
  equippedWeaponTintColorRgb: 0xffaa00
});
assert.equal(changedB, true, "slot tint patch should override equipment profile tint");
state = getAppearanceState(ecs, eid);
assert.equal(state.equippedWeaponTintColorRgb, 0xffaa00, "slot tint should win over equipment profile");

const changedC = system.applyAppearancePatch(eid, "runtime_effect", {
  equippedWeaponTintColorRgb: 0x445566,
  materialVariantId: 7,
  uniformScalePct: 125
});
assert.equal(changedC, true, "runtime effect patch should override lower priorities");
state = getAppearanceState(ecs, eid);
assert.equal(state.equippedWeaponTintColorRgb, 0x445566, "runtime effect should win over slot tint");
assert.equal(state.materialVariantId, 7, "runtime effect should set material variant");
assert.equal(state.uniformScalePct, 125, "runtime effect should set scale");

const changedD = system.clearAppearanceIntent(eid, "runtime_effect");
assert.equal(changedD, true, "clearing runtime effect should recompute appearance");
state = getAppearanceState(ecs, eid);
assert.equal(state.equippedWeaponTintColorRgb, 0xffaa00, "slot tint should become visible after runtime clear");
assert.equal(state.materialVariantId, 0, "material variant should return to baseline after runtime clear");
assert.equal(state.uniformScalePct, 100, "scale should return to baseline after runtime clear");

const changedE = system.clearAppearanceIntentSources(eid, [
  "equipment_slot_tint_weapon",
  "equipment_slot_tint_head"
]);
assert.equal(changedE, true, "clearing slot tint sources should recompute appearance");
state = getAppearanceState(ecs, eid);
assert.equal(state.equippedWeaponTintColorRgb, 0x112233, "equipment profile tint should return after slot clear");

const changedF = system.clearAllAppearanceIntents(eid);
assert.equal(changedF, true, "clearing all intents should reset to baseline");
state = getAppearanceState(ecs, eid);
assert.equal(state.equippedWeaponArchetypeId, 0, "baseline weapon archetype should be restored");
assert.equal(state.equippedWeaponTintColorRgb, 0xffffff, "baseline weapon tint should be restored");

assert.ok(syncCount >= 6, "appearance mutations should trigger replication sync callback");

console.log("appearance-system-regression passed");
