// Shared authoritative movement-mode constants and sanitizers used by client/server simulation.
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
