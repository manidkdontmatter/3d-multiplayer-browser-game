/**
 * Purpose: This file defines canonical world interaction action slots and labels shared by client prompt rendering and server validation.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use one authoritative interaction-action vocabulary.
 */
export type WorldInteractionKind = "pickup" | "station" | "pilot_console";
export type WorldInteractionActionId =
  | "pickup_collect"
  | "station_open_creator"
  | "pilot_console_toggle";

export type WorldInteractionTargetType = WorldInteractionKind;

export const INTERACTION_SLOT_PRIMARY = 0;
export const INTERACTION_SLOT_SECONDARY = 1;
export const INTERACTION_SLOT_TERTIARY = 2;

export interface WorldInteractionAction {
  id: WorldInteractionActionId;
  slot: number;
  label: string;
  enabled: boolean;
  disabledReason?: string;
  priority?: number;
}

export interface WorldInteractionTargetDescriptor {
  targetId: string;
  targetType: WorldInteractionTargetType;
  label: string;
  distanceMeters: number;
  priority: number;
  actions: readonly WorldInteractionAction[];
}

export interface WorldInteractionPromptViewState {
  kind: "world_interaction";
  target: WorldInteractionTargetDescriptor | null;
}

export interface WorldInteractionActivateIntent {
  kind: "interaction_activate";
  targetId: string;
  actionId: WorldInteractionActionId;
  slot: number;
}

export interface WorldInteractionPickupContext {
  itemName: string;
  itemQuantity: number;
}

const WORLD_INTERACTION_ACTIONS_BY_KIND: Readonly<Record<"station" | "pilot_console", readonly WorldInteractionAction[]>> = Object.freeze({
  station: Object.freeze([
    {
      id: "station_open_creator" as const,
      slot: INTERACTION_SLOT_PRIMARY,
      label: "Open Creator Station",
      enabled: true
    }
  ]),
  pilot_console: Object.freeze([{
    id: "pilot_console_toggle" as const,
    slot: INTERACTION_SLOT_PRIMARY,
    label: "Toggle Pilot Console",
    enabled: true
  }])
});

export function getWorldInteractionActions(
  kind: WorldInteractionKind,
  pickupContext?: WorldInteractionPickupContext
): readonly WorldInteractionAction[] {
  if (kind === "pickup") {
    const name = typeof pickupContext?.itemName === "string" && pickupContext.itemName.trim().length > 0
      ? pickupContext.itemName.trim()
      : "Item";
    const quantity = Number.isFinite(pickupContext?.itemQuantity)
      ? Math.max(0, Math.floor(pickupContext!.itemQuantity))
      : 0;
    return Object.freeze([{
      id: "pickup_collect",
      slot: INTERACTION_SLOT_PRIMARY,
      label: `Pick up ${name}${quantity > 1 ? ` x${quantity}` : ""}`,
      enabled: true
    }]);
  }
  if (kind === "station" || kind === "pilot_console") {
    return WORLD_INTERACTION_ACTIONS_BY_KIND[kind];
  }
  return WORLD_INTERACTION_ACTIONS_BY_KIND.station;
}

export function isWorldInteractionSlotSupported(kind: WorldInteractionKind, slot: number): boolean {
  const normalized = Number.isFinite(slot) ? Math.max(0, Math.floor(slot)) : -1;
  return getWorldInteractionActions(kind).some((action) => action.slot === normalized && action.enabled);
}

export function resolveWorldInteractionActionBySlot(
  kind: WorldInteractionKind,
  slot: number,
  pickupContext?: WorldInteractionPickupContext
): WorldInteractionAction | null {
  const normalized = Number.isFinite(slot) ? Math.max(0, Math.floor(slot)) : -1;
  const actions = getWorldInteractionActions(kind, pickupContext);
  return actions.find((action) => action.slot === normalized) ?? null;
}

export function worldInteractionSlotToKeyLabel(slot: number): string {
  const normalized = Number.isFinite(slot) ? Math.max(0, Math.floor(slot)) : 0;
  if (normalized === 0) return "E";
  if (normalized === 1) return "R";
  if (normalized === 2) return "T";
  return `#${normalized + 1}`;
}
