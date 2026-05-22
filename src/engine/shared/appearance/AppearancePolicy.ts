/**
 * Purpose: This file defines canonical appearance policies shared across authoritative simulation and presentation layers.
 * Scope: It belongs to the engine shared layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import type { EquipmentSlot } from "../items";

export type NpcBehaviorState = "idle" | "patrol" | "wander" | "chase" | "attack" | "flee";
export const DEFAULT_TINT_COLOR_RGB = 0xffffff;
export const DEFAULT_UNIFORM_SCALE_PCT = 100;
export const DEFAULT_MATERIAL_VARIANT_ID = 0;

export type EntityAppearancePatch = Partial<{
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
}>;

const NPC_BEHAVIOR_TINT_COLOR_BY_STATE: Readonly<Record<NpcBehaviorState, number>> = Object.freeze({
  idle: 0x52c96b,
  patrol: 0x52c96b,
  wander: 0x52c96b,
  chase: 0xd9463e,
  attack: 0xd9463e,
  flee: 0xf2d34f
});

export function getNpcBehaviorTintColorRgb(behaviorState: NpcBehaviorState): number {
  return NPC_BEHAVIOR_TINT_COLOR_BY_STATE[behaviorState] ?? DEFAULT_TINT_COLOR_RGB;
}

export function sanitizeTintColorRgb(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TINT_COLOR_RGB;
  }
  return Math.max(0, Math.min(0xffffff, Math.floor(value)));
}

export function sanitizeRenderArchetypeId(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(0xffff, Math.floor(value)));
}

export function sanitizeMaterialVariantId(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MATERIAL_VARIANT_ID;
  }
  return Math.max(0, Math.min(0xffff, Math.floor(value)));
}

export function sanitizeUniformScalePct(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_UNIFORM_SCALE_PCT;
  }
  return Math.max(1, Math.min(1000, Math.floor(value)));
}

export function getDefaultEquippedTintPatch(): {
  equippedWeaponTintColorRgb: number;
  equippedHeadTintColorRgb: number;
  equippedBodyTintColorRgb: number;
  equippedLegsTintColorRgb: number;
  equippedAccessoryTintColorRgb: number;
} {
  return {
    equippedWeaponTintColorRgb: DEFAULT_TINT_COLOR_RGB,
    equippedHeadTintColorRgb: DEFAULT_TINT_COLOR_RGB,
    equippedBodyTintColorRgb: DEFAULT_TINT_COLOR_RGB,
    equippedLegsTintColorRgb: DEFAULT_TINT_COLOR_RGB,
    equippedAccessoryTintColorRgb: DEFAULT_TINT_COLOR_RGB
  };
}

export function getEquippedSlotTintPatch(slot: EquipmentSlot, tintColorRgb: number): Partial<{
  equippedWeaponTintColorRgb: number;
  equippedHeadTintColorRgb: number;
  equippedBodyTintColorRgb: number;
  equippedLegsTintColorRgb: number;
  equippedAccessoryTintColorRgb: number;
}> {
  const tint = sanitizeTintColorRgb(tintColorRgb);
  if (slot === "weapon") return { equippedWeaponTintColorRgb: tint };
  if (slot === "head") return { equippedHeadTintColorRgb: tint };
  if (slot === "body") return { equippedBodyTintColorRgb: tint };
  if (slot === "legs") return { equippedLegsTintColorRgb: tint };
  return { equippedAccessoryTintColorRgb: tint };
}
