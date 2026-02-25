// Shared deterministic kinematic character motor used by server authority and client prediction.
import RAPIER from "@dimforge/rapier3d-compat";
import { GRAVITY } from "../config";
import { MOVEMENT_MODE_FLYING, type MovementMode } from "../movementMode";
import { OCEAN_BUOYANCY_ACCEL, OCEAN_VERTICAL_DRAG } from "../ocean";
import { normalizeYaw } from "../platforms";

export interface PlatformCarryDelta {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface GroundSupportHit {
  hit: boolean;
  colliderHandle: number | null;
}

export interface KinematicSolveState {
  movementMode: MovementMode;
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
  if (state.movementMode === MOVEMENT_MODE_FLYING) {
    return state.vy;
  }
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
  simulationSeconds: number;
  sampleOceanSurfaceY?: (x: number, z: number, simulationSeconds: number) => number;
}): KinematicPostStepResult {
  if (options.previous.movementMode === MOVEMENT_MODE_FLYING) {
    return {
      grounded: false,
      groundedPlatformPid: null,
      vy: options.previous.vy,
      x: options.movedBody.x,
      y: options.movedBody.y + options.playerCameraOffsetY,
      z: options.movedBody.z
    };
  }

  const grounded = options.groundedByQuery;
  const attachedPlatformPid = grounded ? options.groundedPlatformPid : null;

  let vy = options.previous.vy;
  if (grounded) {
    if (attachedPlatformPid !== null || vy < 0) {
      vy = 0;
    }
  } else {
    const cameraY = options.movedBody.y + options.playerCameraOffsetY;
    const oceanSurfaceY = options.sampleOceanSurfaceY?.(
      options.movedBody.x,
      options.movedBody.z,
      options.simulationSeconds
    );
    const isUnderwater = Number.isFinite(oceanSurfaceY) && cameraY < (oceanSurfaceY as number);
    if (isUnderwater) {
      vy += OCEAN_BUOYANCY_ACCEL * options.deltaSeconds;
      const drag = Math.max(0, 1 - OCEAN_VERTICAL_DRAG * options.deltaSeconds);
      vy *= drag;
    } else {
      vy += GRAVITY * options.deltaSeconds;
    }
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

export interface KinematicControllerStepState extends KinematicSolveState {
  yaw: number;
  vx: number;
  vz: number;
}

export interface KinematicControllerStepResult extends KinematicPostStepResult {
  yaw: number;
}

export function resolveGroundSupportColliderHandle(options: {
  groundedByQuery: boolean;
  world: RAPIER.World;
  characterController: RAPIER.KinematicCharacterController;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  capsuleHalfHeight: number;
  capsuleRadius: number;
  groundContactMinNormalY: number;
}): GroundSupportHit {
  if (!options.groundedByQuery) {
    return { hit: false, colliderHandle: null };
  }

  const snapDistance = options.characterController.snapToGroundDistance() ?? 0;
  const origin = options.body.translation();
  const maxToi = options.capsuleHalfHeight + options.capsuleRadius + snapDistance + 0.1;
  const ray = new RAPIER.Ray(
    { x: origin.x, y: origin.y + 0.05, z: origin.z },
    { x: 0, y: -1, z: 0 }
  );
  const hit = options.world.castRayAndGetNormal(
    ray,
    maxToi,
    true,
    undefined,
    undefined,
    options.collider,
    options.body,
    (collider) => collider.handle !== options.collider.handle
  );
  if (!hit) {
    return { hit: false, colliderHandle: null };
  }
  if (!Number.isFinite(hit.normal.y) || hit.normal.y < options.groundContactMinNormalY) {
    return { hit: false, colliderHandle: null };
  }
  return { hit: true, colliderHandle: hit.collider.handle };
}

export function resolveGroundedPlatformPidFromComputedCollisions(options: {
  groundedByQuery: boolean;
  previousGroundedPlatformPid: number | null;
  supportHit: GroundSupportHit;
  characterController: RAPIER.KinematicCharacterController;
  resolvePlatformPidByColliderHandle: (colliderHandle: number) => number | null;
  groundContactMinNormalY: number;
}): number | null {
  if (options.groundedByQuery && options.supportHit.hit) {
    const supportPid =
      options.supportHit.colliderHandle !== null
        ? options.resolvePlatformPidByColliderHandle(options.supportHit.colliderHandle)
        : null;
    return typeof supportPid === "number" ? supportPid : null;
  }

  const collisionPlatformPids: number[] = [];
  const collisionCount = options.characterController.numComputedCollisions();
  for (let i = 0; i < collisionCount; i += 1) {
    const collision = options.characterController.computedCollision(i);
    const collider = collision?.collider;
    if (!collision || !collider) {
      continue;
    }
    if (!Number.isFinite(collision.normal1.y) || collision.normal1.y < options.groundContactMinNormalY) {
      continue;
    }
    const pid = options.resolvePlatformPidByColliderHandle(collider.handle);
    if (typeof pid !== "number") {
      continue;
    }
    if (!collisionPlatformPids.includes(pid)) {
      collisionPlatformPids.push(pid);
    }
  }
  return resolveGroundedPlatformPid({
    groundedByQuery: options.groundedByQuery,
    previousGroundedPlatformPid: options.previousGroundedPlatformPid,
    collisionPlatformPids
  });
}

export function stepKinematicCharacterController(options: {
  state: KinematicControllerStepState;
  deltaSeconds: number;
  carry: PlatformCarryDelta;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  characterController: RAPIER.KinematicCharacterController;
  playerCameraOffsetY: number;
  groundContactMinNormalY: number;
  simulationSeconds: number;
  sampleOceanSurfaceY?: (x: number, z: number, simulationSeconds: number) => number;
  resolveGroundSupportColliderHandle: (groundedByQuery: boolean) => GroundSupportHit;
  resolvePlatformPidByColliderHandle: (colliderHandle: number) => number | null;
}): KinematicControllerStepResult {
  const yaw = applyPlatformCarryYaw(options.state.yaw, options.carry.yaw);
  const solveVerticalVelocity = resolveVerticalVelocityForSolve(options.state);
  const desired = buildDesiredCharacterTranslation(
    options.state.vx,
    options.state.vz,
    options.deltaSeconds,
    solveVerticalVelocity,
    options.carry
  );
  options.characterController.computeColliderMovement(
    options.collider,
    desired,
    undefined,
    undefined,
    (collider) => collider.handle !== options.collider.handle
  );
  const corrected = options.characterController.computedMovement();

  const current = options.body.translation();
  options.body.setTranslation(
    {
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z
    },
    true
  );

  const moved = options.body.translation();
  const isFlying = options.state.movementMode === MOVEMENT_MODE_FLYING;
  const groundedByQuery = isFlying ? false : options.characterController.computedGrounded();
  const supportHit = isFlying
    ? { hit: false, colliderHandle: null }
    : options.resolveGroundSupportColliderHandle(groundedByQuery);
  const groundedPlatformPid = isFlying
    ? null
    : resolveGroundedPlatformPidFromComputedCollisions({
        groundedByQuery,
        previousGroundedPlatformPid: options.state.groundedPlatformPid,
        supportHit,
        characterController: options.characterController,
        resolvePlatformPidByColliderHandle: options.resolvePlatformPidByColliderHandle,
        groundContactMinNormalY: options.groundContactMinNormalY
      });
  const next = resolveKinematicPostStepState({
    previous: options.state,
    movedBody: moved,
    groundedByQuery,
    groundedPlatformPid,
    deltaSeconds: options.deltaSeconds,
    playerCameraOffsetY: options.playerCameraOffsetY,
    simulationSeconds: options.simulationSeconds,
    sampleOceanSurfaceY: options.sampleOceanSurfaceY
  });
  return {
    ...next,
    yaw
  };
}
