import { GRAVITY } from "../config";
import { normalizeYaw } from "../platforms";

export interface PlatformCarryDelta {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface KinematicSolveState {
  grounded: boolean;
  groundedPlatformPid: number | null;
  vy: number;
}

export interface KinematicBodyPosition {
  x: number;
  y: number;
  z: number;
}

export interface KinematicPostStepResult {
  grounded: boolean;
  groundedPlatformPid: number | null;
  vy: number;
  x: number;
  y: number;
  z: number;
}

export const GROUND_CONTACT_MIN_NORMAL_Y = Math.cos((60 * Math.PI) / 180);
export const GROUND_ADHESION_VELOCITY = -1;

export function applyPlatformCarryYaw(yaw: number, carryYaw: number): number {
  return normalizeYaw(yaw + carryYaw);
}

export function resolveVerticalVelocityForSolve(state: KinematicSolveState): number {
  if (state.groundedPlatformPid !== null) {
    return 0;
  }
  if (state.grounded) {
    if (state.vy > 0) {
      return state.vy;
    }
    // Rapier snap-to-ground requires a slight downward desired movement.
    return GROUND_ADHESION_VELOCITY;
  }
  return state.vy;
}

export function buildDesiredCharacterTranslation(
  vx: number,
  vz: number,
  deltaSeconds: number,
  solveVerticalVelocity: number,
  carry: PlatformCarryDelta
): { x: number; y: number; z: number } {
  return {
    x: vx * deltaSeconds + carry.x,
    y: solveVerticalVelocity * deltaSeconds + carry.y,
    z: vz * deltaSeconds + carry.z
  };
}

export function resolveGroundedPlatformPid(options: {
  groundedByQuery: boolean;
  previousGroundedPlatformPid: number | null;
  collisionPlatformPids: readonly number[];
}): number | null {
  if (!options.groundedByQuery) {
    return null;
  }

  if (
    options.previousGroundedPlatformPid !== null &&
    options.collisionPlatformPids.includes(options.previousGroundedPlatformPid)
  ) {
    return options.previousGroundedPlatformPid;
  }

  return options.collisionPlatformPids[0] ?? null;
}

export function resolveKinematicPostStepState(options: {
  previous: KinematicSolveState;
  movedBody: KinematicBodyPosition;
  groundedByQuery: boolean;
  groundedPlatformPid: number | null;
  deltaSeconds: number;
  playerCameraOffsetY: number;
}): KinematicPostStepResult {
  const grounded = options.groundedByQuery;
  const attachedPlatformPid = grounded ? options.groundedPlatformPid : null;

  let vy = options.previous.vy;
  if (grounded) {
    if (attachedPlatformPid !== null || vy < 0) {
      vy = 0;
    }
  } else {
    vy += GRAVITY * options.deltaSeconds;
  }

  return {
    grounded,
    groundedPlatformPid: attachedPlatformPid,
    vy,
    x: options.movedBody.x,
    y: options.movedBody.y + options.playerCameraOffsetY,
    z: options.movedBody.z
  };
}
