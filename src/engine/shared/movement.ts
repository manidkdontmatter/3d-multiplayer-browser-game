/**
 * Purpose: This file handles character/world movement rules and integration.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import {
  PLAYER_FLY_SPEED,
  PLAYER_FLY_SPRINT_SPEED,
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

export interface DirectionalState {
  vx: number;
  vy: number;
  vz: number;
}

export interface FlyingInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  yaw: number;
  pitch: number;
}

export function stepHorizontalMovement(
  state: HorizontalState,
  input: HorizontalInput,
  grounded: boolean,
  delta: number
): HorizontalState {
  void state;
  void grounded;
  void delta;
  const speed = input.sprint ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
  const wishForward = input.forward;
  const wishStrafe = input.strafe;

  const forwardX = -Math.sin(input.yaw);
  const forwardZ = -Math.cos(input.yaw);
  const rightX = Math.cos(input.yaw);
  const rightZ = -Math.sin(input.yaw);

  let vx = forwardX * wishForward + rightX * wishStrafe;
  let vz = forwardZ * wishForward + rightZ * wishStrafe;
  const magnitude = Math.hypot(vx, vz);
  if (magnitude > 1e-6) {
    const scale = speed / magnitude;
    vx *= scale;
    vz *= scale;
  } else {
    vx = 0;
    vz = 0;
  }

  return { vx, vz };
}

export function stepFlyingMovement(
  state: DirectionalState,
  input: FlyingInput,
  delta: number
): DirectionalState {
  void state;
  void delta;
  const speed = input.sprint ? PLAYER_FLY_SPRINT_SPEED : PLAYER_FLY_SPEED;
  const wishForward = input.forward;
  const wishStrafe = input.strafe;

  const cosPitch = Math.cos(input.pitch);
  const forwardX = -Math.sin(input.yaw) * cosPitch;
  const forwardY = Math.sin(input.pitch);
  const forwardZ = -Math.cos(input.yaw) * cosPitch;
  const rightX = Math.cos(input.yaw);
  const rightZ = -Math.sin(input.yaw);

  let vx = forwardX * wishForward + rightX * wishStrafe;
  let vy = forwardY * wishForward;
  let vz = forwardZ * wishForward + rightZ * wishStrafe;
  const magnitude = Math.hypot(vx, vy, vz);
  if (magnitude > 1e-6) {
    const scale = speed / magnitude;
    vx *= scale;
    vy *= scale;
    vz *= scale;
  } else {
    vx = 0;
    vy = 0;
    vz = 0;
  }

  return { vx, vy, vz };
}
