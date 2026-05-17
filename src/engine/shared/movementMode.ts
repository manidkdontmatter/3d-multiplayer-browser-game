/**
 * Purpose: This file handles character/world movement rules and integration.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
export const MOVEMENT_MODE_GROUNDED = 0;
export const MOVEMENT_MODE_FLYING = 1;

export type MovementMode = typeof MOVEMENT_MODE_GROUNDED | typeof MOVEMENT_MODE_FLYING;

export function sanitizeMovementMode(
  raw: unknown,
  fallback: MovementMode = MOVEMENT_MODE_GROUNDED
): MovementMode {
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  const value = Math.floor(raw as number);
  if (value === MOVEMENT_MODE_FLYING) {
    return MOVEMENT_MODE_FLYING;
  }
  return MOVEMENT_MODE_GROUNDED;
}

export function toggleMovementMode(mode: MovementMode): MovementMode {
  return mode === MOVEMENT_MODE_FLYING ? MOVEMENT_MODE_GROUNDED : MOVEMENT_MODE_FLYING;
}

export function movementModeToLabel(mode: MovementMode): "grounded" | "flying" {
  return mode === MOVEMENT_MODE_FLYING ? "flying" : "grounded";
}
