/**
 * Purpose: This file defines the canonical server-side action/effect pipeline.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and executes validated actions into deterministic effects.
 */
import type { EquipmentSlot } from "../../../shared/items";
export interface ActionEffectAuditRecord {
  readonly type: ActionEffect["type"];
  readonly success: boolean;
}

export type ActionEffect =
  | { type: "broadcast_ability_use"; ownerNid: number; abilityId: number; x: number; y: number; z: number }
  | {
      type: "spawn_projectile";
      ownerNid: number;
      kind: number;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      radius: number;
      damage: number;
      lifetimeSeconds: number;
      maxRange: number;
      gravity: number;
      drag: number;
      maxSpeed: number;
      minSpeed: number;
      pierceCount: number;
      despawnOnDamageableHit: boolean;
      despawnOnWorldHit: boolean;
    }
  | { type: "apply_melee_hit"; attackerEid: number; damage: number; range: number; radius: number; arcDegrees: number }
  | { type: "restore_health"; userId: number; amount: number }
  | { type: "equip_item_instance"; userId: number; itemInstanceId: number }
  | { type: "unequip_slot"; userId: number; slot: EquipmentSlot }
  | { type: "consume_item_quantity"; userId: number; itemInstanceId: number; amount: number }
  | { type: "pickup_world_item"; userId: number; pickupNid: number }
  | { type: "drop_item_instance"; userId: number; itemInstanceId: number; quantity: number }
  | { type: "assign_hotbar_slot"; userId: number; itemInstanceId: number; targetSlot: number; payloadKind: number }
  | { type: "clear_hotbar_slot"; userId: number; sourceSlot: number }
  | { type: "move_hotbar_slot"; userId: number; sourceSlot: number; targetSlot: number }
  | { type: "drop_hotbar_slot"; userId: number; sourceSlot: number }
  | {
      type: "set_player_render_appearance";
      userId: number;
      patch: Partial<{ renderArchetypeId: number; materialVariantId: number; tintColorRgb: number; uniformScalePct: number }>;
    }
  | { type: "set_equipped_slot_tint"; userId: number; slot: EquipmentSlot; tintColorRgb: number }
  | { type: "pilot_reference_frame_begin"; userId: number; framePid: number; volumeId: string }
  | { type: "pilot_reference_frame_end"; userId: number; framePid: number }
  | { type: "reference_frame_volume_entered"; userId: number; framePid: number; volumeId: string }
  | { type: "reference_frame_volume_exited"; userId: number; framePid: number; volumeId: string };

export interface ActionEffectPipelineOptions {
  readonly broadcastAbilityUse: (ownerNid: number, abilityId: number, x: number, y: number, z: number) => void;
  readonly spawnProjectile: (request: Extract<ActionEffect, { type: "spawn_projectile" }>) => void;
  readonly applyMeleeHit: (request: Extract<ActionEffect, { type: "apply_melee_hit" }>) => void;
  readonly restoreHealth: (userId: number, amount: number) => boolean;
  readonly equipItemInstance: (userId: number, itemInstanceId: number) => boolean;
  readonly unequipSlot: (userId: number, slot: EquipmentSlot) => boolean;
  readonly consumeItemQuantity: (userId: number, itemInstanceId: number, amount: number) => boolean;
  readonly pickupWorldItem: (userId: number, pickupNid: number) => boolean;
  readonly dropItemInstance: (userId: number, itemInstanceId: number, quantity: number) => boolean;
  readonly assignHotbarSlot: (userId: number, itemInstanceId: number, targetSlot: number, payloadKind: number) => boolean;
  readonly clearHotbarSlot: (userId: number, sourceSlot: number) => boolean;
  readonly moveHotbarSlot: (userId: number, sourceSlot: number, targetSlot: number) => boolean;
  readonly dropHotbarSlot: (userId: number, sourceSlot: number) => boolean;
  readonly setPlayerRenderAppearance: (
    userId: number,
    patch: Partial<{ renderArchetypeId: number; materialVariantId: number; tintColorRgb: number; uniformScalePct: number }>
  ) => boolean;
  readonly setEquippedSlotTint: (userId: number, slot: EquipmentSlot, tintColorRgb: number) => boolean;
  readonly pilotReferenceFrameBegin: (userId: number, framePid: number, volumeId: string) => boolean;
  readonly pilotReferenceFrameEnd: (userId: number, framePid: number) => boolean;
  readonly onReferenceFrameVolumeEntered: (userId: number, framePid: number, volumeId: string) => void;
  readonly onReferenceFrameVolumeExited: (userId: number, framePid: number, volumeId: string) => void;
  readonly onEffectEvaluated?: (record: ActionEffectAuditRecord) => void;
}

export class ActionEffectPipeline {
  public constructor(private readonly options: ActionEffectPipelineOptions) {}

  public execute(effect: ActionEffect): boolean {
    const emit = (success: boolean): boolean => {
      this.options.onEffectEvaluated?.({
        type: effect.type,
        success
      });
      return success;
    };
    if (effect.type === "broadcast_ability_use") {
      this.options.broadcastAbilityUse(
        effect.ownerNid,
        effect.abilityId,
        effect.x,
        effect.y,
        effect.z
      );
      return emit(true);
    }
    if (effect.type === "spawn_projectile") {
      this.options.spawnProjectile(effect);
      return emit(true);
    }
    if (effect.type === "apply_melee_hit") {
      this.options.applyMeleeHit(effect);
      return emit(true);
    }
    if (effect.type === "restore_health") {
      return emit(this.options.restoreHealth(effect.userId, effect.amount));
    }
    if (effect.type === "equip_item_instance") {
      return emit(this.options.equipItemInstance(effect.userId, effect.itemInstanceId));
    }
    if (effect.type === "unequip_slot") {
      return emit(this.options.unequipSlot(effect.userId, effect.slot));
    }
    if (effect.type === "consume_item_quantity") {
      return emit(this.options.consumeItemQuantity(effect.userId, effect.itemInstanceId, effect.amount));
    }
    if (effect.type === "pickup_world_item") {
      return emit(this.options.pickupWorldItem(effect.userId, effect.pickupNid));
    }
    if (effect.type === "drop_item_instance") {
      return emit(this.options.dropItemInstance(effect.userId, effect.itemInstanceId, effect.quantity));
    }
    if (effect.type === "assign_hotbar_slot") {
      return emit(this.options.assignHotbarSlot(effect.userId, effect.itemInstanceId, effect.targetSlot, effect.payloadKind));
    }
    if (effect.type === "clear_hotbar_slot") {
      return emit(this.options.clearHotbarSlot(effect.userId, effect.sourceSlot));
    }
    if (effect.type === "move_hotbar_slot") {
      return emit(this.options.moveHotbarSlot(effect.userId, effect.sourceSlot, effect.targetSlot));
    }
    if (effect.type === "drop_hotbar_slot") {
      return emit(this.options.dropHotbarSlot(effect.userId, effect.sourceSlot));
    }
    if (effect.type === "set_player_render_appearance") {
      return emit(this.options.setPlayerRenderAppearance(effect.userId, effect.patch));
    }
    if (effect.type === "set_equipped_slot_tint") {
      return emit(this.options.setEquippedSlotTint(effect.userId, effect.slot, effect.tintColorRgb));
    }
    if (effect.type === "pilot_reference_frame_begin") {
      return emit(this.options.pilotReferenceFrameBegin(effect.userId, effect.framePid, effect.volumeId));
    }
    if (effect.type === "pilot_reference_frame_end") {
      return emit(this.options.pilotReferenceFrameEnd(effect.userId, effect.framePid));
    }
    if (effect.type === "reference_frame_volume_entered") {
      this.options.onReferenceFrameVolumeEntered(effect.userId, effect.framePid, effect.volumeId);
      return emit(true);
    }
    if (effect.type === "reference_frame_volume_exited") {
      this.options.onReferenceFrameVolumeExited(effect.userId, effect.framePid, effect.volumeId);
      return emit(true);
    }
    return emit(false);
  }
}
