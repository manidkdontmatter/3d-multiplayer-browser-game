import RAPIER from "@dimforge/rapier3d-compat";
import { AABB3D, Channel, ChannelAABB3D } from "nengi";
import {
  ABILITY_ID_NONE,
  ABILITY_ID_PUNCH,
  abilityCategoryToWireValue,
  applyPlatformCarry,
  clampHotbarSlotIndex,
  DEFAULT_HOTBAR_ABILITY_IDS,
  DEFAULT_UNLOCKED_ABILITY_IDS,
  encodeAbilityAttributeMask,
  getAbilityDefinitionById,
  HOTBAR_SLOT_COUNT,
  NType,
  normalizeYaw,
  PLATFORM_DEFINITIONS,
  PlatformSpatialIndex,
  PLAYER_BODY_CENTER_HEIGHT,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_JUMP_VELOCITY,
  PLAYER_MAX_HEALTH,
  SERVER_TICK_SECONDS,
  samplePlatformTransform,
  STATIC_WORLD_BLOCKS,
  toPlatformLocal,
  stepHorizontalMovement
} from "../shared/index";
import type { AbilityDefinition, MeleeAbilityProfile } from "../shared/index";
import type {
  InputCommand as InputWireCommand,
  LoadoutCommand as LoadoutWireCommand
} from "../shared/netcode";
import {
  type PlayerSnapshot,
  PersistenceService
} from "./persistence/PersistenceService";
import {
  DamageSystem,
  type CombatTarget
} from "./combat/damage/DamageSystem";
import { ProjectileSystem } from "./combat/projectiles/ProjectileSystem";
import { PlayerMovementSystem } from "./movement/PlayerMovementSystem";

type UserLike = {
  id: number;
  queueMessage: (message: unknown) => void;
  accountId?: number;
  view?: AABB3D;
};

type PlayerEntity = {
  accountId: number;
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
  lastProcessedSequence: number;
  primaryHeld: boolean;
  unlockedAbilityIds: Set<number>;
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

type TrainingDummyEntity = {
  nid: number;
  ntype: NType.TrainingDummyEntity;
  x: number;
  y: number;
  z: number;
  yaw: number;
  serverTick: number;
  health: number;
  maxHealth: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

type PendingOfflineSnapshot = {
  snapshot: PlayerSnapshot;
  dirtyCharacter: boolean;
  dirtyAbilityState: boolean;
};

const INPUT_SEQUENCE_MODULO = 0x10000;
const INPUT_SEQUENCE_HALF_RANGE = INPUT_SEQUENCE_MODULO >>> 1;
const MELEE_DIRECTION_EPSILON = 1e-6;
const ABILITY_USE_EVENT_RADIUS = PLAYER_CAPSULE_RADIUS * 2;
const TRAINING_DUMMY_MAX_HEALTH = 160;
const TRAINING_DUMMY_RADIUS = 0.42;
const TRAINING_DUMMY_HALF_HEIGHT = 0.95;
const TRAINING_DUMMY_SPAWNS = [{ x: 7, y: TRAINING_DUMMY_HALF_HEIGHT, z: -5, yaw: 0 }] as const;

export class GameSimulation {
  private readonly playersByUserId = new Map<number, PlayerEntity>();
  private readonly playersByAccountId = new Map<number, PlayerEntity>();
  private readonly playersByNid = new Map<number, PlayerEntity>();
  private readonly trainingDummiesByNid = new Map<number, TrainingDummyEntity>();
  private readonly usersById = new Map<number, UserLike>();
  private readonly platformsByPid = new Map<number, PlatformEntity>();
  private readonly platformSpatialIndex = new PlatformSpatialIndex();
  private readonly platformQueryScratch: number[] = [];
  private readonly dirtyCharacterAccountIds = new Set<number>();
  private readonly dirtyAbilityStateAccountIds = new Set<number>();
  private readonly pendingOfflineSnapshots = new Map<number, PendingOfflineSnapshot>();
  private readonly world: RAPIER.World;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly damageSystem: DamageSystem;
  private readonly projectileSystem: ProjectileSystem;
  private readonly playerMovementSystem: PlayerMovementSystem<PlayerEntity>;
  private elapsedSeconds = 0;
  private tickNumber = 0;

  public constructor(
    private readonly globalChannel: Channel,
    private readonly spatialChannel: ChannelAABB3D,
    private readonly persistence: PersistenceService
  ) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.integrationParameters.dt = SERVER_TICK_SECONDS;
    this.characterController = this.world.createCharacterController(0.01);
    this.characterController.setSlideEnabled(true);
    this.characterController.enableSnapToGround(0.2);
    this.characterController.disableAutostep();
    this.characterController.setMaxSlopeClimbAngle((60 * Math.PI) / 180);
    this.characterController.setMinSlopeSlideAngle((80 * Math.PI) / 180);
    this.damageSystem = new DamageSystem({
      maxPlayerHealth: PLAYER_MAX_HEALTH,
      playerBodyCenterHeight: PLAYER_BODY_CENTER_HEIGHT,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      getTickNumber: () => this.tickNumber,
      getSpawnPosition: () => this.getSpawnPosition(),
      markPlayerDirty: (player, options) => this.markPlayerDirty(player as PlayerEntity, options)
    });
    this.projectileSystem = new ProjectileSystem({
      world: this.world,
      spatialChannel: this.spatialChannel,
      getTickNumber: () => this.tickNumber,
      getOwnerCollider: (ownerNid) => this.playersByNid.get(ownerNid)?.collider,
      resolveTargetByColliderHandle: (colliderHandle) =>
        this.damageSystem.resolveTargetByColliderHandle(colliderHandle),
      applyDamage: (target, damage) => this.damageSystem.applyDamage(target, damage)
    });
    this.playerMovementSystem = new PlayerMovementSystem<PlayerEntity>({
      characterController: this.characterController,
      getTickNumber: () => this.tickNumber,
      beforePlayerMove: (player) => {
        if (player.primaryHeld) {
          this.tryUsePrimaryAbility(player);
        }
      },
      samplePlayerPlatformCarry: (player) => this.samplePlayerPlatformCarry(player),
      findGroundedPlatformPid: (bodyX, bodyY, bodyZ, preferredPid) =>
        this.findGroundedPlatformPid(bodyX, bodyY, bodyZ, preferredPid),
      onPlayerStepped: (userId, player, platformYawDelta) => {
        this.syncUserView(userId, player);
        this.queueInputAck(userId, player, platformYawDelta);
        this.markPlayerDirty(player, {
          dirtyCharacter: true,
          dirtyAbilityState: false
        });
      }
    });

    this.createStaticWorldColliders();
    this.initializePlatforms();
    this.initializeTrainingDummies();
  }

  public addUser(user: UserLike): void {
    const accountId = typeof user.accountId === "number" && Number.isFinite(user.accountId)
      ? Math.max(1, Math.floor(user.accountId))
      : null;
    if (accountId === null) {
      return;
    }

    const pendingOfflineSnapshot = this.pendingOfflineSnapshots.get(accountId);
    const loaded = pendingOfflineSnapshot?.snapshot ?? this.persistence.loadPlayerState(accountId);
    const spawn = loaded ? { x: loaded.x, z: loaded.z } : this.getSpawnPosition();
    const initialCameraY = loaded?.y ?? (PLAYER_BODY_CENTER_HEIGHT + PLAYER_CAMERA_OFFSET_Y);
    const initialBodyY = initialCameraY - PLAYER_CAMERA_OFFSET_Y;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        initialBodyY,
        spawn.z
      )
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS).setFriction(0),
      body
    );

    const player: PlayerEntity = {
      accountId,
      nid: 0,
      ntype: NType.PlayerEntity,
      x: spawn.x,
      y: initialCameraY,
      z: spawn.z,
      yaw: loaded?.yaw ?? 0,
      pitch: loaded?.pitch ?? 0,
      serverTick: this.tickNumber,
      vy: loaded?.vy ?? 0,
      vx: loaded?.vx ?? 0,
      vz: loaded?.vz ?? 0,
      grounded: false,
      groundedPlatformPid: null,
      health: this.clampHealth(loaded?.health ?? PLAYER_MAX_HEALTH),
      activeHotbarSlot: this.sanitizeHotbarSlot(loaded?.activeHotbarSlot ?? 0, 0),
      hotbarAbilityIds: this.createInitialHotbar(loaded?.hotbarAbilityIds),
      lastPrimaryFireAtSeconds: Number.NEGATIVE_INFINITY,
      lastProcessedSequence: 0,
      primaryHeld: false,
      unlockedAbilityIds: new Set<number>(DEFAULT_UNLOCKED_ABILITY_IDS),
      body,
      collider
    };

    this.ensurePunchAssigned(player);

    this.globalChannel.subscribe(user);
    this.spatialChannel.addEntity(player);
    this.playersByUserId.set(user.id, player);
    this.playersByAccountId.set(player.accountId, player);
    this.playersByNid.set(player.nid, player);
    this.damageSystem.registerPlayer(player);
    this.usersById.set(user.id, user);
    this.pendingOfflineSnapshots.delete(player.accountId);
    if (!pendingOfflineSnapshot?.dirtyCharacter) {
      this.dirtyCharacterAccountIds.delete(player.accountId);
    }
    if (!pendingOfflineSnapshot?.dirtyAbilityState) {
      this.dirtyAbilityStateAccountIds.delete(player.accountId);
    }

    const view = new AABB3D(player.x, player.y, player.z, 128, 64, 128);
    user.view = view;
    this.spatialChannel.subscribe(user, view);

    user.queueMessage({
      ntype: NType.IdentityMessage,
      playerNid: player.nid
    });
    this.sendInitialAbilityState(user, player);
    this.markPlayerDirty(player, {
      dirtyCharacter: true,
      dirtyAbilityState: true
    });
  }

  public removeUser(user: UserLike): void {
    const player = this.playersByUserId.get(user.id);
    if (!player) {
      return;
    }

    this.pendingOfflineSnapshots.set(player.accountId, {
      snapshot: this.capturePlayerSnapshot(player),
      dirtyCharacter: true,
      dirtyAbilityState: true
    });
    this.dirtyCharacterAccountIds.add(player.accountId);
    this.dirtyAbilityStateAccountIds.add(player.accountId);
    this.spatialChannel.removeEntity(player);
    this.playersByUserId.delete(user.id);
    this.playersByAccountId.delete(player.accountId);
    this.playersByNid.delete(player.nid);
    this.damageSystem.unregisterCollider(player.collider.handle);
    this.usersById.delete(user.id);
    this.projectileSystem.removeByOwner(player.nid);
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
    let queuedUsePrimaryPressed = false;
    let mergedUsePrimaryHeld = player.primaryHeld;
    let queuedJump = false;
    let mergedYaw = player.yaw;

    for (const rawCommand of commands) {
      const ntype = (rawCommand as { ntype?: unknown })?.ntype;
      if (ntype === NType.LoadoutCommand) {
        this.processLoadoutCommand(user, player, rawCommand as Partial<LoadoutWireCommand>);
        continue;
      }

      const command = rawCommand as Partial<InputWireCommand>;
      if (command.ntype !== NType.InputCommand) {
        continue;
      }
      if (
        typeof command.forward !== "number" ||
        !Number.isFinite(command.forward) ||
        typeof command.strafe !== "number" ||
        !Number.isFinite(command.strafe) ||
        typeof command.pitch !== "number" ||
        !Number.isFinite(command.pitch)
      ) {
        continue;
      }

      const pitch = command.pitch ?? mergedPitch;
      const hasAbsoluteYaw = typeof command.yaw === "number" && Number.isFinite(command.yaw);
      const hasYawDelta = typeof command.yawDelta === "number" && Number.isFinite(command.yawDelta);
      if (!hasAbsoluteYaw && !hasYawDelta) {
        continue;
      }
      const yaw = hasAbsoluteYaw
        ? normalizeYaw(command.yaw as number)
        : normalizeYaw(mergedYaw + normalizeYaw(command.yawDelta ?? 0));
      const forward = this.clampAxis(command.forward ?? mergedForward);
      const strafe = this.clampAxis(command.strafe ?? mergedStrafe);
      const sprint = Boolean(command.sprint);
      const sequence =
        typeof command.sequence === "number" && Number.isFinite(command.sequence)
          ? (command.sequence & 0xffff)
          : ((latestSequence + 1) & 0xffff);
      if (!this.isSequenceAheadOf(latestSequence, sequence)) {
        continue;
      }

      hasAcceptedCommand = true;
      latestSequence = sequence;
      mergedForward = forward;
      mergedStrafe = strafe;
      mergedYaw = yaw;
      mergedPitch = pitch;
      mergedSprint = sprint;
      queuedUsePrimaryPressed = queuedUsePrimaryPressed || Boolean(command.usePrimaryPressed);
      mergedUsePrimaryHeld = Boolean(command.usePrimaryHeld);
      queuedJump = queuedJump || Boolean(command.jump);
    }

    if (!hasAcceptedCommand) {
      return;
    }

    if (queuedJump && player.grounded) {
      player.vy = PLAYER_JUMP_VELOCITY;
      player.grounded = false;
      player.groundedPlatformPid = null;
    }

    player.yaw = mergedYaw;
    const horizontal = stepHorizontalMovement(
      { vx: player.vx, vz: player.vz },
      { forward: mergedForward, strafe: mergedStrafe, sprint: mergedSprint, yaw: player.yaw },
      player.grounded,
      SERVER_TICK_SECONDS
    );
    player.vx = horizontal.vx;
    player.vz = horizontal.vz;
    player.pitch = Math.max(-1.45, Math.min(1.45, mergedPitch));
    player.primaryHeld = mergedUsePrimaryHeld;
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
    this.playerMovementSystem.stepPlayers(this.playersByUserId, delta);

    this.projectileSystem.step(delta);
    this.world.step();
  }

  public flushDirtyPlayerState(): void {
    const dirtyAccounts = new Set<number>([
      ...this.dirtyCharacterAccountIds,
      ...this.dirtyAbilityStateAccountIds
    ]);

    for (const accountId of dirtyAccounts) {
      const onlinePlayer = this.playersByAccountId.get(accountId);
      const pendingOfflineSnapshot = this.pendingOfflineSnapshots.get(accountId);
      const snapshot = onlinePlayer
        ? this.capturePlayerSnapshot(onlinePlayer)
        : pendingOfflineSnapshot?.snapshot;
      if (!snapshot) {
        continue;
      }

      const shouldSaveCharacter =
        this.dirtyCharacterAccountIds.has(accountId) || Boolean(pendingOfflineSnapshot?.dirtyCharacter);
      const shouldSaveAbilityState =
        this.dirtyAbilityStateAccountIds.has(accountId) || Boolean(pendingOfflineSnapshot?.dirtyAbilityState);

      if (shouldSaveCharacter) {
        this.persistence.saveCharacterSnapshot(snapshot);
      }
      if (shouldSaveAbilityState) {
        this.persistence.saveAbilityStateSnapshot(snapshot);
      }

      this.pendingOfflineSnapshots.delete(accountId);
    }
    this.dirtyCharacterAccountIds.clear();
    this.dirtyAbilityStateAccountIds.clear();
  }

  public getRuntimeStats(): {
    onlinePlayers: number;
    activeProjectiles: number;
    pendingOfflineSnapshots: number;
  } {
    return {
      onlinePlayers: this.playersByUserId.size,
      activeProjectiles: this.projectileSystem.getActiveCount(),
      pendingOfflineSnapshots: this.pendingOfflineSnapshots.size
    };
  }

  private createStaticWorldColliders(): void {
    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(128, 0.5, 128), groundBody);

    for (const block of STATIC_WORLD_BLOCKS) {
      const rotationZ = block.rotationZ ?? 0;
      const staticBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(block.x, block.y, block.z)
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(block.halfX, block.halfY, block.halfZ),
        staticBody
      );
      staticBody.setRotation(
        { x: 0, y: 0, z: Math.sin(rotationZ * 0.5), w: Math.cos(rotationZ * 0.5) },
        true
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
    this.rebuildPlatformSpatialIndex();
  }

  private initializeTrainingDummies(): void {
    for (const spawn of TRAINING_DUMMY_SPAWNS) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(spawn.x, spawn.y, spawn.z)
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(TRAINING_DUMMY_HALF_HEIGHT, TRAINING_DUMMY_RADIUS),
        body
      );
      const dummy: TrainingDummyEntity = {
        nid: 0,
        ntype: NType.TrainingDummyEntity,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        yaw: spawn.yaw,
        serverTick: this.tickNumber,
        health: TRAINING_DUMMY_MAX_HEALTH,
        maxHealth: TRAINING_DUMMY_MAX_HEALTH,
        body,
        collider
      };
      this.spatialChannel.addEntity(dummy);
      this.trainingDummiesByNid.set(dummy.nid, dummy);
      this.damageSystem.registerDummy(dummy);
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
    this.rebuildPlatformSpatialIndex();
  }

  private rebuildPlatformSpatialIndex(): void {
    this.platformSpatialIndex.clear();
    for (const platform of this.platformsByPid.values()) {
      this.platformSpatialIndex.insert({
        pid: platform.pid,
        x: platform.x,
        z: platform.z,
        halfX: platform.halfX,
        halfZ: platform.halfZ
      });
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
    this.platformSpatialIndex.queryAabb(
      bodyX,
      bodyZ,
      horizontalMargin,
      horizontalMargin,
      this.platformQueryScratch
    );
    if (preferredPid !== null && !this.platformQueryScratch.includes(preferredPid)) {
      this.platformQueryScratch.push(preferredPid);
      this.platformQueryScratch.sort((a, b) => a - b);
    }
    let selectedPid: number | null = null;
    let closestVerticalGapAbs = Number.POSITIVE_INFINITY;

    for (const platformPid of this.platformQueryScratch) {
      const platform = this.platformsByPid.get(platformPid);
      if (!platform) {
        continue;
      }
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

  private processLoadoutCommand(
    user: UserLike,
    player: PlayerEntity,
    command: Partial<LoadoutWireCommand>
  ): void {
    const applySelectedHotbarSlot = Boolean(command.applySelectedHotbarSlot);
    const applyAssignment = Boolean(command.applyAssignment);
    if (!applySelectedHotbarSlot && !applyAssignment) {
      return;
    }

    const previousActiveHotbarSlot = player.activeHotbarSlot;
    const activeSlot = this.sanitizeHotbarSlot(player.activeHotbarSlot, 0);
    const previousAssignedAbilityId = player.hotbarAbilityIds[activeSlot] ?? ABILITY_ID_NONE;
    let requiresLoadoutResync = false;
    let didAssignMutation = false;

    if (applySelectedHotbarSlot) {
      const requestedSlot =
        typeof command.selectedHotbarSlot === "number" && Number.isFinite(command.selectedHotbarSlot)
          ? Math.max(0, Math.floor(command.selectedHotbarSlot))
          : null;
      const sanitizedSlot = this.sanitizeHotbarSlot(command.selectedHotbarSlot, player.activeHotbarSlot);
      if (requestedSlot !== null && requestedSlot !== sanitizedSlot) {
        requiresLoadoutResync = true;
      }
      player.activeHotbarSlot = sanitizedSlot;
    }

    if (applyAssignment) {
      const targetSlot = this.sanitizeHotbarSlot(command.assignTargetSlot, player.activeHotbarSlot);
      const fallbackAbilityId = player.hotbarAbilityIds[targetSlot] ?? ABILITY_ID_NONE;
      const requestedAbilityId =
        typeof command.assignAbilityId === "number" && Number.isFinite(command.assignAbilityId)
          ? Math.max(0, Math.floor(command.assignAbilityId))
          : null;
      const sanitizedAbilityId = this.sanitizeSelectedAbilityId(
        command.assignAbilityId,
        fallbackAbilityId,
        player
      );
      if (requestedAbilityId !== null && requestedAbilityId !== sanitizedAbilityId) {
        requiresLoadoutResync = true;
      }
      if (player.hotbarAbilityIds[targetSlot] !== sanitizedAbilityId) {
        player.hotbarAbilityIds[targetSlot] = sanitizedAbilityId;
        didAssignMutation = true;
      }
    }

    const nextActiveSlot = this.sanitizeHotbarSlot(player.activeHotbarSlot, 0);
    const nextAssignedAbilityId = player.hotbarAbilityIds[nextActiveSlot] ?? ABILITY_ID_NONE;
    const loadoutChanged =
      previousActiveHotbarSlot !== nextActiveSlot ||
      previousAssignedAbilityId !== nextAssignedAbilityId ||
      didAssignMutation;
    if (loadoutChanged || requiresLoadoutResync) {
      this.markPlayerDirty(player, {
        dirtyCharacter: false,
        dirtyAbilityState: true
      });
      this.queueLoadoutStateMessage(user, player);
    }
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
    const melee = ability.melee;
    const damage = projectile?.damage ?? melee?.damage ?? 0;
    const radius = projectile?.radius ?? melee?.radius ?? 0;
    const cooldownSeconds = projectile?.cooldownSeconds ?? melee?.cooldownSeconds ?? 0;
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
      damage,
      radius,
      cooldownSeconds,
      lifetimeSeconds: projectile?.lifetimeSeconds ?? 0,
      spawnForwardOffset: projectile?.spawnForwardOffset ?? 0,
      spawnVerticalOffset: projectile?.spawnVerticalOffset ?? 0,
      meleeRange: melee?.range ?? 0,
      meleeArcDegrees: melee?.arcDegrees ?? 0
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

  private broadcastAbilityUseMessage(player: PlayerEntity, ability: AbilityDefinition): void {
    const abilityId = Math.max(0, Math.min(0xffff, Math.floor(ability.id)));
    const category = abilityCategoryToWireValue(ability.category);
    const eventX = player.x;
    const eventY = player.y;
    const eventZ = player.z;
    for (const user of this.usersById.values()) {
      const ownerPlayer = this.playersByUserId.get(user.id);
      const isOwner = ownerPlayer?.nid === player.nid;
      if (
        !isOwner &&
        !this.shouldDeliverAbilityUseToView(
          user.view,
          eventX,
          eventY,
          eventZ,
          ABILITY_USE_EVENT_RADIUS
        )
      ) {
        continue;
      }
      user.queueMessage({
        ntype: NType.AbilityUseMessage,
        ownerNid: player.nid,
        abilityId,
        category,
        serverTick: this.tickNumber
      });
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
    return staticAbility ?? null;
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

  private createInitialHotbar(savedHotbar?: number[]): number[] {
    const hotbar = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      if (savedHotbar && typeof savedHotbar[slot] === "number" && Number.isFinite(savedHotbar[slot])) {
        hotbar[slot] = Math.max(ABILITY_ID_NONE, Math.floor(savedHotbar[slot] as number));
        continue;
      }
      hotbar[slot] = DEFAULT_HOTBAR_ABILITY_IDS[slot] ?? ABILITY_ID_NONE;
    }
    return hotbar;
  }

  private ensurePunchAssigned(player: PlayerEntity): void {
    if (!player.unlockedAbilityIds.has(ABILITY_ID_PUNCH)) {
      return;
    }
    if (player.hotbarAbilityIds.includes(ABILITY_ID_PUNCH)) {
      return;
    }
    const emptySlot = player.hotbarAbilityIds.findIndex((abilityId) => abilityId === ABILITY_ID_NONE);
    if (emptySlot >= 0) {
      player.hotbarAbilityIds[emptySlot] = ABILITY_ID_PUNCH;
      return;
    }
    player.hotbarAbilityIds[0] = ABILITY_ID_PUNCH;
  }

  private clampHealth(value: number): number {
    if (!Number.isFinite(value)) {
      return PLAYER_MAX_HEALTH;
    }
    return Math.max(0, Math.min(PLAYER_MAX_HEALTH, Math.floor(value)));
  }

  private markPlayerDirty(
    player: PlayerEntity,
    options?: { dirtyCharacter?: boolean; dirtyAbilityState?: boolean }
  ): void {
    const dirtyCharacter = options?.dirtyCharacter ?? true;
    const dirtyAbilityState = options?.dirtyAbilityState ?? true;
    if (dirtyCharacter) {
      this.dirtyCharacterAccountIds.add(player.accountId);
    }
    if (dirtyAbilityState) {
      this.dirtyAbilityStateAccountIds.add(player.accountId);
    }
  }

  private capturePlayerSnapshot(player: PlayerEntity): PlayerSnapshot {
    return {
      accountId: player.accountId,
      x: player.x,
      y: player.y,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
      vx: player.vx,
      vy: player.vy,
      vz: player.vz,
      health: player.health,
      activeHotbarSlot: this.sanitizeHotbarSlot(player.activeHotbarSlot, 0),
      hotbarAbilityIds: [...player.hotbarAbilityIds]
    };
  }

  private tryUsePrimaryAbility(player: PlayerEntity): void {
    const slot = clampHotbarSlotIndex(player.activeHotbarSlot);
    const abilityId = this.sanitizeSelectedAbilityId(
      player.hotbarAbilityIds[slot] ?? ABILITY_ID_NONE,
      ABILITY_ID_NONE,
      player
    );
    const ability = this.getAbilityDefinitionForPlayer(player, abilityId);
    if (!ability) {
      return;
    }
    const projectileProfile = ability.projectile;
    const meleeProfile = ability.melee;
    const activeCooldownSeconds = projectileProfile?.cooldownSeconds ?? meleeProfile?.cooldownSeconds;
    if (activeCooldownSeconds === undefined) {
      return;
    }

    const secondsSinceLastFire = this.elapsedSeconds - player.lastPrimaryFireAtSeconds;
    if (secondsSinceLastFire < activeCooldownSeconds) {
      return;
    }
    player.lastPrimaryFireAtSeconds = this.elapsedSeconds;
    this.broadcastAbilityUseMessage(player, ability);

    if (projectileProfile) {
      this.spawnProjectileFromAbility(player, projectileProfile);
      return;
    }
    if (meleeProfile) {
      this.tryApplyMeleeHit(player, meleeProfile);
    }
  }

  private spawnProjectileFromAbility(
    player: PlayerEntity,
    projectileProfile: NonNullable<AbilityDefinition["projectile"]>
  ): void {
    const direction = this.computeViewDirection(player.yaw, player.pitch);
    const dirX = direction.x;
    const dirY = direction.y;
    const dirZ = direction.z;

    const spawnX = player.x + dirX * projectileProfile.spawnForwardOffset;
    const spawnY = player.y + projectileProfile.spawnVerticalOffset + dirY * projectileProfile.spawnForwardOffset;
    const spawnZ = player.z + dirZ * projectileProfile.spawnForwardOffset;

    this.projectileSystem.spawn({
      ownerNid: player.nid,
      kind: projectileProfile.kind,
      x: spawnX,
      y: spawnY,
      z: spawnZ,
      vx: dirX * projectileProfile.speed,
      vy: dirY * projectileProfile.speed,
      vz: dirZ * projectileProfile.speed,
      radius: projectileProfile.radius,
      damage: projectileProfile.damage,
      lifetimeSeconds: projectileProfile.lifetimeSeconds,
      // Per-projectile range is resolved at spawn time instead of a shared mutable global.
      maxRange: Math.max(0, projectileProfile.speed * projectileProfile.lifetimeSeconds)
    });
  }

  private tryApplyMeleeHit(player: PlayerEntity, meleeProfile: MeleeAbilityProfile): void {
    const hitTarget = this.findMeleeHitTarget(player, meleeProfile);
    if (!hitTarget) {
      return;
    }
    this.damageSystem.applyDamage(hitTarget, meleeProfile.damage);
  }

  private findMeleeHitTarget(
    attacker: PlayerEntity,
    meleeProfile: MeleeAbilityProfile
  ): CombatTarget | null {
    const direction = this.computeViewDirection(attacker.yaw, attacker.pitch);
    const attackerBody = attacker.body.translation();
    const originX = attackerBody.x;
    const originY = attackerBody.y;
    const originZ = attackerBody.z;
    const range = Math.max(0.1, meleeProfile.range);
    const halfArcRadians = (Math.max(5, Math.min(175, meleeProfile.arcDegrees)) * Math.PI) / 360;
    const minFacingDot = Math.cos(halfArcRadians);
    const maxCenterDistance = range + PLAYER_CAPSULE_RADIUS * 2 + meleeProfile.radius + TRAINING_DUMMY_RADIUS;
    const maxCenterDistanceSq = maxCenterDistance * maxCenterDistance;
    const attackEndX = originX + direction.x * range;
    const attackEndY = originY + direction.y * range;
    const attackEndZ = originZ + direction.z * range;
    let bestTarget: CombatTarget | null = null;
    let bestForwardDistance = Number.POSITIVE_INFINITY;

    for (const target of this.damageSystem.getTargets()) {
      if (target.kind === "player" && target.player.nid === attacker.nid) {
        continue;
      }

      const targetBody = this.getCombatTargetBody(target);
      const targetRadius = this.getCombatTargetRadius(target);
      const targetHalfHeight = this.getCombatTargetHalfHeight(target);
      const bodyPos = targetBody.translation();
      const centerDx = bodyPos.x - originX;
      const centerDy = bodyPos.y - originY;
      const centerDz = bodyPos.z - originZ;
      const centerDistanceSq = centerDx * centerDx + centerDy * centerDy + centerDz * centerDz;
      if (centerDistanceSq > maxCenterDistanceSq) {
        continue;
      }

      const centerDistance = Math.sqrt(Math.max(centerDistanceSq, 0));
      if (centerDistance > 1e-6) {
        const facingDot =
          (centerDx * direction.x + centerDy * direction.y + centerDz * direction.z) / centerDistance;
        if (facingDot < minFacingDot) {
          continue;
        }
      }

      const segmentMinY = bodyPos.y - targetHalfHeight;
      const segmentMaxY = bodyPos.y + targetHalfHeight;
      const combinedRadius = meleeProfile.radius + targetRadius;
      const combinedRadiusSq = combinedRadius * combinedRadius;
      const distanceSq = this.segmentSegmentDistanceSq(
        originX,
        originY,
        originZ,
        attackEndX,
        attackEndY,
        attackEndZ,
        bodyPos.x,
        segmentMinY,
        bodyPos.z,
        bodyPos.x,
        segmentMaxY,
        bodyPos.z
      );
      if (distanceSq > combinedRadiusSq) {
        continue;
      }

      const forwardDistance =
        centerDx * direction.x + centerDy * direction.y + centerDz * direction.z;
      if (forwardDistance < bestForwardDistance && this.hasMeleeLineOfSight(attacker, target, range)) {
        bestForwardDistance = forwardDistance;
        bestTarget = target;
      }
    }

    return bestTarget;
  }

  private hasMeleeLineOfSight(attacker: PlayerEntity, target: CombatTarget, range: number): boolean {
    const targetBody = this.getCombatTargetBody(target);
    const start = attacker.body.translation();
    const end = targetBody.translation();
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const deltaZ = end.z - start.z;
    const distance = Math.hypot(deltaX, deltaY, deltaZ);
    if (distance <= 1e-6) {
      return true;
    }
    const dir = { x: deltaX / distance, y: deltaY / distance, z: deltaZ / distance };
    const castDistance = Math.min(range + this.getCombatTargetRadius(target), distance);
    const hit = this.world.castRay(
      new RAPIER.Ray({ x: start.x, y: start.y, z: start.z }, dir),
      castDistance,
      true,
      undefined,
      undefined,
      attacker.collider
    );
    if (!hit) {
      return true;
    }
    return hit.collider.handle === this.getCombatTargetCollider(target).handle;
  }

  private computeViewDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
    const cosPitch = Math.cos(pitch);
    const x = -Math.sin(yaw) * cosPitch;
    const y = Math.sin(pitch);
    const z = -Math.cos(yaw) * cosPitch;
    const magnitude = Math.hypot(x, y, z);
    if (magnitude <= MELEE_DIRECTION_EPSILON) {
      return { x: 0, y: 0, z: -1 };
    }
    const invMagnitude = 1 / magnitude;
    return {
      x: x * invMagnitude,
      y: y * invMagnitude,
      z: z * invMagnitude
    };
  }

  private getCombatTargetBody(target: CombatTarget): RAPIER.RigidBody {
    return target.kind === "player" ? target.player.body : target.dummy.body;
  }

  private getCombatTargetCollider(target: CombatTarget): RAPIER.Collider {
    return target.kind === "player" ? target.player.collider : target.dummy.collider;
  }

  private getCombatTargetRadius(target: CombatTarget): number {
    return target.kind === "player" ? PLAYER_CAPSULE_RADIUS : TRAINING_DUMMY_RADIUS;
  }

  private getCombatTargetHalfHeight(target: CombatTarget): number {
    return target.kind === "player" ? PLAYER_CAPSULE_HALF_HEIGHT : TRAINING_DUMMY_HALF_HEIGHT;
  }

  private segmentSegmentDistanceSq(
    p1x: number,
    p1y: number,
    p1z: number,
    q1x: number,
    q1y: number,
    q1z: number,
    p2x: number,
    p2y: number,
    p2z: number,
    q2x: number,
    q2y: number,
    q2z: number
  ): number {
    const d1x = q1x - p1x;
    const d1y = q1y - p1y;
    const d1z = q1z - p1z;
    const d2x = q2x - p2x;
    const d2y = q2y - p2y;
    const d2z = q2z - p2z;
    const rx = p1x - p2x;
    const ry = p1y - p2y;
    const rz = p1z - p2z;
    const a = d1x * d1x + d1y * d1y + d1z * d1z;
    const e = d2x * d2x + d2y * d2y + d2z * d2z;
    const f = d2x * rx + d2y * ry + d2z * rz;
    const epsilon = 1e-6;

    let s = 0;
    let t = 0;

    if (a <= epsilon && e <= epsilon) {
      return rx * rx + ry * ry + rz * rz;
    }

    if (a <= epsilon) {
      s = 0;
      t = this.clamp01(f / e);
    } else {
      const c = d1x * rx + d1y * ry + d1z * rz;
      if (e <= epsilon) {
        t = 0;
        s = this.clamp01(-c / a);
      } else {
        const b = d1x * d2x + d1y * d2y + d1z * d2z;
        const denom = a * e - b * b;
        if (denom > epsilon) {
          s = this.clamp01((b * f - c * e) / denom);
        } else {
          s = 0;
        }
        t = (b * s + f) / e;

        if (t < 0) {
          t = 0;
          s = this.clamp01(-c / a);
        } else if (t > 1) {
          t = 1;
          s = this.clamp01((b - c) / a);
        }
      }
    }

    const c1x = p1x + d1x * s;
    const c1y = p1y + d1y * s;
    const c1z = p1z + d1z * s;
    const c2x = p2x + d2x * t;
    const c2y = p2y + d2y * t;
    const c2z = p2z + d2z * t;
    const dx = c1x - c2x;
    const dy = c1y - c2y;
    const dz = c1z - c2z;
    return dx * dx + dy * dy + dz * dz;
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(1, value));
  }

  private clampAxis(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(-1, Math.min(1, value));
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

  private shouldDeliverAbilityUseToView(
    view: AABB3D | undefined,
    x: number,
    y: number,
    z: number,
    radius: number
  ): boolean {
    if (!view) {
      return false;
    }
    const clampedRadius = Math.max(0, radius);
    const dx = Math.max(Math.abs(x - view.x) - view.halfWidth, 0);
    const dy = Math.max(Math.abs(y - view.y) - view.halfHeight, 0);
    const dz = Math.max(Math.abs(z - view.z) - view.halfDepth, 0);
    return dx * dx + dy * dy + dz * dz <= clampedRadius * clampedRadius;
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
