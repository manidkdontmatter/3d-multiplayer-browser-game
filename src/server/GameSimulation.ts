import RAPIER from "@dimforge/rapier3d-compat";
import { AABB3D, Channel, ChannelAABB3D } from "nengi";
import {
  ABILITY_ID_NONE,
  ABILITY_ID_PUNCH,
  clampHotbarSlotIndex,
  DEFAULT_HOTBAR_ABILITY_IDS,
  DEFAULT_UNLOCKED_ABILITY_IDS,
  getAbilityDefinitionById,
  HOTBAR_SLOT_COUNT,
  MODEL_ID_PLAYER,
  NType,
  PLAYER_BODY_CENTER_HEIGHT,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_MAX_HEALTH,
  quaternionFromYawPitchRoll,
  SERVER_TICK_SECONDS
} from "../shared/index";
import type { AbilityDefinition } from "../shared/index";
import type { LoadoutCommand as LoadoutWireCommand } from "../shared/netcode";
import {
  type PlayerSnapshot,
  PersistenceService
} from "./persistence/PersistenceService";
import { PersistenceSyncSystem } from "./persistence/PersistenceSyncSystem";
import {
  DamageSystem
} from "./combat/damage/DamageSystem";
import { AbilityExecutionSystem } from "./combat/abilities/AbilityExecutionSystem";
import { MeleeCombatSystem } from "./combat/melee/MeleeCombatSystem";
import { ProjectileSystem } from "./combat/projectiles/ProjectileSystem";
import { InputSystem } from "./input/InputSystem";
import { PlayerLifecycleSystem } from "./lifecycle/PlayerLifecycleSystem";
import { PlayerMovementSystem } from "./movement/PlayerMovementSystem";
import { ReplicationMessagingSystem } from "./netcode/ReplicationMessagingSystem";
import { NetReplicationBridge } from "./netcode/NetReplicationBridge";
import { PlatformSystem } from "./platform/PlatformSystem";
import { WorldBootstrapSystem } from "./world/WorldBootstrapSystem";
import { SimulationEcs } from "./ecs/SimulationEcs";

type UserLike = {
  id: number;
  queueMessage: (message: unknown) => void;
  accountId?: number;
  view?: AABB3D;
};

type PlayerEntity = {
  accountId: number;
  nid: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vy: number;
  vx: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  health: number;
  maxHealth: number;
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
  lastPrimaryFireAtSeconds: number;
  lastProcessedSequence: number;
  primaryHeld: boolean;
  unlockedAbilityIds: Set<number>;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

const ABILITY_USE_EVENT_RADIUS = PLAYER_CAPSULE_RADIUS * 2;
const TRAINING_DUMMY_MAX_HEALTH = 160;
const TRAINING_DUMMY_RADIUS = 0.42;
const TRAINING_DUMMY_HALF_HEIGHT = 0.95;
const TRAINING_DUMMY_SPAWNS = [{ x: 7, y: TRAINING_DUMMY_HALF_HEIGHT, z: -5, yaw: 0 }] as const;

export class GameSimulation {
  private readonly usersById = new Map<number, UserLike>();
  private readonly playerEidByUserId = new Map<number, number>();
  private readonly playerEidByNid = new Map<number, number>();
  private readonly playerEidByAccountId = new Map<number, number>();
  private readonly world: RAPIER.World;
  private readonly simulationEcs = new SimulationEcs();
  private readonly replicationBridge: NetReplicationBridge;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly persistenceSyncSystem = new PersistenceSyncSystem<PlayerEntity>();
  private readonly worldBootstrapSystem: WorldBootstrapSystem;
  private readonly playerLifecycleSystem: PlayerLifecycleSystem<UserLike, PlayerEntity>;
  private readonly damageSystem: DamageSystem;
  private readonly meleeCombatSystem: MeleeCombatSystem;
  private readonly abilityExecutionSystem: AbilityExecutionSystem<PlayerEntity>;
  private readonly projectileSystem: ProjectileSystem;
  private readonly inputSystem: InputSystem<UserLike, PlayerEntity>;
  private readonly platformSystem: PlatformSystem;
  private readonly replicationMessaging: ReplicationMessagingSystem<UserLike, PlayerEntity>;
  private readonly playerMovementSystem: PlayerMovementSystem<PlayerEntity>;
  private elapsedSeconds = 0;
  private tickNumber = 0;

  public constructor(
    private readonly globalChannel: Channel,
    private readonly spatialChannel: ChannelAABB3D,
    private readonly persistence: PersistenceService
  ) {
    this.replicationBridge = new NetReplicationBridge(this.spatialChannel);
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
      getSpawnPosition: () => this.getSpawnPosition(),
      markPlayerDirty: (player, options) =>
        this.persistenceSyncSystem.markPlayerDirty(player as PlayerEntity, options)
    });
    this.worldBootstrapSystem = new WorldBootstrapSystem({
      world: this.world,
      onDummyAdded: (dummy) => {
        dummy.nid = this.replicationBridge.spawn(dummy, this.toReplicationSnapshot(dummy));
        this.simulationEcs.registerDummy(dummy);
      }
    });
    this.projectileSystem = new ProjectileSystem({
      world: this.world,
      getOwnerCollider: (ownerNid) => this.getPlayerByNidViaEcs(ownerNid)?.collider,
      resolveTargetByColliderHandle: (colliderHandle) =>
        this.damageSystem.resolveTargetByColliderHandle(colliderHandle),
      applyDamage: (target, damage) => this.damageSystem.applyDamage(target, damage),
      onProjectileAdded: (projectile) => {
        const nid = this.replicationBridge.spawn(projectile, this.toReplicationSnapshot(projectile));
        projectile.nid = nid;
        this.simulationEcs.registerProjectile(projectile);
        return nid;
      },
      onProjectileRemoved: (projectile) => {
        this.replicationBridge.despawn(projectile);
        this.simulationEcs.unregister(projectile);
      }
    });
    this.meleeCombatSystem = new MeleeCombatSystem({
      world: this.world,
      playerCapsuleRadius: PLAYER_CAPSULE_RADIUS,
      playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
      dummyRadius: TRAINING_DUMMY_RADIUS,
      dummyHalfHeight: TRAINING_DUMMY_HALF_HEIGHT,
      getTargets: () => this.damageSystem.getTargets(),
      applyDamage: (target, damage) => this.damageSystem.applyDamage(target, damage)
    });
    this.abilityExecutionSystem = new AbilityExecutionSystem<PlayerEntity>({
      getElapsedSeconds: () => this.elapsedSeconds,
      resolveSelectedAbility: (player) => this.resolveSelectedAbility(player),
      broadcastAbilityUse: (player, ability) =>
        this.replicationMessaging.broadcastAbilityUseMessage(player, ability),
      spawnProjectile: (request) => this.projectileSystem.spawn(request),
      applyMeleeHit: (player, meleeProfile) =>
        this.meleeCombatSystem.tryApplyMeleeHit(player, meleeProfile)
    });
    this.inputSystem = new InputSystem<UserLike, PlayerEntity>({
      onLoadoutCommand: (user, player, command) => this.processLoadoutCommand(user, player, command),
      onPrimaryPressed: (player) => this.abilityExecutionSystem.tryUsePrimaryAbility(player)
    });
    this.platformSystem = new PlatformSystem({
      world: this.world,
      onPlatformAdded: (platform) => {
        platform.nid = this.replicationBridge.spawn(platform, this.toReplicationSnapshot(platform));
        this.simulationEcs.registerPlatform(platform);
      }
    });
    this.replicationMessaging = new ReplicationMessagingSystem<UserLike, PlayerEntity>({
      getTickNumber: () => this.tickNumber,
      getUsers: () => this.usersById.values(),
      getUserById: (userId) => this.usersById.get(userId),
      getPlayerByUserId: (userId) => this.getPlayerByUserIdViaEcs(userId),
      sanitizeHotbarSlot: (rawSlot, fallbackSlot) => this.sanitizeHotbarSlot(rawSlot, fallbackSlot),
      getAbilityDefinitionForPlayer: (player, abilityId) =>
        this.getAbilityDefinitionForPlayer(player, abilityId),
      abilityUseEventRadius: ABILITY_USE_EVENT_RADIUS
    });
    this.playerMovementSystem = new PlayerMovementSystem<PlayerEntity>({
      characterController: this.characterController,
      beforePlayerMove: (player) => {
        if (player.primaryHeld) {
          this.abilityExecutionSystem.tryUsePrimaryAbility(player);
        }
      },
      samplePlayerPlatformCarry: (player) => this.platformSystem.samplePlayerPlatformCarry(player),
      findGroundedPlatformPid: (bodyX, bodyY, bodyZ, preferredPid) =>
        this.platformSystem.findGroundedPlatformPid(bodyX, bodyY, bodyZ, preferredPid),
      onPlayerStepped: (userId, player, platformYawDelta) => {
        this.replicationMessaging.syncUserView(userId, player);
        this.replicationMessaging.queueInputAck(userId, player, platformYawDelta);
        this.persistenceSyncSystem.markPlayerDirty(player, {
          dirtyCharacter: true,
          dirtyAbilityState: false
        });
      }
    });
    this.playerLifecycleSystem = new PlayerLifecycleSystem<UserLike, PlayerEntity>({
      world: this.world,
      globalChannel: this.globalChannel,
      spatialChannel: this.spatialChannel,
      usersById: this.usersById,
      resolvePlayerByUserId: (userId) => this.getPlayerByUserIdViaEcs(userId),
      takePendingSnapshotForLogin: (accountId) =>
        this.persistenceSyncSystem.takePendingSnapshotForLogin(accountId),
      loadPlayerState: (accountId) => this.persistence.loadPlayerState(accountId),
      getSpawnPosition: () => this.getSpawnPosition(),
      playerBodyCenterHeight: PLAYER_BODY_CENTER_HEIGHT,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
      playerCapsuleRadius: PLAYER_CAPSULE_RADIUS,
      maxPlayerHealth: PLAYER_MAX_HEALTH,
      defaultUnlockedAbilityIds: DEFAULT_UNLOCKED_ABILITY_IDS,
      sanitizeHotbarSlot: (rawSlot, fallbackSlot) => this.sanitizeHotbarSlot(rawSlot, fallbackSlot),
      createInitialHotbar: (savedHotbar) => this.createInitialHotbar(savedHotbar),
      clampHealth: (value) => this.clampHealth(value),
      ensurePunchAssigned: (player) => this.ensurePunchAssigned(player),
      buildPlayerEntity: (options) => ({
        accountId: options.accountId,
        nid: 0,
        modelId: MODEL_ID_PLAYER,
        position: {
          x: options.spawnX,
          y: options.spawnCameraY,
          z: options.spawnZ
        },
        rotation: quaternionFromYawPitchRoll(options.loaded?.yaw ?? 0, 0),
        x: options.spawnX,
        y: options.spawnCameraY,
        z: options.spawnZ,
        yaw: options.loaded?.yaw ?? 0,
        pitch: options.loaded?.pitch ?? 0,
        vy: options.loaded?.vy ?? 0,
        vx: options.loaded?.vx ?? 0,
        vz: options.loaded?.vz ?? 0,
        grounded: false,
        groundedPlatformPid: null,
        health: options.health,
        maxHealth: PLAYER_MAX_HEALTH,
        activeHotbarSlot: options.activeHotbarSlot,
        hotbarAbilityIds: options.hotbarAbilityIds,
        lastPrimaryFireAtSeconds: Number.NEGATIVE_INFINITY,
        lastProcessedSequence: 0,
        primaryHeld: false,
        unlockedAbilityIds: options.unlockedAbilityIds,
        body: options.body,
        collider: options.collider
      }),
      markPlayerDirty: (player, options) => this.persistenceSyncSystem.markPlayerDirty(player, options),
      registerPlayerForDamage: (player) => this.damageSystem.registerPlayer(player),
      unregisterPlayerCollider: (colliderHandle) => this.damageSystem.unregisterCollider(colliderHandle),
      removeProjectilesByOwner: (ownerNid) => this.projectileSystem.removeByOwner(ownerNid),
      queueIdentityMessage: (user, playerNid) => {
        user.queueMessage({
          ntype: NType.IdentityMessage,
          playerNid
        });
      },
      sendInitialReplicationState: (user, player) => this.replicationMessaging.sendInitialAbilityState(user, player),
      queueOfflineSnapshot: (accountId, snapshot) =>
        this.persistenceSyncSystem.queueOfflineSnapshot(accountId, snapshot),
      capturePlayerSnapshot: (player) => this.capturePlayerSnapshot(player),
      viewHalfWidth: 128,
      viewHalfHeight: 64,
      viewHalfDepth: 128,
      onPlayerAdded: (user, player) => {
        player.nid = this.replicationBridge.spawn(player, this.toReplicationSnapshot(player));
        this.simulationEcs.registerPlayer(player);
        const oldEid = this.playerEidByUserId.get(user.id);
        if (typeof oldEid === "number") {
          this.playerEidByUserId.delete(user.id);
        }
        const newEid = this.simulationEcs.getEidForObject(player);
        if (typeof newEid === "number") {
          this.playerEidByUserId.set(user.id, newEid);
          this.playerEidByNid.set(player.nid, newEid);
          this.playerEidByAccountId.set(player.accountId, newEid);
        }
      },
      onPlayerRemoved: (user, player) => {
        this.playerEidByUserId.delete(user.id);
        this.playerEidByNid.delete(player.nid);
        this.playerEidByAccountId.delete(player.accountId);
        this.replicationBridge.despawn(player);
        this.simulationEcs.unregister(player);
      }
    });

    this.worldBootstrapSystem.createStaticWorldColliders();
    this.platformSystem.initializePlatforms();
    for (const dummy of this.worldBootstrapSystem.initializeTrainingDummies(
      TRAINING_DUMMY_SPAWNS,
      TRAINING_DUMMY_HALF_HEIGHT,
      TRAINING_DUMMY_RADIUS,
      TRAINING_DUMMY_MAX_HEALTH
    )) {
      this.damageSystem.registerDummy(dummy);
    }
  }

  public addUser(user: UserLike): void {
    this.playerLifecycleSystem.addUser(user);
  }

  public removeUser(user: UserLike): void {
    this.playerLifecycleSystem.removeUser(user);
  }

  public applyCommands(user: UserLike, commands: unknown[]): void {
    const player = this.getPlayerByUserIdViaEcs(user.id);
    if (!player) {
      return;
    }
    this.inputSystem.applyCommands(user, player, commands);
  }

  public step(delta: number): void {
    this.tickNumber += 1;
    const previousElapsedSeconds = this.elapsedSeconds;
    this.elapsedSeconds += delta;
    this.world.integrationParameters.dt = delta;
    this.platformSystem.updatePlatforms(previousElapsedSeconds, this.elapsedSeconds);
    this.playerMovementSystem.stepPlayers(this.getMovementPlayerEntries(), delta);

    this.projectileSystem.step(delta);
    this.simulationEcs.forEachReplicatedSnapshot((entity, snapshot) => {
      this.replicationBridge.sync(entity, snapshot);
    });
    this.world.step();
  }

  public flushDirtyPlayerState(): void {
    this.persistenceSyncSystem.flushDirtyPlayerState(
      this.getOnlinePlayersByAccountIdViaEcs(),
      (player) => this.capturePlayerSnapshot(player),
      (snapshot) => this.persistence.saveCharacterSnapshot(snapshot),
      (snapshot) => this.persistence.saveAbilityStateSnapshot(snapshot)
    );
  }

  public getRuntimeStats(): {
    onlinePlayers: number;
    activeProjectiles: number;
    pendingOfflineSnapshots: number;
    ecsEntities: number;
  } {
    const ecsStats = this.simulationEcs.getStats();
    return {
      onlinePlayers: this.playerEidByUserId.size,
      activeProjectiles: this.projectileSystem.getActiveCount(),
      pendingOfflineSnapshots: this.persistenceSyncSystem.getPendingOfflineSnapshotCount(),
      ecsEntities: ecsStats.total
    };
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
      this.persistenceSyncSystem.markPlayerDirty(player, {
        dirtyCharacter: false,
        dirtyAbilityState: true
      });
      this.replicationMessaging.queueLoadoutStateMessage(user, player);
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

  private resolveSelectedAbility(player: PlayerEntity): AbilityDefinition | null {
    const slot = this.abilityExecutionSystem.resolveActiveHotbarSlot(player);
    const abilityId = this.sanitizeSelectedAbilityId(
      player.hotbarAbilityIds[slot] ?? ABILITY_ID_NONE,
      ABILITY_ID_NONE,
      player
    );
    return this.getAbilityDefinitionForPlayer(player, abilityId);
  }

  private toReplicationSnapshot(entity: {
    nid: number;
    modelId: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    grounded: boolean;
    health: number;
    maxHealth: number;
  }): {
    nid: number;
    modelId: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    grounded: boolean;
    health: number;
    maxHealth: number;
  } {
    return {
      nid: entity.nid,
      modelId: entity.modelId,
      position: entity.position,
      rotation: entity.rotation,
      grounded: entity.grounded,
      health: entity.health,
      maxHealth: entity.maxHealth
    };
  }

  private getSpawnPosition(): { x: number; z: number } {
    const occupied: Array<{ x: number; z: number }> = [];
    this.simulationEcs.forEachPlayerObject((entity) => {
      const player = entity as PlayerEntity;
      occupied.push({ x: player.x, z: player.z });
    });

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

  private getMovementPlayerEntries(): Array<readonly [number, PlayerEntity]> {
    const entries: Array<readonly [number, PlayerEntity]> = [];
    for (const [userId, eid] of this.playerEidByUserId.entries()) {
      const player = this.simulationEcs.getObjectByEid(eid) as PlayerEntity | null;
      if (player) {
        entries.push([userId, player] as const);
      }
    }
    return entries;
  }

  private getPlayerByUserIdViaEcs(userId: number): PlayerEntity | undefined {
    const eid = this.playerEidByUserId.get(userId);
    if (typeof eid !== "number") {
      return undefined;
    }
    const player = this.simulationEcs.getObjectByEid(eid) as PlayerEntity | null;
    return player ?? undefined;
  }

  private getPlayerByNidViaEcs(nid: number): PlayerEntity | undefined {
    const eid = this.playerEidByNid.get(nid);
    if (typeof eid !== "number") {
      return undefined;
    }
    const player = this.simulationEcs.getObjectByEid(eid) as PlayerEntity | null;
    return player ?? undefined;
  }

  private getOnlinePlayersByAccountIdViaEcs(): ReadonlyMap<number, PlayerEntity> {
    const byAccount = new Map<number, PlayerEntity>();
    for (const [accountId, eid] of this.playerEidByAccountId.entries()) {
      const player = this.simulationEcs.getObjectByEid(eid) as PlayerEntity | null;
      if (player) {
        byAccount.set(accountId, player);
      }
    }
    return byAccount;
  }

}
