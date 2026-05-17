/**
 * Purpose: This file runs core simulation state updates in tick order.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ABILITY_ID_NONE, ABILITY_ID_PUNCH,
  buildAbilityDefinitionFromBlueprint,
  clampHotbarSlotIndex, configurePlayerCharacterController,
  creatorProfileIdToGrantedAccessTags,
  DEFAULT_HOTBAR_ABILITY_IDS, DEFAULT_VOID_SPAWN_ANCHOR, DEFAULT_UNLOCKED_ABILITY_IDS,
  HOTBAR_SLOT_COUNT, PLAYER_BODY_CENTER_HEIGHT, MOVEMENT_MODE_GROUNDED,
  PLAYER_CHARACTER_CONTROLLER_OFFSET, PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS,
  encodeInventoryStateSnapshot, getAbilityDefinitionById,
  quaternionFromYawPitchRoll,
  sanitizeMovementMode,
  type BlueprintAccessTag,
  type InventoryStateSnapshot, type MovementMode, SERVER_TICK_SECONDS
} from "../shared/index";
import type { AbilityDefinition } from "../shared/index";
import { sortedUniqueContains } from "../shared/sortedNumberList";
import {
  NType,
  type AbilityCommand as AbilityWireCommand,
  type ItemCommand as ItemWireCommand,
  type InputCommand as InputWireCommand
} from "../shared/netcode";
import { PersistenceService, type PlayerSnapshot } from "./persistence/PersistenceService";
import { MapProcessIpcChannel } from "./ipc/MapProcessIpcChannel";
import { PersistenceSyncSystem } from "./persistence/PersistenceSyncSystem";
import { DamageSystem } from "./combat/damage/DamageSystem";
import { AbilityExecutionSystem } from "./combat/abilities/AbilityExecutionSystem";
import { MeleeCombatSystem } from "./combat/melee/MeleeCombatSystem";
import { ProjectileSystem } from "./combat/projectiles/ProjectileSystem";
import { InputSystem } from "./input/InputSystem";
import { PlayerLifecycleSystem, type PlayerSpawnContext } from "./lifecycle/PlayerLifecycleSystem";
import { LocationRootSystem, type LocationFrameActor } from "./location/LocationRootSystem";
import { PlayerMovementSystem } from "./movement/PlayerMovementSystem";
import { AbilityCommandHandler } from "./net/AbilityCommandHandler";
import { CreatorSystem } from "./creator/CreatorSystem";
import { ItemInventorySystem } from "./items/ItemInventorySystem";
import { ServerReplicationCoordinator } from "./net/ServerReplicationCoordinator";
import { PlatformSystem, type PlatformCarryActor } from "./platform/PlatformSystem";
import { NpcAiSystem } from "./ai/NpcAiSystem";
import { WorldContentCoordinator } from "./world/WorldContentCoordinator";
import { SimulationEcs } from "./ecs/SimulationEcs";
import { getHotbarArray, getHotbarSlot, setHotbarSlot } from "./ecs/HotbarComponents";
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
  private readonly platformEidByPid = new Map<number, number>();
  private readonly locationEidByPid = new Map<number, number>();
  private readonly dummyEidByObject = new WeakMap<object, number>();
  private nextNpcPlayerAlertAtSeconds = 0; private elapsedSeconds = 0; private tickNumber = 0;

  public constructor(
    private readonly globalChannel: GlobalChannelLike,
    private readonly nearChannel: SpatialChannelLike,
    private readonly farChannel: FarSpatialChannelLike,
    private readonly persistence: PersistenceService,
    private readonly createUserView: CreateUserView,
    private readonly ipcChannel: MapProcessIpcChannel | null = null
  ) {
    const c = this.simulationEcs.world.components;
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
      world: this.world,
      ecs: this.simulationEcs,
      replication: this.replication,
      persistence: this.persistence,
      getUserById: (userId) => this.usersById.get(userId),
      markPlayerCharacterDirty: (accountId) => this.persistenceSyncSystem.markAccountDirty(accountId, { dirtyCharacter: true, dirtyAbilityState: false }),
      persistInventoryMutation: (accountId, snapshot, action, eventId, eventAtMs) => {
        if (!this.ipcChannel?.isAvailable()) {
          this.persistence.saveInventoryState(accountId, snapshot);
          this.persistence.saveCriticalEvent({
            eventId,
            instanceId: process.env.MAP_INSTANCE_ID ?? "default-1",
            accountId,
            eventType: "inventory_mutation",
            eventPayloadJson: JSON.stringify({
              action,
              itemCount: snapshot.items.length,
              equipmentSlots: Object.keys(snapshot.equipment)
            }),
            eventAtMs
          });
          return;
        }
        void this.ipcChannel
          .request("PersistInventoryMutation", {
            accountId,
            instanceId: process.env.MAP_INSTANCE_ID ?? "default-1",
            action,
            snapshot,
            eventId,
            eventAtMs
          })
          .then((response) => {
            if (!response.ok) {
              throw new Error(response.error ?? "PersistInventoryMutation rejected.");
            }
          })
          .catch((error) => {
            console.error("[server] critical inventory persistence failed", error);
            throw error;
          });
      }
    });

    // ── Damage ────────────────────────────────────────────────────────────
    this.damageSystem = new DamageSystem({
      maxPlayerHealth: this.archetypes.player.maxHealth,
      playerBodyCenterHeight: PLAYER_BODY_CENTER_HEIGHT,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      getSpawnPosition: () => this.getSpawnPosition(),
      getSpawnBodyY: (x, z) => this.getSpawnBodyY(x, z),
      markCharacterDirtyByAccountId: (accountId, options) => this.persistenceSyncSystem.markAccountDirty(accountId, options),
      getCharacterStateByEid: (eid) => this.simulationEcs.getCharacterDamageStateByEid(eid),
      applyCharacterStateByEid: (eid, state) => this.simulationEcs.applyCharacterDamageStateByEid(eid, state),
      getDummyStateByEid: (eid) => this.simulationEcs.getDummyDamageStateByEid(eid),
      applyDummyStateByEid: (eid, state) => this.simulationEcs.applyDummyDamageStateByEid(eid, state),
      events: this.events
    });

    // ── World content ─────────────────────────────────────────────────────
    this.worldContentCoordinator = new WorldContentCoordinator({
      world: this.world,
      onDummyAdded: (dummy) => {
        const eid = this.simulationEcs.createEntityFromPreset("dummy", {
          position: dummy.position, rotation: dummy.rotation,
          health: dummy.maxHealth, maxHealth: dummy.maxHealth,
          modelId: dummy.modelId
        });
        this.dummyEidByObject.set(dummy, eid);
        this.simulationEcs.registerDummyPhysicsRefs(eid, dummy.body, dummy.collider);
        const nid = this.replication.spawnEntity(eid);
        dummy.nid = nid;
        this.simulationEcs.setEntityNidByEid(eid, nid);
      }
    });

    // ── Projectiles ───────────────────────────────────────────────────────
    this.projectileSystem = new ProjectileSystem({
      world: this.world,
      ecsWorld: this.simulationEcs.world,
      getOwnerColliderByNid: (ownerNid) => this.simulationEcs.getCharacterColliderByNid(ownerNid),
      resolveTargetByColliderHandle: (h) => this.damageSystem.resolveTargetByColliderHandle(h),
      applyDamage: (target, damage) => this.damageSystem.applyDamage(target, damage),
      despawnProjectile: (eid) => { this.replication.despawnEntity(eid); this.simulationEcs.destroyEid(eid); }
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
      resolveAbilityById: (unlockedAbilityIds, abilityId) => this.getAbilityDefinitionForUnlockedList(unlockedAbilityIds, abilityId),
      broadcastAbilityUse: (playerNid, ability, x, y, z) => {
        this.replication.broadcastAbilityUseMessage(playerNid, ability, x, y, z);
        this.events.emit<AbilityUsedPayload>(GameEvent.ABILITY_USED, {
          ownerNid: playerNid, abilityId: ability.id,
          category: ability.category, serverTick: this.tickNumber,
          x, y, z
        });
      },
      ecsComponents: c,
      spawnProjectile: (req) => this.spawnProjectile(req),
      applyMeleeHit: (playerEid, mp) => {
        const body = this.simulationEcs.getPlayerBody(playerEid);
        const collider = this.simulationEcs.getPlayerCollider(playerEid);
        if (!body || !collider) return;
        this.meleeCombatSystem.tryApplyMeleeHit({
          nid: c.NetworkId.value[playerEid] ?? 0,
          yaw: c.Yaw.value[playerEid] ?? 0,
          pitch: c.Pitch.value[playerEid] ?? 0,
          body, collider
        }, mp);
      }
    });

    // ── Input ─────────────────────────────────────────────────────────────
    this.inputSystem = new InputSystem({
      ecsComponents: c,
      onPrimaryPressed: (eid) => this.abilityExecutionSystem.tryUsePrimaryMouseAbilityByEid(eid),
      onSecondaryPressed: (eid) => this.abilityExecutionSystem.tryUseSecondaryMouseAbilityByEid(eid),
      onCastSlotPressed: (eid, slot) => this.abilityExecutionSystem.tryUseAbilityBySlotByEid(eid, slot)
    });

    // ── Platforms ─────────────────────────────────────────────────────────
    this.platformSystem = new PlatformSystem({
      world: this.world, definitions: this.archetypes.platforms,
      onPlatformAdded: (platform) => {
        const eid = this.simulationEcs.createEntityFromPreset("platform", {
          position: platform.position, rotation: platform.rotation, modelId: platform.modelId
        });
        this.platformEidByPid.set(platform.pid, eid);
      },
      onPlatformUpdated: (platform) => {
        const eid = this.platformEidByPid.get(platform.pid);
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
        const eid = this.simulationEcs.createEntityFromPreset("location", {
          position: location.position, rotation: location.rotation, modelId: location.modelId,
          locationKind: location.locationKind, locationArchetypeId: location.locationArchetypeId,
          locationSeed: location.locationSeed, locationEnvironmentId: location.locationEnvironmentId,
          locationStreamingRadius: location.locationStreamingRadius, locationInfluenceRadius: location.locationInfluenceRadius
        });
        this.locationEidByPid.set(location.pid, eid);
        const nid = this.replication.spawnEntity(eid);
        location.nid = nid;
        this.simulationEcs.setEntityNidByEid(eid, nid);
      },
      onLocationUpdated: (location) => {
        const eid = this.locationEidByPid.get(location.pid);
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
      world: this.world,
      ecs: this.simulationEcs,
      ecsComponents: c,
      replication: this.replication,
      navigation: this.navigationPlanner,
      characterArchetypes: this.archetypes.characterArchetypes,
      spawns: this.archetypes.npcSpawns,
      controllerKindAi: CONTROLLER_KIND_AI,
      onNpcSpawned: (eid, colliderHandle) => {
        this.controllerSystem.attachAiController(eid);
        this.damageSystem.registerCharacterCollider(colliderHandle, eid);
      },
      hasPerceptionTargets: () => this.aiPerceptionTargetByColliderHandle.size > 0,
      resolvePerceptionTargetByColliderHandle: (h) => this.aiPerceptionTargetByColliderHandle.get(h) ?? null,
      usePrimaryAbilityByEid: (eid) => this.abilityExecutionSystem.tryUsePrimaryMouseAbilityByEid(eid),
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
      resolveDummyEid: (dummy) => this.dummyEidByObject.get(dummy) ?? -1,
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
    const eid = this.simulationEcs.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return;
    this.inputSystem.applyCommands(eid, commands);
  }

  public applyAbilityCommand(user: UserLike, command: Partial<AbilityWireCommand>): void {
    if (typeof this.simulationEcs.getPlayerEidByUserId(user.id) !== "number") return;
    this.applyForgetAbilityIntent(user, command);
    this.abilityCommandHandler.apply(user, command);
  }

  public applyCreatorCommand(user: UserLike, command: {
    sessionId: number; sequence: number; setName?: boolean; name?: string;
    selectBaseBlueprint?: boolean; baseBlueprintId?: number;
    stepField?: boolean; fieldId?: string; fieldDelta?: number;
    setField?: boolean; fieldValueJson?: string;
    submitCreate?: boolean;
  }): void {
    const accountId = this.simulationEcs.getPlayerAccountIdByUserId(user.id);
    if (accountId === null) return;
    const abilityState = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
    const availableTemplateBlueprintIds = this.ensureBlueprintAccessLoaded(
      accountId,
      "blueprint.template",
      abilityState?.unlockedAbilityIds ?? DEFAULT_UNLOCKED_ABILITY_IDS
    );
    const result = this.creatorSystem.applyCommand({
      userId: user.id,
      accountId,
      availableTemplateBlueprintIds,
      command
    });
    this.replication.queueCreatorStateMessage(user, result.snapshot);

    if (result.createdBlueprint) {
      const grantedAccessTags = creatorProfileIdToGrantedAccessTags(result.snapshot.profileId);
      this.persistence.saveBlueprintAndGrantAccess({
        blueprint: result.createdBlueprint,
        createdByAccountId: accountId,
        grantAccessTags: grantedAccessTags
      });
      for (const accessTag of grantedAccessTags) {
        this.creatorSystem.grantBlueprintAccess(accountId, accessTag, result.createdBlueprint.id);
      }
      const createdAbility = buildAbilityDefinitionFromBlueprint(result.createdBlueprint);
      if (createdAbility) {
        const unlockedAbilityIds = this.creatorSystem.getAccessibleBlueprintIds(accountId, "ability.use") ?? [];
        this.simulationEcs.setPlayerUnlockedAbilityIdsByUserId(user.id, unlockedAbilityIds);
        this.replication.queueAbilityDefinitionMessage(user, createdAbility);
        const refreshed = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
        if (refreshed) {
          this.replication.queueAbilityOwnershipMessage(user, refreshed.unlockedAbilityIds);
          this.replication.queueAbilityStateMessageFromSnapshot(user, refreshed);
        }
      }
      const nextCreatorState = this.creatorSystem.synchronizeSessionAvailability(user.id);
      if (nextCreatorState) {
        this.replication.queueCreatorStateMessage(user, nextCreatorState);
      }
    }
  }

  public applyItemCommand(user: UserLike, command: Partial<ItemWireCommand>): void {
    if (typeof this.simulationEcs.getPlayerEidByUserId(user.id) !== "number") return;
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
      const snap = this.creatorSystem.synchronizeSessionAvailability(user.id);
      if (snap) this.replication.queueCreatorStateMessage(user, snap);
      return;
    }

    this.persistence.revokeBlueprintAccess(accountId, targetId, "ability.use");
    this.persistence.revokeBlueprintAccess(accountId, targetId, "blueprint.template");
    const nextUnlockedAbilityIds = this.creatorSystem.revokeBlueprintAccess(accountId, "ability.use", targetId);
    this.creatorSystem.revokeBlueprintAccess(accountId, "blueprint.template", targetId);
    this.simulationEcs.setPlayerUnlockedAbilityIdsByUserId(user.id, nextUnlockedAbilityIds);
    const hotbarChanged = this.simulationEcs.clearPlayerAbilityOnHotbarByUserId(user.id, targetId);
    const after = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
    if (!after) return;
    this.replication.queueAbilityOwnershipMessage(user, after.unlockedAbilityIds);
    this.replication.queueAbilityStateMessageFromSnapshot(user, after);
    const snap = this.creatorSystem.synchronizeSessionAvailability(user.id);
    if (snap) this.replication.queueCreatorStateMessage(user, snap);
    if (hotbarChanged) this.persistenceSyncSystem.markAccountDirty(accountId, { dirtyCharacter: false, dirtyAbilityState: true });
  }

  // ── Tick ──────────────────────────────────────────────────────────────────
  public step(delta: number): void {
    this.tickNumber += 1;
    const prevElapsed = this.elapsedSeconds;
    this.elapsedSeconds += delta;
    this.world.integrationParameters.dt = delta;
    this.tickKinematicWorldFrames(prevElapsed);
    this.tickAiIntentPhase();
    this.tickAbilityIntentPhase();
    this.tickMovementPhase(delta);
    this.tickCombatPhase(delta);
    this.tickReplicationPhase();
    this.tickPhysicsFinalizePhase();
  }

  private tickKinematicWorldFrames(prevElapsed: number): void {
    this.platformSystem.updatePlatforms(prevElapsed, this.elapsedSeconds);
    this.locationRootSystem.updateLocations(prevElapsed, this.elapsedSeconds);
  }

  private tickAiIntentPhase(): void {
    this.refreshAiPerceptionTargets();
    this.emitPlayerPresenceStimuli();
    this.npcAiSystem.step(this.elapsedSeconds);
  }

  private tickAbilityIntentPhase(): void {
    const c = this.simulationEcs.world.components;
    for (const uid of this.simulationEcs.getOnlinePlayerUserIds()) {
      const eid = this.simulationEcs.getPlayerEidByUserId(uid);
      if (typeof eid !== "number") continue;
      if ((c.PrimaryHeld.value[eid] ?? 0) !== 0) {
        this.abilityExecutionSystem.tryUsePrimaryMouseAbilityByEid(eid);
      }
      if ((c.SecondaryHeld.value[eid] ?? 0) !== 0) {
        this.abilityExecutionSystem.tryUseSecondaryMouseAbilityByEid(eid);
      }
    }
  }

  private tickMovementPhase(delta: number): void {
    this.playerMovementSystem.stepPlayers(this.getMovementPlayerEntries(), delta, this.elapsedSeconds);
    this.npcMovementSystem.stepCharacters(this.npcAiSystem.getNpcEids() as number[], delta, this.elapsedSeconds);
  }

  private tickCombatPhase(delta: number): void {
    this.projectileSystem.step(delta);
    this.statusEffects.step(this.elapsedSeconds * 1000);
  }

  private tickReplicationPhase(): void {
    const replicatedEids = this.simulationEcs.getReplicatedEids();
    for (const eid of replicatedEids) {
      this.replication.syncEntityFromEcs(eid);
    }
  }

  private tickPhysicsFinalizePhase(): void {
    this.world.step();
    this.maybeBroadcastServerPopulation();
  }

  public flushDirtyPlayerState(overrides?: { saveCharacterSnapshot?: (s: PlayerSnapshot) => void; saveAbilityStateSnapshot?: (s: PlayerSnapshot) => void }): void {
    this.persistenceSyncSystem.flushDirtyPlayerState(
      (accountId) => this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(accountId),
      (snap) => { if (overrides?.saveCharacterSnapshot) overrides.saveCharacterSnapshot(snap); else this.persistence.saveCharacterSnapshot(snap); },
      (snap) => { if (overrides?.saveAbilityStateSnapshot) overrides.saveAbilityStateSnapshot(snap); else this.persistence.saveAbilityStateSnapshot(snap); }
    );
  }

  public injectPendingLoginSnapshot(accountId: number, snapshot: PlayerSnapshot): void { this.persistenceSyncSystem.queueOfflineSnapshot(accountId, snapshot); }
  public injectPendingInventorySnapshot(accountId: number, snapshot: InventoryStateSnapshot): void {
    this.itemInventorySystem.queuePendingInventorySnapshot(accountId, snapshot);
  }
  public getPlayerSnapshotByUserId(userId: number): PlayerSnapshot | null {
    const aid = this.simulationEcs.getPlayerAccountIdByUserId(userId);
    if (aid === null) return null;
    return this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(aid);
  }
  public getInventorySnapshotByAccountId(accountId: number): InventoryStateSnapshot {
    return this.itemInventorySystem.ensureInventoryLoaded(accountId);
  }

  public getRuntimeStats(): { onlinePlayers: number; activeProjectiles: number; pendingOfflineSnapshots: number; ecsEntities: number; activeNpcs: number; inactiveNpcs: number; hibernatingNpcs: number } {
    const es = this.simulationEcs.getStats();
    const ai = this.npcAiSystem.getStats();
    return { onlinePlayers: this.simulationEcs.getOnlinePlayerCount(), activeProjectiles: this.projectileSystem.getActiveCount(), pendingOfflineSnapshots: this.persistenceSyncSystem.getPendingOfflineSnapshotCount(), ecsEntities: es.total, activeNpcs: ai.active, inactiveNpcs: ai.inactive, hibernatingNpcs: ai.hibernating };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private ensureBlueprintAccessLoaded(
    accountId: number,
    accessTag: BlueprintAccessTag,
    defaultIds: readonly number[]
  ): number[] {
    const cached = this.creatorSystem.getAccessibleBlueprintIds(accountId, accessTag);
    if (cached) {
      this.hydratePersistedBlueprintDefinitions(cached);
      return cached;
    }
    const accessibleIds = this.persistence.loadAccessibleBlueprintIds(accountId, accessTag, defaultIds);
    this.creatorSystem.hydrateAccessibleBlueprintIds(accountId, accessTag, accessibleIds);
    this.hydratePersistedBlueprintDefinitions(accessibleIds);
    return accessibleIds;
  }

  private hydratePersistedBlueprintDefinitions(blueprintIds: readonly number[]): void {
    const unresolvedIds = blueprintIds.filter((blueprintId) =>
      blueprintId > 0 && !this.creatorSystem.resolveBlueprintDefinitionById(blueprintId)
    );
    if (unresolvedIds.length === 0) {
      return;
    }
    const persistedBlueprints = this.persistence.loadPersistedBlueprintDefinitions(unresolvedIds);
    for (const blueprint of persistedBlueprints) {
      this.creatorSystem.registerPersistedBlueprint(blueprint);
    }
  }

  private getAbilityDefinitionForUnlockedSet(unlocked: Set<number>, abilityId: number): AbilityDefinition | null {
    if (!unlocked.has(abilityId)) return null;
    return this.resolveAbilityDefinitionById(abilityId);
  }

  private getAbilityDefinitionForUnlockedList(unlocked: readonly number[], abilityId: number): AbilityDefinition | null {
    // unlocked is kept normalized (sorted/unique) by ECS helpers.
    // Binary search is much cheaper than allocating Sets repeatedly.
    if (!unlocked || unlocked.length === 0) return null;
    // Fast-path for tiny lists.
    if (unlocked.length <= 8) {
      for (let i = 0; i < unlocked.length; i += 1) {
        if (unlocked[i] === abilityId) return this.resolveAbilityDefinitionById(abilityId);
      }
      return null;
    }
    // Larger lists: binary search
    let lo = 0;
    let hi = unlocked.length - 1;
    const target = Math.max(0, Math.floor(abilityId));
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = unlocked[mid] ?? 0;
      if (v === target) return this.resolveAbilityDefinitionById(abilityId);
      if (v < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  private sanitizeHotbarSlot(raw: unknown, fallback: number): number {
    return (typeof raw === "number" && Number.isFinite(raw)) ? clampHotbarSlotIndex(raw) : fallback;
  }

  private normalizeAbilityId(raw: unknown): number {
    return (typeof raw === "number" && Number.isFinite(raw)) ? Math.max(ABILITY_ID_NONE, Math.min(0xffff, Math.floor(raw))) : ABILITY_ID_NONE;
  }

  private sanitizeSelectedAbilityId(raw: unknown, fallback: number, unlocked: readonly number[]): number {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
    const n = Math.max(0, Math.floor(raw));
    if (n === ABILITY_ID_NONE) return ABILITY_ID_NONE;
    const resolved = this.getAbilityDefinitionForUnlockedList(unlocked, n);
    return resolved ? n : fallback;
  }

  private resolveAbilityDefinitionById(id: number): AbilityDefinition | null {
    const sd = getAbilityDefinitionById(id);
    if (sd) return sd;
    const blueprint = this.creatorSystem.resolveBlueprintDefinitionById(id);
    return blueprint ? buildAbilityDefinitionFromBlueprint(blueprint) : null;
  }

  private createInitialHotbar(saved?: number[]): number[] {
    const h = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
    for (let s = 0; s < HOTBAR_SLOT_COUNT; s++) {
      h[s] = (saved && typeof saved[s] === "number" && Number.isFinite(saved[s])) ? Math.max(ABILITY_ID_NONE, Math.floor(saved[s] as number)) : (DEFAULT_HOTBAR_ABILITY_IDS[s] ?? ABILITY_ID_NONE);
    }
    return h;
  }

  private ensurePunchAssigned(eid: number): void {
    const unlocked = this.simulationEcs.world.components.UnlockedAbilityIds.value[eid] ?? [];
    if (!sortedUniqueContains(unlocked, ABILITY_ID_PUNCH)) return;
    const c = this.simulationEcs.world.components;
    for (let s = 0; s < HOTBAR_SLOT_COUNT; s++) {
      if (getHotbarSlot(c, eid, s) === ABILITY_ID_PUNCH) return;
    }
    for (let s = 0; s < HOTBAR_SLOT_COUNT; s++) {
      if (getHotbarSlot(c, eid, s) === ABILITY_ID_NONE) {
        setHotbarSlot(c, eid, s, ABILITY_ID_PUNCH);
        return;
      }
    }
    setHotbarSlot(c, eid, 0, ABILITY_ID_PUNCH);
  }

  private clampHealth(v: number): number { return Number.isFinite(v) ? Math.max(0, Math.min(this.archetypes.player.maxHealth, Math.floor(v))) : this.archetypes.player.maxHealth; }

  private refreshAiPerceptionTargets(): void {
    this.aiPerceptionTargetByColliderHandle.clear();
    const c = this.simulationEcs.world.components;
    for (const uid of this.simulationEcs.getOnlinePlayerUserIds()) {
      const peid = this.controllerSystem.getControlledCharacterEidByUserId(uid);
      if (peid === null) continue;
      const eid = this.simulationEcs.getPlayerEidByUserId(uid);
      if (typeof eid !== "number") continue;
      const collider = this.simulationEcs.getPlayerCollider(eid);
      if (!collider) continue;
      const gp = c.GroundedPlatformPid.value[eid] ?? -1;
      const cf = c.CarriedFramePid.value[eid] ?? -1;
      this.aiPerceptionTargetByColliderHandle.set(collider.handle, {
        eid: peid,
        nid: c.NetworkId.value[eid] ?? 0,
        x: c.Position.x[eid] ?? 0,
        y: c.Position.y[eid] ?? 0,
        z: c.Position.z[eid] ?? 0,
        movementMode: sanitizeMovementMode(c.MovementMode.value[eid], MOVEMENT_MODE_GROUNDED),
        carriedFramePid: cf < 0 ? null : cf,
        groundedPlatformPid: gp < 0 ? null : gp
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
      const eid = this.simulationEcs.getPlayerEidByUserId(uid);
      if (typeof eid === "number") entries.push([uid, eid] as const);
    }
    return entries;
  }

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

  private spawnProjectile(req: {
    ownerNid: number; kind: number;
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    radius: number; damage: number; lifetimeSeconds: number;
    maxRange: number; gravity: number; drag: number;
    maxSpeed: number; minSpeed: number; pierceCount: number;
    despawnOnDamageableHit: boolean; despawnOnWorldHit: boolean;
  }): void {
    const eid = this.simulationEcs.createEntityFromPreset("projectile", {
      modelId: this.resolveProjectileModelId(req.kind),
      position: { x: req.x, y: req.y, z: req.z },
      velocity: { x: req.vx, y: req.vy, z: req.vz },
      projectileOwnerNid: req.ownerNid,
      projectileKind: req.kind,
      projectileRadius: req.radius,
      projectileDamage: req.damage,
      projectileTtl: req.lifetimeSeconds,
      projectileRemainingRange: ProjectileSystem.resolveMaxRange(req.maxRange),
      projectileGravity: ProjectileSystem.resolveOptionalNumber(req.gravity, 0),
      projectileDrag: Math.max(0, ProjectileSystem.resolveOptionalNumber(req.drag, 0)),
      projectileMaxSpeed: Math.max(0, ProjectileSystem.resolveOptionalNumber(req.maxSpeed, Number.POSITIVE_INFINITY)),
      projectileMinSpeed: Math.max(0, ProjectileSystem.resolveOptionalNumber(req.minSpeed, 0)),
      projectileRemainingPierces: Math.max(0, Math.floor(ProjectileSystem.resolveOptionalNumber(req.pierceCount, 0))),
      projectileDespawnOnDamageableHit: Boolean(req.despawnOnDamageableHit),
      projectileDespawnOnWorldHit: Boolean(req.despawnOnWorldHit)
    });
    const nid = this.replication.spawnEntity(eid);
    this.simulationEcs.setEntityNidByEid(eid, nid);
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
        const ids = this.ensureBlueprintAccessLoaded(aid, "ability.use", def as number[]);
        return ids.length > 0 ? ids : (def as number[]);
      },
      sanitizeHotbarSlot: (raw, fallback) => this.sanitizeHotbarSlot(raw, fallback),
      createInitialHotbar: (saved) => this.createInitialHotbar(saved),
      clampHealth: (v) => this.clampHealth(v),
      spawnPlayer: (user, ctx) => {
        const eid = this.simulationEcs.createEntityFromPreset("character", {
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
        const availableTemplateBlueprintIds = this.ensureBlueprintAccessLoaded(
          accountId,
          "blueprint.template",
          abilityState.unlockedAbilityIds
        );
        const creatorState = this.creatorSystem.initializeSession(
          user.id,
          accountId,
          availableTemplateBlueprintIds,
          "ability_creator"
        );
        this.replication.queueCreatorStateMessage(user, creatorState);
        this.itemInventorySystem.queueInventoryStateForUser(user.id);
      },
      resolvePlayerEidByUserId: (uid) => this.simulationEcs.getPlayerEidByUserId(uid),
      takePendingSnapshotForLogin: (aid) => this.persistenceSyncSystem.takePendingSnapshotForLogin(aid),
      loadPlayerState: (aid) => this.persistence.loadPlayerState(aid),
      queueOfflineSnapshot: (aid, snap) => this.persistenceSyncSystem.queueOfflineSnapshot(aid, snap),
      resolveOfflineSnapshotByAccountId: (aid) => this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(aid),
      markPlayerDirty: (aid, opts) => this.persistenceSyncSystem.markAccountDirty(aid, opts),
      unregisterPlayerCollider: (h) => this.damageSystem.unregisterCollider(h),
      removeProjectilesByOwner: (nid) => this.projectileSystem.removeByOwner(nid),
      queueIdentityMessage: (user, nid) => this.replication.queueIdentityMessage(user, nid),
      viewHalfWidth: 256, viewHalfHeight: 128, viewHalfDepth: 256,
      farViewHalfWidth: 3200, farViewHalfHeight: 1600, farViewHalfDepth: 3200
    });
  }
}
