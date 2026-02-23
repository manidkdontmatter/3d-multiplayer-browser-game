import RAPIER from "@dimforge/rapier3d-compat";
import {
  ABILITY_ID_NONE,
  ABILITY_ID_PUNCH,
  clampHotbarSlotIndex,
  configurePlayerCharacterController,
  DEFAULT_HOTBAR_ABILITY_IDS,
  DEFAULT_UNLOCKED_ABILITY_IDS,
  getAbilityDefinitionById,
  HOTBAR_SLOT_COUNT,
  PLAYER_BODY_CENTER_HEIGHT,
  PLAYER_CHARACTER_CONTROLLER_OFFSET,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  quaternionFromYawPitchRoll,
  SERVER_TICK_SECONDS
} from "../shared/index";
import type { AbilityDefinition } from "../shared/index";
import type {
  InputCommand as InputWireCommand,
  LoadoutCommand as LoadoutWireCommand
} from "../shared/netcode";
import {
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
import { LoadoutCommandHandler } from "./net/LoadoutCommandHandler";
import { ServerReplicationCoordinator } from "./net/ServerReplicationCoordinator";
import { PlatformSystem } from "./platform/PlatformSystem";
import { WorldBootstrapSystem } from "./world/WorldBootstrapSystem";
import { SimulationEcs } from "./ecs/SimulationEcs";
import {
  loadServerArchetypeCatalog,
  type ServerArchetypeCatalog
} from "./content/ArchetypeCatalog";

type UserLike = {
  id: number;
  queueMessage: (message: unknown) => void;
  accountId?: number;
  view?: { x: number; y: number; z: number };
};

type GlobalChannelLike = {
  subscribe: (user: UserLike) => void;
};

type SpatialChannelLike = {
  subscribe: (user: UserLike, view: NonNullable<UserLike["view"]>) => void;
  addEntity: (entity: unknown) => void;
  removeEntity: (entity: unknown) => void;
  addMessage: (message: unknown) => void;
};

type CreateUserView = (position: {
  x: number;
  y: number;
  z: number;
  halfWidth: number;
  halfHeight: number;
  halfDepth: number;
}) => NonNullable<UserLike["view"]>;

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

type RuntimePlayerState = {
  accountId: number;
  nid: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  lastProcessedSequence: number;
  lastPrimaryFireAtSeconds: number;
  primaryHeld: boolean;
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: Set<number>;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

export class GameSimulation {
  private readonly usersById = new Map<number, UserLike>();
  private readonly world: RAPIER.World;
  private readonly simulationEcs = new SimulationEcs();
  private readonly replication: ServerReplicationCoordinator<UserLike, RuntimePlayerState>;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly persistenceSyncSystem = new PersistenceSyncSystem<PlayerEntity>();
  private readonly worldBootstrapSystem: WorldBootstrapSystem;
  private readonly playerLifecycleSystem: PlayerLifecycleSystem<UserLike, PlayerEntity>;
  private readonly damageSystem: DamageSystem;
  private readonly meleeCombatSystem: MeleeCombatSystem;
  private readonly abilityExecutionSystem: AbilityExecutionSystem<RuntimePlayerState>;
  private readonly projectileSystem: ProjectileSystem;
  private readonly inputSystem: InputSystem<RuntimePlayerState>;
  private readonly loadoutCommandHandler: LoadoutCommandHandler<UserLike>;
  private readonly platformSystem: PlatformSystem;
  private readonly playerMovementSystem: PlayerMovementSystem<RuntimePlayerState>;
  private readonly archetypes: ServerArchetypeCatalog;
  private elapsedSeconds = 0;
  private tickNumber = 0;

  public constructor(
    private readonly globalChannel: GlobalChannelLike,
    private readonly spatialChannel: SpatialChannelLike,
    private readonly persistence: PersistenceService,
    private readonly createUserView: CreateUserView
  ) {
    this.archetypes = this.resolveServerArchetypes();
    this.replication = new ServerReplicationCoordinator<UserLike, RuntimePlayerState>({
      spatialChannel: this.spatialChannel,
      getTickNumber: () => this.tickNumber,
      getUserById: (userId) => this.usersById.get(userId),
      sanitizeHotbarSlot: (rawSlot, fallbackSlot) => this.sanitizeHotbarSlot(rawSlot, fallbackSlot),
      getAbilityDefinitionById: (abilityId) => getAbilityDefinitionById(abilityId)
    });
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.integrationParameters.dt = SERVER_TICK_SECONDS;
    this.characterController = this.world.createCharacterController(PLAYER_CHARACTER_CONTROLLER_OFFSET);
    configurePlayerCharacterController(this.characterController);
    this.damageSystem = new DamageSystem({
      maxPlayerHealth: this.archetypes.player.maxHealth,
      playerBodyCenterHeight: PLAYER_BODY_CENTER_HEIGHT,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      getSpawnPosition: () => this.getSpawnPosition(),
      markPlayerDirtyByAccountId: (accountId, options) =>
        this.persistenceSyncSystem.markAccountDirty(accountId, options),
      getPlayerStateByEid: (eid) => this.simulationEcs.getPlayerDamageStateByEid(eid),
      applyPlayerStateByEid: (eid, state) => this.simulationEcs.applyPlayerDamageStateByEid(eid, state),
      getDummyStateByEid: (eid) => this.simulationEcs.getDummyDamageStateByEid(eid),
      applyDummyStateByEid: (eid, state) => this.simulationEcs.applyDummyDamageStateByEid(eid, state)
    });
    this.worldBootstrapSystem = new WorldBootstrapSystem({
      world: this.world,
      onDummyAdded: (dummy) => {
        this.simulationEcs.registerDummy(dummy);
        const eid = this.requireEid(dummy);
        const nid = this.replication.spawnEntity(eid, this.toReplicationSnapshot(dummy));
        dummy.nid = nid;
        this.simulationEcs.setEntityNidByEid(eid, nid);
      }
    });
    this.projectileSystem = new ProjectileSystem({
      world: this.world,
      getOwnerCollider: (ownerNid) => this.simulationEcs.getPlayerColliderByNid(ownerNid),
      resolveTargetByColliderHandle: (colliderHandle) =>
        this.damageSystem.resolveTargetByColliderHandle(colliderHandle),
      applyDamage: (target, damage) => this.damageSystem.applyDamage(target, damage),
      createProjectile: (request) => {
        const eid = this.simulationEcs.createProjectile({
          modelId: this.resolveProjectileModelId(request.kind),
          ownerNid: request.ownerNid,
          kind: request.kind,
          x: request.x,
          y: request.y,
          z: request.z,
          vx: request.vx,
          vy: request.vy,
          vz: request.vz,
          radius: request.radius,
          damage: request.damage,
          ttlSeconds: request.lifetimeSeconds,
          remainingRange: ProjectileSystem.resolveMaxRange(request.maxRange),
          gravity: ProjectileSystem.resolveOptionalNumber(request.gravity, 0),
          drag: Math.max(0, ProjectileSystem.resolveOptionalNumber(request.drag, 0)),
          maxSpeed: Math.max(
            0,
            ProjectileSystem.resolveOptionalNumber(request.maxSpeed, Number.POSITIVE_INFINITY)
          ),
          minSpeed: Math.max(0, ProjectileSystem.resolveOptionalNumber(request.minSpeed, 0)),
          remainingPierces: Math.max(
            0,
            Math.floor(ProjectileSystem.resolveOptionalNumber(request.pierceCount, 0))
          ),
          despawnOnDamageableHit:
            typeof request.despawnOnDamageableHit === "boolean" ? request.despawnOnDamageableHit : true,
          despawnOnWorldHit:
            typeof request.despawnOnWorldHit === "boolean" ? request.despawnOnWorldHit : true
        });
        const nid = this.replication.spawnEntity(eid, this.simulationEcs.getReplicationSnapshotByEid(eid));
        this.simulationEcs.setProjectileNidByEid(eid, nid);
        return eid;
      },
      getProjectileState: (eid) => this.simulationEcs.getProjectileRuntimeStateByEid(eid),
      applyProjectileState: (eid, state) => this.simulationEcs.applyProjectileRuntimeStateByEid(eid, state),
      removeProjectile: (eid) => {
        this.replication.despawnEntity(eid);
        this.simulationEcs.removeEntityByEid(eid);
      }
    });
    this.meleeCombatSystem = new MeleeCombatSystem({
      world: this.world,
      playerCapsuleRadius: PLAYER_CAPSULE_RADIUS,
      playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
      dummyRadius: this.archetypes.trainingDummy.capsuleRadius,
      dummyHalfHeight: this.archetypes.trainingDummy.capsuleHalfHeight,
      getTargets: () => this.damageSystem.getTargets(),
      resolveTargetRuntime: (target) => this.simulationEcs.resolveCombatTargetRuntime(target),
      applyDamage: (target, damage) => this.damageSystem.applyDamage(target, damage)
    });
    this.abilityExecutionSystem = new AbilityExecutionSystem<RuntimePlayerState>({
      getElapsedSeconds: () => this.elapsedSeconds,
      resolveSelectedAbility: (player) => this.resolveSelectedAbility(player),
      broadcastAbilityUse: (player, ability) =>
        this.replication.broadcastAbilityUseMessage(player, ability),
      spawnProjectile: (request) => this.projectileSystem.spawn(request),
      applyMeleeHit: (player, meleeProfile) =>
        this.meleeCombatSystem.tryApplyMeleeHit(player, meleeProfile)
    });
    this.inputSystem = new InputSystem<RuntimePlayerState>({
      onPrimaryPressed: (player) => this.abilityExecutionSystem.tryUsePrimaryAbility(player)
    });
    this.platformSystem = new PlatformSystem({
      world: this.world,
      definitions: this.archetypes.platforms,
      onPlatformAdded: (platform) => {
        this.simulationEcs.registerPlatform(platform);
      },
      onPlatformUpdated: (platform) => {
        this.simulationEcs.syncPlatform(platform);
      }
    });
    this.loadoutCommandHandler = new LoadoutCommandHandler<UserLike>({
      getLoadoutStateByUserId: (userId) => this.simulationEcs.getPlayerLoadoutStateByUserId(userId),
      setPlayerActiveHotbarSlotByUserId: (userId, slot) =>
        this.simulationEcs.setPlayerActiveHotbarSlotByUserId(userId, slot),
      setPlayerHotbarAbilityByUserId: (userId, slot, abilityId) =>
        this.simulationEcs.setPlayerHotbarAbilityByUserId(userId, slot, abilityId),
      getPlayerAccountIdByUserId: (userId) => this.simulationEcs.getPlayerAccountIdByUserId(userId),
      markAccountAbilityStateDirty: (accountId) =>
        this.persistenceSyncSystem.markAccountDirty(accountId, {
          dirtyCharacter: false,
          dirtyAbilityState: true
        }),
      queueLoadoutStateMessageFromSnapshot: (user, snapshot) =>
        this.replication.queueLoadoutStateMessageFromSnapshot(user, snapshot),
      sanitizeHotbarSlot: (rawSlot, fallbackSlot) => this.sanitizeHotbarSlot(rawSlot, fallbackSlot),
      sanitizeSelectedAbilityId: (rawAbilityId, fallbackAbilityId, unlockedAbilityIds) =>
        this.sanitizeSelectedAbilityId(rawAbilityId, fallbackAbilityId, unlockedAbilityIds)
    });
    this.playerMovementSystem = new PlayerMovementSystem<RuntimePlayerState>({
      world: this.world,
      characterController: this.characterController,
      playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
      playerCapsuleRadius: PLAYER_CAPSULE_RADIUS,
      beforePlayerMove: (player) => {
        if (player.primaryHeld) {
          this.abilityExecutionSystem.tryUsePrimaryAbility(player);
        }
      },
      samplePlayerPlatformCarry: (player) => this.platformSystem.samplePlayerPlatformCarry(player),
      resolvePlatformPidByColliderHandle: (colliderHandle) =>
        this.platformSystem.resolvePlatformPidByColliderHandle(colliderHandle),
      onPlayerStepped: (userId, player) => {
        this.simulationEcs.applyPlayerRuntimeStateByUserId(userId, player);
        const ackState = this.simulationEcs.getPlayerInputAckStateByUserId(userId);
        if (ackState) {
          this.replication.syncUserViewPosition(userId, ackState.x, ackState.y, ackState.z);
          this.replication.queueInputAckFromState(userId, ackState);
        }
        this.persistenceSyncSystem.markAccountDirty(player.accountId, {
          dirtyCharacter: true,
          dirtyAbilityState: false
        });
      }
    });
    this.playerLifecycleSystem = new PlayerLifecycleSystem<UserLike, PlayerEntity>({
      world: this.world,
      globalChannel: this.globalChannel,
      spatialChannel: this.spatialChannel,
      createUserView: ({ x, y, z, halfWidth, halfHeight, halfDepth }) =>
        this.createUserView({ x, y, z, halfWidth, halfHeight, halfDepth }),
      usersById: this.usersById,
      resolvePlayerByUserId: (userId) => this.simulationEcs.getPlayerObjectByUserId<PlayerEntity>(userId),
      takePendingSnapshotForLogin: (accountId) =>
        this.persistenceSyncSystem.takePendingSnapshotForLogin(accountId),
      loadPlayerState: (accountId) => this.persistence.loadPlayerState(accountId),
      getSpawnPosition: () => this.getSpawnPosition(),
      playerBodyCenterHeight: PLAYER_BODY_CENTER_HEIGHT,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
      playerCapsuleRadius: PLAYER_CAPSULE_RADIUS,
      maxPlayerHealth: this.archetypes.player.maxHealth,
      defaultUnlockedAbilityIds: DEFAULT_UNLOCKED_ABILITY_IDS,
      sanitizeHotbarSlot: (rawSlot, fallbackSlot) => this.sanitizeHotbarSlot(rawSlot, fallbackSlot),
      createInitialHotbar: (savedHotbar) => this.createInitialHotbar(savedHotbar),
      clampHealth: (value) => this.clampHealth(value),
      ensurePunchAssigned: (player) => this.ensurePunchAssigned(player),
      buildPlayerEntity: (options) => ({
        accountId: options.accountId,
        nid: 0,
        modelId: this.archetypes.player.modelId,
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
        maxHealth: this.archetypes.player.maxHealth,
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
      registerPlayerForDamage: (player) => {
        const eid = this.requireEid(player);
        this.damageSystem.registerPlayerCollider(player.collider.handle, eid);
      },
      unregisterPlayerCollider: (colliderHandle) => this.damageSystem.unregisterCollider(colliderHandle),
      removeProjectilesByOwner: (ownerNid) => this.projectileSystem.removeByOwner(ownerNid),
      queueIdentityMessage: (user, playerNid) => this.replication.queueIdentityMessage(user, playerNid),
      sendInitialReplicationState: (user, _player) => {
        const loadout = this.simulationEcs.getPlayerLoadoutStateByUserId(user.id);
        if (!loadout) {
          return;
        }
        this.replication.sendInitialAbilityStateFromSnapshot(user, loadout);
      },
      queueOfflineSnapshot: (accountId, snapshot) =>
        this.persistenceSyncSystem.queueOfflineSnapshot(accountId, snapshot),
      resolveOfflineSnapshotByAccountId: (accountId) => {
        return this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(accountId);
      },
      viewHalfWidth: 128,
      viewHalfHeight: 64,
      viewHalfDepth: 128,
      onPlayerAdded: (user, player) => {
        this.simulationEcs.registerPlayer(player);
        const eid = this.requireEid(player);
        const nid = this.replication.spawnEntity(eid, this.toReplicationSnapshot(player));
        player.nid = nid;
        this.simulationEcs.setEntityNidByEid(eid, nid);
        this.simulationEcs.bindPlayerLookupIndexes(player, user.id);
      },
      onPlayerRemoved: (user, player) => {
        this.simulationEcs.unbindPlayerLookupIndexes(player, user.id);
        const eid = this.simulationEcs.getEidForObject(player);
        if (typeof eid === "number") {
          this.replication.despawnEntity(eid);
        }
        this.simulationEcs.unregister(player);
      }
    });

    this.worldBootstrapSystem.createStaticWorldColliders();
    this.platformSystem.initializePlatforms();
    for (const dummy of this.worldBootstrapSystem.initializeTrainingDummies(
      this.archetypes.trainingDummy.spawns,
      this.archetypes.trainingDummy.capsuleHalfHeight,
      this.archetypes.trainingDummy.capsuleRadius,
      this.archetypes.trainingDummy.maxHealth,
      this.archetypes.trainingDummy.modelId
    )) {
      const eid = this.requireEid(dummy);
      this.damageSystem.registerDummyCollider(dummy.collider.handle, eid);
    }
  }

  public addUser(user: UserLike): void {
    this.playerLifecycleSystem.addUser(user);
  }

  public removeUser(user: UserLike): void {
    this.playerLifecycleSystem.removeUser(user);
  }

  public applyInputCommands(userId: number, commands: Partial<InputWireCommand>[]): void {
    const runtimePlayer = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
    if (!runtimePlayer) {
      return;
    }
    this.inputSystem.applyCommands(runtimePlayer, commands);
    this.simulationEcs.applyPlayerRuntimeStateByUserId(userId, runtimePlayer);
  }

  public applyLoadoutCommand(user: UserLike, command: Partial<LoadoutWireCommand>): void {
    const runtimePlayer = this.simulationEcs.getPlayerRuntimeStateByUserId(user.id);
    if (!runtimePlayer) {
      return;
    }
    this.loadoutCommandHandler.apply(user, command);
    this.simulationEcs.applyPlayerRuntimeStateByUserId(user.id, runtimePlayer);
  }

  public step(delta: number): void {
    this.tickNumber += 1;
    const previousElapsedSeconds = this.elapsedSeconds;
    this.elapsedSeconds += delta;
    this.world.integrationParameters.dt = delta;
    this.platformSystem.updatePlatforms(previousElapsedSeconds, this.elapsedSeconds);
    this.playerMovementSystem.stepPlayers(this.getMovementPlayerEntries(), delta);

    this.projectileSystem.step(delta);
    this.simulationEcs.forEachReplicatedState(
      (eid, _nid, modelId, x, y, z, rx, ry, rz, rw, grounded, health, maxHealth) => {
        this.replication.syncEntityFromValues(
          eid,
          modelId,
          x,
          y,
          z,
          rx,
          ry,
          rz,
          rw,
          grounded,
          health,
          maxHealth
        );
      }
    );
    this.world.step();
  }

  public flushDirtyPlayerState(): void {
    this.persistenceSyncSystem.flushDirtyPlayerState(
      (accountId) => {
        return this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(accountId);
      },
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
      onlinePlayers: this.simulationEcs.getOnlinePlayerCount(),
      activeProjectiles: this.projectileSystem.getActiveCount(),
      pendingOfflineSnapshots: this.persistenceSyncSystem.getPendingOfflineSnapshotCount(),
      ecsEntities: ecsStats.total
    };
  }

  private getAbilityDefinitionForUnlockedSet(
    unlockedAbilityIds: Set<number>,
    abilityId: number
  ): AbilityDefinition | null {
    if (!unlockedAbilityIds.has(abilityId)) {
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
    unlockedAbilityIds: Set<number>
  ): number {
    if (typeof rawAbilityId !== "number" || !Number.isFinite(rawAbilityId)) {
      return fallbackAbilityId;
    }

    const normalized = Math.max(0, Math.floor(rawAbilityId));
    if (normalized === ABILITY_ID_NONE) {
      return ABILITY_ID_NONE;
    }
    if (!unlockedAbilityIds.has(normalized)) {
      return fallbackAbilityId;
    }
    return getAbilityDefinitionById(normalized) ? normalized : fallbackAbilityId;
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
      return this.archetypes.player.maxHealth;
    }
    return Math.max(0, Math.min(this.archetypes.player.maxHealth, Math.floor(value)));
  }

  private resolveSelectedAbility(player: RuntimePlayerState): AbilityDefinition | null {
    const slot = this.abilityExecutionSystem.resolveActiveHotbarSlot(player);
    const abilityId = this.sanitizeSelectedAbilityId(
      player.hotbarAbilityIds[slot] ?? ABILITY_ID_NONE,
      ABILITY_ID_NONE,
      player.unlockedAbilityIds
    );
    return this.getAbilityDefinitionForUnlockedSet(player.unlockedAbilityIds, abilityId);
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
    const occupied = this.simulationEcs.getOnlinePlayerPositionsXZ();

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

  private getMovementPlayerEntries(): Array<readonly [number, RuntimePlayerState]> {
    const entries: Array<readonly [number, RuntimePlayerState]> = [];
    for (const userId of this.simulationEcs.getOnlinePlayerUserIds()) {
      const runtimePlayer = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
      if (!runtimePlayer) {
        continue;
      }
      entries.push([userId, runtimePlayer] as const);
    }
    return entries;
  }

  private resolveProjectileModelId(kind: number): number {
    const resolvedKind = Math.max(0, Math.floor(kind));
    const entry = this.archetypes.projectiles.get(resolvedKind);
    if (!entry) {
      return this.archetypes.projectiles.get(1)?.modelId ?? 0;
    }
    return entry.modelId;
  }

  private resolveServerArchetypes(): ServerArchetypeCatalog {
    return loadServerArchetypeCatalog();
  }

  private requireEid(entity: object): number {
    const eid = this.simulationEcs.getEidForObject(entity);
    if (typeof eid === "number") {
      return eid;
    }
    throw new Error("Simulation ECS eid not found for registered entity");
  }

}
