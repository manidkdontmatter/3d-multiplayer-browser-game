import RAPIER from "@dimforge/rapier3d-compat";
import { AABB3D, Channel, ChannelAABB3D } from "nengi";
import {
  ABILITY_ID_NONE,
  ABILITY_ID_PUNCH,
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
  AbilityCreateCommand as AbilityCreateWireCommand,
  InputCommand as InputWireCommand,
  LoadoutCommand as LoadoutWireCommand
} from "../shared/netcode";
import {
  type PlayerSnapshot,
  PersistenceService
} from "./persistence/PersistenceService";

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

type CombatTarget =
  | { kind: "player"; player: PlayerEntity }
  | { kind: "dummy"; dummy: TrainingDummyEntity };

type RuntimeAbilityEntry = {
  ownerNid: number;
  definition: AbilityDefinition;
};

type PendingOfflineSnapshot = {
  snapshot: PlayerSnapshot;
  dirtyCharacter: boolean;
  dirtyAbilityState: boolean;
};

const INPUT_SEQUENCE_MODULO = 0x10000;
const INPUT_SEQUENCE_HALF_RANGE = INPUT_SEQUENCE_MODULO >>> 1;
const PROJECTILE_MAX_RANGE = 260;
const MELEE_DIRECTION_EPSILON = 1e-6;
const PROJECTILE_POOL_PREWARM = 96;
const PROJECTILE_POOL_MAX = 4096;
const PROJECTILE_MIN_RADIUS = 0.005;
const PROJECTILE_RADIUS_CACHE_SCALE = 1000;
const PROJECTILE_SPEED_EPSILON = 1e-6;
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
  private readonly combatTargetsByColliderHandle = new Map<number, CombatTarget>();
  private readonly usersById = new Map<number, UserLike>();
  private readonly platformsByPid = new Map<number, PlatformEntity>();
  private readonly platformSpatialIndex = new PlatformSpatialIndex();
  private readonly platformQueryScratch: number[] = [];
  private readonly projectilesByNid = new Map<number, ProjectileEntity>();
  private readonly projectilePool: ProjectileEntity[] = [];
  private readonly projectileCastShapeCache = new Map<number, RAPIER.Ball>();
  private readonly runtimeAbilitiesById = new Map<number, RuntimeAbilityEntry>();
  private readonly dirtyCharacterAccountIds = new Set<number>();
  private readonly dirtyAbilityStateAccountIds = new Set<number>();
  private readonly pendingOfflineSnapshots = new Map<number, PendingOfflineSnapshot>();
  private readonly world: RAPIER.World;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly identityRotation: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };
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

    this.createStaticWorldColliders();
    this.initializePlatforms();
    this.initializeTrainingDummies();
    this.prewarmProjectilePool(PROJECTILE_POOL_PREWARM);
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
      lastAbilitySubmitNonce: 0,
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
    this.combatTargetsByColliderHandle.set(player.collider.handle, { kind: "player", player });
    this.usersById.set(user.id, user);
    this.pendingOfflineSnapshots.delete(player.accountId);
    if (!pendingOfflineSnapshot?.dirtyCharacter) {
      this.dirtyCharacterAccountIds.delete(player.accountId);
    }
    if (!pendingOfflineSnapshot?.dirtyAbilityState) {
      this.dirtyAbilityStateAccountIds.delete(player.accountId);
    }

    if (loaded) {
      for (const runtimeAbility of loaded.runtimeAbilities) {
        if (this.runtimeAbilitiesById.has(runtimeAbility.id)) {
          continue;
        }
        this.runtimeAbilitiesById.set(runtimeAbility.id, {
          ownerNid: player.nid,
          definition: runtimeAbility
        });
        player.unlockedAbilityIds.add(runtimeAbility.id);
      }
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
    this.combatTargetsByColliderHandle.delete(player.collider.handle);
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
    let queuedUsePrimaryPressed = false;
    let mergedUsePrimaryHeld = player.primaryHeld;
    let queuedJump = false;
    let mergedYaw = player.yaw;

    for (const rawCommand of commands) {
      const ntype = (rawCommand as { ntype?: unknown })?.ntype;
      if (ntype === NType.AbilityCreateCommand) {
        this.processAbilityCreateCommand(user, player, rawCommand as Partial<AbilityCreateWireCommand>);
        continue;
      }
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

    for (const [userId, player] of this.playersByUserId.entries()) {
      if (player.primaryHeld) {
        this.tryUsePrimaryAbility(player);
      }
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
      this.markPlayerDirty(player, {
        dirtyCharacter: true,
        dirtyAbilityState: false
      });
    }

    this.updateProjectiles(delta);
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
      activeProjectiles: this.projectilesByNid.size,
      pendingOfflineSnapshots: this.pendingOfflineSnapshots.size
    };
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
      this.combatTargetsByColliderHandle.set(dummy.collider.handle, { kind: "dummy", dummy });
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

  private processAbilityCreateCommand(
    user: UserLike,
    player: PlayerEntity,
    command: Partial<AbilityCreateWireCommand>
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

    let allocatedAbilityId = ABILITY_ID_NONE;
    try {
      allocatedAbilityId = this.persistence.allocateRuntimeAbilityId();
    } catch (error) {
      console.error("[server] allocateRuntimeAbilityId failed", error);
      this.queueAbilityCreateResultMessage(
        user,
        submitNonce,
        false,
        ABILITY_ID_NONE,
        "Ability allocation unavailable."
      );
      return;
    }

    const abilityDefinition = createAbilityDefinitionFromDraft(allocatedAbilityId, {
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

    this.markPlayerDirty(player, {
      dirtyCharacter: false,
      dirtyAbilityState: true
    });
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
    const runtimeAbilities: AbilityDefinition[] = [];
    for (const runtimeAbility of this.runtimeAbilitiesById.values()) {
      if (runtimeAbility.ownerNid !== player.nid) {
        continue;
      }
      runtimeAbilities.push(runtimeAbility.definition);
    }
    runtimeAbilities.sort((a, b) => a.id - b.id);

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
      hotbarAbilityIds: [...player.hotbarAbilityIds],
      runtimeAbilities
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
      this.spawnProjectileAbility(player, projectileProfile);
      return;
    }
    if (meleeProfile) {
      this.tryApplyMeleeHit(player, meleeProfile);
    }
  }

  private spawnProjectileAbility(
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

    const projectile = this.acquireProjectile();
    projectile.ownerNid = player.nid;
    projectile.kind = projectileProfile.kind;
    projectile.x = spawnX;
    projectile.y = spawnY;
    projectile.z = spawnZ;
    projectile.serverTick = this.tickNumber;
    projectile.vx = dirX * projectileProfile.speed;
    projectile.vy = dirY * projectileProfile.speed;
    projectile.vz = dirZ * projectileProfile.speed;
    projectile.radius = projectileProfile.radius;
    projectile.damage = projectileProfile.damage;
    projectile.ttlSeconds = projectileProfile.lifetimeSeconds;
    projectile.remainingRange = PROJECTILE_MAX_RANGE;

    this.spatialChannel.addEntity(projectile);
    this.projectilesByNid.set(projectile.nid, projectile);
  }

  private tryApplyMeleeHit(player: PlayerEntity, meleeProfile: MeleeAbilityProfile): void {
    const hitTarget = this.findMeleeHitTarget(player, meleeProfile);
    if (!hitTarget) {
      return;
    }
    this.applyCombatDamage(hitTarget, meleeProfile.damage);
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

    for (const target of this.combatTargetsByColliderHandle.values()) {
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

  private updateProjectiles(delta: number): void {
    for (const [nid, projectile] of this.projectilesByNid) {
      projectile.ttlSeconds -= delta;
      if (projectile.ttlSeconds <= 0) {
        this.removeProjectile(nid, projectile);
        continue;
      }

      const speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
      if (speed <= PROJECTILE_SPEED_EPSILON) {
        this.removeProjectile(nid, projectile);
        continue;
      }
      const maxTravelTime = this.resolveProjectileMaxTravelTime(delta, projectile.remainingRange, speed);
      const collision = this.castProjectileCollision(projectile, maxTravelTime);
      const traveledTime = collision ? collision.timeOfImpact : maxTravelTime;
      const traveledDistance = speed * traveledTime;
      projectile.remainingRange -= traveledDistance;
      if (projectile.remainingRange <= 0) {
        this.removeProjectile(nid, projectile);
        continue;
      }
      if (collision) {
        if (collision.target) {
          this.applyCombatDamage(collision.target, projectile.damage);
        }
        this.removeProjectile(nid, projectile);
        continue;
      }

      projectile.x += projectile.vx * traveledTime;
      projectile.y += projectile.vy * traveledTime;
      projectile.z += projectile.vz * traveledTime;
      projectile.serverTick = this.tickNumber;
    }
  }

  private resolveProjectileMaxTravelTime(
    tickDeltaSeconds: number,
    remainingRange: number,
    speed: number
  ): number {
    if (speed <= PROJECTILE_SPEED_EPSILON || remainingRange <= 0) {
      return 0;
    }
    const rangeLimitedTime = remainingRange / speed;
    return Math.max(0, Math.min(tickDeltaSeconds, rangeLimitedTime));
  }

  private castProjectileCollision(
    projectile: ProjectileEntity,
    maxTravelTime: number
  ): { timeOfImpact: number; target: CombatTarget | null } | null {
    if (maxTravelTime <= 0) {
      return null;
    }
    const ownerCollider = this.playersByNid.get(projectile.ownerNid)?.collider;
    const shape = this.getProjectileCastShape(projectile.radius);
    const hit = this.world.castShape(
      { x: projectile.x, y: projectile.y, z: projectile.z },
      this.identityRotation,
      { x: projectile.vx, y: projectile.vy, z: projectile.vz },
      shape,
      0,
      maxTravelTime,
      true,
      undefined,
      undefined,
      ownerCollider
    );
    if (!hit) {
      return null;
    }
    const timeOfImpact = Math.max(0, Math.min(maxTravelTime, hit.time_of_impact));
    const hitTarget = this.combatTargetsByColliderHandle.get(hit.collider.handle) ?? null;
    return {
      timeOfImpact,
      target: hitTarget
    };
  }

  private getProjectileCastShape(radius: number): RAPIER.Ball {
    const clampedRadius = Math.max(PROJECTILE_MIN_RADIUS, radius);
    const cacheKey = Math.max(1, Math.round(clampedRadius * PROJECTILE_RADIUS_CACHE_SCALE));
    let shape = this.projectileCastShapeCache.get(cacheKey);
    if (!shape) {
      shape = new RAPIER.Ball(cacheKey / PROJECTILE_RADIUS_CACHE_SCALE);
      this.projectileCastShapeCache.set(cacheKey, shape);
    }
    return shape;
  }

  private applyCombatDamage(target: CombatTarget, damage: number): void {
    const appliedDamage = Math.max(0, Math.floor(damage));
    if (appliedDamage <= 0) {
      return;
    }
    if (target.kind === "player") {
      const player = target.player;
      player.health = Math.max(0, player.health - appliedDamage);
      this.markPlayerDirty(player, {
        dirtyCharacter: true,
        dirtyAbilityState: false
      });
      if (player.health <= 0) {
        this.respawnPlayer(player);
      }
      return;
    }
    const dummy = target.dummy;
    dummy.health = Math.max(0, dummy.health - appliedDamage);
    dummy.serverTick = this.tickNumber;
    if (dummy.health <= 0) {
      dummy.health = dummy.maxHealth;
    }
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
    this.markPlayerDirty(player, {
      dirtyCharacter: true,
      dirtyAbilityState: false
    });
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
    this.releaseProjectile(projectile);
  }

  private prewarmProjectilePool(count: number): void {
    for (let i = this.projectilePool.length; i < count; i += 1) {
      this.projectilePool.push(this.createPooledProjectile());
    }
  }

  private acquireProjectile(): ProjectileEntity {
    const projectile = this.projectilePool.pop() ?? this.createPooledProjectile();
    projectile.nid = 0;
    projectile.ntype = NType.ProjectileEntity;
    projectile.ownerNid = 0;
    projectile.kind = 0;
    projectile.x = 0;
    projectile.y = 0;
    projectile.z = 0;
    projectile.serverTick = this.tickNumber;
    projectile.vx = 0;
    projectile.vy = 0;
    projectile.vz = 0;
    projectile.radius = 0;
    projectile.damage = 0;
    projectile.ttlSeconds = 0;
    projectile.remainingRange = 0;
    return projectile;
  }

  private releaseProjectile(projectile: ProjectileEntity): void {
    if (this.projectilePool.length >= PROJECTILE_POOL_MAX) {
      return;
    }
    projectile.nid = 0;
    projectile.ownerNid = 0;
    projectile.kind = 0;
    projectile.x = 0;
    projectile.y = -1000;
    projectile.z = 0;
    projectile.vx = 0;
    projectile.vy = 0;
    projectile.vz = 0;
    projectile.radius = 0;
    projectile.damage = 0;
    projectile.ttlSeconds = 0;
    projectile.remainingRange = 0;
    this.projectilePool.push(projectile);
  }

  private createPooledProjectile(): ProjectileEntity {
    return {
      nid: 0,
      ntype: NType.ProjectileEntity,
      ownerNid: 0,
      kind: 0,
      x: 0,
      y: -1000,
      z: 0,
      serverTick: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      radius: 0,
      damage: 0,
      ttlSeconds: 0,
      remainingRange: 0
    };
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
