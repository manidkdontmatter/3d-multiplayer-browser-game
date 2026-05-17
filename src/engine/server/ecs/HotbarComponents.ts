// Data-oriented helpers for fixed-width hotbar component slot access.
import { HOTBAR_SLOT_COUNT, clampHotbarSlotIndex } from "../../shared/index";
import type { WorldWithComponents } from "./SimulationEcsTypes";

export function normalizeHotbarAbilityId(abilityId: number): number {
  return Math.max(0, Math.floor(Number.isFinite(abilityId) ? abilityId : 0));
}

export function getHotbarSlot(
  components: WorldWithComponents["components"],
  eid: number,
  slot: number
): number {
  const normalizedSlot = clampHotbarSlotIndex(slot);
  const h = components.Hotbar;
  switch (normalizedSlot) {
    case 0: return h.slot0[eid] ?? 0;
    case 1: return h.slot1[eid] ?? 0;
    case 2: return h.slot2[eid] ?? 0;
    case 3: return h.slot3[eid] ?? 0;
    case 4: return h.slot4[eid] ?? 0;
    case 5: return h.slot5[eid] ?? 0;
    case 6: return h.slot6[eid] ?? 0;
    case 7: return h.slot7[eid] ?? 0;
    case 8: return h.slot8[eid] ?? 0;
    default: return h.slot9[eid] ?? 0;
  }
}

export function setHotbarSlot(
  components: WorldWithComponents["components"],
  eid: number,
  slot: number,
  abilityId: number
): boolean {
  const normalizedAbilityId = normalizeHotbarAbilityId(abilityId);
  const normalizedSlot = clampHotbarSlotIndex(slot);
  const h = components.Hotbar;
  let previous: number;
  switch (normalizedSlot) {
    case 0: previous = h.slot0[eid] ?? 0; h.slot0[eid] = normalizedAbilityId; break;
    case 1: previous = h.slot1[eid] ?? 0; h.slot1[eid] = normalizedAbilityId; break;
    case 2: previous = h.slot2[eid] ?? 0; h.slot2[eid] = normalizedAbilityId; break;
    case 3: previous = h.slot3[eid] ?? 0; h.slot3[eid] = normalizedAbilityId; break;
    case 4: previous = h.slot4[eid] ?? 0; h.slot4[eid] = normalizedAbilityId; break;
    case 5: previous = h.slot5[eid] ?? 0; h.slot5[eid] = normalizedAbilityId; break;
    case 6: previous = h.slot6[eid] ?? 0; h.slot6[eid] = normalizedAbilityId; break;
    case 7: previous = h.slot7[eid] ?? 0; h.slot7[eid] = normalizedAbilityId; break;
    case 8: previous = h.slot8[eid] ?? 0; h.slot8[eid] = normalizedAbilityId; break;
    default: previous = h.slot9[eid] ?? 0; h.slot9[eid] = normalizedAbilityId; break;
  }
  return previous !== normalizedAbilityId;
}

export function getHotbarArray(components: WorldWithComponents["components"], eid: number): number[] {
  const hotbar = new Array<number>(HOTBAR_SLOT_COUNT);
  for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
    hotbar[slot] = getHotbarSlot(components, eid, slot);
  }
  return hotbar;
}

export function setHotbarArray(
  components: WorldWithComponents["components"],
  eid: number,
  hotbarAbilityIds: ReadonlyArray<number>
): void {
  for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
    setHotbarSlot(components, eid, slot, hotbarAbilityIds[slot] ?? 0);
  }
}
