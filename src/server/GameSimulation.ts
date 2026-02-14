import RAPIER from "@dimforge/rapier3d-compat";
import { AABB3D, Channel, ChannelAABB3D } from "nengi";
import {
  applyPlatformCarry,
  GRAVITY,
  NType,
  normalizeYaw,
  PLATFORM_DEFINITIONS,
  PLAYER_BODY_CENTER_HEIGHT,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_JUMP_VELOCITY,
  SERVER_TICK_SECONDS,
  samplePlatformTransform,
  PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED,
  STATIC_WORLD_BLOCKS,
  toPlatformLocal,
  stepHorizontalMovement
} from "../shared/index";

type UserLike = {
  id: number;
  queueMessage: (message: unknown) => void;
  view?: AABB3D;
};

type PlayerEntity = {
  nid: number;
  ntype: NType.PlayerEntity;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  serverTick: number;
  vy: number;
  vx: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  lastProcessedSequence: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

type PlatformEntity = {
  nid: number;
  ntype: NType.PlatformEntity;
  pid: number;
  kind: 1 | 2;
  x: number;
  y: number;
  z: number;
  yaw: number;
  serverTick: number;
  halfX: number;
  halfY: number;
  halfZ: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  prevYaw: number;
  definition: (typeof PLATFORM_DEFINITIONS)[number];
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

type InputCommand = {
  ntype: NType.InputCommand;
  sequence: number;
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
  yawDelta: number;
  pitch: number;
  delta: number;
};

const INPUT_SEQUENCE_MODULO = 0x10000;
const INPUT_SEQUENCE_HALF_RANGE = INPUT_SEQUENCE_MODULO >>> 1;

export class GameSimulation {
  private readonly playersByUserId = new Map<number, PlayerEntity>();
  private readonly usersById = new Map<number, UserLike>();
  private readonly platformsByPid = new Map<number, PlatformEntity>();
  private readonly world: RAPIER.World;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private elapsedSeconds = 0;
  private tickNumber = 0;

  public constructor(
    private readonly globalChannel: Channel,
    private readonly spatialChannel: ChannelAABB3D
  ) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.integrationParameters.dt = 1 / 30;
    this.characterController = this.world.createCharacterController(0.01);
    this.characterController.setSlideEnabled(true);
    this.characterController.enableSnapToGround(0.2);
    this.characterController.disableAutostep();
    this.characterController.setMaxSlopeClimbAngle((60 * Math.PI) / 180);
    this.characterController.setMinSlopeSlideAngle((80 * Math.PI) / 180);

    this.createStaticWorldColliders();
    this.initializePlatforms();
  }

  public addUser(user: UserLike): void {
    const spawn = this.getSpawnPosition();
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        PLAYER_BODY_CENTER_HEIGHT,
        spawn.z
      )
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS).setFriction(0),
      body
    );

    const player: PlayerEntity = {
      nid: 0,
      ntype: NType.PlayerEntity,
      x: spawn.x,
      y: PLAYER_BODY_CENTER_HEIGHT + PLAYER_CAMERA_OFFSET_Y,
      z: spawn.z,
      yaw: 0,
      pitch: 0,
      serverTick: this.tickNumber,
      vy: 0,
      vx: 0,
      vz: 0,
      grounded: true,
      groundedPlatformPid: null,
      lastProcessedSequence: 0,
      body,
      collider
    };

    this.globalChannel.subscribe(user);
    this.spatialChannel.addEntity(player);
    this.playersByUserId.set(user.id, player);
    this.usersById.set(user.id, user);

    const view = new AABB3D(player.x, player.y, player.z, 128, 64, 128);
    user.view = view;
    this.spatialChannel.subscribe(user, view);

    user.queueMessage({
      ntype: NType.IdentityMessage,
      playerNid: player.nid
    });
  }

  public removeUser(user: UserLike): void {
    const player = this.playersByUserId.get(user.id);
    if (!player) {
      return;
    }

    this.spatialChannel.removeEntity(player);
    this.playersByUserId.delete(user.id);
    this.usersById.delete(user.id);
    this.world.removeCollider(player.collider, true);
    this.world.removeRigidBody(player.body);
  }

  public applyCommands(user: UserLike, commands: unknown[]): void {
    const player = this.playersByUserId.get(user.id);
    if (!player) {
      return;
    }

    let latestSequence = player.lastProcessedSequence;
    let hasAcceptedCommand = false;
    let mergedForward = 0;
    let mergedStrafe = 0;
    let mergedPitch = player.pitch;
    let mergedSprint = false;
    let queuedJump = false;
    let accumulatedYawDelta = 0;

    for (const rawCommand of commands) {
      const command = rawCommand as Partial<InputCommand>;
      if (
        typeof command.forward !== "number" ||
        typeof command.strafe !== "number" ||
        typeof command.yawDelta !== "number" ||
        typeof command.pitch !== "number"
      ) {
        continue;
      }

      const pitch = command.pitch ?? mergedPitch;
      const yawDelta = normalizeYaw(command.yawDelta ?? 0);
      const forward = command.forward ?? mergedForward;
      const strafe = command.strafe ?? mergedStrafe;
      const sprint = Boolean(command.sprint);
      const sequence =
        typeof command.sequence === "number"
          ? (command.sequence & 0xffff)
          : ((latestSequence + 1) & 0xffff);
      if (!this.isSequenceAheadOf(latestSequence, sequence)) {
        continue;
      }

      hasAcceptedCommand = true;
      latestSequence = sequence;
      mergedForward = forward;
      mergedStrafe = strafe;
      mergedPitch = pitch;
      mergedSprint = sprint;
      queuedJump = queuedJump || Boolean(command.jump);
      accumulatedYawDelta = normalizeYaw(accumulatedYawDelta + yawDelta);
    }

    if (!hasAcceptedCommand) {
      return;
    }

    if (queuedJump && player.grounded) {
      player.vy = PLAYER_JUMP_VELOCITY;
      player.grounded = false;
      player.groundedPlatformPid = null;
    }

    player.yaw = normalizeYaw(player.yaw + accumulatedYawDelta);
    const speedScale = mergedSprint ? PLAYER_SPRINT_SPEED / PLAYER_WALK_SPEED : 1;
    const horizontal = stepHorizontalMovement(
      { vx: player.vx, vz: player.vz },
      { forward: mergedForward, strafe: mergedStrafe, sprint: false, yaw: player.yaw },
      player.grounded,
      SERVER_TICK_SECONDS
    );
    player.vx = horizontal.vx * speedScale;
    player.vz = horizontal.vz * speedScale;
    player.pitch = Math.max(-1.45, Math.min(1.45, mergedPitch));
    player.lastProcessedSequence = latestSequence;
  }

  public step(delta: number): void {
    this.tickNumber += 1;
    const previousElapsedSeconds = this.elapsedSeconds;
    this.elapsedSeconds += delta;
    this.world.integrationParameters.dt = delta;
    this.updatePlatforms(previousElapsedSeconds, this.elapsedSeconds);

    for (const [userId, player] of this.playersByUserId.entries()) {
      const carry = this.samplePlayerPlatformCarry(player);
      player.yaw = normalizeYaw(player.yaw + carry.yaw);
      const attachedToPlatform = player.groundedPlatformPid !== null;
      if (attachedToPlatform) {
        // While attached to a platform, platform Y carry drives vertical motion directly.
        player.vy = 0;
      } else {
        // Gravity is applied through desired Y movement for the KCC query.
        if (player.grounded && player.vy < 0) {
          player.vy = 0;
        }
        player.vy += GRAVITY * delta;
      }

      const desired = {
        x: player.vx * delta + carry.x,
        y: player.vy * delta + carry.y,
        z: player.vz * delta + carry.z
      };
      this.characterController.computeColliderMovement(
        player.collider,
        desired,
        undefined,
        undefined,
        (collider) => {
          if (collider.handle === player.collider.handle) {
            return false;
          }
          return true;
        }
      );
      const corrected = this.characterController.computedMovement();

      const current = player.body.translation();
      player.body.setTranslation(
        {
          x: current.x + corrected.x,
          y: current.y + corrected.y,
          z: current.z + corrected.z
        },
        true
      );

      const moved = player.body.translation();
      const groundedByQuery = this.characterController.computedGrounded();
      const canAttachToPlatform =
        groundedByQuery || player.groundedPlatformPid !== null || player.vy <= 0;
      const groundedPlatformPid = canAttachToPlatform
        ? this.findGroundedPlatformPid(moved.x, moved.y, moved.z, player.groundedPlatformPid)
        : null;
      player.grounded = groundedByQuery || groundedPlatformPid !== null;
      if (player.grounded && player.vy < 0) {
        player.vy = 0;
      }
      player.groundedPlatformPid = player.grounded ? groundedPlatformPid : null;

      player.x = moved.x;
      player.y = moved.y + PLAYER_CAMERA_OFFSET_Y;
      player.z = moved.z;
      player.serverTick = this.tickNumber;

      this.syncUserView(userId, player);
      this.queueInputAck(userId, player, carry.yaw);
    }

    this.world.step();
  }

  private createStaticWorldColliders(): void {
    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(128, 0.5, 128), groundBody);

    const staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const block of STATIC_WORLD_BLOCKS) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(block.halfX, block.halfY, block.halfZ).setTranslation(
          block.x,
          block.y,
          block.z
        ),
        staticBody
      );
    }
  }

  private initializePlatforms(): void {
    for (const definition of PLATFORM_DEFINITIONS) {
      const pose = samplePlatformTransform(definition, 0);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pose.x, pose.y, pose.z)
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(definition.halfX, definition.halfY, definition.halfZ),
        body
      );

      const platform: PlatformEntity = {
        nid: 0,
        ntype: NType.PlatformEntity,
        pid: definition.pid,
        kind: definition.kind,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        serverTick: this.tickNumber,
        halfX: definition.halfX,
        halfY: definition.halfY,
        halfZ: definition.halfZ,
        prevX: pose.x,
        prevY: pose.y,
        prevZ: pose.z,
        prevYaw: pose.yaw,
        definition,
        body,
        collider
      };
      this.platformsByPid.set(platform.pid, platform);
      this.spatialChannel.addEntity(platform);
    }
  }

  private updatePlatforms(previousElapsedSeconds: number, elapsedSeconds: number): void {
    for (const platform of this.platformsByPid.values()) {
      const previousPose = samplePlatformTransform(platform.definition, previousElapsedSeconds);
      const currentPose = samplePlatformTransform(platform.definition, elapsedSeconds);
      platform.prevX = previousPose.x;
      platform.prevY = previousPose.y;
      platform.prevZ = previousPose.z;
      platform.prevYaw = previousPose.yaw;
      platform.x = currentPose.x;
      platform.y = currentPose.y;
      platform.z = currentPose.z;
      platform.yaw = currentPose.yaw;
      platform.serverTick = this.tickNumber;

      platform.body.setTranslation({ x: platform.x, y: platform.y, z: platform.z }, true);
      platform.body.setRotation(
        { x: 0, y: Math.sin(platform.yaw * 0.5), z: 0, w: Math.cos(platform.yaw * 0.5) },
        true
      );
    }
  }

  private samplePlayerPlatformCarry(player: PlayerEntity): { x: number; y: number; z: number; yaw: number } {
    if (!player.grounded || player.groundedPlatformPid === null) {
      return { x: 0, y: 0, z: 0, yaw: 0 };
    }

    const platform = this.platformsByPid.get(player.groundedPlatformPid);
    if (!platform) {
      player.groundedPlatformPid = null;
      return { x: 0, y: 0, z: 0, yaw: 0 };
    }

    const bodyPos = player.body.translation();
    const carried = applyPlatformCarry(
      { x: platform.prevX, y: platform.prevY, z: platform.prevZ, yaw: platform.prevYaw },
      { x: platform.x, y: platform.y, z: platform.z, yaw: platform.yaw },
      { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z }
    );

    return {
      x: carried.x - bodyPos.x,
      y: carried.y - bodyPos.y,
      z: carried.z - bodyPos.z,
      yaw: normalizeYaw(platform.yaw - platform.prevYaw)
    };
  }

  private findGroundedPlatformPid(
    bodyX: number,
    bodyY: number,
    bodyZ: number,
    preferredPid: number | null
  ): number | null {
    const footY = bodyY - (PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS);
    const baseVerticalTolerance = 0.25;
    const preferredVerticalTolerance = 0.45;
    const maxBelowTopTolerance = 0.2;
    const horizontalMargin = PLAYER_CAPSULE_RADIUS * 0.75;
    let selectedPid: number | null = null;
    let closestVerticalGapAbs = Number.POSITIVE_INFINITY;

    for (const platform of this.platformsByPid.values()) {
      const local = toPlatformLocal(platform, bodyX, bodyZ);
      const withinX = Math.abs(local.x) <= platform.halfX + horizontalMargin;
      const withinZ = Math.abs(local.z) <= platform.halfZ + horizontalMargin;
      if (!withinX || !withinZ) {
        continue;
      }

      const topY = platform.y + platform.halfY;
      const signedGap = footY - topY;
      if (signedGap < -maxBelowTopTolerance) {
        continue;
      }
      const maxGap =
        preferredPid !== null && platform.pid === preferredPid
          ? preferredVerticalTolerance
          : baseVerticalTolerance;
      if (signedGap > maxGap) {
        continue;
      }

      const gapAbs = Math.abs(signedGap);
      if (gapAbs >= closestVerticalGapAbs) {
        continue;
      }

      closestVerticalGapAbs = gapAbs;
      selectedPid = platform.pid;
    }

    return selectedPid;
  }

  private queueInputAck(userId: number, player: PlayerEntity, platformYawDelta: number): void {
    const user = this.usersById.get(userId);
    if (!user) {
      return;
    }
    user.queueMessage({
      ntype: NType.InputAckMessage,
      sequence: player.lastProcessedSequence,
      serverTick: this.tickNumber,
      x: player.x,
      y: player.y,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
      vx: player.vx,
      vy: player.vy,
      vz: player.vz,
      grounded: player.grounded,
      groundedPlatformPid: player.groundedPlatformPid ?? -1,
      platformYawDelta
    });
  }

  private syncUserView(userId: number, player: PlayerEntity): void {
    const user = this.usersById.get(userId);
    if (!user?.view) {
      return;
    }
    user.view.x = player.x;
    user.view.y = player.y;
    user.view.z = player.z;
  }

  private getSpawnPosition(): { x: number; z: number } {
    const occupied = Array.from(this.playersByUserId.values(), (player) => ({ x: player.x, z: player.z }));

    const minSeparation = PLAYER_CAPSULE_RADIUS * 4;
    const minSeparationSq = minSeparation * minSeparation;
    const baseRadius = 2.25;
    const ringStep = 1.5;
    const maxRings = 64;

    for (let ring = 0; ring <= maxRings; ring += 1) {
      const radius = baseRadius + ring * ringStep;
      const circumference = Math.max(radius * Math.PI * 2, minSeparation);
      const slots = Math.max(8, Math.ceil(circumference / minSeparation));
      const angleOffset = ring % 2 === 0 ? 0 : Math.PI / slots;

      for (let slot = 0; slot < slots; slot += 1) {
        const angle = (slot / slots) * Math.PI * 2 + angleOffset;
        const candidateX = Math.cos(angle) * radius;
        const candidateZ = Math.sin(angle) * radius;
        let intersectsExisting = false;

        for (const position of occupied) {
          const dx = candidateX - position.x;
          const dz = candidateZ - position.z;
          if (dx * dx + dz * dz < minSeparationSq) {
            intersectsExisting = true;
            break;
          }
        }

        if (!intersectsExisting) {
          return { x: candidateX, z: candidateZ };
        }
      }
    }

    return { x: baseRadius + (maxRings + 1) * ringStep, z: 0 };
  }

  private isSequenceAheadOf(lastSequence: number, candidateSequence: number): boolean {
    const delta = (candidateSequence - lastSequence + INPUT_SEQUENCE_MODULO) % INPUT_SEQUENCE_MODULO;
    return delta > 0 && delta < INPUT_SEQUENCE_HALF_RANGE;
  }
}
