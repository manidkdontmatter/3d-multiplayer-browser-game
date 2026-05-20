/**
 * Purpose: This file defines world state, world helpers, or world orchestration behavior, and defines physics setup, queries, or shared collision behavior.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import {
  applyPlatformCarry,
  configurePlayerCharacterController,
  createLocationCarrierSensorColliders,
  createLocationKinematicCollider,
  createStaticWorldColliders,
  DEFAULT_VOID_SPAWN_ANCHOR,
  getReferenceFrameCarryDelta,
  GROUND_CONTACT_MIN_NORMAL_Y,
  hasCarrierVolumesContainingPoint,
  MOVEMENT_MODE_FLYING,
  MOVEMENT_MODE_GROUNDED,
  normalizeYaw,
  PHYSICS_GROUP_CHARACTER,
  PHYSICS_GROUP_SOLID,
  PLATFORM_DEFINITIONS,
  PLAYER_CHARACTER_CONTROLLER_OFFSET,
  PLAYER_BODY_CENTER_HEIGHT,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_JUMP_VELOCITY,
  resolveGroundSupportColliderHandle,
  sampleLocationTransform,
  samplePlatformTransform,
  stepFlyingMovement,
  stepKinematicCharacterController,
  stepHorizontalMovement,
  toggleMovementMode,
  VOID_LOCATION_DEFINITIONS,
} from "../../shared/index";
import type { LocationRootDefinition } from "../../shared/index";
import type { MovementMode } from "../../shared/index";
import type { MovementInput, PlayerPose } from "./types";

export interface ReconciliationState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number;
  carriedFramePid: number;
  movementMode: MovementMode;
  serverTimeSeconds?: number;
}

interface LocalPlatformBody {
  pid: number;
  body: RAPIER.RigidBody;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface LocalMovingLocationBody {
  definition: LocationRootDefinition;
  body: RAPIER.RigidBody;
  x: number;
  y: number;
  z: number;
  yaw: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  prevYaw: number;
}

interface LocalFrameCarry {
  x: number;
  y: number;
  z: number;
  yaw: number;
  carriedFramePid: number | null;
}

const CARRIER_FRAME_STICKY_MARGIN = 0.25;

export class LocalPhysicsWorld {
  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly playerBody: RAPIER.RigidBody;
  private readonly playerCollider: RAPIER.Collider;
  private readonly world: RAPIER.World;
  private readonly platformBodies = new Map<number, LocalPlatformBody>();
  private readonly platformPidByColliderHandle = new Map<number, number>();
  private readonly movingLocationBodies = new Map<number, LocalMovingLocationBody>();
  private grounded = false;
  private groundedPlatformPid: number | null = null;
  private carriedFramePid: number | null = null;
  private movementMode: MovementMode = MOVEMENT_MODE_GROUNDED;
  private verticalVelocity = 0;
  private horizontalVelocity = { vx: 0, vz: 0 };
  private readonly pose: PlayerPose = { x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0 };
  private simulationSeconds = 0;

  private constructor(
    world: RAPIER.World,
    playerBody: RAPIER.RigidBody,
    playerCollider: RAPIER.Collider,
    characterController: RAPIER.KinematicCharacterController
  ) {
    this.world = world;
    this.playerBody = playerBody;
    this.playerCollider = playerCollider;
    this.characterController = characterController;
  }

  public static async create(): Promise<LocalPhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.integrationParameters.dt = 1 / 60;
    const characterController = world.createCharacterController(PLAYER_CHARACTER_CONTROLLER_OFFSET);
    configurePlayerCharacterController(characterController);
    createStaticWorldColliders(world);
    const spawnBodyY = DEFAULT_VOID_SPAWN_ANCHOR.y - PLAYER_CAMERA_OFFSET_Y;

    const playerBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        DEFAULT_VOID_SPAWN_ANCHOR.x,
        spawnBodyY,
        DEFAULT_VOID_SPAWN_ANCHOR.z
      )
    );
    const playerCollider = world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS)
        .setFriction(0.0)
        .setCollisionGroups(PHYSICS_GROUP_CHARACTER)
        .setSolverGroups(PHYSICS_GROUP_CHARACTER),
      playerBody
    );

    const local = new LocalPhysicsWorld(world, playerBody, playerCollider, characterController);
    local.pose.x = DEFAULT_VOID_SPAWN_ANCHOR.x;
    local.pose.y = DEFAULT_VOID_SPAWN_ANCHOR.y;
    local.pose.z = DEFAULT_VOID_SPAWN_ANCHOR.z;
    for (const platformDef of PLATFORM_DEFINITIONS) {
      const platformPose = samplePlatformTransform(platformDef, 0);
      const platformBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          platformPose.x,
          platformPose.y,
          platformPose.z
        )
      );
      const platformCollider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(platformDef.halfX, platformDef.halfY, platformDef.halfZ)
          .setCollisionGroups(PHYSICS_GROUP_SOLID)
          .setSolverGroups(PHYSICS_GROUP_SOLID),
        platformBody
      );
      platformBody.setRotation(
        { x: 0, y: Math.sin(platformPose.yaw * 0.5), z: 0, w: Math.cos(platformPose.yaw * 0.5) },
        true
      );
      local.platformBodies.set(platformDef.pid, {
        pid: platformDef.pid,
        body: platformBody,
        x: platformPose.x,
        y: platformPose.y,
        z: platformPose.z,
        yaw: platformPose.yaw
      });
      local.platformPidByColliderHandle.set(platformCollider.handle, platformDef.pid);
    }
    for (const definition of VOID_LOCATION_DEFINITIONS) {
      if (definition.motion === "static") {
        continue;
      }
      const pose = sampleLocationTransform(definition, 0);
      const moving = createLocationKinematicCollider(world, definition, pose);
      createLocationCarrierSensorColliders(world, definition, moving.body);
      local.movingLocationBodies.set(definition.pid, {
        definition,
        body: moving.body,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        prevX: pose.x,
        prevY: pose.y,
        prevZ: pose.z,
        prevYaw: pose.yaw
      });
    }
    local.syncPlatformBodies(0);
    local.syncMovingLocationBodies(0, 0);
    world.step();

    return local;
  }

  public step(delta: number, movement: MovementInput, yaw: number, pitch: number): void {
    const dt = this.clampStepDelta(delta);
    this.world.integrationParameters.dt = dt;
    const previousSimulationSeconds = this.simulationSeconds;
    this.simulationSeconds += dt;
    this.syncPlatformBodies(this.simulationSeconds);
    this.syncMovingLocationBodies(previousSimulationSeconds, this.simulationSeconds);

    if (movement.toggleFlyPressed) {
      this.movementMode = toggleMovementMode(this.movementMode);
      this.grounded = false;
      this.groundedPlatformPid = null;
      this.verticalVelocity = 0;
    }

    if (this.movementMode === MOVEMENT_MODE_FLYING) {
      this.grounded = false;
      this.groundedPlatformPid = null;
      const nextDirectionalVelocity = stepFlyingMovement(
        {
          vx: this.horizontalVelocity.vx,
          vy: this.verticalVelocity,
          vz: this.horizontalVelocity.vz
        },
        {
          forward: movement.forward,
          strafe: movement.strafe,
          sprint: movement.sprint,
          yaw,
          pitch
        },
        dt
      );
      this.horizontalVelocity.vx = nextDirectionalVelocity.vx;
      this.horizontalVelocity.vz = nextDirectionalVelocity.vz;
      this.verticalVelocity = nextDirectionalVelocity.vy;
    } else {
      this.horizontalVelocity = stepHorizontalMovement(
        this.horizontalVelocity,
        {
          forward: movement.forward,
          strafe: movement.strafe,
          sprint: movement.sprint,
          yaw
        },
        this.grounded,
        dt
      );

      if (movement.jump && this.grounded) {
        this.verticalVelocity = PLAYER_JUMP_VELOCITY;
        this.grounded = false;
        this.groundedPlatformPid = null;
      }
    }

    const carry = this.samplePlatformCarry(previousSimulationSeconds, this.simulationSeconds);
    const frameCarry = this.sampleMovingLocationCarry();
    const next = stepKinematicCharacterController({
      state: {
        movementMode: this.movementMode,
        yaw,
        vx: this.horizontalVelocity.vx,
        vy: this.verticalVelocity,
        vz: this.horizontalVelocity.vz,
        grounded: this.grounded,
        groundedPlatformPid: this.groundedPlatformPid,
        carriedFramePid: frameCarry.carriedFramePid
      },
      deltaSeconds: dt,
      carry: {
        x: carry.x + frameCarry.x,
        y: carry.y + frameCarry.y,
        z: carry.z + frameCarry.z,
        yaw: 0
      },
      body: this.playerBody,
      collider: this.playerCollider,
      characterController: this.characterController,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y,
      simulationSeconds: this.simulationSeconds,
      resolveGroundSupportColliderHandle: (groundedByQuery) =>
        resolveGroundSupportColliderHandle({
          groundedByQuery,
          world: this.world,
          characterController: this.characterController,
          body: this.playerBody,
          collider: this.playerCollider,
          capsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
          capsuleRadius: PLAYER_CAPSULE_RADIUS,
          groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y
        }),
      resolvePlatformPidByColliderHandle: (colliderHandle) =>
        this.platformPidByColliderHandle.get(colliderHandle) ?? null,
      resolveCarriedFramePid: (movedBody, previousCarriedFramePid) =>
        this.resolveMovingLocationFramePid(movedBody, previousCarriedFramePid)
    });
    this.grounded = next.grounded;
    this.groundedPlatformPid = next.groundedPlatformPid;
    this.carriedFramePid = next.carriedFramePid;
    this.verticalVelocity = next.vy;
    this.pose.x = next.x;
    this.pose.y = next.y;
    this.pose.z = next.z;
    this.pose.yaw = next.yaw;
    this.pose.pitch = pitch;
    this.world.step();
  }

  public predictAttachedPlatformYawDelta(delta: number): number {
    if (this.movementMode === MOVEMENT_MODE_FLYING) {
      return 0;
    }
    if (!this.grounded || this.groundedPlatformPid === null) {
      return 0;
    }
    const definition = PLATFORM_DEFINITIONS.find((platformDef) => platformDef.pid === this.groundedPlatformPid);
    if (!definition) {
      return 0;
    }
    const dt = this.clampStepDelta(delta);
    const previousPose = samplePlatformTransform(definition, this.simulationSeconds);
    const currentPose = samplePlatformTransform(definition, this.simulationSeconds + dt);
    return normalizeYaw(currentPose.yaw - previousPose.yaw);
  }

  public predictCarriedFrameYawDelta(delta: number): number {
    if (this.carriedFramePid === null) {
      return 0;
    }
    const location = this.movingLocationBodies.get(this.carriedFramePid);
    if (!location) {
      return 0;
    }
    const dt = this.clampStepDelta(delta);
    const bodyPos = this.playerBody.translation();
    const previousPose = sampleLocationTransform(location.definition, this.simulationSeconds);
    const previousFrame = {
      x: previousPose.x,
      y: previousPose.y,
      z: previousPose.z,
      yaw: previousPose.yaw
    };
    if (
      !hasCarrierVolumesContainingPoint(
        location.definition.carrierVolumes,
        previousFrame,
        bodyPos,
        CARRIER_FRAME_STICKY_MARGIN
      )
    ) {
      return 0;
    }
    const currentPose = sampleLocationTransform(location.definition, this.simulationSeconds + dt);
    const carry = getReferenceFrameCarryDelta(previousFrame, currentPose, bodyPos);
    return normalizeYaw(carry.yaw);
  }

  public getPose(): PlayerPose {
    return { ...this.pose };
  }

  public getSimulationSeconds(): number {
    return this.simulationSeconds;
  }

  public getPlatformTransform(pid: number): { x: number; y: number; z: number; yaw: number } | null {
    const platform = this.platformBodies.get(pid);
    if (!platform) {
      return null;
    }
    return {
      x: platform.x,
      y: platform.y,
      z: platform.z,
      yaw: platform.yaw
    };
  }

  public getMovingLocationTransform(pid: number): { x: number; y: number; z: number; yaw: number } | null {
    const location = this.movingLocationBodies.get(pid);
    if (!location) {
      return null;
    }
    return {
      x: location.x,
      y: location.y,
      z: location.z,
      yaw: location.yaw
    };
  }

  public getKinematicState(): {
    vx: number;
    vy: number;
    vz: number;
    grounded: boolean;
    groundedPlatformPid: number | null;
    carriedFramePid: number | null;
    movementMode: MovementMode;
  } {
    return {
      vx: this.horizontalVelocity.vx,
      vy: this.verticalVelocity,
      vz: this.horizontalVelocity.vz,
      grounded: this.grounded,
      groundedPlatformPid: this.groundedPlatformPid,
      carriedFramePid: this.carriedFramePid,
      movementMode: this.movementMode
    };
  }

  public isGrounded(): boolean {
    return this.grounded;
  }

  public setReconciliationState(state: ReconciliationState): void {
    this.pose.x = state.x;
    this.pose.y = state.y;
    this.pose.z = state.z;
    this.pose.yaw = state.yaw;
    this.pose.pitch = state.pitch;
    this.grounded = state.grounded;
    this.groundedPlatformPid = state.groundedPlatformPid >= 0 ? state.groundedPlatformPid : null;
    this.carriedFramePid = state.carriedFramePid >= 0 ? state.carriedFramePid : null;
    this.movementMode = state.movementMode;
    this.verticalVelocity = state.vy;
    this.horizontalVelocity.vx = state.vx;
    this.horizontalVelocity.vz = state.vz;
    if (typeof state.serverTimeSeconds === "number" && Number.isFinite(state.serverTimeSeconds)) {
      this.simulationSeconds = Math.max(0, state.serverTimeSeconds);
      this.syncPlatformBodies(this.simulationSeconds);
      this.syncMovingLocationBodies(this.simulationSeconds, this.simulationSeconds);
    }

    const bodyY = state.y - PLAYER_CAMERA_OFFSET_Y;
    this.playerBody.setTranslation({ x: state.x, y: bodyY, z: state.z }, true);
  }

  private syncPlatformBodies(seconds: number): void {
    for (const platformDef of PLATFORM_DEFINITIONS) {
      const platform = this.platformBodies.get(platformDef.pid);
      if (!platform) {
        continue;
      }
      const pose = samplePlatformTransform(platformDef, seconds);
      platform.x = pose.x;
      platform.y = pose.y;
      platform.z = pose.z;
      platform.yaw = pose.yaw;
      platform.body.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true);
      platform.body.setRotation(
        { x: 0, y: Math.sin(pose.yaw * 0.5), z: 0, w: Math.cos(pose.yaw * 0.5) },
        true
      );
    }
  }

  private samplePlatformCarry(previousSeconds: number, currentSeconds: number): { x: number; y: number; z: number } {
    if (this.movementMode === MOVEMENT_MODE_FLYING) {
      return { x: 0, y: 0, z: 0 };
    }
    if (!this.grounded || this.groundedPlatformPid === null) {
      return { x: 0, y: 0, z: 0 };
    }

    const definition = PLATFORM_DEFINITIONS.find((platformDef) => platformDef.pid === this.groundedPlatformPid);
    if (!definition) {
      this.groundedPlatformPid = null;
      return { x: 0, y: 0, z: 0 };
    }

    const previousPose = samplePlatformTransform(definition, previousSeconds);
    const currentPose = samplePlatformTransform(definition, currentSeconds);
    const bodyPos = this.playerBody.translation();
    const carried = applyPlatformCarry(
      { x: previousPose.x, y: previousPose.y, z: previousPose.z, yaw: previousPose.yaw },
      { x: currentPose.x, y: currentPose.y, z: currentPose.z, yaw: currentPose.yaw },
      { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z }
    );

    return {
      x: carried.x - bodyPos.x,
      y: carried.y - bodyPos.y,
      z: carried.z - bodyPos.z
    };
  }

  private clampStepDelta(delta: number): number {
    return Math.max(1 / 120, Math.min(delta, 1 / 20));
  }

  private syncMovingLocationBodies(previousSeconds: number, seconds: number): void {
    for (const location of this.movingLocationBodies.values()) {
      const previousPose = sampleLocationTransform(location.definition, previousSeconds);
      const pose = sampleLocationTransform(location.definition, seconds);
      location.prevX = previousPose.x;
      location.prevY = previousPose.y;
      location.prevZ = previousPose.z;
      location.prevYaw = previousPose.yaw;
      location.x = pose.x;
      location.y = pose.y;
      location.z = pose.z;
      location.yaw = pose.yaw;
      location.body.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true);
      location.body.setRotation(
        { x: 0, y: Math.sin(pose.yaw * 0.5), z: 0, w: Math.cos(pose.yaw * 0.5) },
        true
      );
    }
  }

  private sampleMovingLocationCarry(): LocalFrameCarry {
    const bodyPos = this.playerBody.translation();
    const previousLocation =
      this.carriedFramePid === null ? null : this.movingLocationBodies.get(this.carriedFramePid) ?? null;
    if (previousLocation) {
      const carry = this.sampleMovingLocationCarryFromPreviousFrame(
        previousLocation,
        bodyPos,
        CARRIER_FRAME_STICKY_MARGIN
      );
      if (carry) {
        return carry;
      }
    }

    for (const location of this.movingLocationBodies.values()) {
      const carry = this.sampleMovingLocationCarryFromPreviousFrame(location, bodyPos, 0);
      if (carry) {
        return carry;
      }
    }
    return { x: 0, y: 0, z: 0, yaw: 0, carriedFramePid: null };
  }

  private sampleMovingLocationCarryFromPreviousFrame(
    location: LocalMovingLocationBody,
    bodyPos: { x: number; y: number; z: number },
    margin: number
  ): LocalFrameCarry | null {
    const previous = { x: location.prevX, y: location.prevY, z: location.prevZ, yaw: location.prevYaw };
    if (!hasCarrierVolumesContainingPoint(location.definition.carrierVolumes, previous, bodyPos, margin)) {
      return null;
    }
    const current = { x: location.x, y: location.y, z: location.z, yaw: location.yaw };
    const carry = getReferenceFrameCarryDelta(previous, current, bodyPos);
    return { ...carry, carriedFramePid: location.definition.pid };
  }

  private resolveMovingLocationFramePid(
    point: { x: number; y: number; z: number },
    previousCarriedFramePid: number | null
  ): number | null {
    const previousLocation =
      previousCarriedFramePid === null ? null : this.movingLocationBodies.get(previousCarriedFramePid) ?? null;
    if (
      previousLocation &&
      hasCarrierVolumesContainingPoint(
        previousLocation.definition.carrierVolumes,
        { x: previousLocation.x, y: previousLocation.y, z: previousLocation.z, yaw: previousLocation.yaw },
        point,
        CARRIER_FRAME_STICKY_MARGIN
      )
    ) {
      return previousLocation.definition.pid;
    }

    for (const location of this.movingLocationBodies.values()) {
      if (
        hasCarrierVolumesContainingPoint(
          location.definition.carrierVolumes,
          { x: location.x, y: location.y, z: location.z, yaw: location.yaw },
          point,
          0
        )
      ) {
        return location.definition.pid;
      }
    }
    return null;
  }
}
