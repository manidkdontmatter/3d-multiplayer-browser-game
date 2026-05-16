// Authoritative server simulation orchestrator — all systems read/write ECS components directly.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ABILITY_ID_NONE, ABILITY_ID_PUNCH,
  clampHotbarSlotIndex, configurePlayerCharacterController,
  DEFAULT_HOTBAR_ABILITY_IDS, DEFAULT_VOID_SPAWN_ANCHOR, DEFAULT_UNLOCKED_ABILITY_IDS,
  HOTBAR_SLOT_COUNT, PLAYER_BODY_CENTER_HEIGHT, MOVEMENT_MODE_GROUNDED,
  PLAYER_CHARACTER_CONTROLLER_OFFSET, PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS,
  encodeInventoryStateSnapshot, getAbilityDefinitionById,
  quaternionFromYawPitchRoll, resolveRuntimeMapConfig,
  type InventoryStateSnapshot, type MovementMode, SERVER_TICK_SECONDS
} from "../shared/index";
import type { AbilityDefinition, CreatorSessionSnapshot } from "../shared/index";
import {
  NType,
  type AbilityCommand as AbilityWireCommand,
  type CreatorCommandWire,
  type ItemCommand as ItemWireCommand,
  type InputCommand as InputWireCommand
} from "../shared/netcode";
import { PersistenceService, type PlayerSnapshot } from "./persistence/PersistenceService";
import { PersistenceSyncSystem } from "./persistence/PersistenceSyncSystem";
import { DamageSystem } from "./combat/damage/DamageSystem";
import { AbilityExecutionSystem, type AbilityUseContext } from "./combat/abilities/AbilityExecutionSystem";
import { MeleeCombatSystem } from "./combat/melee/MeleeCombatSystem";
import { ProjectileSystem } from "./combat/projectiles/ProjectileSystem";
import { InputSystem } from "./input/InputSystem";
import { PlayerLifecycleSystem, type PlayerSpawnContext } from "./lifecycle/PlayerLifecycleSystem";
import { LocationRootSystem, type LocationFrameActor } from "./location/LocationRootSystem";
import { PlayerMovementSystem } from "./movement/PlayerMovementSystem";
import { AbilityCommandHandler } from "./net/AbilityCommandHandler";
import { CreatorSystem } from "./creator/CreatorSystem";
import { ItemInventorySystem, type WorldItemObject } from "./items/ItemInventorySystem";
import { ServerReplicationCoordinator } from "./net/ServerReplicationCoordinator";
import { PlatformSystem, type PlatformCarryActor } from "./platform/PlatformSystem";
import { NpcAiSystem, type NpcCharacter } from "./ai/NpcAiSystem";
import { WorldContentCoordinator } from "./world/WorldContentCoordinator";
import { SimulationEcs } from "./ecs/SimulationEcs";
import { loadServerArchetypeCatalog, type ServerArchetypeCatalog } from "./content/ArchetypeCatalog";
import { CONTROLLER_KIND_AI, ControllerSystem } from "./controllers/ControllerSystem";
import { CharacterMovementSystem } from "./movement/CharacterMovementSystem";
import { CharacterNavigationPlanner } from "./navigation/NavigationService";
import { buildServerNavigationWorld, type NavigationBuildReport } from "./navigation/NavigationWorldBuilder";
import type { PlayerStateSnapshot } from "./ecs/SimulationEcsTypes";
import { EventBus } from "./events/EventBus";
import { GameEvent, type PlayerMovedPayload, type PlayerSpawnedPayload, type PlayerDespawnedPayload, type DamageDealtPayload, type HealthChangedPayload, type AbilityUsedPayload } from "./events/GameEvents";
import { StatusEffectSystem } from "./combat/status/StatusEffectSystem";

type UserLike = {
  id: number; queueMessage: (message: unknown) => void; accountId?: number;
  view?: { x: number; y: number; z: number; halfWidth: number; halfHeight: number; halfDepth: number };
  farView?: { x: number; y: number; z: number; halfWidth: number; halfHeight: number; halfDepth: number };
};

type GlobalChannelLike = { subscribe: (user: UserLike) => void };
type SpatialChannelLike = {
  subscribe: (user: UserLike, view: NonNullable<UserLike["view"] | UserLike["farView"]>) => void;
  addEntity: (entity: unknown) => void;
  removeEntity: (entity: unknown) => void;
  addMessage: (message: unknown) => void;
};
type FarSpatialChannelLike = {
  subscribe: (user: UserLike, view: NonNullable<UserLike["farView"]>) => void;
  addEntity: (entity: unknown) => void;
  removeEntity: (entity: unknown) => void;
};
type CreateUserView = (p: { x: number; y: number; z: number; halfWidth: number; halfHeight: number; halfDepth: number }) => NonNullable<UserLike["view"]>;

export class GameSimulation {
  private readonly usersById = new Map<number, UserLike>();
  private readonly world: RAPIER.World;
  public readonly events = new EventBus();
  public readonly statusEffects: StatusEffectSystem;
  private readonly simulationEcs = new SimulationEcs();
  private readonly controllerSystem = new ControllerSystem();
  private readonly replication: ServerReplicationCoordinator<UserLike>;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly persistenceSyncSystem = new PersistenceSyncSystem();
  private readonly worldContentCoordinator: WorldContentCoordinator;
  private readonly damageSystem: DamageSystem;
  private readonly meleeCombatSystem: MeleeCombatSystem;
  private readonly abilityExecutionSystem: AbilityExecutionSystem;
  private readonly projectileSystem: ProjectileSystem;
  private readonly inputSystem: InputSystem;
  private readonly abilityCommandHandler: AbilityCommandHandler<UserLike>;
  private readonly creatorSystem: CreatorSystem;
  private readonly itemInventorySystem: ItemInventorySystem<UserLike>;
  private readonly platformSystem: PlatformSystem;
  private readonly locationRootSystem: LocationRootSystem;
  private readonly navigationPlanner: CharacterNavigationPlanner;
  private readonly playerMovementSystem: PlayerMovementSystem;
  private readonly npcMovementSystem: CharacterMovementSystem;
  private readonly npcAiSystem: NpcAiSystem;
  private readonly playerLifecycleSystem: PlayerLifecycleSystem<UserLike>;
  private readonly archetypes: ServerArchetypeCatalog;
  private readonly runtimeMapConfig = resolveRuntimeMapConfig();
  private readonly loadTestSpawnMode: "default" | "grid";
  private readonly loadTestGridSpacing: number; private readonly loadTestGridColumns: number; private readonly loadTestGridRows: number;
  private readonly populationBroadcastRebroadcastTicks = 300;
  private lastBroadcastPlayerCount: number | null = null;
  private readonly npcPlayerAlertIntervalSeconds: number; private readonly npcPlayerAlertMemorySeconds: number;
  private readonly npcPlayerAlertShape: RAPIER.Ball;
  private readonly aiPerceptionTargetByColliderHandle = new Map<number, {
    eid: number; nid: number; x: number; y: number; z: number;
    movementMode: MovementMode; carriedFramePid: number | null; groundedPlatformPid: number | null;
  }>();
  private nextNpcPlayerAlertAtSeconds = 0; private elapsedSeconds = 0; private tickNumber = 0;

  public constructor(
    private readonly globalChannel: GlobalChannelLike,
    private readonly nearChannel: SpatialChannelLike,
    private readonly farChannel: FarSpatialChannelLike,
    private readonly persistence: PersistenceService,
    private readonly createUserView: CreateUserView
  ) {
    const c = this.simulationEcs.world.components;
    const indexes = this.simulationEcs as unknown as { getPlayerBody(eid: number): RAPIER.RigidBody | undefined; getPlayerCollider(eid: number): RAPIER.Collider | undefined; getCharacterBody(eid: number): RAPIER.RigidBody | undefined; getCharacterCollider(eid: number): RAPIER.Collider | undefined; getUnlockedAbilities(eid: number): Set<number> };

    this.archetypes = loadServerArchetypeCatalog();
    this.loadTestSpawnMode = this.resolveLoadTestSpawnMode();
    this.loadTestGridSpacing = this.resolveLoadTestGridSpacing();
    this.loadTestGridColumns = this.resolveLoadTestGridColumns();
    this.loadTestGridRows = this.resolveLoadTestGridRows();
    this.npcPlayerAlertIntervalSeconds = this.resolvePositiveEnvNumber("NPC_PLAYER_ALERT_INTERVAL", 0.5);
    this.npcPlayerAlertMemorySeconds = this.resolvePositiveEnvNumber("NPC_PLAYER_ALERT_MEMORY", 1.25);
    this.npcPlayerAlertShape = new RAPIER.Ball(this.resolvePositiveEnvNumber("NPC_PLAYER_ALERT_RADIUS", 220));
    this.creatorSystem = new CreatorSystem();
    this.replication = new ServerReplicationCoordinator<UserLike>({
      nearChannel: this.nearChannel, farChannel: this.farChannel,
      getTickNumber: () => this.tickNumber,
      getUserById: (userId) => this.usersById.get(userId),
      sanitizeHotbarSlot: (rawSlot, fallbackSlot) => this.sanitizeHotbarSlot(rawSlot, fallbackSlot),
      getAbilityDefinitionById: (abilityId) => this.resolveAbilityDefinitionById(abilityId)
    }, c);
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.integrationParameters.dt = SERVER_TICK_SECONDS;
    this.characterController = this.world.createCharacterController(PLAYER_CHARACTER_CONTROLLER_OFFSET);
    configurePlayerCharacterController(this.characterController);

    // ── Item inventory ────────────────────────────────────────────────────
    this.itemInventorySystem = new ItemInventorySystem<UserLike>({
      world: this.world, persistence: this.persistence,
      getUserById: (userId) => this.usersById.get(userId),
      getPlayerStateByUserId: (userId) => this.simulationEcs.getPlayerRuntimeStateByUserId(userId) as any,
      setPlayerHealthByUserId: (userId, health) => this.simulationEcs.setPlayerHealthByUserId(userId, health),
      markPlayerCharacterDirty: (accountId) => this.persistenceSyncSystem.markAccountDirty(accountId, { dirtyCharacter: true, dirtyAbilityState: false }),
      addWorldItem: (item) => this.addWorldItem(item),
      syncWorldItem: (item) => this.syncWorldItem(item),
      removeWorldItem: (item) => this.removeWorldItem(item),
      queueInventoryState: (user, snapshot) => this.queueInventoryStateMessage(user, snapshot)
    });

    // ── Damage ────────────────────────────────────────────────────────────
    this.damageSystem = new DamageSystem({
      maxPlayerHealth: this.archetypes.player.maxHealth,
      playerBodyCenterHeight: PLAYER_BODY_CENTER_HEIGHT,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      getSpawnPosition: () => this.getSpawnPosition(),
      getSpawnBodyY: (x, z) => this.getSpawnBodyY(x, z),
      markCharacterDirtyByAccountId: (accountId, options) => this.persistenceSyncSystem.markAccountDirty(accountId, options),
      getCharacterStateByEid: (eid) => this.simulationEcs.getCharacterDamageStateByEid(eid) as any,
      applyCharacterStateByEid: (eid, state) => this.simulationEcs.applyCharacterDamageStateByEid(eid, state),
      getDummyStateByEid: (eid) => this.simulationEcs.getDummyDamageStateByEid(eid) as any,
      applyDummyStateByEid: (eid, state) => this.simulationEcs.applyDummyDamageStateByEid(eid, state),
      events: this.events
    });

    // ── World content ─────────────────────────────────────────────────────
    this.worldContentCoordinator = new WorldContentCoordinator({
      world: this.world,
      onDummyAdded: (dummy) => {
        const eid = this.simulationEcs.factory.createEntityByKind("dummy", {
          position: dummy.position, rotation: dummy.rotation,
          health: dummy.maxHealth, maxHealth: dummy.maxHealth,
          modelId: dummy.modelId
        });
        this.simulationEcs.registerDummyPhysicsRefs(eid, dummy.body, dummy.collider);
        const nid = this.replication.spawnEntity(eid);
        dummy.nid = nid;
        this.simulationEcs.setEntityNidByEid(eid, nid);
      }
    });

    // ── Projectiles ───────────────────────────────────────────────────────
    this.projectileSystem = new ProjectileSystem({
      world: this.world,
      getOwnerCollider: (ownerNid) => this.simulationEcs.getCharacterColliderByNid(ownerNid),
      resolveTargetByColliderHandle: (h) => this.damageSystem.resolveTargetByColliderHandle(h),
      applyDamage: (target, damage) => this.damageSystem.applyDamage(target, damage),
      createProjectile: (req) => {
        const eid = this.simulationEcs.factory.createEntityByKind("projectile", {
          modelId: this.resolveProjectileModelId(req.kind),
          position: { x: req.x, y: req.y, z: req.z },
          velocity: { x: req.vx, y: req.vy, z: req.vz },
          projectileOwnerNid: req.ownerNid, projectileKind: req.kind,
          projectileRadius: req.radius, projectileDamage: req.damage,
          projectileTtl: req.lifetimeSeconds,
          projectileRemainingRange: ProjectileSystem.resolveMaxRange(req.maxRange),
          projectileGravity: ProjectileSystem.resolveOptionalNumber(req.gravity, 0),
          projectileDrag: Math.max(0, ProjectileSystem.resolveOptionalNumber(req.drag, 0)),
          projectileMaxSpeed: Math.max(0, ProjectileSystem.resolveOptionalNumber(req.maxSpeed, Number.POSITIVE_INFINITY)),
          projectileMinSpeed: Math.max(0, ProjectileSystem.resolveOptionalNumber(req.minSpeed, 0)),
          projectileRemainingPierces: Math.max(0, Math.floor(ProjectileSystem.resolveOptionalNumber(req.pierceCount, 0))),
          projectileDespawnOnDamageableHit: typeof req.despawnOnDamageableHit === "boolean" ? req.despawnOnDamageableHit : true,
          projectileDespawnOnWorldHit: typeof req.despawnOnWorldHit === "boolean" ? req.despawnOnWorldHit : true
        });
        const nid = this.replication.spawnEntity(eid);
        this.simulationEcs.setEntityNidByEid(eid, nid);
        return eid;
      },
      getProjectileState: (eid) => this.simulationEcs.getProjectileRuntimeStateByEid(eid),
      applyProjectileState: (eid, state) => this.simulationEcs.applyProjectileRuntimeStateByEid(eid, state),
      removeProjectile: (eid) => { this.replication.despawnEntity(eid); this.simulationEcs.destroyEid(eid); }
    });

    // ── Melee ─────────────────────────────────────────────────────────────
    this.meleeCombatSystem = new MeleeCombatSystem({
      world: this.world,
      playerCapsuleRadius: PLAYER_CAPSULE_RADIUS, playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
      dummyRadius: this.archetypes.trainingDummy.capsuleRadius,
      dummyHalfHeight: this.archetypes.trainingDummy.capsuleHalfHeight,
      getTargets: () => this.damageSystem.getTargets(),
      resolveTargetRuntime: (t) => this.simulationEcs.resolveCombatTargetRuntime(t),
      applyDamage: (target, damage) => this.damageSystem.applyDamage(target, damage)
    });

    // ── Abilities ─────────────────────────────────────────────────────────
    const simEcs = this.simulationEcs;
    this.abilityExecutionSystem = new AbilityExecutionSystem({
      getElapsedSeconds: () => this.elapsedSeconds,
      resolveAbilityById: (unlockedAbilityIds, abilityId) => this.getAbilityDefinitionForUnlockedSet(unlockedAbilityIds, abilityId),
      broadcastAbilityUse: (playerNid, ability, x, y, z) => {
        this.replication.broadcastAbilityUseMessage(playerNid, ability, x, y, z);
        this.events.emit<AbilityUsedPayload>(GameEvent.ABILITY_USED, {
          ownerNid: playerNid, abilityId: ability.id,
          category: ability.category, serverTick: this.tickNumber,
          x, y, z
        });
      },
      spawnProjectile: (req) => this.projectileSystem.spawn(req),
      applyMeleeHit: (playerNid, mp) => {
        const eid = this.simulationEcs.getPlayerEidByNid(playerNid);
        if (typeof eid !== "number") return;
        const body = this.simulationEcs.getPlayerBody(eid);
        const collider = this.simulationEcs.getPlayerCollider(eid);
        if (!body || !collider) return;
        const c = this.simulationEcs.world.components;
        this.meleeCombatSystem.tryApplyMeleeHit({
          nid: playerNid,
          yaw: c.Yaw.value[eid] ?? 0,
          pitch: c.Pitch.value[eid] ?? 0,
          body, collider
        }, mp);
      }
    });

    // ── Input ─────────────────────────────────────────────────────────────
    this.inputSystem = new InputSystem({
      onPrimaryPressed: (unlocked, primarySlot, hotbar) =>
        this.abilityExecutionSystem.tryUsePrimaryMouseAbility({ nid: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hotbarAbilityIds: hotbar, unlockedAbilityIds: unlocked, lastPrimaryFireAtSeconds: 0, primaryMouseSlot: primarySlot, secondaryMouseSlot: 0 }),
      onSecondaryPressed: (unlocked, secondarySlot, hotbar) =>
        this.abilityExecutionSystem.tryUseSecondaryMouseAbility({ nid: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hotbarAbilityIds: hotbar, unlockedAbilityIds: unlocked, lastPrimaryFireAtSeconds: 0, primaryMouseSlot: 0, secondaryMouseSlot: secondarySlot }),
      onCastSlotPressed: (unlocked, slot, hotbar) =>
        this.abilityExecutionSystem.tryUseAbilityBySlot({ nid: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hotbarAbilityIds: hotbar, unlockedAbilityIds: unlocked, lastPrimaryFireAtSeconds: 0, primaryMouseSlot: 0, secondaryMouseSlot: 0 }, slot)
    });

    // ── Platforms ─────────────────────────────────────────────────────────
    this.platformSystem = new PlatformSystem({
      world: this.world, definitions: this.archetypes.platforms,
      onPlatformAdded: (platform) => {
        const eid = this.simulationEcs.factory.createEntityByKind("platform", {
          position: platform.position, rotation: platform.rotation, modelId: platform.modelId
        });
        (platform as any)._ecsEid = eid;
      },
      onPlatformUpdated: (platform) => {
        const eid = (platform as any)._ecsEid;
        if (typeof eid === "number") {
          c.Position.x[eid] = platform.position.x; c.Position.y[eid] = platform.position.y; c.Position.z[eid] = platform.position.z;
          c.Rotation.x[eid] = platform.rotation.x; c.Rotation.y[eid] = platform.rotation.y; c.Rotation.z[eid] = platform.rotation.z; c.Rotation.w[eid] = platform.rotation.w;
        }
      }
    });

    // ── Locations ─────────────────────────────────────────────────────────
    this.locationRootSystem = new LocationRootSystem({
      world: this.world,
      onLocationAdded: (location) => {
        const eid = this.simulationEcs.factory.createEntityByKind("location", {
          position: location.position, rotation: location.rotation, modelId: location.modelId,
          locationKind: location.locationKind, locationArchetypeId: location.locationArchetypeId,
          locationSeed: location.locationSeed, locationEnvironmentId: location.locationEnvironmentId,
          locationStreamingRadius: location.locationStreamingRadius, locationInfluenceRadius: location.locationInfluenceRadius
        });
        (location as any)._ecsEid = eid;
        const nid = this.replication.spawnEntity(eid);
        location.nid = nid;
        this.simulationEcs.setEntityNidByEid(eid, nid);
      },
      onLocationUpdated: (location) => {
        const eid = (location as any)._ecsEid;
        if (typeof eid !== "number") return;
        c.Position.x[eid] = location.position.x; c.Position.y[eid] = location.position.y; c.Position.z[eid] = location.position.z;
        c.Rotation.x[eid] = location.rotation.x; c.Rotation.y[eid] = location.rotation.y; c.Rotation.z[eid] = location.rotation.z; c.Rotation.w[eid] = location.rotation.w;
      }
    });

    // ── Navigation ────────────────────────────────────────────────────────
    const navBuild = buildServerNavigationWorld({
      getElapsedSeconds: () => this.elapsedSeconds,
      enableRecastSurfaceNavigation: this.resolveBooleanEnv("NAVIGATION_RECAST_SURFACES_ENABLED", true),
      cache: {
        enabled: this.resolveBooleanEnv("NAVIGATION_CACHE_ENABLED", true),
        readEnabled: this.resolveBooleanEnv("NAVIGATION_CACHE_READ_ENABLED", true),
        writeEnabled: this.resolveBooleanEnv("NAVIGATION_CACHE_WRITE_ENABLED", true),
        directory: this.resolveOptionalEnvString("NAVIGATION_CACHE_DIR")
      }
    });
    this.navigationPlanner = new CharacterNavigationPlanner(navBuild.world);
    this.logNavigationBuildReport(navBuild.report);

    // ── Ability command handler ───────────────────────────────────────────
    this.abilityCommandHandler = new AbilityCommandHandler<UserLike>({
      getAbilityStateByUserId: (userId) => this.simulationEcs.getPlayerAbilityStateByUserId(userId)!,
      setPlayerHotbarAbilityByUserId: (userId, slot, abilityId) => this.simulationEcs.setPlayerHotbarAbilityByUserId(userId, slot, abilityId),
      setPlayerPrimaryMouseSlotByUserId: (userId, slot) => this.simulationEcs.setPlayerPrimaryMouseSlotByUserId(userId, slot),
      setPlayerSecondaryMouseSlotByUserId: (userId, slot) => this.simulationEcs.setPlayerSecondaryMouseSlotByUserId(userId, slot),
      getPlayerAccountIdByUserId: (userId) => this.simulationEcs.getPlayerAccountIdByUserId(userId),
      markAccountAbilityStateDirty: (accountId) => this.persistenceSyncSystem.markAccountDirty(accountId, { dirtyCharacter: false, dirtyAbilityState: true }),
      queueAbilityStateMessageFromSnapshot: (user, snapshot) => this.replication.queueAbilityStateMessageFromSnapshot(user, snapshot),
      sanitizeHotbarSlot: (rawSlot, fallbackSlot) => this.sanitizeHotbarSlot(rawSlot, fallbackSlot),
      sanitizeSelectedAbilityId: (rawAbilityId, fallbackAbilityId, unlockedAbilityIds) => this.sanitizeSelectedAbilityId(rawAbilityId, fallbackAbilityId, unlockedAbilityIds)
    });

    // ── Movement ──────────────────────────────────────────────────────────
    this.playerMovementSystem = new PlayerMovementSystem({
      world: this.world, characterController: this.characterController,
      playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT, playerCapsuleRadius: PLAYER_CAPSULE_RADIUS,
      ecsComponents: c,
      getBody: (eid) => this.simulationEcs.getPlayerBody(eid),
      getCollider: (eid) => this.simulationEcs.getPlayerCollider(eid),
      getUnlockedAbilityIds: (eid) => this.simulationEcs.world.components.UnlockedAbilityCsv.value[eid] ? new Set((this.simulationEcs.world.components.UnlockedAbilityCsv.value[eid] ?? "").split(",").map(n => Math.max(0, Math.floor(Number(n) || 0)))) : new Set<number>(),
      getHotbar: (eid) => {
        const hotbar: number[] = [];
        for (let s = 0; s < HOTBAR_SLOT_COUNT; s++) {
          const h = c.Hotbar;
          hotbar.push(s === 0 ? (h.slot0[eid] ?? 0) : s === 1 ? (h.slot1[eid] ?? 0) : s === 2 ? (h.slot2[eid] ?? 0) : s === 3 ? (h.slot3[eid] ?? 0) : s === 4 ? (h.slot4[eid] ?? 0) : s === 5 ? (h.slot5[eid] ?? 0) : s === 6 ? (h.slot6[eid] ?? 0) : s === 7 ? (h.slot7[eid] ?? 0) : s === 8 ? (h.slot8[eid] ?? 0) : (h.slot9[eid] ?? 0));
        }
        return hotbar;
      },
      beforePlayerMove: (eid, unlocked, primarySlot, secondarySlot, hotbar) => {
        if (c.PrimaryHeld.value[eid]) {
          this.abilityExecutionSystem.tryUsePrimaryMouseAbility({ nid: 0, x: c.Position.x[eid] ?? 0, y: c.Position.y[eid] ?? 0, z: c.Position.z[eid] ?? 0, yaw: c.Yaw.value[eid] ?? 0, pitch: c.Pitch.value[eid] ?? 0, hotbarAbilityIds: hotbar, unlockedAbilityIds: unlocked, lastPrimaryFireAtSeconds: c.LastPrimaryFireAtSeconds.value[eid] ?? 0, primaryMouseSlot: primarySlot, secondaryMouseSlot: secondarySlot });
        }
        if (c.SecondaryHeld.value[eid]) {
          this.abilityExecutionSystem.tryUseSecondaryMouseAbility({ nid: 0, x: c.Position.x[eid] ?? 0, y: c.Position.y[eid] ?? 0, z: c.Position.z[eid] ?? 0, yaw: c.Yaw.value[eid] ?? 0, pitch: c.Pitch.value[eid] ?? 0, hotbarAbilityIds: hotbar, unlockedAbilityIds: unlocked, lastPrimaryFireAtSeconds: c.LastPrimaryFireAtSeconds.value[eid] ?? 0, primaryMouseSlot: primarySlot, secondaryMouseSlot: secondarySlot });
        }
      },
      samplePlayerPlatformCarry: (eid) => {
        const body = this.simulationEcs.getPlayerBody(eid);
        if (!body) return { x: 0, y: 0, z: 0, yaw: 0, carriedFramePid: null };
        const gpp = c.GroundedPlatformPid.value[eid];
        const cfp = c.CarriedFramePid.value[eid];
        const actor: PlatformCarryActor = { grounded: (c.Grounded.value[eid] ?? 0) !== 0, groundedPlatformPid: (gpp ?? -1) < 0 ? null : (gpp ?? null), body };
        const pc = this.platformSystem.samplePlayerPlatformCarry(actor);
        const lfa: LocationFrameActor = { x: c.Position.x[eid] ?? 0, y: c.Position.y[eid] ?? 0, z: c.Position.z[eid] ?? 0, carriedFramePid: (cfp ?? -1) < 0 ? null : (cfp ?? null), body };
        const fc = this.locationRootSystem.sampleFrameCarry(lfa);
        return { x: pc.x + fc.x, y: pc.y + fc.y, z: pc.z + fc.z, yaw: pc.yaw + fc.yaw, carriedFramePid: fc.carriedFramePid };
      },
      resolvePlayerCarriedFramePid: (eid, movedBody, prev) => { const b = this.simulationEcs.getPlayerBody(eid); const cfp2 = c.CarriedFramePid.value[eid]; return b ? this.locationRootSystem.resolveCarriedFramePidForPoint(movedBody, (cfp2 ?? -1) < 0 ? null : (cfp2 ?? null)) : prev; },
      resolvePlatformPidByColliderHandle: (h) => this.platformSystem.resolvePlatformPidByColliderHandle(h),
      onPlayerStepped: (userId, eid) => {
        const ack: PlayerMovedPayload = {
          userId, eid,
          x: c.Position.x[eid] ?? 0, y: c.Position.y[eid] ?? 0, z: c.Position.z[eid] ?? 0,
          yaw: c.Yaw.value[eid] ?? 0, pitch: c.Pitch.value[eid] ?? 0,
          vx: c.Velocity.x[eid] ?? 0, vy: c.Velocity.y[eid] ?? 0, vz: c.Velocity.z[eid] ?? 0,
          grounded: (c.Grounded.value[eid] ?? 0) !== 0,
          movementMode: (c.MovementMode.value[eid] ?? MOVEMENT_MODE_GROUNDED) as MovementMode,
          groundedPlatformPid: (c.GroundedPlatformPid.value[eid] ?? -1) < 0 ? null : (c.GroundedPlatformPid.value[eid] ?? null),
          carriedFramePid: (c.CarriedFramePid.value[eid] ?? -1) < 0 ? null : (c.CarriedFramePid.value[eid] ?? null),
          lastProcessedSequence: c.LastProcessedSequence.value[eid] ?? 0
        };
        this.events.emit(GameEvent.PLAYER_MOVED, ack);
      }
    });

    this.npcMovementSystem = new CharacterMovementSystem({
      world: this.world, characterController: this.characterController,
      capsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT, capsuleRadius: PLAYER_CAPSULE_RADIUS,
      ecsComponents: c,
      getBody: (eid) => this.simulationEcs.getCharacterBody(eid),
      getCollider: (eid) => this.simulationEcs.getCharacterCollider(eid),
      sampleCharacterCarry: (eid) => {
        const body = this.simulationEcs.getCharacterBody(eid);
        if (!body) return { x: 0, y: 0, z: 0, yaw: 0, carriedFramePid: null };
        const gpp = c.GroundedPlatformPid.value[eid];
        const cfp = c.CarriedFramePid.value[eid];
        const actor: PlatformCarryActor = { grounded: (c.Grounded.value[eid] ?? 0) !== 0, groundedPlatformPid: (gpp ?? -1) < 0 ? null : (gpp ?? null), body };
        const pc = this.platformSystem.samplePlayerPlatformCarry(actor);
        const lfa: LocationFrameActor = { x: c.Position.x[eid] ?? 0, y: c.Position.y[eid] ?? 0, z: c.Position.z[eid] ?? 0, carriedFramePid: (cfp ?? -1) < 0 ? null : (cfp ?? null), body };
        const fc = this.locationRootSystem.sampleFrameCarry(lfa);
        return { x: pc.x + fc.x, y: pc.y + fc.y, z: pc.z + fc.z, yaw: pc.yaw + fc.yaw, carriedFramePid: fc.carriedFramePid };
      },
      resolveCharacterCarriedFramePid: (eid, movedBody, prev) => { const b = this.simulationEcs.getCharacterBody(eid); const cfp2 = c.CarriedFramePid.value[eid]; return b ? this.locationRootSystem.resolveCarriedFramePidForPoint(movedBody, (cfp2 ?? -1) < 0 ? null : (cfp2 ?? null)) : prev; },
      resolvePlatformPidByColliderHandle: (h) => this.platformSystem.resolvePlatformPidByColliderHandle(h)
    });

    // ── Event subscriptions (replaces ad-hoc callback wiring) ──────────────
    this.events.on<PlayerMovedPayload>(GameEvent.PLAYER_MOVED, (payload) => {
      this.replication.syncUserViewPosition(payload.userId, payload.x, payload.y, payload.z);
      this.replication.queueInputAckFromState(payload.userId, {
        lastProcessedSequence: payload.lastProcessedSequence,
        x: payload.x, y: payload.y, z: payload.z,
        yaw: payload.yaw, pitch: payload.pitch,
        vx: payload.vx, vy: payload.vy, vz: payload.vz,
        grounded: payload.grounded, movementMode: payload.movementMode,
        groundedPlatformPid: payload.groundedPlatformPid,
        carriedFramePid: payload.carriedFramePid
      });
      const aid = this.simulationEcs.getPlayerAccountIdByUserId(payload.userId);
      if (aid !== null) this.persistenceSyncSystem.markAccountDirty(aid, { dirtyCharacter: true, dirtyAbilityState: false });
    });

    this.events.on<PlayerSpawnedPayload>(GameEvent.PLAYER_SPAWNED, (payload) => {
      this.replication.queueIdentityMessage(
        { id: payload.userId, queueMessage: (msg) => { const u = this.usersById.get(payload.userId); if (u) u.queueMessage(msg); } } as UserLike,
        this.simulationEcs.world.components.NetworkId.value[payload.eid] ?? 0
      );
    });

    this.events.on<DamageDealtPayload>(GameEvent.DAMAGE_DEALT, (payload) => {
      const fromAccount = payload.sourceEid !== null ? this.simulationEcs.world.components.AccountId.value[payload.sourceEid] : undefined;
      if (typeof fromAccount === "number" && fromAccount > 0) {
        this.persistenceSyncSystem.markAccountDirty(fromAccount, { dirtyCharacter: true, dirtyAbilityState: false });
      }
    });

    this.events.on<HealthChangedPayload>(GameEvent.HEALTH_CHANGED, (payload) => {
      const accountId = this.simulationEcs.world.components.AccountId.value[payload.eid];
      if (typeof accountId === "number" && accountId > 0) {
        this.persistenceSyncSystem.markAccountDirty(accountId, { dirtyCharacter: true, dirtyAbilityState: false });
      }
    });

    // ── Status effects ────────────────────────────────────────────────────
    this.statusEffects = new StatusEffectSystem(c, this.events);
    this.statusEffects.registerDefinition({
      id: "burning", key: "burning", name: "Burning", description: "Taking fire damage over time.",
      durationMs: 3000, tickIntervalMs: 500, maxStacks: 5, stackPolicy: "stack_add",
      damagePerTick: 5
    });
    this.statusEffects.registerDefinition({
      id: "frozen", key: "frozen", name: "Frozen", description: "Movement speed reduced.",
      durationMs: 4000, tickIntervalMs: 0, maxStacks: 1, stackPolicy: "replace",
      speedMultiplier: 0.3
    });
    this.statusEffects.registerDefinition({
      id: "regeneration", key: "regeneration", name: "Regeneration", description: "Healing over time.",
      durationMs: 5000, tickIntervalMs: 1000, maxStacks: 3, stackPolicy: "stack_add",
      healPerTick: 8
    });
    this.statusEffects.registerDefinition({
      id: "weakened", key: "weakened", name: "Weakened", description: "Deal reduced damage.",
      durationMs: 4000, tickIntervalMs: 0, maxStacks: 1, stackPolicy: "replace",
      damageMultiplier: 0.7
    });
    this.statusEffects.registerDefinition({
      id: "vulnerable", key: "vulnerable", name: "Vulnerable", description: "Take increased damage.",
      durationMs: 3000, tickIntervalMs: 0, maxStacks: 3, stackPolicy: "stack_add",
      damageTakenMultiplier: 1.3
    });

    // ── NPC AI ────────────────────────────────────────────────────────────
    this.npcAiSystem = new NpcAiSystem({
      world: this.world, navigation: this.navigationPlanner,
      characterArchetypes: this.archetypes.characterArchetypes, spawns: this.archetypes.npcSpawns,
      controllerKindAi: CONTROLLER_KIND_AI,
      onCharacterCreated: (character) => this.addNpcCharacter(character),
      onCharacterUpdated: (_character) => { /* no-op: ECS is written directly by movement system */ },
      hasPerceptionTargets: () => this.aiPerceptionTargetByColliderHandle.size > 0,
      resolvePerceptionTargetByColliderHandle: (h) => this.aiPerceptionTargetByColliderHandle.get(h) ?? null,
      usePrimaryAbility: (character) => {
        const ctx: AbilityUseContext = {
          nid: character.nid, x: character.x, y: character.y, z: character.z,
          yaw: character.yaw, pitch: character.pitch,
          hotbarAbilityIds: character.hotbarAbilityIds,
          unlockedAbilityIds: character.unlockedAbilityIds,
          lastPrimaryFireAtSeconds: character.lastPrimaryFireAtSeconds,
          primaryMouseSlot: character.primaryMouseSlot,
          secondaryMouseSlot: character.secondaryMouseSlot
        };
        this.abilityExecutionSystem.tryUsePrimaryMouseAbility(ctx);
      },
      aiTickIntervalSeconds: this.resolvePositiveEnvNumber("NPC_AI_TICK_INTERVAL", 0.2),
      perceptionTickIntervalSeconds: this.resolvePositiveEnvNumber("NPC_PERCEPTION_TICK_INTERVAL", 0.25),
      pathReplanIntervalSeconds: this.resolvePositiveEnvNumber("NPC_PATH_REPLAN_INTERVAL", 0.75),
      inactiveAiTickIntervalSeconds: this.resolvePositiveEnvNumber("NPC_AI_INACTIVE_TICK_INTERVAL", 0.65),
      inactivePerceptionTickIntervalSeconds: this.resolvePositiveEnvNumber("NPC_PERCEPTION_INACTIVE_TICK_INTERVAL", 0.95),
      inactivePathReplanIntervalSeconds: this.resolvePositiveEnvNumber("NPC_PATH_REPLAN_INACTIVE_INTERVAL", 2),
      lifecycleRecheckIntervalSeconds: this.resolvePositiveEnvNumber("NPC_LIFECYCLE_RECHECK_INTERVAL", 0.5),
      inactiveMoveSpeedScale: this.resolveClampedEnvNumber("NPC_AI_INACTIVE_MOVE_SPEED_SCALE", 0.72, 0.05, 1),
      pathStuckTimeoutSeconds: this.resolvePositiveEnvNumber("NPC_PATH_STUCK_TIMEOUT", 1.35),
      pathStuckRecoveryDelaySeconds: this.resolvePositiveEnvNumber("NPC_PATH_STUCK_RECOVERY_DELAY", 0.45),
      hibernationEnabled: this.resolveBooleanEnv("NPC_HIBERNATION_ENABLED", false)
    });

    // ── Player lifecycle ──────────────────────────────────────────────────
    this.playerLifecycleSystem = this.createPlayerLifecycleSystem();

    // ── World init ────────────────────────────────────────────────────────
    this.worldContentCoordinator.initializeWorldContent({
      platformSystem: this.platformSystem,
      trainingDummies: {
        spawns: this.archetypes.trainingDummy.spawns,
        capsuleHalfHeight: this.archetypes.trainingDummy.capsuleHalfHeight,
        capsuleRadius: this.archetypes.trainingDummy.capsuleRadius,
        maxHealth: this.archetypes.trainingDummy.maxHealth,
        modelId: this.archetypes.trainingDummy.modelId
      },
      resolveDummyEid: (dummy) => (dummy as any)._ecsEid ?? -1,
      registerDummyCollider: (ch, eid) => this.damageSystem.registerDummyCollider(ch, eid)
    });
    this.locationRootSystem.initializeLocations();
    this.itemInventorySystem.initializeWorldItems();
    this.npcAiSystem.initialize();
  }

  // ── User management ───────────────────────────────────────────────────────
  public addUser(user: UserLike): void { this.playerLifecycleSystem.addUser(user); }
  public removeUser(user: UserLike): void { this.playerLifecycleSystem.removeUser(user); }

  // ── Command handlers ──────────────────────────────────────────────────────
  public applyInputCommands(userId: number, commands: Partial<InputWireCommand>[]): void {
    const player = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
    if (!player) return;
    this.inputSystem.applyCommands(player, commands);
    this.simulationEcs.applyPlayerMovementState(player.eid, {
      x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
      vx: player.vx, vy: player.vy, vz: player.vz,
      grounded: player.grounded, movementMode: player.movementMode,
      groundedPlatformPid: player.groundedPlatformPid, carriedFramePid: player.carriedFramePid,
      lastProcessedSequence: player.lastProcessedSequence,
      lastPrimaryFireAtSeconds: player.lastPrimaryFireAtSeconds,
      primaryHeld: player.primaryHeld, secondaryHeld: player.secondaryHeld,
      primaryMouseSlot: player.primaryMouseSlot, secondaryMouseSlot: player.secondaryMouseSlot,
      rotation: player.rotation
    });
  }

  public applyAbilityCommand(user: UserLike, command: Partial<AbilityWireCommand>): void {
    if (!this.simulationEcs.getPlayerRuntimeStateByUserId(user.id)) return;
    this.applyForgetAbilityIntent(user, command);
    this.abilityCommandHandler.apply(user, command);
  }

  public applyCreatorCommand(user: UserLike, command: {
    sessionId: number; sequence: number; applyName?: boolean; name?: string;
    selectBaseArchetype?: boolean; baseArchetypeId?: number;
    allocateStat?: boolean; statId?: string; statDelta?: number;
    toggleTrait?: boolean; traitId?: string; submitCreate?: boolean; forgetArchetypeId?: number;
  }): void {
    const accountId = this.simulationEcs.getPlayerAccountIdByUserId(user.id);
    if (accountId === null) return;
    const ownedIds = this.creatorSystem.resolveOwnedArchetypeIds(accountId,
      this.simulationEcs.getPlayerAbilityStateByUserId(user.id)?.unlockedAbilityIds ?? []);
    const result = this.creatorSystem.applyCommand({ userId: user.id, accountId, ownedArchetypeIds: ownedIds, command });
    this.replication.queueCreatorStateMessage(user, result.snapshot);

    if (result.createdArchetype && result.nextOwnedArchetypeIds) {
      const ownedChanged = this.simulationEcs.setPlayerUnlockedAbilityIdsByUserId(user.id, result.nextOwnedArchetypeIds);
      if (result.createdArchetype.kind === "ability") {
        const custom = result.createdArchetype;
        const rs = custom.baseStats as Record<string, number>;
        const def: AbilityDefinition = {
          id: custom.id, key: custom.key, name: custom.name, description: custom.description,
          category: custom.abilityCategory ?? "projectile",
          points: { power: rs.power ?? 0, velocity: rs.velocity ?? 0, efficiency: rs.efficiency ?? 0, control: rs.control ?? 0 },
          attributes: [...(custom.abilityAttributes ?? [])]
        };
        if (custom.projectileProfile) def.projectile = custom.projectileProfile;
        if (custom.meleeProfile) def.melee = custom.meleeProfile;
        this.replication.queueAbilityDefinitionMessage(user, def);
      }
      const refreshed = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
      if (refreshed) {
        this.replication.queueAbilityOwnershipMessage(user, refreshed.unlockedAbilityIds);
        this.replication.queueAbilityStateMessageFromSnapshot(user, refreshed);
      }
      if (ownedChanged) this.persistenceSyncSystem.markAccountDirty(accountId, { dirtyCharacter: false, dirtyAbilityState: true });
    }
  }

  public applyItemCommand(user: UserLike, command: Partial<ItemWireCommand>): void {
    if (!this.simulationEcs.getPlayerRuntimeStateByUserId(user.id)) return;
    this.itemInventorySystem.applyCommand(user.id, command);
  }

  private applyForgetAbilityIntent(user: UserLike, command: Partial<AbilityWireCommand>): void {
    if (!command.applyForgetAbility) return;
    const before = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
    const accountId = this.simulationEcs.getPlayerAccountIdByUserId(user.id);
    if (!before || accountId === null) return;

    const targetId = this.normalizeAbilityId(command.forgetAbilityId);
    if (targetId <= ABILITY_ID_NONE) {
      this.replication.queueAbilityOwnershipMessage(user, before.unlockedAbilityIds);
      this.replication.queueAbilityStateMessageFromSnapshot(user, before);
      const snap = this.creatorSystem.synchronizeSessionOwnedCount(user.id, before.unlockedAbilityIds.length);
      if (snap) this.replication.queueCreatorStateMessage(user, snap);
      return;
    }

    const forgetResult = this.creatorSystem.forgetArchetype(accountId, targetId);
    if (!forgetResult.ok || !forgetResult.nextOwnedArchetypeIds) {
      this.replication.queueAbilityOwnershipMessage(user, before.unlockedAbilityIds);
      this.replication.queueAbilityStateMessageFromSnapshot(user, before);
      const snap = this.creatorSystem.synchronizeSessionOwnedCount(user.id, before.unlockedAbilityIds.length);
      if (snap) this.replication.queueCreatorStateMessage(user, snap);
      return;
    }

    const ownedChanged = this.simulationEcs.setPlayerUnlockedAbilityIdsByUserId(user.id, forgetResult.nextOwnedArchetypeIds);
    const hotbarChanged = this.simulationEcs.clearPlayerAbilityOnHotbarByUserId(user.id, forgetResult.forgottenArchetypeId ?? 0);
    const after = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
    if (!after) return;
    this.replication.queueAbilityOwnershipMessage(user, after.unlockedAbilityIds);
    this.replication.queueAbilityStateMessageFromSnapshot(user, after);
    const snap = this.creatorSystem.synchronizeSessionOwnedCount(user.id, after.unlockedAbilityIds.length);
    if (snap) this.replication.queueCreatorStateMessage(user, snap);
    if (ownedChanged || hotbarChanged) this.persistenceSyncSystem.markAccountDirty(accountId, { dirtyCharacter: false, dirtyAbilityState: true });
  }

  // ── Tick ──────────────────────────────────────────────────────────────────
  public step(delta: number): void {
    this.tickNumber += 1;
    const prevElapsed = this.elapsedSeconds;
    this.elapsedSeconds += delta;
    this.world.integrationParameters.dt = delta;
    this.platformSystem.updatePlatforms(prevElapsed, this.elapsedSeconds);
    this.locationRootSystem.updateLocations(prevElapsed, this.elapsedSeconds);
    this.refreshAiPerceptionTargets();
    this.emitPlayerPresenceStimuli();
    this.npcAiSystem.step(this.elapsedSeconds);
    this.playerMovementSystem.stepPlayers(this.getMovementPlayerEntries(), delta, this.elapsedSeconds);
    this.npcMovementSystem.stepCharacters(this.getNpcMovementEntries(), delta, this.elapsedSeconds);
    this.projectileSystem.step(delta);
    this.statusEffects.step(this.elapsedSeconds * 1000);

    const replicatedEids = this.simulationEcs.getReplicatedEids();
    for (const eid of replicatedEids) {
      this.replication.syncEntityFromEcs(eid);
    }
    this.world.step();
    this.maybeBroadcastServerPopulation();
  }

  public flushDirtyPlayerState(overrides?: { saveCharacterSnapshot?: (s: PlayerSnapshot) => void; saveAbilityStateSnapshot?: (s: PlayerSnapshot) => void }): void {
    this.persistenceSyncSystem.flushDirtyPlayerState(
      (accountId) => this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(accountId) as any,
      (snap) => { if (overrides?.saveCharacterSnapshot) overrides.saveCharacterSnapshot(snap); else this.persistence.saveCharacterSnapshot(snap); },
      (snap) => { if (overrides?.saveAbilityStateSnapshot) overrides.saveAbilityStateSnapshot(snap); else this.persistence.saveAbilityStateSnapshot(snap); }
    );
  }

  public injectPendingLoginSnapshot(accountId: number, snapshot: PlayerSnapshot): void { this.persistenceSyncSystem.queueOfflineSnapshot(accountId, snapshot); }
  public getPlayerSnapshotByUserId(userId: number): PlayerSnapshot | null {
    const aid = this.simulationEcs.getPlayerAccountIdByUserId(userId);
    if (aid === null) return null;
    return this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(aid) as any;
  }

  public getRuntimeStats(): { onlinePlayers: number; activeProjectiles: number; pendingOfflineSnapshots: number; ecsEntities: number; activeNpcs: number; inactiveNpcs: number; hibernatingNpcs: number } {
    const es = this.simulationEcs.getStats();
    const ai = this.npcAiSystem.getStats();
    return { onlinePlayers: this.simulationEcs.getOnlinePlayerCount(), activeProjectiles: this.projectileSystem.getActiveCount(), pendingOfflineSnapshots: this.persistenceSyncSystem.getPendingOfflineSnapshotCount(), ecsEntities: es.total, activeNpcs: ai.active, inactiveNpcs: ai.inactive, hibernatingNpcs: ai.hibernating };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private getAbilityDefinitionForUnlockedSet(unlocked: Set<number>, abilityId: number): AbilityDefinition | null {
    if (!unlocked.has(abilityId)) return null;
    return this.resolveAbilityDefinitionById(abilityId);
  }

  private sanitizeHotbarSlot(raw: unknown, fallback: number): number {
    return (typeof raw === "number" && Number.isFinite(raw)) ? clampHotbarSlotIndex(raw) : fallback;
  }

  private normalizeAbilityId(raw: unknown): number {
    return (typeof raw === "number" && Number.isFinite(raw)) ? Math.max(ABILITY_ID_NONE, Math.min(0xffff, Math.floor(raw))) : ABILITY_ID_NONE;
  }

  private sanitizeSelectedAbilityId(raw: unknown, fallback: number, unlocked: Set<number>): number {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
    const n = Math.max(0, Math.floor(raw));
    if (n === ABILITY_ID_NONE) return ABILITY_ID_NONE;
    if (!unlocked.has(n)) return fallback;
    return this.resolveAbilityDefinitionById(n) ? n : fallback;
  }

  private resolveAbilityDefinitionById(id: number): AbilityDefinition | null {
    const sd = getAbilityDefinitionById(id);
    if (sd) return sd;
    const a = this.creatorSystem.resolveArchetypeDefinitionById(id);
    if (a && a.kind === "ability") {
      return {
        id: a.id, key: a.key, name: a.name, description: a.description,
        category: a.abilityCategory ?? "projectile",
        points: a.abilityPoints ?? { power: 0, velocity: 0, efficiency: 0, control: 0 },
        attributes: [...(a.abilityAttributes ?? [])] as any,
        projectile: a.projectileProfile, melee: a.meleeProfile
      };
    }
    return null;
  }

  private createInitialHotbar(saved?: number[]): number[] {
    const h = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
    for (let s = 0; s < HOTBAR_SLOT_COUNT; s++) {
      h[s] = (saved && typeof saved[s] === "number" && Number.isFinite(saved[s])) ? Math.max(ABILITY_ID_NONE, Math.floor(saved[s] as number)) : (DEFAULT_HOTBAR_ABILITY_IDS[s] ?? ABILITY_ID_NONE);
    }
    return h;
  }

  private ensurePunchAssigned(eid: number): void {
    const csv = this.simulationEcs.world.components.UnlockedAbilityCsv.value[eid] ?? "";
    const ids = csv ? csv.split(",").map(n => Math.max(0, Math.floor(Number(n) || 0))) : [];
    if (!ids.includes(ABILITY_ID_PUNCH)) return;
    const h = this.simulationEcs.world.components.Hotbar;
    for (let s = 0; s < HOTBAR_SLOT_COUNT; s++) {
      const v = s === 0 ? (h.slot0[eid] ?? 0) : s === 1 ? (h.slot1[eid] ?? 0) : s === 2 ? (h.slot2[eid] ?? 0) : s === 3 ? (h.slot3[eid] ?? 0) : s === 4 ? (h.slot4[eid] ?? 0) : s === 5 ? (h.slot5[eid] ?? 0) : s === 6 ? (h.slot6[eid] ?? 0) : s === 7 ? (h.slot7[eid] ?? 0) : s === 8 ? (h.slot8[eid] ?? 0) : (h.slot9[eid] ?? 0);
      if (v === ABILITY_ID_PUNCH) return;
    }
    for (let s = 0; s < HOTBAR_SLOT_COUNT; s++) {
      const v = s === 0 ? (h.slot0[eid] ?? 0) : s === 1 ? (h.slot1[eid] ?? 0) : s === 2 ? (h.slot2[eid] ?? 0) : s === 3 ? (h.slot3[eid] ?? 0) : s === 4 ? (h.slot4[eid] ?? 0) : s === 5 ? (h.slot5[eid] ?? 0) : s === 6 ? (h.slot6[eid] ?? 0) : s === 7 ? (h.slot7[eid] ?? 0) : s === 8 ? (h.slot8[eid] ?? 0) : (h.slot9[eid] ?? 0);
      if (v === ABILITY_ID_NONE) {
        if (s === 0) h.slot0[eid] = ABILITY_ID_PUNCH; else if (s === 1) h.slot1[eid] = ABILITY_ID_PUNCH; else if (s === 2) h.slot2[eid] = ABILITY_ID_PUNCH; else if (s === 3) h.slot3[eid] = ABILITY_ID_PUNCH; else if (s === 4) h.slot4[eid] = ABILITY_ID_PUNCH; else if (s === 5) h.slot5[eid] = ABILITY_ID_PUNCH; else if (s === 6) h.slot6[eid] = ABILITY_ID_PUNCH; else if (s === 7) h.slot7[eid] = ABILITY_ID_PUNCH; else if (s === 8) h.slot8[eid] = ABILITY_ID_PUNCH; else h.slot9[eid] = ABILITY_ID_PUNCH;
        return;
      }
    }
    h.slot0[eid] = ABILITY_ID_PUNCH;
  }

  private clampHealth(v: number): number { return Number.isFinite(v) ? Math.max(0, Math.min(this.archetypes.player.maxHealth, Math.floor(v))) : this.archetypes.player.maxHealth; }

  private addWorldItem(item: WorldItemObject): void {
    const eid = this.simulationEcs.factory.createEntityByKind("item", {
      position: item.position, rotation: item.rotation, modelId: item.modelId,
      itemArchetypeId: item.itemArchetypeId, itemQuantity: item.itemQuantity
    });
    (item as any)._ecsEid = eid;
    const nid = this.replication.spawnEntity(eid);
    item.nid = nid;
    this.simulationEcs.setEntityNidByEid(eid, nid);
  }

  private syncWorldItem(item: WorldItemObject): void {
    const eid = (item as any)._ecsEid;
    if (typeof eid !== "number") return;
    const c = this.simulationEcs.world.components;
    c.Position.x[eid] = item.position.x; c.Position.y[eid] = item.position.y; c.Position.z[eid] = item.position.z;
  }

  private removeWorldItem(item: WorldItemObject): void {
    const eid = (item as any)._ecsEid;
    if (typeof eid !== "number") return;
    this.replication.despawnEntity(eid);
    this.simulationEcs.destroyEid(eid);
  }

  private queueInventoryStateMessage(user: UserLike, snap: InventoryStateSnapshot): void {
    user.queueMessage({ ntype: NType.InventoryStateMessage, inventoryJson: encodeInventoryStateSnapshot(snap) });
  }

  private addNpcCharacter(character: NpcCharacter): void {
    const eid = this.simulationEcs.factory.createEntityByKind("npc", {
      position: { x: character.x, y: character.y, z: character.z },
      yaw: character.yaw, characterArchetypeId: character.characterArchetypeId,
      controllerKind: character.controllerKind, modelId: character.modelId,
      health: character.health, maxHealth: character.maxHealth
    });
    this.simulationEcs.registerCharacterPhysicsRefs(eid, character.body, character.collider);
    character._ecsEid = eid;
    this.controllerSystem.attachAiController(eid);
    const nid = this.replication.spawnEntity(eid);
    character.nid = nid;
    this.simulationEcs.setEntityNidByEid(eid, nid);
    this.damageSystem.registerCharacterCollider(character.collider.handle, eid);
  }

  private refreshAiPerceptionTargets(): void {
    this.aiPerceptionTargetByColliderHandle.clear();
    for (const uid of this.simulationEcs.getOnlinePlayerUserIds()) {
      const p = this.simulationEcs.getPlayerRuntimeStateByUserId(uid);
      if (!p) continue;
      const peid = this.controllerSystem.getControlledCharacterEidByUserId(uid);
      if (peid === null) continue;
      this.aiPerceptionTargetByColliderHandle.set(p.collider.handle, {
        eid: peid, nid: p.nid, x: p.x, y: p.y, z: p.z,
        movementMode: p.movementMode, carriedFramePid: p.carriedFramePid, groundedPlatformPid: p.groundedPlatformPid
      });
    }
  }

  private emitPlayerPresenceStimuli(): void {
    if (this.elapsedSeconds < this.nextNpcPlayerAlertAtSeconds) return;
    this.nextNpcPlayerAlertAtSeconds = this.elapsedSeconds + this.npcPlayerAlertIntervalSeconds;
    for (const t of this.aiPerceptionTargetByColliderHandle.values()) {
      const sc = this.simulationEcs.getPlayerColliderByNid(t.nid);
      this.world.intersectionsWithShape(
        { x: t.x, y: t.y, z: t.z }, { x: 0, y: 0, z: 0, w: 1 }, this.npcPlayerAlertShape,
        (collider) => { this.npcAiSystem.receivePlayerPresenceByColliderHandle(collider.handle, { target: t, x: t.x, y: t.y, z: t.z, expiresAtSeconds: this.elapsedSeconds + this.npcPlayerAlertMemorySeconds }, this.elapsedSeconds); return true; },
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, sc
      );
    }
  }

  private getSpawnPosition(): { x: number; z: number } {
    const occupied = this.simulationEcs.getOnlinePlayerPositionsXZ();
    if (this.loadTestSpawnMode === "grid") return this.getLoadTestGridSpawnPosition(occupied.length);
    const minSep = PLAYER_CAPSULE_RADIUS * 4; const minSepSq = minSep * minSep;
    const bx = DEFAULT_VOID_SPAWN_ANCHOR.x; const bz = DEFAULT_VOID_SPAWN_ANCHOR.z;
    const br = 2.25; const rs = 1.5; const mr = 64;
    for (let ring = 0; ring <= mr; ring++) {
      const r = br + ring * rs; const circ = Math.max(r * Math.PI * 2, minSep);
      const slots = Math.max(8, Math.ceil(circ / minSep)); const ao = ring % 2 === 0 ? 0 : Math.PI / slots;
      for (let slot = 0; slot < slots; slot++) {
        const a = (slot / slots) * Math.PI * 2 + ao;
        const cx = bx + Math.cos(a) * r; const cz = bz + Math.sin(a) * r;
        let intersects = false;
        for (const p of occupied) { const dx = cx - p.x; const dz = cz - p.z; if (dx * dx + dz * dz < minSepSq) { intersects = true; break; } }
        if (!intersects && this.isSpawnCandidateValid(cx, cz)) return { x: cx, z: cz };
      }
    }
    return { x: bx + br + (mr + 1) * rs, z: bz };
  }

  private getLoadTestGridSpawnPosition(i: number): { x: number; z: number } {
    const si = Math.max(0, Math.floor(i)); const cols = this.loadTestGridColumns; const rows = this.loadTestGridRows;
    const sp = this.loadTestGridSpacing; const col = si % cols; const row = Math.floor(si / cols);
    return { x: (col - (cols - 1) / 2) * sp, z: (row - (rows - 1) / 2) * sp };
  }

  private getSpawnBodyY(_x: number, _z: number): number { return DEFAULT_VOID_SPAWN_ANCHOR.y - PLAYER_CAMERA_OFFSET_Y; }
  private isSpawnCandidateValid(_x: number, _z: number): boolean { return true; }

  private getMovementPlayerEntries(): Array<readonly [number, number]> {
    const entries: Array<readonly [number, number]> = [];
    for (const uid of this.simulationEcs.getOnlinePlayerUserIds()) {
      const p = this.simulationEcs.getPlayerRuntimeStateByUserId(uid);
      if (p) entries.push([uid, p.eid] as const);
    }
    return entries;
  }

  private getNpcMovementEntries(): number[] { return this.npcAiSystem.getCharacterEids(); }

  private resolvePositiveEnvNumber(name: string, fallback: number): number {
    const p = Number(process.env[name] ?? fallback); return Number.isFinite(p) && p > 0 ? p : fallback;
  }
  private resolveClampedEnvNumber(name: string, fallback: number, min: number, max: number): number {
    const p = Number(process.env[name] ?? fallback); return Number.isFinite(p) ? Math.max(min, Math.min(max, p)) : fallback;
  }
  private resolveBooleanEnv(name: string, fallback: boolean): boolean {
    const r = process.env[name]; if (r === undefined) return fallback; const n = r.trim().toLowerCase(); return n === "1" || n === "true" || n === "yes";
  }
  private resolveOptionalEnvString(name: string): string | undefined {
    const r = process.env[name]; if (!r) return undefined; const t = r.trim(); return t.length > 0 ? t : undefined;
  }
  private resolveLoadTestSpawnMode(): "default" | "grid" {
    return String(process.env.SERVER_LOAD_TEST_SPAWN_MODE ?? "").trim().toLowerCase() === "grid" ? "grid" : "default";
  }
  private resolveLoadTestGridSpacing(): number { const p = Number(process.env.SERVER_LOAD_TEST_GRID_SPACING ?? 320); return Number.isFinite(p) && p >= 8 ? p : 320; }
  private resolveLoadTestGridColumns(): number { const p = Number(process.env.SERVER_LOAD_TEST_GRID_COLUMNS ?? 10); return Number.isFinite(p) && p >= 1 ? Math.max(1, Math.floor(p)) : 10; }
  private resolveLoadTestGridRows(): number { const p = Number(process.env.SERVER_LOAD_TEST_GRID_ROWS ?? this.loadTestGridColumns); return Number.isFinite(p) && p >= 1 ? Math.max(1, Math.floor(p)) : this.loadTestGridColumns; }
  private logNavigationBuildReport(report: NavigationBuildReport): void {
    console.log(`[navigation] boot contexts=${report.surfaceContextCount} generated=${report.generatedCount} failed=${report.failedCount} cache=${report.cacheEnabled ? "on" : "off"} cacheHits=${report.cacheHits}/${report.cacheReads} writes=${report.cacheWrites} totalMs=${report.durationMs.toFixed(1)}`);
    if (!this.resolveBooleanEnv("NAVIGATION_BOOT_LOG_VERBOSE", false)) return;
    for (const ctx of report.contexts) console.log(`[navigation] context id=${ctx.contextId} kind=${ctx.kind} source=${ctx.source} verts=${ctx.vertices} tris=${ctx.triangles} ms=${ctx.durationMs.toFixed(1)}`);
  }
  private resolveProjectileModelId(kind: number): number {
    const rk = Math.max(0, Math.floor(kind)); return this.archetypes.projectiles.get(rk)?.modelId ?? this.archetypes.projectiles.get(1)?.modelId ?? 0;
  }
  private maybeBroadcastServerPopulation(): void {
    const playerCount = this.simulationEcs.getOnlinePlayerCount();
    const changed = this.lastBroadcastPlayerCount !== playerCount;
    const stale = this.tickNumber % this.populationBroadcastRebroadcastTicks === 0;
    if (!changed && !stale) return;
    this.lastBroadcastPlayerCount = playerCount;
    const wireCount = Math.max(0, Math.min(0xffff, Math.floor(playerCount)));
    for (const user of this.usersById.values()) {
      user.queueMessage({ ntype: NType.ServerPopulationMessage, onlinePlayers: wireCount });
    }
  }

  // ── Player lifecycle ──────────────────────────────────────────────────────
  private createPlayerLifecycleSystem(): PlayerLifecycleSystem<UserLike> {
    return new PlayerLifecycleSystem<UserLike>({
      world: this.world, globalChannel: this.globalChannel, nearChannel: this.nearChannel, farChannel: this.farChannel,
      createUserView: (p) => this.createUserView(p), usersById: this.usersById,
      getSpawnPosition: () => this.getSpawnPosition(), getSpawnBodyY: (x, z) => this.getSpawnBodyY(x, z),
      playerBodyCenterHeight: PLAYER_BODY_CENTER_HEIGHT, playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT, playerCapsuleRadius: PLAYER_CAPSULE_RADIUS,
      maxPlayerHealth: this.archetypes.player.maxHealth,
      defaultUnlockedAbilityIds: DEFAULT_UNLOCKED_ABILITY_IDS,
      resolveInitialUnlockedAbilityIds: (aid, def) => {
        const ids = this.creatorSystem.resolveOwnedArchetypeIds(aid, def as number[]);
        return ids.length > 0 ? ids : (def as number[]);
      },
      sanitizeHotbarSlot: (raw, fallback) => this.sanitizeHotbarSlot(raw, fallback),
      createInitialHotbar: (saved) => this.createInitialHotbar(saved),
      clampHealth: (v) => this.clampHealth(v),
      spawnPlayer: (user, ctx) => {
        const eid = this.simulationEcs.factory.createEntityByKind("character", {
          accountId: ctx.accountId,
          position: { x: ctx.spawnX, y: ctx.initialCameraY, z: ctx.spawnZ },
          yaw: ctx.yaw, pitch: ctx.pitch,
          velocity: { x: ctx.vx, y: ctx.vy, z: ctx.vz },
          health: ctx.health, maxHealth: this.archetypes.player.maxHealth,
          modelId: this.archetypes.player.modelId,
          hotbarAbilityIds: ctx.hotbarAbilityIds,
          unlockedAbilityIds: ctx.unlockedAbilityIds,
          primaryMouseSlot: 0, secondaryMouseSlot: 1,
          lastPrimaryFireAtSeconds: Number.NEGATIVE_INFINITY, lastProcessedSequence: 0,
          primaryHeld: false, secondaryHeld: false
        });
        this.simulationEcs.registerPlayerPhysicsRefs(eid, ctx.body, ctx.collider);
        const nid = this.replication.spawnEntity(eid);
        this.simulationEcs.setEntityNidByEid(eid, nid);
        this.simulationEcs.bindPlayerIndexes(user.id, eid);
        this.controllerSystem.attachPlayerController(user.id, eid);
        this.damageSystem.registerPlayerCollider(ctx.collider.handle, eid);
        this.ensurePunchAssigned(eid);
        this.replication.queueIdentityMessage(user, nid);
        this.events.emit<PlayerSpawnedPayload>(GameEvent.PLAYER_SPAWNED, { userId: user.id, eid, accountId: ctx.accountId, colliderHandle: ctx.collider.handle });
        return eid;
      },
      despawnPlayer: (user, eid) => {
        const accountId = this.simulationEcs.getPlayerAccountIdByUserId(user.id) ?? 0;
        this.creatorSystem.removeSession(user.id);
        this.controllerSystem.detachUser(user.id);
        this.simulationEcs.unbindPlayerIndexes(user.id, eid);
        this.replication.despawnEntity(eid);
        this.simulationEcs.destroyEid(eid);
        this.events.emit<PlayerDespawnedPayload>(GameEvent.PLAYER_DESPAWNED, { userId: user.id, eid, accountId });
      },
      sendInitialReplicationState: (user, accountId) => {
        const abilityState = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
        if (!abilityState) return;
        this.replication.sendInitialAbilityStateFromSnapshot(user, abilityState);
        const creatorState = this.creatorSystem.initializeSession(user.id, abilityState.unlockedAbilityIds, "ability");
        this.replication.queueCreatorStateMessage(user, creatorState);
        this.queueInventoryStateMessage(user, this.itemInventorySystem.ensureInventoryLoaded(accountId));
      },
      resolvePlayerEidByUserId: (uid) => this.simulationEcs.getPlayerEidByUserId(uid),
      takePendingSnapshotForLogin: (aid) => this.persistenceSyncSystem.takePendingSnapshotForLogin(aid),
      loadPlayerState: (aid) => this.persistence.loadPlayerState(aid),
      queueOfflineSnapshot: (aid, snap) => this.persistenceSyncSystem.queueOfflineSnapshot(aid, snap),
      resolveOfflineSnapshotByAccountId: (aid) => this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(aid) as any,
      markPlayerDirty: (aid, opts) => this.persistenceSyncSystem.markAccountDirty(aid, opts),
      unregisterPlayerCollider: (h) => this.damageSystem.unregisterCollider(h),
      removeProjectilesByOwner: (nid) => this.projectileSystem.removeByOwner(nid),
      queueIdentityMessage: (user, nid) => this.replication.queueIdentityMessage(user, nid),
      viewHalfWidth: 256, viewHalfHeight: 128, viewHalfDepth: 256,
      farViewHalfWidth: 3200, farViewHalfHeight: 1600, farViewHalfDepth: 3200
    });
  }
}
