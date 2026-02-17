import { GRAVITY, PLAYER_GROUND_STICK_VELOCITY } from "../config";
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

export function applyPlatformCarryYaw(yaw: number, carryYaw: number): number {
  return normalizeYaw(yaw + carryYaw);
}

export function resolveVerticalVelocityForSolve(state: KinematicSolveState): number {
  const attachedToPlatformForSolve = state.groundedPlatformPid !== null;
  if (attachedToPlatformForSolve) {
    return 0;
  }
  if (state.grounded && state.vy <= 0) {
    return PLAYER_GROUND_STICK_VELOCITY;
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

export function resolveKinematicPostStepState(options: {
  previous: KinematicSolveState;
  movedBody: KinematicBodyPosition;
  groundedByQuery: boolean;
  deltaSeconds: number;
  playerCameraOffsetY: number;
  findGroundedPlatformPid: (
    bodyX: number,
    bodyY: number,
    bodyZ: number,
    preferredPid: number | null
  ) => number | null;
}): KinematicPostStepResult {
  const canAttachToPlatform =
    options.groundedByQuery ||
    options.previous.groundedPlatformPid !== null ||
    options.previous.vy <= 0;

  const groundedPlatformPid = canAttachToPlatform
    ? options.findGroundedPlatformPid(
        options.movedBody.x,
        options.movedBody.y,
        options.movedBody.z,
        options.previous.groundedPlatformPid
      )
    : null;

  const grounded = options.groundedByQuery || groundedPlatformPid !== null;

  let vy = options.previous.vy;
  const attachedToPlatform = grounded && groundedPlatformPid !== null;
  if (attachedToPlatform) {
    vy = 0;
  } else if (grounded) {
    if (vy < 0) {
      vy = 0;
    }
  } else {
    vy += GRAVITY * options.deltaSeconds;
  }

  return {
    grounded,
    groundedPlatformPid: grounded ? groundedPlatformPid : null,
    vy,
    x: options.movedBody.x,
    y: options.movedBody.y + options.playerCameraOffsetY,
    z: options.movedBody.z
  };
}
