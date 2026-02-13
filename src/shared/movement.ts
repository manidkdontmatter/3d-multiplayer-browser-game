import {
  PLAYER_AIR_ACCEL,
  PLAYER_GROUND_ACCEL,
  PLAYER_GROUND_FRICTION,
  PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED
} from "./config";

export interface HorizontalState {
  vx: number;
  vz: number;
}

export interface HorizontalInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  yaw: number;
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (current < target) {
    return Math.min(current + maxDelta, target);
  }
  return Math.max(current - maxDelta, target);
}

export function stepHorizontalMovement(
  state: HorizontalState,
  input: HorizontalInput,
  grounded: boolean,
  delta: number
): HorizontalState {
  const clampedDelta = Math.max(0, delta);
  const speed = input.sprint ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
  const wishMagnitude = Math.hypot(input.forward, input.strafe);
  const wishScale = wishMagnitude > 1 ? 1 / wishMagnitude : 1;
  const wishForward = input.forward * wishScale;
  const wishStrafe = input.strafe * wishScale;

  const forwardX = -Math.sin(input.yaw);
  const forwardZ = -Math.cos(input.yaw);
  const rightX = Math.cos(input.yaw);
  const rightZ = -Math.sin(input.yaw);

  const targetVx = (forwardX * wishForward + rightX * wishStrafe) * speed;
  const targetVz = (forwardZ * wishForward + rightZ * wishStrafe) * speed;
  const accel = grounded ? PLAYER_GROUND_ACCEL : PLAYER_AIR_ACCEL;
  const accelStep = accel * clampedDelta;

  let vx = moveTowards(state.vx, targetVx, accelStep);
  let vz = moveTowards(state.vz, targetVz, accelStep);

  if (grounded) {
    const horizontalSpeed = Math.hypot(vx, vz);
    if (horizontalSpeed > 0) {
      const drop = horizontalSpeed * PLAYER_GROUND_FRICTION * clampedDelta;
      const newSpeed = Math.max(0, horizontalSpeed - drop);
      const scale = newSpeed / horizontalSpeed;
      vx *= scale;
      vz *= scale;
    }
  }

  return { vx, vz };
}
