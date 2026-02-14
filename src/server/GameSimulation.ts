import RAPIER from "@dimforge/rapier3d-compat";
import { AABB3D, Channel, ChannelAABB3D } from "nengi";
import {
  ABILITY_DYNAMIC_ID_START,
  ABILITY_ID_NONE,
  abilityCategoryFromWireValue,
  abilityCategoryToWireValue,
  applyPlatformCarry,
  clampHotbarSlotIndex,
  createAbilityDefinitionFromDraft,
  DEFAULT_HOTBAR_ABILITY_IDS,
  DEFAULT_UNLOCKED_ABILITY_IDS,
  decodeAbilityAttributeMask,
  encodeAbilityAttributeMask,
  GRAVITY,
  getAbilityDefinitionById,
  HOTBAR_SLOT_COUNT,
  NType,
  normalizeYaw,
  PLATFORM_DEFINITIONS,
  PLAYER_BODY_CENTER_HEIGHT,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_JUMP_VELOCITY,
  PLAYER_MAX_HEALTH,
  SERVER_TICK_SECONDS,
  samplePlatformTransform,
  PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED,
  STATIC_WORLD_BLOCKS,
  toPlatformLocal,
  stepHorizontalMovement
} from "../shared/index";
import type { AbilityDefinition } from "../shared/index";

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
  health: number;
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
  lastPrimaryFireAtSeconds: number;
  upperBodyAction: number;
  upperBodyActionNonce: number;
  lastProcessedSequence: number;
  lastAbilitySubmitNonce: number;
  unlockedAbilityIds: Set<number>;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

type ProjectileEntity = {
  nid: number;
  ntype: NType.ProjectileEntity;
  ownerNid: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  serverTick: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  damage: number;
  ttlSeconds: number;
  remainingRange: number;
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
  usePrimaryPressed: boolean;
  activeHotbarSlot: number;
  selectedAbilityId: number;
  yawDelta: number;
  pitch: number;
  delta: number;
};

type AbilityCreateCommand = {
  ntype: NType.AbilityCreateCommand;
  submitNonce: number;
  name: string;
  category: number;
  pointsPower: number;
  pointsVelocity: number;
  pointsEfficiency: number;
  pointsControl: number;
  attributeMask: number;
  targetHotbarSlot: number;
};

type RuntimeAbilityEntry = {
  ownerNid: number;
  definition: AbilityDefinition;
};

const INPUT_SEQUENCE_MODULO = 0x10000;
const INPUT_SEQUENCE_HALF_RANGE = INPUT_SEQUENCE_MODULO >>> 1;
const PROJECTILE_MAX_RANGE = 260;

export class GameSimulation {
  private readonly playersByUserId = new Map<number, PlayerEntity>();
  private readonly usersById = new Map<number, UserLike>();
  private readonly platformsByPid = new Map<number, PlatformEntity>();
  private readonly projectilesByNid = new Map<number, ProjectileEntity>();
  private readonly runtimeAbilitiesById = new Map<number, RuntimeAbilityEntry>();
  private readonly world: RAPIER.World;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private elapsedSeconds = 0;
  private tickNumber = 0;
  private nextRuntimeAbilityId = ABILITY_DYNAMIC_ID_START;

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
      health: PLAYER_MAX_HEALTH,
      activeHotbarSlot: 0,
      hotbarAbilityIds: this.createInitialHotbar(),
      lastPrimaryFireAtSeconds: Number.NEGATIVE_INFINITY,
      upperBodyAction: 0,
      upperBodyActionNonce: 0,
      lastProcessedSequence: 0,
      lastAbilitySubmitNonce: 0,
      unlockedAbilityIds: new Set<number>(DEFAULT_UNLOCKED_ABILITY_IDS),
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
    this.sendInitialAbilityState(user, player);
  }

  public removeUser(user: UserLike): void {
    const player = this.playersByUserId.get(user.id);
    if (!player) {
      return;
    }

    this.spatialChannel.removeEntity(player);
    this.playersByUserId.delete(user.id);
    this.usersById.delete(user.id);
    this.removeProjectilesByOwner(player.nid);
    this.removeRuntimeAbilitiesByOwner(player.nid);
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
    let mergedActiveHotbarSlot = this.sanitizeHotbarSlot(player.activeHotbarSlot, 0);
    const previousActiveHotbarSlot = mergedActiveHotbarSlot;
    const previousSelectedAbilityId = player.hotbarAbilityIds[mergedActiveHotbarSlot] ?? ABILITY_ID_NONE;
    let mergedSelectedAbilityId = this.sanitizeSelectedAbilityId(
      player.hotbarAbilityIds[mergedActiveHotbarSlot] ?? ABILITY_ID_NONE,
      ABILITY_ID_NONE,
      player
    );
    let requiresLoadoutResync = false;
    let queuedUsePrimaryPressed = false;
    let queuedJump = false;
    let accumulatedYawDelta = 0;

    for (const rawCommand of commands) {
      const ntype = (rawCommand as { ntype?: unknown })?.ntype;
      if (ntype === NType.AbilityCreateCommand) {
        this.processAbilityCreateCommand(user, player, rawCommand as Partial<AbilityCreateCommand>);
        continue;
      }

      const command = rawCommand as Partial<InputCommand>;
      if (command.ntype !== NType.InputCommand) {
        continue;
      }
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
      const nextHotbarSlot = this.sanitizeHotbarSlot(command.activeHotbarSlot, mergedActiveHotbarSlot);
      if (nextHotbarSlot !== mergedActiveHotbarSlot) {
        mergedActiveHotbarSlot = nextHotbarSlot;
        mergedSelectedAbilityId = this.sanitizeSelectedAbilityId(
          player.hotbarAbilityIds[mergedActiveHotbarSlot] ?? ABILITY_ID_NONE,
          ABILITY_ID_NONE,
          player
        );
      }
      const requestedSelectedAbilityId =
        typeof command.selectedAbilityId === "number" && Number.isFinite(command.selectedAbilityId)
          ? Math.max(0, Math.floor(command.selectedAbilityId))
          : null;
      const nextSelectedAbilityId = this.sanitizeSelectedAbilityId(
        command.selectedAbilityId,
        mergedSelectedAbilityId,
        player
      );
      if (requestedSelectedAbilityId !== null && requestedSelectedAbilityId !== nextSelectedAbilityId) {
        requiresLoadoutResync = true;
      }
      mergedSelectedAbilityId = nextSelectedAbilityId;
      queuedUsePrimaryPressed = queuedUsePrimaryPressed || Boolean(command.usePrimaryPressed);
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
    player.activeHotbarSlot = mergedActiveHotbarSlot;
    player.hotbarAbilityIds[mergedActiveHotbarSlot] = mergedSelectedAbilityId;
    const loadoutChanged =
      player.activeHotbarSlot !== previousActiveHotbarSlot ||
      player.hotbarAbilityIds[mergedActiveHotbarSlot] !== previousSelectedAbilityId;
    if (loadoutChanged || requiresLoadoutResync) {
      this.queueLoadoutStateMessage(user, player);
    }
    if (queuedUsePrimaryPressed) {
      this.tryUsePrimaryAbility(player);
    }
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

    this.updateProjectiles(delta);
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

  private processAbilityCreateCommand(
    user: UserLike,
    player: PlayerEntity,
    command: Partial<AbilityCreateCommand>
  ): void {
    if (typeof command.submitNonce !== "number") {
      return;
    }
    const submitNonce = command.submitNonce & 0xffff;
    if (!this.isSequenceAheadOf(player.lastAbilitySubmitNonce, submitNonce)) {
      return;
    }
    player.lastAbilitySubmitNonce = submitNonce;

    const category = abilityCategoryFromWireValue(command.category ?? 0);
    if (!category) {
      this.queueAbilityCreateResultMessage(user, submitNonce, false, ABILITY_ID_NONE, "Invalid category.");
      return;
    }

    const abilityDefinition = createAbilityDefinitionFromDraft(this.allocateRuntimeAbilityId(), {
      name: typeof command.name === "string" ? command.name : "",
      category,
      points: {
        power: typeof command.pointsPower === "number" ? command.pointsPower : 0,
        velocity: typeof command.pointsVelocity === "number" ? command.pointsVelocity : 0,
        efficiency: typeof command.pointsEfficiency === "number" ? command.pointsEfficiency : 0,
        control: typeof command.pointsControl === "number" ? command.pointsControl : 0
      },
      attributes: decodeAbilityAttributeMask(
        typeof command.attributeMask === "number" ? command.attributeMask : 0
      )
    });

    if (!abilityDefinition) {
      this.queueAbilityCreateResultMessage(
        user,
        submitNonce,
        false,
        ABILITY_ID_NONE,
        "Draft validation failed."
      );
      return;
    }

    this.runtimeAbilitiesById.set(abilityDefinition.id, {
      ownerNid: player.nid,
      definition: abilityDefinition
    });
    player.unlockedAbilityIds.add(abilityDefinition.id);

    const targetSlot = this.sanitizeHotbarSlot(command.targetHotbarSlot, player.activeHotbarSlot);
    player.hotbarAbilityIds[targetSlot] = abilityDefinition.id;
    player.activeHotbarSlot = targetSlot;

    this.queueAbilityDefinitionMessage(user, abilityDefinition);
    this.queueLoadoutStateMessage(user, player);
    this.queueAbilityCreateResultMessage(
      user,
      submitNonce,
      true,
      abilityDefinition.id,
      `${abilityDefinition.name} created.`
    );
  }

  private sendInitialAbilityState(user: UserLike, player: PlayerEntity): void {
    for (const abilityId of player.unlockedAbilityIds) {
      const ability = this.getAbilityDefinitionForPlayer(player, abilityId);
      if (!ability) {
        continue;
      }
      this.queueAbilityDefinitionMessage(user, ability);
    }
    this.queueLoadoutStateMessage(user, player);
  }

  private queueAbilityDefinitionMessage(user: UserLike, ability: AbilityDefinition): void {
    const projectile = ability.projectile;
    user.queueMessage({
      ntype: NType.AbilityDefinitionMessage,
      abilityId: ability.id,
      name: ability.name,
      category: abilityCategoryToWireValue(ability.category),
      pointsPower: ability.points.power,
      pointsVelocity: ability.points.velocity,
      pointsEfficiency: ability.points.efficiency,
      pointsControl: ability.points.control,
      attributeMask: encodeAbilityAttributeMask(ability.attributes),
      kind: projectile?.kind ?? 0,
      speed: projectile?.speed ?? 0,
      damage: projectile?.damage ?? 0,
      radius: projectile?.radius ?? 0,
      cooldownSeconds: projectile?.cooldownSeconds ?? 0,
      lifetimeSeconds: projectile?.lifetimeSeconds ?? 0,
      spawnForwardOffset: projectile?.spawnForwardOffset ?? 0,
      spawnVerticalOffset: projectile?.spawnVerticalOffset ?? 0
    });
  }

  private queueLoadoutStateMessage(user: UserLike, player: PlayerEntity): void {
    user.queueMessage({
      ntype: NType.LoadoutStateMessage,
      selectedHotbarSlot: this.sanitizeHotbarSlot(player.activeHotbarSlot, 0),
      slot0AbilityId: player.hotbarAbilityIds[0] ?? ABILITY_ID_NONE,
      slot1AbilityId: player.hotbarAbilityIds[1] ?? ABILITY_ID_NONE,
      slot2AbilityId: player.hotbarAbilityIds[2] ?? ABILITY_ID_NONE,
      slot3AbilityId: player.hotbarAbilityIds[3] ?? ABILITY_ID_NONE,
      slot4AbilityId: player.hotbarAbilityIds[4] ?? ABILITY_ID_NONE
    });
  }

  private queueAbilityCreateResultMessage(
    user: UserLike,
    submitNonce: number,
    success: boolean,
    createdAbilityId: number,
    message: string
  ): void {
    user.queueMessage({
      ntype: NType.AbilityCreateResultMessage,
      submitNonce: submitNonce & 0xffff,
      success,
      createdAbilityId: Math.max(0, Math.min(0xffff, Math.floor(createdAbilityId))),
      message
    });
  }

  private allocateRuntimeAbilityId(): number {
    while (this.runtimeAbilitiesById.has(this.nextRuntimeAbilityId) || getAbilityDefinitionById(this.nextRuntimeAbilityId)) {
      this.nextRuntimeAbilityId += 1;
      if (this.nextRuntimeAbilityId > 0xffff) {
        this.nextRuntimeAbilityId = ABILITY_DYNAMIC_ID_START;
      }
    }
    const allocated = this.nextRuntimeAbilityId;
    this.nextRuntimeAbilityId += 1;
    if (this.nextRuntimeAbilityId > 0xffff) {
      this.nextRuntimeAbilityId = ABILITY_DYNAMIC_ID_START;
    }
    return allocated;
  }

  private removeRuntimeAbilitiesByOwner(ownerNid: number): void {
    for (const [abilityId, abilityEntry] of this.runtimeAbilitiesById) {
      if (abilityEntry.ownerNid === ownerNid) {
        this.runtimeAbilitiesById.delete(abilityId);
      }
    }
  }

  private getAbilityDefinitionForPlayer(
    player: PlayerEntity,
    abilityId: number
  ): AbilityDefinition | null {
    if (!player.unlockedAbilityIds.has(abilityId)) {
      return null;
    }

    const staticAbility = getAbilityDefinitionById(abilityId);
    if (staticAbility) {
      return staticAbility;
    }

    const runtimeAbility = this.runtimeAbilitiesById.get(abilityId);
    if (!runtimeAbility) {
      return null;
    }
    if (runtimeAbility.ownerNid !== player.nid) {
      return null;
    }
    return runtimeAbility.definition;
  }

  private sanitizeHotbarSlot(rawSlot: unknown, fallbackSlot: number): number {
    if (typeof rawSlot !== "number" || !Number.isFinite(rawSlot)) {
      return fallbackSlot;
    }
    return clampHotbarSlotIndex(rawSlot);
  }

  private sanitizeSelectedAbilityId(
    rawAbilityId: unknown,
    fallbackAbilityId: number,
    player: PlayerEntity
  ): number {
    if (typeof rawAbilityId !== "number" || !Number.isFinite(rawAbilityId)) {
      return fallbackAbilityId;
    }

    const normalized = Math.max(0, Math.floor(rawAbilityId));
    if (normalized === ABILITY_ID_NONE) {
      return ABILITY_ID_NONE;
    }
    if (!player.unlockedAbilityIds.has(normalized)) {
      return fallbackAbilityId;
    }
    return this.getAbilityDefinitionForPlayer(player, normalized) ? normalized : fallbackAbilityId;
  }

  private createInitialHotbar(): number[] {
    const hotbar = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      hotbar[slot] = DEFAULT_HOTBAR_ABILITY_IDS[slot] ?? ABILITY_ID_NONE;
    }
    return hotbar;
  }

  private tryUsePrimaryAbility(player: PlayerEntity): void {
    const slot = clampHotbarSlotIndex(player.activeHotbarSlot);
    const abilityId = this.sanitizeSelectedAbilityId(
      player.hotbarAbilityIds[slot] ?? ABILITY_ID_NONE,
      ABILITY_ID_NONE,
      player
    );
    const ability = this.getAbilityDefinitionForPlayer(player, abilityId);
    const projectileProfile = ability?.projectile;
    if (!projectileProfile) {
      return;
    }

    const secondsSinceLastFire = this.elapsedSeconds - player.lastPrimaryFireAtSeconds;
    if (secondsSinceLastFire < projectileProfile.cooldownSeconds) {
      return;
    }

    player.lastPrimaryFireAtSeconds = this.elapsedSeconds;
    player.upperBodyAction = 1;
    player.upperBodyActionNonce = (player.upperBodyActionNonce + 1) & 0xffff;

    const cosPitch = Math.cos(player.pitch);
    const dirX = -Math.sin(player.yaw) * cosPitch;
    const dirY = Math.sin(player.pitch);
    const dirZ = -Math.cos(player.yaw) * cosPitch;

    const spawnX = player.x + dirX * projectileProfile.spawnForwardOffset;
    const spawnY = player.y + projectileProfile.spawnVerticalOffset + dirY * projectileProfile.spawnForwardOffset;
    const spawnZ = player.z + dirZ * projectileProfile.spawnForwardOffset;

    const projectile: ProjectileEntity = {
      nid: 0,
      ntype: NType.ProjectileEntity,
      ownerNid: player.nid,
      kind: projectileProfile.kind,
      x: spawnX,
      y: spawnY,
      z: spawnZ,
      serverTick: this.tickNumber,
      vx: dirX * projectileProfile.speed,
      vy: dirY * projectileProfile.speed,
      vz: dirZ * projectileProfile.speed,
      radius: projectileProfile.radius,
      damage: projectileProfile.damage,
      ttlSeconds: projectileProfile.lifetimeSeconds,
      remainingRange: PROJECTILE_MAX_RANGE
    };

    this.spatialChannel.addEntity(projectile);
    this.projectilesByNid.set(projectile.nid, projectile);
  }

  private updateProjectiles(delta: number): void {
    for (const [nid, projectile] of this.projectilesByNid) {
      projectile.ttlSeconds -= delta;
      if (projectile.ttlSeconds <= 0) {
        this.removeProjectile(nid, projectile);
        continue;
      }

      const nextX = projectile.x + projectile.vx * delta;
      const nextY = projectile.y + projectile.vy * delta;
      const nextZ = projectile.z + projectile.vz * delta;
      const traveledDistance = Math.hypot(
        projectile.vx * delta,
        projectile.vy * delta,
        projectile.vz * delta
      );
      projectile.remainingRange -= traveledDistance;
      if (projectile.remainingRange <= 0) {
        this.removeProjectile(nid, projectile);
        continue;
      }

      if (this.isProjectileBlockedByWorld(nextX, nextY, nextZ, projectile.radius)) {
        this.removeProjectile(nid, projectile);
        continue;
      }

      const hitPlayer = this.findProjectileHitPlayer(projectile, nextX, nextY, nextZ);
      if (hitPlayer) {
        this.applyProjectileDamage(hitPlayer, projectile.damage);
        this.removeProjectile(nid, projectile);
        continue;
      }

      projectile.x = nextX;
      projectile.y = nextY;
      projectile.z = nextZ;
      projectile.serverTick = this.tickNumber;
    }
  }

  private isProjectileBlockedByWorld(x: number, y: number, z: number, radius: number): boolean {
    if (y - radius <= 0) {
      return true;
    }

    for (const block of STATIC_WORLD_BLOCKS) {
      const withinX = Math.abs(x - block.x) <= block.halfX + radius;
      const withinY = Math.abs(y - block.y) <= block.halfY + radius;
      const withinZ = Math.abs(z - block.z) <= block.halfZ + radius;
      if (withinX && withinY && withinZ) {
        return true;
      }
    }

    for (const platform of this.platformsByPid.values()) {
      const local = toPlatformLocal(platform, x, z);
      const withinX = Math.abs(local.x) <= platform.halfX + radius;
      const withinY = Math.abs(y - platform.y) <= platform.halfY + radius;
      const withinZ = Math.abs(local.z) <= platform.halfZ + radius;
      if (withinX && withinY && withinZ) {
        return true;
      }
    }

    return false;
  }

  private findProjectileHitPlayer(
    projectile: ProjectileEntity,
    x: number,
    y: number,
    z: number
  ): PlayerEntity | null {
    const combinedRadius = PLAYER_CAPSULE_RADIUS + projectile.radius;
    const combinedRadiusSq = combinedRadius * combinedRadius;

    for (const candidate of this.playersByUserId.values()) {
      if (candidate.nid === projectile.ownerNid) {
        continue;
      }
      const bodyPos = candidate.body.translation();
      const segmentMinY = bodyPos.y - PLAYER_CAPSULE_HALF_HEIGHT;
      const segmentMaxY = bodyPos.y + PLAYER_CAPSULE_HALF_HEIGHT;
      const closestY = Math.max(segmentMinY, Math.min(segmentMaxY, y));
      const dx = x - bodyPos.x;
      const dy = y - closestY;
      const dz = z - bodyPos.z;
      if (dx * dx + dy * dy + dz * dz <= combinedRadiusSq) {
        return candidate;
      }
    }

    return null;
  }

  private applyProjectileDamage(target: PlayerEntity, damage: number): void {
    target.health = Math.max(0, target.health - Math.max(0, Math.floor(damage)));
    if (target.health > 0) {
      return;
    }
    this.respawnPlayer(target);
  }

  private respawnPlayer(player: PlayerEntity): void {
    const spawn = this.getSpawnPosition();
    player.body.setTranslation(
      { x: spawn.x, y: PLAYER_BODY_CENTER_HEIGHT, z: spawn.z },
      true
    );
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.grounded = true;
    player.groundedPlatformPid = null;
    player.health = PLAYER_MAX_HEALTH;
    player.x = spawn.x;
    player.y = PLAYER_BODY_CENTER_HEIGHT + PLAYER_CAMERA_OFFSET_Y;
    player.z = spawn.z;
    player.serverTick = this.tickNumber;
  }

  private removeProjectilesByOwner(ownerNid: number): void {
    for (const [nid, projectile] of this.projectilesByNid) {
      if (projectile.ownerNid === ownerNid) {
        this.removeProjectile(nid, projectile);
      }
    }
  }

  private removeProjectile(nid: number, projectile: ProjectileEntity): void {
    this.spatialChannel.removeEntity(projectile);
    this.projectilesByNid.delete(nid);
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
