// Authoritative server simulation orchestrator for movement, combat, replication, and persistence.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ABILITY_ID_NONE,
  ABILITY_ID_PUNCH,
  clampHotbarSlotIndex,
  configurePlayerCharacterController,
  DEFAULT_HOTBAR_ABILITY_IDS,
  DEFAULT_VOID_SPAWN_ANCHOR,
  DEFAULT_UNLOCKED_ABILITY_IDS,
  HOTBAR_SLOT_COUNT,
  PLAYER_BODY_CENTER_HEIGHT,
  MOVEMENT_MODE_GROUNDED,
  PLAYER_CHARACTER_CONTROLLER_OFFSET,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  encodeInventoryStateSnapshot,
  quaternionFromYawPitchRoll,
  resolveRuntimeMapConfig,
  type InventoryStateSnapshot,
  type MovementMode,
  SERVER_TICK_SECONDS
} from "../shared/index";
import type { AbilityDefinition } from "../shared/index";
import {
  NType,
  type AbilityCommand as AbilityWireCommand,
  type AbilityCreatorCommand as AbilityCreatorWireCommand,
  type ItemCommand as ItemWireCommand,
  type InputCommand as InputWireCommand
} from "../shared/netcode";
import {
  PersistenceService,
  type PlayerSnapshot
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
import { LocationRootSystem } from "./location/LocationRootSystem";
import { PlayerMovementSystem } from "./movement/PlayerMovementSystem";
import { AbilityCommandHandler } from "./net/AbilityCommandHandler";
import { AbilityCreatorSystem } from "./abilityCreator/AbilityCreatorSystem";
import { ItemInventorySystem, type WorldItemObject } from "./items/ItemInventorySystem";
import { ServerReplicationCoordinator } from "./net/ServerReplicationCoordinator";
import { PlatformSystem } from "./platform/PlatformSystem";
import {
  NpcAiSystem,
  type NpcCharacter
} from "./ai/NpcAiSystem";
import { WorldContentCoordinator } from "./world/WorldContentCoordinator";
import { SimulationEcs } from "./ecs/SimulationEcs";
import {
  loadServerArchetypeCatalog,
  type ServerArchetypeCatalog
} from "./content/ArchetypeCatalog";
import {
  CONTROLLER_KIND_AI,
  ControllerSystem
} from "./controllers/ControllerSystem";
import { CharacterMovementSystem } from "./movement/CharacterMovementSystem";
import { CharacterNavigationPlanner } from "./navigation/NavigationService";
import {
  buildServerNavigationWorld,
  type NavigationBuildReport
} from "./navigation/NavigationWorldBuilder";

type UserLike = {
  id: number;
  queueMessage: (message: unknown) => void;
  accountId?: number;
  view?: {
    x: number;
    y: number;
    z: number;
    halfWidth: number;
    halfHeight: number;
    halfDepth: number;
  };
  farView?: {
    x: number;
    y: number;
    z: number;
    halfWidth: number;
    halfHeight: number;
    halfDepth: number;
  };
};

type GlobalChannelLike = {
  subscribe: (user: UserLike) => void;
};

type SpatialChannelLike = {
  subscribe: (user: UserLike, view: NonNullable<UserLike["view"] | UserLike["farView"]>) => void;
  addEntity: (entity: any) => any;
  removeEntity: (entity: any) => any;
  addMessage: (message: unknown) => void;
};

type FarSpatialChannelLike = {
  subscribe: (user: UserLike, view: NonNullable<UserLike["farView"]>) => void;
  addEntity: (entity: any) => any;
  removeEntity: (entity: any) => any;
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
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
  carriedFramePid: number | null;
  health: number;
  maxHealth: number;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
  lastPrimaryFireAtSeconds: number;
  lastProcessedSequence: number;
  primaryHeld: boolean;
  secondaryHeld: boolean;
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
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
  carriedFramePid: number | null;
  lastProcessedSequence: number;
  lastPrimaryFireAtSeconds: number;
  primaryHeld: boolean;
  secondaryHeld: boolean;
  health: number;
  maxHealth: number;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
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
  private readonly controllerSystem = new ControllerSystem();
  private readonly replication: ServerReplicationCoordinator<UserLike, RuntimePlayerState | NpcCharacter>;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly persistenceSyncSystem = new PersistenceSyncSystem<PlayerEntity>();
  private readonly worldContentCoordinator: WorldContentCoordinator;
  private readonly playerLifecycleSystem: PlayerLifecycleSystem<UserLike, PlayerEntity>;
  private readonly damageSystem: DamageSystem;
  private readonly meleeCombatSystem: MeleeCombatSystem;
  private readonly abilityExecutionSystem: AbilityExecutionSystem<RuntimePlayerState | NpcCharacter>;
  private readonly projectileSystem: ProjectileSystem;
  private readonly inputSystem: InputSystem<RuntimePlayerState>;
  private readonly abilityCommandHandler: AbilityCommandHandler<UserLike>;
  private readonly abilityCreatorSystem: AbilityCreatorSystem;
  private readonly itemInventorySystem: ItemInventorySystem<UserLike>;
  private readonly platformSystem: PlatformSystem;
  private readonly locationRootSystem: LocationRootSystem;
  private readonly navigationPlanner: CharacterNavigationPlanner;
  private readonly playerMovementSystem: PlayerMovementSystem<RuntimePlayerState>;
  private readonly npcMovementSystem: CharacterMovementSystem<NpcCharacter>;
  private readonly npcAiSystem: NpcAiSystem;
  private readonly archetypes: ServerArchetypeCatalog;
  private readonly runtimeMapConfig = resolveRuntimeMapConfig();
  private readonly loadTestSpawnMode: "default" | "grid";
  private readonly loadTestGridSpacing: number;
  private readonly loadTestGridColumns: number;
  private readonly loadTestGridRows: number;
  private readonly populationBroadcastIntervalTicks = 10;
  private readonly npcPlayerAlertIntervalSeconds: number;
  private readonly npcPlayerAlertMemorySeconds: number;
  private readonly npcPlayerAlertShape: RAPIER.Ball;
  private readonly aiPerceptionTargetByColliderHandle = new Map<number, {
    eid: number;
    nid: number;
    x: number;
    y: number;
    z: number;
    movementMode: MovementMode;
    carriedFramePid: number | null;
    groundedPlatformPid: number | null;
  }>();
  private nextNpcPlayerAlertAtSeconds = 0;
  private elapsedSeconds = 0;
  private tickNumber = 0;

  public constructor(
    private readonly globalChannel: GlobalChannelLike,
    private readonly nearChannel: SpatialChannelLike,
    private readonly farChannel: FarSpatialChannelLike,
    private readonly persistence: PersistenceService,
    private readonly createUserView: CreateUserView
  ) {
    this.archetypes = this.resolveServerArchetypes();
    this.loadTestSpawnMode = this.resolveLoadTestSpawnMode();
    this.loadTestGridSpacing = this.resolveLoadTestGridSpacing();
    this.loadTestGridColumns = this.resolveLoadTestGridColumns();
    this.loadTestGridRows = this.resolveLoadTestGridRows();
    this.npcPlayerAlertIntervalSeconds = this.resolvePositiveEnvNumber("NPC_PLAYER_ALERT_INTERVAL", 0.5);
    const npcPlayerAlertRadius = this.resolvePositiveEnvNumber("NPC_PLAYER_ALERT_RADIUS", 220);
    this.npcPlayerAlertMemorySeconds = this.resolvePositiveEnvNumber("NPC_PLAYER_ALERT_MEMORY", 1.25);
    this.npcPlayerAlertShape = new RAPIER.Ball(npcPlayerAlertRadius);
    this.abilityCreatorSystem = new AbilityCreatorSystem(this.persistence);
    this.replication = new ServerReplicationCoordinator<UserLike, RuntimePlayerState | NpcCharacter>({
      nearChannel: this.nearChannel,
      farChannel: this.farChannel,
      getTickNumber: () => this.tickNumber,
      getUserById: (userId) => this.usersById.get(userId),
      sanitizeHotbarSlot: (rawSlot, fallbackSlot) => this.sanitizeHotbarSlot(rawSlot, fallbackSlot),
      getAbilityDefinitionById: (abilityId) => this.resolveAbilityDefinitionById(abilityId)
    });
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.integrationParameters.dt = SERVER_TICK_SECONDS;
    this.characterController = this.world.createCharacterController(PLAYER_CHARACTER_CONTROLLER_OFFSET);
    configurePlayerCharacterController(this.characterController);
    this.itemInventorySystem = new ItemInventorySystem<UserLike>({
      world: this.world,
      persistence: this.persistence,
      getUserById: (userId) => this.usersById.get(userId),
      getPlayerStateByUserId: (userId) => this.simulationEcs.getPlayerRuntimeStateByUserId(userId),
      setPlayerHealthByUserId: (userId, health) =>
        this.simulationEcs.setPlayerHealthByUserId(userId, health),
      markPlayerCharacterDirty: (accountId) =>
        this.persistenceSyncSystem.markAccountDirty(accountId, {
          dirtyCharacter: true,
          dirtyAbilityState: false
        }),
      addWorldItem: (item) => this.addWorldItem(item),
      syncWorldItem: (item) => this.syncWorldItem(item),
      removeWorldItem: (item) => this.removeWorldItem(item),
      queueInventoryState: (user, snapshot) => this.queueInventoryStateMessage(user, snapshot)
    });
    this.damageSystem = new DamageSystem({
      maxPlayerHealth: this.archetypes.player.maxHealth,
      playerBodyCenterHeight: PLAYER_BODY_CENTER_HEIGHT,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      getSpawnPosition: () => this.getSpawnPosition(),
      getSpawnBodyY: (x, z) => this.getSpawnBodyY(x, z),
      markCharacterDirtyByAccountId: (accountId, options) =>
        this.persistenceSyncSystem.markAccountDirty(accountId, options),
      getCharacterStateByEid: (eid) => this.simulationEcs.getCharacterDamageStateByEid(eid),
      applyCharacterStateByEid: (eid, state) => this.simulationEcs.applyCharacterDamageStateByEid(eid, state),
      getDummyStateByEid: (eid) => this.simulationEcs.getDummyDamageStateByEid(eid),
      applyDummyStateByEid: (eid, state) => this.simulationEcs.applyDummyDamageStateByEid(eid, state)
    });
    this.worldContentCoordinator = new WorldContentCoordinator({
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
      getOwnerCollider: (ownerNid) => this.simulationEcs.getCharacterColliderByNid(ownerNid),
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
    this.abilityExecutionSystem = new AbilityExecutionSystem<RuntimePlayerState | NpcCharacter>({
      getElapsedSeconds: () => this.elapsedSeconds,
      resolveAbilityById: (player, abilityId) =>
        this.getAbilityDefinitionForUnlockedSet(player.unlockedAbilityIds, abilityId),
      broadcastAbilityUse: (player, ability) =>
        this.replication.broadcastAbilityUseMessage(player, ability),
      spawnProjectile: (request) => this.projectileSystem.spawn(request),
      applyMeleeHit: (player, meleeProfile) =>
        this.meleeCombatSystem.tryApplyMeleeHit(player, meleeProfile)
    });
    this.inputSystem = new InputSystem<RuntimePlayerState>({
      onPrimaryPressed: (player) => this.abilityExecutionSystem.tryUsePrimaryMouseAbility(player),
      onSecondaryPressed: (player) => this.abilityExecutionSystem.tryUseSecondaryMouseAbility(player),
      onCastSlotPressed: (player, slot) => this.abilityExecutionSystem.tryUseAbilityBySlot(player, slot)
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
    this.locationRootSystem = new LocationRootSystem({
      world: this.world,
      onLocationAdded: (location) => {
        this.simulationEcs.registerLocationRoot(location);
        const eid = this.requireEid(location);
        const nid = this.replication.spawnEntity(eid, this.toReplicationSnapshot(location));
        location.nid = nid;
        this.simulationEcs.setEntityNidByEid(eid, nid);
      },
      onLocationUpdated: (location) => {
        this.simulationEcs.syncLocationRoot(location);
      }
    });
    const navigationBuild = buildServerNavigationWorld({
      getElapsedSeconds: () => this.elapsedSeconds,
      enableRecastSurfaceNavigation: this.resolveBooleanEnv("NAVIGATION_RECAST_SURFACES_ENABLED", true),
      cache: {
        enabled: this.resolveBooleanEnv("NAVIGATION_CACHE_ENABLED", true),
        readEnabled: this.resolveBooleanEnv("NAVIGATION_CACHE_READ_ENABLED", true),
        writeEnabled: this.resolveBooleanEnv("NAVIGATION_CACHE_WRITE_ENABLED", true),
        directory: this.resolveOptionalEnvString("NAVIGATION_CACHE_DIR")
      }
    });
    this.navigationPlanner = new CharacterNavigationPlanner(navigationBuild.world);
    this.logNavigationBuildReport(navigationBuild.report);
    this.abilityCommandHandler = new AbilityCommandHandler<UserLike>({
      getAbilityStateByUserId: (userId) => this.simulationEcs.getPlayerAbilityStateByUserId(userId),
      setPlayerHotbarAbilityByUserId: (userId, slot, abilityId) =>
        this.simulationEcs.setPlayerHotbarAbilityByUserId(userId, slot, abilityId),
      setPlayerPrimaryMouseSlotByUserId: (userId, slot) =>
        this.simulationEcs.setPlayerPrimaryMouseSlotByUserId(userId, slot),
      setPlayerSecondaryMouseSlotByUserId: (userId, slot) =>
        this.simulationEcs.setPlayerSecondaryMouseSlotByUserId(userId, slot),
      getPlayerAccountIdByUserId: (userId) => this.simulationEcs.getPlayerAccountIdByUserId(userId),
      markAccountAbilityStateDirty: (accountId) =>
        this.persistenceSyncSystem.markAccountDirty(accountId, {
          dirtyCharacter: false,
          dirtyAbilityState: true
        }),
      queueAbilityStateMessageFromSnapshot: (user, snapshot) =>
        this.replication.queueAbilityStateMessageFromSnapshot(user, snapshot),
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
          this.abilityExecutionSystem.tryUsePrimaryMouseAbility(player);
        }
        if (player.secondaryHeld) {
          this.abilityExecutionSystem.tryUseSecondaryMouseAbility(player);
        }
      },
      samplePlayerPlatformCarry: (player) => {
        const platformCarry = this.platformSystem.samplePlayerPlatformCarry(player);
        const frameCarry = this.locationRootSystem.sampleFrameCarry(player);
        return {
          x: platformCarry.x + frameCarry.x,
          y: platformCarry.y + frameCarry.y,
          z: platformCarry.z + frameCarry.z,
          yaw: platformCarry.yaw + frameCarry.yaw,
          carriedFramePid: frameCarry.carriedFramePid
        };
      },
      resolvePlayerCarriedFramePid: (player, movedBody, previousCarriedFramePid) =>
        this.locationRootSystem.resolveCarriedFramePidForPoint(movedBody, previousCarriedFramePid),
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
    this.npcMovementSystem = new CharacterMovementSystem<NpcCharacter>({
      world: this.world,
      characterController: this.characterController,
      capsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
      capsuleRadius: PLAYER_CAPSULE_RADIUS,
      sampleCharacterCarry: (character) => {
        const platformCarry = this.platformSystem.samplePlayerPlatformCarry(character);
        const frameCarry = this.locationRootSystem.sampleFrameCarry(character);
        return {
          x: platformCarry.x + frameCarry.x,
          y: platformCarry.y + frameCarry.y,
          z: platformCarry.z + frameCarry.z,
          yaw: platformCarry.yaw + frameCarry.yaw,
          carriedFramePid: frameCarry.carriedFramePid
        };
      },
      resolveCharacterCarriedFramePid: (_character, movedBody, previousCarriedFramePid) =>
        this.locationRootSystem.resolveCarriedFramePidForPoint(movedBody, previousCarriedFramePid),
      resolvePlatformPidByColliderHandle: (colliderHandle) =>
        this.platformSystem.resolvePlatformPidByColliderHandle(colliderHandle),
      onCharacterStepped: (_eid, character) => {
        this.simulationEcs.syncCharacter(character);
      }
    });
    this.npcAiSystem = new NpcAiSystem({
      world: this.world,
      navigation: this.navigationPlanner,
      characterArchetypes: this.archetypes.characterArchetypes,
      spawns: this.archetypes.npcSpawns,
      controllerKindAi: CONTROLLER_KIND_AI,
      onCharacterCreated: (character) => this.addNpcCharacter(character),
      onCharacterUpdated: (character) => this.simulationEcs.syncCharacter(character),
      hasPerceptionTargets: () => this.aiPerceptionTargetByColliderHandle.size > 0,
      resolvePerceptionTargetByColliderHandle: (colliderHandle) =>
        this.aiPerceptionTargetByColliderHandle.get(colliderHandle) ?? null,
      usePrimaryAbility: (character) => this.abilityExecutionSystem.tryUsePrimaryMouseAbility(character),
      aiTickIntervalSeconds: this.resolvePositiveEnvNumber("NPC_AI_TICK_INTERVAL", 0.2),
      perceptionTickIntervalSeconds: this.resolvePositiveEnvNumber("NPC_PERCEPTION_TICK_INTERVAL", 0.25),
      pathReplanIntervalSeconds: this.resolvePositiveEnvNumber("NPC_PATH_REPLAN_INTERVAL", 0.75),
      inactiveAiTickIntervalSeconds: this.resolvePositiveEnvNumber("NPC_AI_INACTIVE_TICK_INTERVAL", 0.65),
      inactivePerceptionTickIntervalSeconds: this.resolvePositiveEnvNumber(
        "NPC_PERCEPTION_INACTIVE_TICK_INTERVAL",
        0.95
      ),
      inactivePathReplanIntervalSeconds: this.resolvePositiveEnvNumber(
        "NPC_PATH_REPLAN_INACTIVE_INTERVAL",
        2
      ),
      lifecycleRecheckIntervalSeconds: this.resolvePositiveEnvNumber("NPC_LIFECYCLE_RECHECK_INTERVAL", 0.5),
      inactiveMoveSpeedScale: this.resolveClampedEnvNumber("NPC_AI_INACTIVE_MOVE_SPEED_SCALE", 0.72, 0.05, 1),
      pathStuckTimeoutSeconds: this.resolvePositiveEnvNumber("NPC_PATH_STUCK_TIMEOUT", 1.35),
      pathStuckRecoveryDelaySeconds: this.resolvePositiveEnvNumber("NPC_PATH_STUCK_RECOVERY_DELAY", 0.45),
      hibernationEnabled: this.resolveBooleanEnv("NPC_HIBERNATION_ENABLED", false)
    });
    this.playerLifecycleSystem = this.createPlayerLifecycleSystem();

    this.worldContentCoordinator.initializeWorldContent({
      platformSystem: this.platformSystem,
      trainingDummies: {
        spawns: this.archetypes.trainingDummy.spawns,
        capsuleHalfHeight: this.archetypes.trainingDummy.capsuleHalfHeight,
        capsuleRadius: this.archetypes.trainingDummy.capsuleRadius,
        maxHealth: this.archetypes.trainingDummy.maxHealth,
        modelId: this.archetypes.trainingDummy.modelId
      },
      resolveDummyEid: (dummy) => this.requireEid(dummy),
      registerDummyCollider: (colliderHandle, eid) =>
        this.damageSystem.registerDummyCollider(colliderHandle, eid)
    });
    this.locationRootSystem.initializeLocations();
    this.itemInventorySystem.initializeWorldItems();
    this.npcAiSystem.initialize();
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

  public applyAbilityCommand(user: UserLike, command: Partial<AbilityWireCommand>): void {
    if (!this.simulationEcs.getPlayerRuntimeStateByUserId(user.id)) {
      return;
    }
    this.applyForgetAbilityIntent(user, command);
    this.abilityCommandHandler.apply(user, command);
  }

  public applyAbilityCreatorCommand(user: UserLike, command: Partial<AbilityCreatorWireCommand>): void {
    const abilityState = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
    const accountId = this.simulationEcs.getPlayerAccountIdByUserId(user.id);
    if (!abilityState || accountId === null) {
      return;
    }
    const result = this.abilityCreatorSystem.applyCommand({
      userId: user.id,
      accountId,
      ownedAbilityIds: abilityState.unlockedAbilityIds,
      command
    });

    if (result.createdAbility && result.nextOwnedAbilityIds) {
      const ownedChanged = this.simulationEcs.setPlayerUnlockedAbilityIdsByUserId(
        user.id,
        result.nextOwnedAbilityIds
      );
      let hotbarChanged = false;
      if (typeof result.replacedAbilityId === "number" && result.replacedAbilityId > 0) {
        hotbarChanged = this.simulationEcs.replacePlayerAbilityOnHotbarByUserId(
          user.id,
          result.replacedAbilityId,
          result.createdAbility.id
        );
      }

      this.replication.queueAbilityDefinitionMessage(user, result.createdAbility);

      const refreshed = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
      if (refreshed) {
        this.replication.queueAbilityOwnershipMessage(user, refreshed.unlockedAbilityIds);
        this.replication.queueAbilityStateMessageFromSnapshot(user, refreshed);
      }

      if (ownedChanged || hotbarChanged) {
        this.persistenceSyncSystem.markAccountDirty(accountId, {
          dirtyCharacter: false,
          dirtyAbilityState: true
        });
      }
    }

    this.replication.queueAbilityCreatorStateMessage(user, result.snapshot);
  }

  public applyItemCommand(user: UserLike, command: Partial<ItemWireCommand>): void {
    if (!this.simulationEcs.getPlayerRuntimeStateByUserId(user.id)) {
      return;
    }
    this.itemInventorySystem.applyCommand(user.id, command);
  }

  private applyForgetAbilityIntent(user: UserLike, command: Partial<AbilityWireCommand>): void {
    if (!command.applyForgetAbility) {
      return;
    }
    const abilityStateBefore = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
    const accountId = this.simulationEcs.getPlayerAccountIdByUserId(user.id);
    if (!abilityStateBefore || accountId === null) {
      return;
    }

    const targetAbilityId = this.normalizeAbilityId(command.forgetAbilityId);
    if (targetAbilityId <= ABILITY_ID_NONE) {
      this.replication.queueAbilityOwnershipMessage(user, abilityStateBefore.unlockedAbilityIds);
      this.replication.queueAbilityStateMessageFromSnapshot(user, abilityStateBefore);
      const creatorSnapshot = this.abilityCreatorSystem.synchronizeSessionOwnedAbilities(
        user.id,
        abilityStateBefore.unlockedAbilityIds
      );
      if (creatorSnapshot) {
        this.replication.queueAbilityCreatorStateMessage(user, creatorSnapshot);
      }
      return;
    }

    const forgetResult = this.abilityCreatorSystem.forgetOwnedAbility({
      accountId,
      ownedAbilityIds: abilityStateBefore.unlockedAbilityIds,
      abilityId: targetAbilityId
    });
    if (!forgetResult.ok) {
      this.replication.queueAbilityOwnershipMessage(user, abilityStateBefore.unlockedAbilityIds);
      this.replication.queueAbilityStateMessageFromSnapshot(user, abilityStateBefore);
      const creatorSnapshot = this.abilityCreatorSystem.synchronizeSessionOwnedAbilities(
        user.id,
        abilityStateBefore.unlockedAbilityIds
      );
      if (creatorSnapshot) {
        this.replication.queueAbilityCreatorStateMessage(user, creatorSnapshot);
      }
      return;
    }

    const ownedChanged = this.simulationEcs.setPlayerUnlockedAbilityIdsByUserId(
      user.id,
      forgetResult.nextOwnedAbilityIds
    );
    const hotbarChanged = this.simulationEcs.clearPlayerAbilityOnHotbarByUserId(
      user.id,
      forgetResult.forgottenAbilityId
    );

    const abilityStateAfter = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
    if (!abilityStateAfter) {
      return;
    }

    this.replication.queueAbilityOwnershipMessage(user, abilityStateAfter.unlockedAbilityIds);
    this.replication.queueAbilityStateMessageFromSnapshot(user, abilityStateAfter);
    const creatorSnapshot = this.abilityCreatorSystem.synchronizeSessionOwnedAbilities(
      user.id,
      abilityStateAfter.unlockedAbilityIds
    );
    if (creatorSnapshot) {
      this.replication.queueAbilityCreatorStateMessage(user, creatorSnapshot);
    }

    if (ownedChanged || hotbarChanged) {
      this.persistenceSyncSystem.markAccountDirty(accountId, {
        dirtyCharacter: false,
        dirtyAbilityState: true
      });
    }
  }

  public step(delta: number): void {
    this.tickNumber += 1;
    const previousElapsedSeconds = this.elapsedSeconds;
    this.elapsedSeconds += delta;
    this.world.integrationParameters.dt = delta;
    this.platformSystem.updatePlatforms(previousElapsedSeconds, this.elapsedSeconds);
    this.locationRootSystem.updateLocations(previousElapsedSeconds, this.elapsedSeconds);
    this.refreshAiPerceptionTargets();
    this.emitPlayerPresenceStimuli();
    this.npcAiSystem.step(this.elapsedSeconds);
    this.playerMovementSystem.stepPlayers(this.getMovementPlayerEntries(), delta, this.elapsedSeconds);
    this.npcMovementSystem.stepCharacters(this.getNpcMovementEntries(), delta, this.elapsedSeconds);

    this.projectileSystem.step(delta);
    this.simulationEcs.forEachReplicatedState(
      (
        eid,
        _nid,
        modelId,
        x,
        y,
        z,
        rx,
        ry,
        rz,
        rw,
        grounded,
        movementMode,
        health,
        maxHealth,
        itemArchetypeId,
        itemQuantity,
        locationKind,
        locationArchetypeId,
        locationSeed,
        locationEnvironmentId,
        locationStreamingRadius,
        locationInfluenceRadius
      ) => {
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
          movementMode,
          health,
          maxHealth,
          itemArchetypeId,
          itemQuantity,
          locationKind,
          locationArchetypeId,
          locationSeed,
          locationEnvironmentId,
          locationStreamingRadius,
          locationInfluenceRadius
        );
      }
    );
    this.world.step();
    this.maybeBroadcastServerPopulation();
  }

  public flushDirtyPlayerState(overrides?: {
    saveCharacterSnapshot?: (snapshot: PlayerSnapshot) => void;
    saveAbilityStateSnapshot?: (snapshot: PlayerSnapshot) => void;
  }): void {
    this.persistenceSyncSystem.flushDirtyPlayerState(
      (accountId) => {
        return this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(accountId);
      },
      (snapshot) => {
        if (overrides?.saveCharacterSnapshot) {
          overrides.saveCharacterSnapshot(snapshot);
          return;
        }
        this.persistence.saveCharacterSnapshot(snapshot);
      },
      (snapshot) => {
        if (overrides?.saveAbilityStateSnapshot) {
          overrides.saveAbilityStateSnapshot(snapshot);
          return;
        }
        this.persistence.saveAbilityStateSnapshot(snapshot);
      }
    );
  }

  public getRuntimeStats(): {
    onlinePlayers: number;
    activeProjectiles: number;
    pendingOfflineSnapshots: number;
    ecsEntities: number;
    activeNpcs: number;
    inactiveNpcs: number;
    hibernatingNpcs: number;
  } {
    const ecsStats = this.simulationEcs.getStats();
    const aiStats = this.npcAiSystem.getStats();
    return {
      onlinePlayers: this.simulationEcs.getOnlinePlayerCount(),
      activeProjectiles: this.projectileSystem.getActiveCount(),
      pendingOfflineSnapshots: this.persistenceSyncSystem.getPendingOfflineSnapshotCount(),
      ecsEntities: ecsStats.total,
      activeNpcs: aiStats.active,
      inactiveNpcs: aiStats.inactive,
      hibernatingNpcs: aiStats.hibernating
    };
  }

  private getAbilityDefinitionForUnlockedSet(
    unlockedAbilityIds: Set<number>,
    abilityId: number
  ): AbilityDefinition | null {
    if (!unlockedAbilityIds.has(abilityId)) {
      return null;
    }

    return this.resolveAbilityDefinitionById(abilityId);
  }

  public injectPendingLoginSnapshot(accountId: number, snapshot: PlayerSnapshot): void {
    this.persistenceSyncSystem.queueOfflineSnapshot(accountId, snapshot);
  }

  public getPlayerSnapshotByUserId(userId: number): PlayerSnapshot | null {
    const accountId = this.simulationEcs.getPlayerAccountIdByUserId(userId);
    if (accountId === null) {
      return null;
    }
    return this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(accountId);
  }

  private sanitizeHotbarSlot(rawSlot: unknown, fallbackSlot: number): number {
    if (typeof rawSlot !== "number" || !Number.isFinite(rawSlot)) {
      return fallbackSlot;
    }
    return clampHotbarSlotIndex(rawSlot);
  }

  private normalizeAbilityId(rawAbilityId: unknown): number {
    if (typeof rawAbilityId !== "number" || !Number.isFinite(rawAbilityId)) {
      return ABILITY_ID_NONE;
    }
    return Math.max(ABILITY_ID_NONE, Math.min(0xffff, Math.floor(rawAbilityId)));
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
    return this.resolveAbilityDefinitionById(normalized) ? normalized : fallbackAbilityId;
  }

  private resolveAbilityDefinitionById(abilityId: number): AbilityDefinition | null {
    return this.abilityCreatorSystem.resolveAbilityDefinitionById(abilityId);
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

  private toReplicationSnapshot(entity: {
    nid: number;
    modelId: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    grounded: boolean;
    movementMode?: MovementMode;
    health: number;
    maxHealth: number;
    itemArchetypeId?: number;
    itemQuantity?: number;
    locationKind?: number;
    locationArchetypeId?: number;
    locationSeed?: number;
    locationEnvironmentId?: number;
    locationStreamingRadius?: number;
    locationInfluenceRadius?: number;
  }): {
    nid: number;
    modelId: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    grounded: boolean;
    movementMode: MovementMode;
    health: number;
    maxHealth: number;
    itemArchetypeId: number;
    itemQuantity: number;
    locationKind: number;
    locationArchetypeId: number;
    locationSeed: number;
    locationEnvironmentId: number;
    locationStreamingRadius: number;
    locationInfluenceRadius: number;
  } {
    return {
      nid: entity.nid,
      modelId: entity.modelId,
      position: entity.position,
      rotation: entity.rotation,
      grounded: entity.grounded,
      movementMode: entity.movementMode ?? MOVEMENT_MODE_GROUNDED,
      health: entity.health,
      maxHealth: entity.maxHealth,
      itemArchetypeId: entity.itemArchetypeId ?? 0,
      itemQuantity: entity.itemQuantity ?? 0,
      locationKind: entity.locationKind ?? 0,
      locationArchetypeId: entity.locationArchetypeId ?? 0,
      locationSeed: entity.locationSeed ?? 0,
      locationEnvironmentId: entity.locationEnvironmentId ?? 0,
      locationStreamingRadius: entity.locationStreamingRadius ?? 0,
      locationInfluenceRadius: entity.locationInfluenceRadius ?? 0
    };
  }

  private addWorldItem(item: WorldItemObject): void {
    this.simulationEcs.registerWorldItem(item);
    const eid = this.requireEid(item);
    const nid = this.replication.spawnEntity(eid, this.toReplicationSnapshot(item));
    item.nid = nid;
    this.simulationEcs.setEntityNidByEid(eid, nid);
  }

  private syncWorldItem(item: WorldItemObject): void {
    this.simulationEcs.syncWorldItem(item);
  }

  private removeWorldItem(item: WorldItemObject): void {
    const eid = this.simulationEcs.getEidForObject(item);
    if (typeof eid !== "number") {
      return;
    }
    this.replication.despawnEntity(eid);
    this.simulationEcs.unregister(item);
  }

  private queueInventoryStateMessage(user: UserLike, snapshot: InventoryStateSnapshot): void {
    user.queueMessage({
      ntype: NType.InventoryStateMessage,
      inventoryJson: encodeInventoryStateSnapshot(snapshot)
    });
  }

  private addNpcCharacter(character: NpcCharacter): void {
    this.simulationEcs.registerNpcCharacter(character);
    const eid = this.requireEid(character);
    this.controllerSystem.attachAiController(eid);
    const nid = this.replication.spawnEntity(eid, this.toReplicationSnapshot(character));
    character.nid = nid;
    this.simulationEcs.setEntityNidByEid(eid, nid);
    this.damageSystem.registerCharacterCollider(character.collider.handle, eid);
  }

  private refreshAiPerceptionTargets(): void {
    this.aiPerceptionTargetByColliderHandle.clear();
    for (const userId of this.simulationEcs.getOnlinePlayerUserIds()) {
      const runtimePlayer = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
      if (!runtimePlayer) {
        continue;
      }
      const playerEid = this.controllerSystem.getControlledCharacterEidByUserId(userId);
      if (playerEid === null) {
        continue;
      }
      this.aiPerceptionTargetByColliderHandle.set(runtimePlayer.collider.handle, {
        eid: playerEid,
        nid: runtimePlayer.nid,
        x: runtimePlayer.x,
        y: runtimePlayer.y,
        z: runtimePlayer.z,
        movementMode: runtimePlayer.movementMode,
        carriedFramePid: runtimePlayer.carriedFramePid,
        groundedPlatformPid: runtimePlayer.groundedPlatformPid
      });
    }
  }

  private emitPlayerPresenceStimuli(): void {
    if (this.elapsedSeconds < this.nextNpcPlayerAlertAtSeconds) {
      return;
    }
    this.nextNpcPlayerAlertAtSeconds = this.elapsedSeconds + this.npcPlayerAlertIntervalSeconds;
    for (const target of this.aiPerceptionTargetByColliderHandle.values()) {
      const sourceCollider = this.simulationEcs.getPlayerColliderByNid(target.nid);
      const stimulus = {
        target,
        x: target.x,
        y: target.y,
        z: target.z,
        expiresAtSeconds: this.elapsedSeconds + this.npcPlayerAlertMemorySeconds
      };
      this.world.intersectionsWithShape(
        { x: target.x, y: target.y, z: target.z },
        { x: 0, y: 0, z: 0, w: 1 },
        this.npcPlayerAlertShape,
        (collider) => {
          this.npcAiSystem.receivePlayerPresenceByColliderHandle(collider.handle, stimulus, this.elapsedSeconds);
          return true;
        },
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        sourceCollider
      );
    }
  }

  private getSpawnPosition(): { x: number; z: number } {
    const occupied = this.simulationEcs.getOnlinePlayerPositionsXZ();
    if (this.loadTestSpawnMode === "grid") {
      return this.getLoadTestGridSpawnPosition(occupied.length);
    }

    const minSeparation = PLAYER_CAPSULE_RADIUS * 4;
    const minSeparationSq = minSeparation * minSeparation;
    const baseX = DEFAULT_VOID_SPAWN_ANCHOR.x;
    const baseZ = DEFAULT_VOID_SPAWN_ANCHOR.z;
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
        const candidateX = baseX + Math.cos(angle) * radius;
        const candidateZ = baseZ + Math.sin(angle) * radius;
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
          if (!this.isSpawnCandidateValid(candidateX, candidateZ)) {
            continue;
          }
          return { x: candidateX, z: candidateZ };
        }
      }
    }

    return { x: baseX + baseRadius + (maxRings + 1) * ringStep, z: baseZ };
  }

  private getLoadTestGridSpawnPosition(index: number): { x: number; z: number } {
    const safeIndex = Math.max(0, Math.floor(index));
    const columns = this.loadTestGridColumns;
    const rows = this.loadTestGridRows;
    const spacing = this.loadTestGridSpacing;
    const col = safeIndex % columns;
    const row = Math.floor(safeIndex / columns);
    const centerCol = (columns - 1) / 2;
    const centerRow = (rows - 1) / 2;
    const x = (col - centerCol) * spacing;
    const z = (row - centerRow) * spacing;
    return { x, z };
  }

  private getSpawnBodyY(x: number, z: number): number {
    void x;
    void z;
    return DEFAULT_VOID_SPAWN_ANCHOR.y - PLAYER_CAMERA_OFFSET_Y;
  }

  private isSpawnCandidateValid(x: number, z: number): boolean {
    void x;
    void z;
    return true;
  }

  private resolveLoadTestSpawnMode(): "default" | "grid" {
    const raw = String(process.env.SERVER_LOAD_TEST_SPAWN_MODE ?? "").trim().toLowerCase();
    return raw === "grid" ? "grid" : "default";
  }

  private resolveLoadTestGridSpacing(): number {
    const parsed = Number(process.env.SERVER_LOAD_TEST_GRID_SPACING ?? 320);
    if (!Number.isFinite(parsed) || parsed < 8) {
      return 320;
    }
    return parsed;
  }

  private resolveLoadTestGridColumns(): number {
    const parsed = Number(process.env.SERVER_LOAD_TEST_GRID_COLUMNS ?? 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 10;
    }
    return Math.max(1, Math.floor(parsed));
  }

  private resolveLoadTestGridRows(): number {
    const parsed = Number(process.env.SERVER_LOAD_TEST_GRID_ROWS ?? this.loadTestGridColumns);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return this.loadTestGridColumns;
    }
    return Math.max(1, Math.floor(parsed));
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

  private getNpcMovementEntries(): Array<readonly [number, NpcCharacter]> {
    const entries: Array<readonly [number, NpcCharacter]> = [];
    for (const character of this.npcAiSystem.getCharacters()) {
      const eid = this.simulationEcs.getEidForObject(character);
      if (typeof eid !== "number") {
        continue;
      }
      entries.push([eid, character] as const);
    }
    return entries;
  }

  private resolvePositiveEnvNumber(name: string, fallback: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private resolveClampedEnvNumber(name: string, fallback: number, min: number, max: number): number {
    const parsed = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
  }

  private resolveBooleanEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined) {
      return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }

  private resolveOptionalEnvString(name: string): string | undefined {
    const raw = process.env[name];
    if (!raw) {
      return undefined;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private logNavigationBuildReport(report: NavigationBuildReport): void {
    console.log(
      `[navigation] boot contexts=${report.surfaceContextCount} generated=${report.generatedCount} failed=${report.failedCount} cache=${report.cacheEnabled ? "on" : "off"} cacheHits=${report.cacheHits}/${report.cacheReads} writes=${report.cacheWrites} totalMs=${report.durationMs.toFixed(1)}`
    );
    if (!this.resolveBooleanEnv("NAVIGATION_BOOT_LOG_VERBOSE", false)) {
      return;
    }
    for (const context of report.contexts) {
      console.log(
        `[navigation] context id=${context.contextId} kind=${context.kind} source=${context.source} verts=${context.vertices} tris=${context.triangles} ms=${context.durationMs.toFixed(1)}`
      );
    }
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

  private maybeBroadcastServerPopulation(): void {
    if (this.tickNumber % this.populationBroadcastIntervalTicks !== 0) {
      return;
    }
    const onlinePlayers = this.simulationEcs.getOnlinePlayerCount();
    const safeCount = Math.max(0, Math.min(0xffff, Math.floor(onlinePlayers)));
    for (const user of this.usersById.values()) {
      user.queueMessage({
        ntype: NType.ServerPopulationMessage,
        onlinePlayers: safeCount
      });
    }
  }

  private createPlayerLifecycleSystem(): PlayerLifecycleSystem<UserLike, PlayerEntity> {
    return new PlayerLifecycleSystem<UserLike, PlayerEntity>({
      world: this.world,
      globalChannel: this.globalChannel,
      nearChannel: this.nearChannel,
      farChannel: this.farChannel,
      createUserView: ({ x, y, z, halfWidth, halfHeight, halfDepth }) =>
        this.createUserView({ x, y, z, halfWidth, halfHeight, halfDepth }),
      usersById: this.usersById,
      resolvePlayerByUserId: (userId) => this.simulationEcs.getPlayerObjectByUserId<PlayerEntity>(userId),
      takePendingSnapshotForLogin: (accountId) =>
        this.persistenceSyncSystem.takePendingSnapshotForLogin(accountId),
      loadPlayerState: (accountId) => this.persistence.loadPlayerState(accountId),
      getSpawnPosition: () => this.getSpawnPosition(),
      getSpawnBodyY: (x, z) => this.getSpawnBodyY(x, z),
      playerBodyCenterHeight: PLAYER_BODY_CENTER_HEIGHT,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
      playerCapsuleRadius: PLAYER_CAPSULE_RADIUS,
      maxPlayerHealth: this.archetypes.player.maxHealth,
      defaultUnlockedAbilityIds: DEFAULT_UNLOCKED_ABILITY_IDS,
      resolveInitialUnlockedAbilityIds: (accountId, defaultUnlockedAbilityIds) =>
        this.abilityCreatorSystem.resolveOwnedAbilityIds(accountId, defaultUnlockedAbilityIds),
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
        movementMode: MOVEMENT_MODE_GROUNDED,
        groundedPlatformPid: null,
        carriedFramePid: null,
        health: options.health,
        maxHealth: this.archetypes.player.maxHealth,
        primaryMouseSlot: options.primaryMouseSlot,
        secondaryMouseSlot: options.secondaryMouseSlot,
        hotbarAbilityIds: options.hotbarAbilityIds,
        lastPrimaryFireAtSeconds: Number.NEGATIVE_INFINITY,
        lastProcessedSequence: 0,
        primaryHeld: false,
        secondaryHeld: false,
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
        const abilityState = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
        if (!abilityState) {
          return;
        }
        this.replication.sendInitialAbilityStateFromSnapshot(user, abilityState);
        const accountId = this.simulationEcs.getPlayerAccountIdByUserId(user.id);
        if (accountId === null) {
          return;
        }
        const creatorState = this.abilityCreatorSystem.initializeUserSession(
          user.id,
          abilityState.unlockedAbilityIds
        );
        this.replication.queueAbilityCreatorStateMessage(user, creatorState);
        const inventoryState = this.itemInventorySystem.ensureInventoryLoaded(accountId);
        this.queueInventoryStateMessage(user, inventoryState);
      },
      queueOfflineSnapshot: (accountId, snapshot) =>
        this.persistenceSyncSystem.queueOfflineSnapshot(accountId, snapshot),
      resolveOfflineSnapshotByAccountId: (accountId) => {
        return this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(accountId);
      },
      viewHalfWidth: 256,
      viewHalfHeight: 128,
      viewHalfDepth: 256,
      farViewHalfWidth: 3200,
      farViewHalfHeight: 1600,
      farViewHalfDepth: 3200,
      onPlayerAdded: (user, player) => {
        this.simulationEcs.registerPlayer(player);
        const eid = this.requireEid(player);
        this.controllerSystem.attachPlayerController(user.id, eid);
        const nid = this.replication.spawnEntity(eid, this.toReplicationSnapshot(player));
        player.nid = nid;
        this.simulationEcs.setEntityNidByEid(eid, nid);
        this.simulationEcs.bindPlayerLookupIndexes(player, user.id);
      },
      onPlayerRemoved: (user, player) => {
        this.abilityCreatorSystem.removeUserSession(user.id);
        this.controllerSystem.detachUser(user.id);
        this.simulationEcs.unbindPlayerLookupIndexes(player, user.id);
        const eid = this.simulationEcs.getEidForObject(player);
        if (typeof eid === "number") {
          this.replication.despawnEntity(eid);
        }
        this.simulationEcs.unregister(player);
      }
    });
  }

  private requireEid(entity: object): number {
    const eid = this.simulationEcs.getEidForObject(entity);
    if (typeof eid === "number") {
      return eid;
    }
    throw new Error("Simulation ECS eid not found for registered entity");
  }

}
