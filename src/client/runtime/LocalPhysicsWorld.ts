import RAPIER from "@dimforge/rapier3d-compat";
import {
  applyPlatformCarry,
  buildDesiredCharacterTranslation,
  GROUND_CONTACT_MIN_NORMAL_Y,
  normalizeYaw,
  PLATFORM_DEFINITIONS,
  PLAYER_BODY_CENTER_HEIGHT,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_JUMP_VELOCITY,
  resolveGroundedPlatformPid,
  resolveKinematicPostStepState,
  resolveVerticalVelocityForSolve,
  STATIC_WORLD_BLOCKS,
  samplePlatformTransform,
  stepHorizontalMovement,
} from "../../shared/index";
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

interface GroundSupportHit {
  hit: boolean;
  colliderHandle: number | null;
}

export class LocalPhysicsWorld {
  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly playerBody: RAPIER.RigidBody;
  private readonly playerCollider: RAPIER.Collider;
  private readonly world: RAPIER.World;
  private readonly platformBodies = new Map<number, LocalPlatformBody>();
  private readonly platformPidByColliderHandle = new Map<number, number>();
  private grounded = false;
  private groundedPlatformPid: number | null = null;
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
    const characterController = world.createCharacterController(0.01);
    characterController.setSlideEnabled(true);
    characterController.enableSnapToGround(0.2);
    characterController.disableAutostep();
    characterController.setMaxSlopeClimbAngle((60 * Math.PI) / 180);
    characterController.setMinSlopeSlideAngle((80 * Math.PI) / 180);

    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(128, 0.5, 128), groundBody);

    for (const worldBlock of STATIC_WORLD_BLOCKS) {
      const rotationZ = worldBlock.rotationZ ?? 0;
      const staticWorldBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(worldBlock.x, worldBlock.y, worldBlock.z)
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(worldBlock.halfX, worldBlock.halfY, worldBlock.halfZ),
        staticWorldBody
      );
      staticWorldBody.setRotation(
        { x: 0, y: 0, z: Math.sin(rotationZ * 0.5), w: Math.cos(rotationZ * 0.5) },
        true
      );
    }

    const playerBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PLAYER_BODY_CENTER_HEIGHT, 0)
    );
    const playerCollider = world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS).setFriction(0.0),
      playerBody
    );

    const local = new LocalPhysicsWorld(world, playerBody, playerCollider, characterController);
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
        RAPIER.ColliderDesc.cuboid(platformDef.halfX, platformDef.halfY, platformDef.halfZ),
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
    local.syncPlatformBodies(0);

    return local;
  }

  public step(delta: number, movement: MovementInput, yaw: number, pitch: number): void {
    const dt = this.clampStepDelta(delta);
    this.world.integrationParameters.dt = dt;
    const previousSimulationSeconds = this.simulationSeconds;
    this.simulationSeconds += dt;
    this.syncPlatformBodies(this.simulationSeconds);

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

    const carry = this.samplePlatformCarry(previousSimulationSeconds, this.simulationSeconds);
    const solveVerticalVelocity = resolveVerticalVelocityForSolve({
      grounded: this.grounded,
      groundedPlatformPid: this.groundedPlatformPid,
      vy: this.verticalVelocity
    });
    const desired = buildDesiredCharacterTranslation(
      this.horizontalVelocity.vx,
      this.horizontalVelocity.vz,
      dt,
      solveVerticalVelocity,
      { x: carry.x, y: carry.y, z: carry.z, yaw: 0 }
    );
    this.characterController.computeColliderMovement(
      this.playerCollider,
      desired,
      undefined,
      undefined,
      (collider) => collider.handle !== this.playerCollider.handle
    );
    const corrected = this.characterController.computedMovement();
    const current = this.playerBody.translation();
    this.playerBody.setTranslation(
      {
        x: current.x + corrected.x,
        y: current.y + corrected.y,
        z: current.z + corrected.z
      },
      true
    );
    const position = this.playerBody.translation();
    const groundedByQuery = this.characterController.computedGrounded();
    const supportHit = this.resolveGroundSupportColliderHandle(groundedByQuery);
    const groundedPlatformPid =
      groundedByQuery && supportHit.hit
        ? (supportHit.colliderHandle !== null
            ? (this.platformPidByColliderHandle.get(supportHit.colliderHandle) ?? null)
            : null)
        : this.resolveGroundedPlatformPidFromComputedCollisions(groundedByQuery, this.groundedPlatformPid);
    const next = resolveKinematicPostStepState({
      previous: {
        grounded: this.grounded,
        groundedPlatformPid: this.groundedPlatformPid,
        vy: this.verticalVelocity
      },
      movedBody: position,
      groundedByQuery,
      groundedPlatformPid,
      deltaSeconds: dt,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y
    });
    this.grounded = next.grounded;
    this.groundedPlatformPid = next.groundedPlatformPid;
    this.verticalVelocity = next.vy;
    this.pose.x = next.x;
    this.pose.y = next.y;
    this.pose.z = next.z;
    this.pose.yaw = yaw;
    this.pose.pitch = pitch;
    this.world.step();
  }

  public predictAttachedPlatformYawDelta(delta: number): number {
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

  public getKinematicState(): {
    vx: number;
    vy: number;
    vz: number;
    grounded: boolean;
    groundedPlatformPid: number | null;
  } {
    return {
      vx: this.horizontalVelocity.vx,
      vy: this.verticalVelocity,
      vz: this.horizontalVelocity.vz,
      grounded: this.grounded,
      groundedPlatformPid: this.groundedPlatformPid
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
    this.verticalVelocity = state.vy;
    this.horizontalVelocity.vx = state.vx;
    this.horizontalVelocity.vz = state.vz;
    if (typeof state.serverTimeSeconds === "number" && Number.isFinite(state.serverTimeSeconds)) {
      this.simulationSeconds = Math.max(0, state.serverTimeSeconds);
      this.syncPlatformBodies(this.simulationSeconds);
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

  private resolveGroundedPlatformPidFromComputedCollisions(
    groundedByQuery: boolean,
    previousGroundedPlatformPid: number | null
  ): number | null {
    const collisionPlatformPids: number[] = [];
    const collisionCount = this.characterController.numComputedCollisions();
    for (let i = 0; i < collisionCount; i += 1) {
      const collision = this.characterController.computedCollision(i);
      const collider = collision?.collider;
      if (!collision || !collider) {
        continue;
      }
      if (!Number.isFinite(collision.normal1.y) || collision.normal1.y < GROUND_CONTACT_MIN_NORMAL_Y) {
        continue;
      }
      const pid = this.platformPidByColliderHandle.get(collider.handle);
      if (typeof pid !== "number") {
        continue;
      }
      if (!collisionPlatformPids.includes(pid)) {
        collisionPlatformPids.push(pid);
      }
    }
    return resolveGroundedPlatformPid({
      groundedByQuery,
      previousGroundedPlatformPid,
      collisionPlatformPids
    });
  }

  private resolveGroundSupportColliderHandle(groundedByQuery: boolean): GroundSupportHit {
    if (!groundedByQuery) {
      return { hit: false, colliderHandle: null };
    }

    const snapDistance = this.characterController.snapToGroundDistance() ?? 0;
    const origin = this.playerBody.translation();
    const maxToi = PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS + snapDistance + 0.1;
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y + 0.05, z: origin.z },
      { x: 0, y: -1, z: 0 }
    );
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      this.playerCollider,
      this.playerBody,
      (collider) => collider.handle !== this.playerCollider.handle
    );
    if (!hit) {
      return { hit: false, colliderHandle: null };
    }
    if (!Number.isFinite(hit.normal.y) || hit.normal.y < GROUND_CONTACT_MIN_NORMAL_Y) {
      return { hit: false, colliderHandle: null };
    }
    return { hit: true, colliderHandle: hit.collider.handle };
  }

  private clampStepDelta(delta: number): number {
    return Math.max(1 / 120, Math.min(delta, 1 / 20));
  }
}
