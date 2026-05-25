/**
 * Purpose: This file runs core simulation state updates in tick order.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import {
  type AlertSeverity,
  ABILITY_ID_NONE, ABILITY_ID_PUNCH,
  buildAbilityDefinitionFromBlueprint,
  buildItemDefinitionFromBlueprint,
  clampHotbarSlotIndex, configurePlayerCharacterController,
  creatorProfileIdToGrantedAccessTags,
  filterCreatorTemplateBlueprintIdsForStation,
  DEFAULT_HOTBAR_ABILITY_IDS, DEFAULT_VOID_SPAWN_ANCHOR, DEFAULT_UNLOCKED_ABILITY_IDS,
  HOTBAR_SLOT_COUNT, PLAYER_BODY_CENTER_HEIGHT, MOVEMENT_MODE_GROUNDED,
  PLAYER_CHARACTER_CONTROLLER_OFFSET, PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS,
  encodeInventorySnapshot, getAbilityDefinitionById, getItemDefinitionById,
  quaternionFromYawPitchRoll,
  DEFAULT_PLAYER_SETTINGS,
  coercePlayerSettings,
  getBlueprintRuntimeAbilityByBlueprintId,
  getBlueprintRuntimeItemByBlueprintId,
  getBlueprintDefinitionsForProfile,
  getBlueprintRuntimeActivationSpecsByBlueprintId,
  resolveReadyAppearanceRuntimeBinding,
  INTERACTION_SLOT_PRIMARY,
  upsertBlueprintRuntimeCapabilityEntry,
  type WorldInteractionActionId,
  type WorldInteractionActivateIntent,
  type WorldInteractionPromptViewState,
  type WorldInteractionTargetDescriptor,
  type RuntimeActivationSpec,
  cloneBlueprintDefinition,
  sanitizeMovementMode,
  type BlueprintAccessTag,
  type BlueprintDefinition,
  type CreatorProfileId,
  type InventorySnapshot, type MovementMode, type PlayerSettings, SERVER_TICK_SECONDS, type EquipmentSlot
} from "../shared/index";
import type { AbilityDefinition } from "../shared/index";
import { sortedUniqueContains } from "../shared/sortedNumberList";
import {
  NType,
  type AbilityCommand as AbilityWireCommand,
  type UiIntentCommand as UiIntentWireCommand,
  decodeCreatorCommandPayloadJson,
  normalizeCreatorCommandFromPayload,
  type InputCommand as InputWireCommand,
  type PlayerSettingsCommand as PlayerSettingsWireCommand
} from "../shared/netcode";
import { PersistenceService, type PlayerSnapshot } from "./persistence/PersistenceService";
import { MapProcessIpcChannel } from "./ipc/MapProcessIpcChannel";
import { PersistenceSyncSystem } from "./persistence/PersistenceSyncSystem";
import { DamageSystem } from "./combat/damage/DamageSystem";
import { DeathLifecycleSystem, type DeathPolicyId } from "./combat/death/DeathLifecycleSystem";
import { AbilityExecutionSystem } from "./combat/abilities/AbilityExecutionSystem";
import { ActionEffectPipeline } from "./combat/actions/ActionEffectPipeline";
import { MeleeCombatSystem } from "./combat/melee/MeleeCombatSystem";
import { ProjectileSystem } from "./combat/projectiles/ProjectileSystem";
import { AttackRuntimeSystem } from "./combat/attack/AttackRuntimeSystem";
import { InputSystem } from "./input/InputSystem";
import { PlayerLifecycleSystem, type PlayerSpawnContext } from "./lifecycle/PlayerLifecycleSystem";
import { LocationRootSystem, type LocationFrameActor } from "./location/LocationRootSystem";
import { PlayerMovementSystem } from "./movement/PlayerMovementSystem";
import { AbilityCommandHandler } from "./net/AbilityCommandHandler";
import { ServerAlertDispatcher } from "./net/ServerAlertDispatcher";
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
import {
  GameEvent,
  type PlayerMovedPayload,
  type PlayerSpawnedPayload,
  type PlayerDespawnedPayload,
  type DamageDealtPayload,
  type DamagePacketAppliedPayload,
  type HealthChangedPayload,
  type AbilityUsedPayload,
  type ItemEquippedPayload,
  type ItemUnequippedPayload,
  type DeathPolicyStartedPayload,
  type DeathPolicyCompletedPayload
} from "./events/GameEvents";
import { StatusEffectSystem } from "./combat/status/StatusEffectSystem";
import {
  type EntityAppearancePatch,
  getDefaultEquippedTintPatch,
  getEquippedSlotTintPatch
} from "../shared/appearance/AppearancePolicy";
import { AppearanceSystem } from "./appearance/AppearanceSystem";
import type { AppearanceIntentSource } from "./appearance/AppearanceSystem";
import { UiViewReplicationRuntime } from "./ui/UiViewReplicationRuntime";

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

interface PortalTransferZone {
  sourceMapInstanceId: string;
  targetMapInstanceId: string;
  centerX: number;
  centerY: number;
  centerZ: number;
  sensorRadius: number;
}

const PORTAL_TRANSFER_RETRIGGER_SECONDS = 2.0;
const FALL_DAMAGE_MIN_IMPACT_SPEED = 14;
const FALL_DAMAGE_PER_SPEED = 5;
const DEFAULT_ACTOR_CAPABILITIES: Readonly<Record<string, number>> = Object.freeze({
  strength: 10,
  speed: 10,
  intelligence: 10,
  skill: 10,
  "creator.author": 1,
  "creator.clone": 1,
  "creator.publish.template": 1,
  "creator.publish.global": 0,
  "blueprint.instantiate.restricted": 0
});
const MAX_CREATOR_COMMAND_JSON_BYTES = 4096;
type InventoryWireCommand = {
  action?: number;
  pickupNid?: number;
  itemInstanceId?: number;
  quantity?: number;
  equipmentSlot?: number;
  sourceSlot?: number;
  targetSlot?: number;
  activationChannel?: number;
  payloadKind?: number;
};
type ResolvedInteractionTarget =
  | { targetId: string; actionId: WorldInteractionActionId; targetType: "pickup"; pickupNid: number; descriptor: WorldInteractionTargetDescriptor }
  | { targetId: string; actionId: WorldInteractionActionId; targetType: "station"; stationSessionId: string; descriptor: WorldInteractionTargetDescriptor }
  | { targetId: string; actionId: WorldInteractionActionId; targetType: "pilot_console"; framePid: number; volumeId: string; descriptor: WorldInteractionTargetDescriptor };
const PORTAL_TRANSFER_ZONES: readonly PortalTransferZone[] = Object.freeze([
  { sourceMapInstanceId: "map-a", targetMapInstanceId: "map-b", centerX: 12, centerY: 34, centerZ: 0, sensorRadius: 2.2 },
  { sourceMapInstanceId: "map-b", targetMapInstanceId: "map-a", centerX: 0, centerY: 4, centerZ: 0, sensorRadius: 2.2 }
]);

const EQUIPMENT_SLOT_TINT_INTENT_SOURCES: readonly AppearanceIntentSource[] = Object.freeze([
  "equipment_slot_tint_weapon",
  "equipment_slot_tint_head",
  "equipment_slot_tint_body",
  "equipment_slot_tint_legs",
  "equipment_slot_tint_accessory"
]);

function getEquipmentSlotTintIntentSource(slot: EquipmentSlot): AppearanceIntentSource {
  if (slot === "weapon") return "equipment_slot_tint_weapon";
  if (slot === "head") return "equipment_slot_tint_head";
  if (slot === "body") return "equipment_slot_tint_body";
  if (slot === "legs") return "equipment_slot_tint_legs";
  return "equipment_slot_tint_accessory";
}

export class GameSimulation {
  private readonly usersById = new Map<number, UserLike>();
  private readonly world: RAPIER.World;
  public readonly events = new EventBus();
  public readonly statusEffects: StatusEffectSystem;
  private readonly simulationEcs = new SimulationEcs();
  private readonly controllerSystem = new ControllerSystem();
  private readonly replication: ServerReplicationCoordinator<UserLike>;
  private readonly appearanceSystem: AppearanceSystem;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private readonly persistenceSyncSystem = new PersistenceSyncSystem();
  private readonly worldContentCoordinator: WorldContentCoordinator;
  private readonly damageSystem: DamageSystem;
  private readonly deathLifecycleSystem: DeathLifecycleSystem;
  private readonly meleeCombatSystem: MeleeCombatSystem;
  private readonly abilityExecutionSystem: AbilityExecutionSystem;
  private readonly attackRuntimeSystem: AttackRuntimeSystem;
  private readonly actionEffectPipeline: ActionEffectPipeline;
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
  private readonly uiViewRuntime = new UiViewReplicationRuntime();
  private readonly playerLifecycleSystem: PlayerLifecycleSystem<UserLike>;
  private readonly alertDispatcher: ServerAlertDispatcher<UserLike>;
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
  private readonly referenceFrameMembershipByUserId = new Map<number, Set<string>>();
  private readonly pilotedReferenceFrameByUserId = new Map<number, { framePid: number; volumeId: string }>();
  private readonly pilotUserIdByReferenceFramePid = new Map<number, number>();
  private readonly pilotControlIntentByUserId = new Map<number, {
    forward: number;
    strafe: number;
    ascend: number;
    yawDelta: number;
    sprint: boolean;
  }>();
  private readonly effectAuditSuccessCountByType = new Map<string, number>();
  private readonly autoTransferRequestByUserId = new Map<number, string>();
  private readonly portalTriggerCooldownByUserId = new Map<number, number>();
  private readonly previousGroundedByEid = new Map<number, boolean>();
  private readonly minAirborneVyByEid = new Map<number, number>();
  private readonly playerSettingsByAccountId = new Map<number, PlayerSettings>();
  private readonly actorCapabilitiesByAccountId = new Map<number, Record<string, number>>();
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
    this.alertDispatcher = new ServerAlertDispatcher<UserLike>(() => this.usersById.values());
    this.creatorSystem = new CreatorSystem();
    this.replication = new ServerReplicationCoordinator<UserLike>({
      nearChannel: this.nearChannel, farChannel: this.farChannel,
      getTickNumber: () => this.tickNumber,
      getUserById: (userId) => this.usersById.get(userId),
      sanitizeHotbarSlot: (rawSlot, fallbackSlot) => this.sanitizeHotbarSlot(rawSlot, fallbackSlot),
      getAbilityDefinitionById: (abilityId) => this.resolveAbilityDefinitionById(abilityId)
    }, c);
    this.appearanceSystem = new AppearanceSystem(
      this.simulationEcs,
      (eid) => this.replication.syncEntityFromEcs(eid)
    );
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.integrationParameters.dt = SERVER_TICK_SECONDS;
    this.characterController = this.world.createCharacterController(PLAYER_CHARACTER_CONTROLLER_OFFSET);
    configurePlayerCharacterController(this.characterController);
    const mapInstanceId = process.env.MAP_INSTANCE_ID ?? "default-1";

    this.actionEffectPipeline = new ActionEffectPipeline({
      broadcastAbilityUse: (playerNid, abilityId, x, y, z) => {
        const ability = this.resolveAbilityDefinitionById(abilityId);
        if (!ability) {
          return;
        }
        this.replication.broadcastAbilityUseMessage(playerNid, ability, x, y, z);
        this.events.emit<AbilityUsedPayload>(GameEvent.ABILITY_USED, {
          ownerNid: playerNid,
          abilityId: ability.id,
          category: ability.category,
          serverTick: this.tickNumber,
          x,
          y,
          z
        });
      },
      restoreHealth: (userId, amount) => {
        const state = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
        if (!state) return false;
        return this.damageSystem.applyHealingByEid(state.eid, amount);
      },
      equipItemInstance: (userId, itemInstanceId) => this.itemInventorySystem?.applyEquipEffectByUserId(userId, itemInstanceId) ?? false,
      unequipSlot: (userId, slot) => this.itemInventorySystem?.applyUnequipEffectByUserId(userId, slot) ?? false,
      consumeItemQuantity: (userId, itemInstanceId, amount) =>
        this.itemInventorySystem?.applyConsumeItemEffectByUserId(userId, itemInstanceId, amount) ?? false,
      pickupWorldItem: (userId, pickupNid) =>
        this.itemInventorySystem?.applyPickupWorldItemEffectByUserId(userId, pickupNid) ?? false,
      dropItemInstance: (userId, itemInstanceId, quantity) =>
        this.itemInventorySystem?.applyDropItemEffectByUserId(userId, itemInstanceId, quantity) ?? false,
      assignHotbarSlot: (userId, itemInstanceId, targetSlot, payloadKind) =>
        this.itemInventorySystem?.applyAssignHotbarSlotEffectByUserId(userId, itemInstanceId, targetSlot, payloadKind) ?? false,
      clearHotbarSlot: (userId, sourceSlot) =>
        this.itemInventorySystem?.applyClearHotbarSlotEffectByUserId(userId, sourceSlot) ?? false,
      moveHotbarSlot: (userId, sourceSlot, targetSlot) =>
        this.itemInventorySystem?.applyMoveHotbarSlotEffectByUserId(userId, sourceSlot, targetSlot) ?? false,
      dropHotbarSlot: (userId, sourceSlot) =>
        this.itemInventorySystem?.applyDropHotbarSlotEffectByUserId(userId, sourceSlot) ?? false,
      setPlayerRenderAppearance: (userId, patch) => {
        const playerState = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
        if (!playerState) {
          return false;
        }
        return this.applyRuntimeAppearancePatchByEid(playerState.eid, patch);
      },
      setEquippedSlotTint: (userId, slot, tintColorRgb) => this.applyEquippedSlotTintForUser(userId, slot, tintColorRgb),
      pilotReferenceFrameBegin: (userId, framePid, volumeId) => {
        const seatOwner = this.pilotUserIdByReferenceFramePid.get(framePid);
        if (typeof seatOwner === "number" && seatOwner !== userId) {
          return false;
        }
        const previous = this.pilotedReferenceFrameByUserId.get(userId);
        if (previous && previous.framePid !== framePid) {
          this.pilotUserIdByReferenceFramePid.delete(previous.framePid);
        }
        this.pilotedReferenceFrameByUserId.set(userId, { framePid, volumeId });
        this.pilotUserIdByReferenceFramePid.set(framePid, userId);
        const pilotEid = this.simulationEcs.getPlayerEidByUserId(userId);
        if (typeof pilotEid === "number") {
          const pc = this.simulationEcs.world.components;
          pc.Velocity.x[pilotEid] = 0;
          pc.Velocity.y[pilotEid] = 0;
          pc.Velocity.z[pilotEid] = 0;
          pc.PrimaryHeld.value[pilotEid] = 0;
          pc.SecondaryHeld.value[pilotEid] = 0;
        }
        return true;
      },
      pilotReferenceFrameEnd: (userId, framePid) => {
        const current = this.pilotedReferenceFrameByUserId.get(userId);
        if (!current || current.framePid !== framePid) {
          return false;
        }
        this.pilotedReferenceFrameByUserId.delete(userId);
        const seatOwner = this.pilotUserIdByReferenceFramePid.get(framePid);
        if (seatOwner === userId) {
          this.pilotUserIdByReferenceFramePid.delete(framePid);
        }
        return true;
      },
      onReferenceFrameVolumeEntered: (userId, framePid, volumeId) => {
        this.replication.queueReferenceFrameVolumeEntered(userId, framePid, volumeId);
      },
      onReferenceFrameVolumeExited: (userId, framePid, volumeId) => {
        this.replication.queueReferenceFrameVolumeExited(userId, framePid, volumeId);
      },
      onEffectEvaluated: (record) => {
        if (!record.success) {
          return;
        }
        this.effectAuditSuccessCountByType.set(
          record.type,
          (this.effectAuditSuccessCountByType.get(record.type) ?? 0) + 1
        );
      }
    });

    // ── Item inventory ────────────────────────────────────────────────────
    this.itemInventorySystem = new ItemInventorySystem<UserLike>({
      world: this.world,
      ecs: this.simulationEcs,
      mapInstanceId,
      replication: this.replication,
      persistence: this.persistence,
      getUserById: (userId) => this.usersById.get(userId),
      publishInventoryUiView: (userId, snapshot) => {
        const user = this.usersById.get(userId);
        if (!user) {
          return;
        }
        this.uiViewRuntime.publish(user, "inventory", this.buildInventoryUiViewPayload(snapshot));
      },
      markPlayerCharacterDirty: (accountId) => this.persistenceSyncSystem.markAccountDirty(accountId, { dirtyCharacter: true, dirtyAbilityState: false }),
      persistInventoryMutation: (accountId, snapshot, action, eventId, eventAtMs) => {
        if (!this.ipcChannel?.isAvailable()) {
          this.persistence.saveInventoryState(accountId, snapshot);
          this.persistence.saveCriticalEvent({
            eventId,
            instanceId: mapInstanceId,
            accountId,
            eventType: "inventory_mutation",
            eventPayloadJson: JSON.stringify({
              action,
              itemCount: snapshot.itemInstances.length,
              equipmentSlots: Object.keys(snapshot.equipment)
            }),
            eventAtMs
          });
          return;
        }
        void this.ipcChannel
          .request("PersistInventoryMutation", {
            accountId,
            instanceId: mapInstanceId,
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
      },
      loadPersistentPickups: (instanceId) => {
        if (!this.ipcChannel?.isAvailable()) {
          return this.persistence.loadPersistentPickups(instanceId);
        }
        return this.ipcChannel
          .request("LoadPersistentPickups", {
            instanceId
          })
          .then((response) => {
            if (!response.ok) {
              throw new Error(response.error ?? "LoadPersistentPickups rejected.");
            }
            return Array.isArray(response.pickups) ? response.pickups : [];
          })
          .catch((error) => {
            console.error("[server] load persistent pickups failed", error);
            return [];
          });
      },
      savePersistentPickups: (instanceId, pickups) => {
        if (!this.ipcChannel?.isAvailable()) {
          this.persistence.savePersistentPickups(instanceId, pickups);
          return;
        }
        void this.ipcChannel
          .request("PersistPersistentPickups", {
            instanceId,
            pickups: pickups.map((pickup) => ({
              pickupId: pickup.pickupId,
              definitionId: pickup.definitionId,
              modelId: pickup.modelId,
              quantity: pickup.quantity,
              persistencePolicy: pickup.persistencePolicy,
              x: pickup.x,
              y: pickup.y,
              z: pickup.z,
              rotation: {
                x: pickup.rotation.x,
                y: pickup.rotation.y,
                z: pickup.rotation.z,
                w: pickup.rotation.w
              }
            }))
          })
          .then((response) => {
            if (!response.ok) {
              throw new Error(response.error ?? "PersistPersistentPickups rejected.");
            }
          })
          .catch((error) => {
            console.error("[server] persist persistent pickups failed", error);
          });
      },
      executeHotbarAbility: (userId, abilityId) => {
        const eid = this.simulationEcs.getPlayerEidByUserId(userId);
        if (typeof eid !== "number") {
          return false;
        }
        return this.abilityExecutionSystem.tryUseKnownAbilityByIdByEid(eid, abilityId);
      },
      canAssignHotbarAbility: (userId, abilityId) => {
        const eid = this.simulationEcs.getPlayerEidByUserId(userId);
        if (typeof eid !== "number") {
          return false;
        }
        const unlocked = this.simulationEcs.world.components.UnlockedAbilityIds.value[eid] ?? [];
        return this.getAbilityDefinitionForUnlockedList(unlocked, abilityId) !== null;
      },
      applyEntityRenderAppearanceByEid: (eid, patch) => {
        return this.applyRuntimeAppearancePatchByEid(eid, patch);
      },
      resolveStationSessionPolicyContext: (sessionId) => {
        const station = this.locationRootSystem.getStationBySessionId(sessionId);
        if (!station) {
          return null;
        }
        return {
          inventorySourcePolicy: station.inventorySourcePolicy,
          consumeOrderPolicy: station.consumeOrderPolicy,
          tierMaxOverride: station.tierMaxOverride,
          actorRequirementPolicy: station.actorRequirementPolicy
        };
      },
      isUserWithinStationSession: (userId, sessionId, slack) => {
        const playerState = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
        if (!playerState) {
          return false;
        }
        return this.locationRootSystem.isPointWithinStationSession(
          { x: playerState.x, y: playerState.y, z: playerState.z },
          sessionId,
          slack
        );
      },
      resolveActorRequirementValue: (userId, key) => {
        const runtime = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
        if (!runtime) {
          return null;
        }
        const capabilities = this.ensureActorCapabilitiesLoaded(runtime.accountId);
        const normalizedKey = typeof key === "string" ? key.trim() : "";
        if (normalizedKey.length > 0) {
          const direct = capabilities[normalizedKey];
          if (Number.isFinite(direct)) {
            return direct ?? null;
          }
          if (normalizedKey.startsWith("cap:")) {
            const capabilityKey = normalizedKey.slice(4);
            const capabilityValue = capabilities[capabilityKey];
            if (Number.isFinite(capabilityValue)) {
              return capabilityValue ?? null;
            }
          }
        }
        switch (normalizedKey) {
          case "health":
            return runtime.health;
          case "max_health":
          case "maxHealth":
            return runtime.maxHealth;
          case "movement_speed":
            return Math.hypot(runtime.vx, runtime.vz);
          default:
            return null;
        }
      },
      canInstantiateRestrictedBlueprint: (userId, blueprintId) => {
        const accountId = this.simulationEcs.getPlayerAccountIdByUserId(userId);
        if (accountId === null || blueprintId <= 0) {
          return false;
        }
        return this.hasActorCapabilityAtLeast(accountId, "blueprint.instantiate.restricted", 1);
      },
      actionEffects: this.actionEffectPipeline,
      onItemEquipped: (userId, itemInstanceId, slot) => {
        this.refreshEquippedVisualAppearanceForUser(userId);
        this.events.emit<ItemEquippedPayload>(GameEvent.ITEM_EQUIPPED, {
          userId,
          itemInstanceId,
          slot
        });
      },
      onItemUnequipped: (userId, itemInstanceId, slot) => {
        this.refreshEquippedVisualAppearanceForUser(userId);
        this.events.emit<ItemUnequippedPayload>(GameEvent.ITEM_UNEQUIPPED, {
          userId,
          itemInstanceId,
          slot
        });
      }
    });

    // ── Damage ────────────────────────────────────────────────────────────
    this.damageSystem = new DamageSystem({
      markCharacterDirtyByAccountId: (accountId, options) => this.persistenceSyncSystem.markAccountDirty(accountId, options),
      getDamageableStateByEid: (eid) => this.simulationEcs.getDamageableStateByEid(eid),
      applyDamageableStateByEid: (eid, state) => this.simulationEcs.applyDamageableStateByEid(eid, state),
      onZeroHealth: (eid, accountId) => this.deathLifecycleSystem.handleZeroHealth({ eid, accountId }),
      events: this.events
    });

    this.deathLifecycleSystem = new DeathLifecycleSystem({
      resolvePolicyByEid: (eid): DeathPolicyId => {
        if (this.simulationEcs.isPlayerEntity(eid)) return "player_respawn_immediate";
        if (this.simulationEcs.isNpcEntity(eid)) return "npc_respawn_delay";
        return "reset_health";
      },
      handlePlayerRespawnImmediate: (eid, context) => {
        const character = this.simulationEcs.getCharacterDamageStateByEid(eid);
        if (!character) {
          return;
        }
        const spawn = this.getSpawnPosition();
        const spawnBodyY = this.getSpawnBodyY(spawn.x, spawn.z);
        character.body.setTranslation({ x: spawn.x, y: spawnBodyY, z: spawn.z }, true);
        character.vx = 0;
        character.vy = 0;
        character.vz = 0;
        character.grounded = true;
        character.movementMode = MOVEMENT_MODE_GROUNDED;
        character.groundedPlatformPid = null;
        character.carriedFramePid = null;
        character.health = this.archetypes.player.maxHealth;
        character.maxHealth = this.archetypes.player.maxHealth;
        character.x = spawn.x;
        character.y = spawnBodyY + PLAYER_CAMERA_OFFSET_Y;
        character.z = spawn.z;
        this.simulationEcs.applyCharacterDamageStateByEid(eid, character);
        this.resetCombatExecutionStateByEid(eid);
        if (context.accountId > 0) {
          this.persistenceSyncSystem.markAccountDirty(context.accountId, {
            dirtyCharacter: true,
            dirtyAbilityState: false
          });
        }
      },
      handleNpcRespawnDelay: (eid, _context, delaySeconds) => {
        this.resetCombatExecutionStateByEid(eid);
        const queued = this.npcAiSystem.queueRespawnForNpcEid(eid, this.elapsedSeconds, delaySeconds);
        if (!queued) {
          this.deathLifecycleSystem.completeDelayedPolicyByEid(eid);
        }
      },
      handleResetHealth: (eid) => {
        this.damageSystem.restoreHealthToMaxByEid(eid);
        this.resetCombatExecutionStateByEid(eid);
      },
      npcRespawnDelaySeconds: 30,
      onPolicyStarted: (context, policyId) => {
        this.events.emit<DeathPolicyStartedPayload>(GameEvent.DEATH_POLICY_STARTED, {
          eid: context.eid,
          accountId: context.accountId,
          policyId
        });
      },
      onPolicyCompleted: (context, policyId) => {
        this.events.emit<DeathPolicyCompletedPayload>(GameEvent.DEATH_POLICY_COMPLETED, {
          eid: context.eid,
          accountId: context.accountId,
          policyId
        });
      }
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
      spiralFrequencyScale: this.resolveClampedEnvNumber("PROJECTILE_SPIRAL_FREQUENCY_SCALE", 0.1, 0, 10),
      getOwnerColliderByEid: (ownerEid) => this.simulationEcs.resolveCombatTargetRuntimeByEid(ownerEid)?.collider,
      resolveTargetEidByColliderHandle: (h) => this.damageSystem.resolveTargetEidByColliderHandle(h),
      shouldProjectileHitTarget: (ownerEid, targetEid, projectileEid) => {
        const c = this.simulationEcs.world.components;
        const allowSelf = (c.ProjectileTargetAllowSelf.value[projectileEid] ?? 0) !== 0;
        const allowPlayers = (c.ProjectileTargetAllowPlayers.value[projectileEid] ?? 0) !== 0;
        const allowNpcs = (c.ProjectileTargetAllowNpcs.value[projectileEid] ?? 0) !== 0;
        const allowDummies = (c.ProjectileTargetAllowDummies.value[projectileEid] ?? 0) !== 0;
        if (!allowSelf && typeof ownerEid === "number" && ownerEid === targetEid) {
          return false;
        }
        if (this.simulationEcs.isDummyEntity(targetEid)) {
          return allowDummies;
        }
        if (this.simulationEcs.isNpcEntity(targetEid)) {
          return allowNpcs;
        }
        if (this.simulationEcs.isPlayerEntity(targetEid)) {
          return allowPlayers;
        }
        // Unknown classified targets are still valid damageables if they reached this path.
        return true;
      },
      applyDamage: (sourceEid, targetEid, damage) => this.damageSystem.applyProjectileDamageByEid(targetEid, damage, sourceEid ?? null),
      despawnProjectile: (eid) => { this.replication.despawnEntity(eid); this.simulationEcs.destroyEid(eid); }
    });

    // ── Melee ─────────────────────────────────────────────────────────────
    this.meleeCombatSystem = new MeleeCombatSystem({
      world: this.world,
      forEachTarget: (visitor) => this.damageSystem.forEachTarget(visitor),
      resolveTargetRuntime: (targetEid) => this.simulationEcs.resolveCombatTargetRuntimeByEid(targetEid),
      resolveAttackerCollisionRadius: (attacker) => {
        const runtimeBounds = this.simulationEcs.resolveCombatCollisionBoundsByEid(attacker.eid);
        if (runtimeBounds) {
          return runtimeBounds.radius;
        }
        if (this.simulationEcs.isDummyEntity(attacker.eid)) {
          return this.archetypes.trainingDummy.capsuleRadius;
        }
        return PLAYER_CAPSULE_RADIUS;
      },
      resolveTargetCollisionBounds: (targetEid) => {
        const runtimeBounds = this.simulationEcs.resolveCombatCollisionBoundsByEid(targetEid);
        if (runtimeBounds) {
          return runtimeBounds;
        }
        if (this.simulationEcs.isDummyEntity(targetEid)) {
          return {
            radius: this.archetypes.trainingDummy.capsuleRadius,
            halfHeight: this.archetypes.trainingDummy.capsuleHalfHeight
          };
        }
        return {
          radius: PLAYER_CAPSULE_RADIUS,
          halfHeight: PLAYER_CAPSULE_HALF_HEIGHT
        };
      },
      shouldMeleeHitTarget: (attacker, targetEid, meleeProfile) => {
        const policy = meleeProfile.targetPolicy;
        const allowSelf = policy?.allowSelf === true;
        const allowPlayers = policy?.allowPlayers !== false;
        const allowNpcs = policy?.allowNpcs !== false;
        const allowDummies = policy?.allowDummies !== false;
        if (!allowSelf && attacker.eid === targetEid) {
          return false;
        }
        if (this.simulationEcs.isDummyEntity(targetEid)) {
          return allowDummies;
        }
        if (this.simulationEcs.isNpcEntity(targetEid)) {
          return allowNpcs;
        }
        if (this.simulationEcs.isPlayerEntity(targetEid)) {
          return allowPlayers;
        }
        // Unknown classified targets are still valid damageables if they reached this path.
        return true;
      },
      applyDamage: (attacker, targetEid, damage) => this.damageSystem.applyMeleeDamageByEid(targetEid, damage, attacker.eid)
    });

    this.attackRuntimeSystem = new AttackRuntimeSystem({
      worldSeed: this.resolveCombatWorldSeed(mapInstanceId),
      resolveCanonicalAttackerEid: (attackerEid) =>
        this.simulationEcs.resolveCombatOwnerIdentityByEid(attackerEid)?.eid ?? null,
      executeProjectile: (request) => this.spawnProjectile(request),
      executeMeleeHit: (request) => {
        const attackerIdentity = this.simulationEcs.resolveCombatOwnerIdentityByEid(request.attackerEid);
        if (!attackerIdentity) {
          return;
        }
        const attackerRuntime = this.simulationEcs.resolveCombatTargetRuntimeByEid(attackerIdentity.eid);
        if (!attackerRuntime) {
          return;
        }
        this.meleeCombatSystem.tryApplyMeleeHit(
          {
            eid: attackerIdentity.eid,
            yaw: c.Yaw.value[attackerIdentity.eid] ?? 0,
            pitch: c.Pitch.value[attackerIdentity.eid] ?? 0,
            body: attackerRuntime.body,
            collider: attackerRuntime.collider
          },
          {
            damage: request.damage,
            range: request.range,
            radius: request.radius,
            cooldownSeconds: 0,
            arcDegrees: request.arcDegrees
          }
        );
      }
    });

    // ── Abilities ─────────────────────────────────────────────────────────
    this.abilityExecutionSystem = new AbilityExecutionSystem({
      getElapsedSeconds: () => this.elapsedSeconds,
      getServerTick: () => this.tickNumber,
      resolveAbilityById: (unlockedAbilityIds, abilityId) => this.getAbilityDefinitionForUnlockedList(unlockedAbilityIds, abilityId),
      resolveKnownAbilityById: (abilityId) => this.resolveAbilityDefinitionById(abilityId),
      resolveAbilityActivationSpec: (abilityId) =>
        getBlueprintRuntimeActivationSpecsByBlueprintId(abilityId).find((entry) => entry.source === "ability") ?? null,
      resolveUserIdByEid: (eid) => this.simulationEcs.getPlayerUserIdByEid(eid) ?? null,
      ecsComponents: c,
      effectPipeline: this.actionEffectPipeline,
      attackRuntime: this.attackRuntimeSystem
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
          worldAnchorId: location.pid,
          worldAnchorKind: location.locationKind, worldAnchorArchetypeId: location.locationArchetypeId,
          worldAnchorSeed: location.locationSeed, worldAnchorEnvironmentId: location.locationEnvironmentId,
          worldAnchorStreamingRadius: location.locationStreamingRadius, worldAnchorInfluenceRadius: location.locationInfluenceRadius
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
      this.syncCarrierMembershipMessagesForPlayer(payload.userId, payload.eid);
    });

    this.events.on<PlayerSpawnedPayload>(GameEvent.PLAYER_SPAWNED, (payload) => {
      this.referenceFrameMembershipByUserId.set(payload.userId, new Set<string>());
      this.syncCarrierMembershipMessagesForPlayer(payload.userId, payload.eid);
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

    this.events.on<DamagePacketAppliedPayload>(GameEvent.DAMAGE_PACKET_APPLIED, (payload) => {
      const targetAccountId = this.simulationEcs.world.components.AccountId.value[payload.targetEid];
      if (typeof targetAccountId === "number" && targetAccountId > 0) {
        this.persistenceSyncSystem.markAccountDirty(targetAccountId, {
          dirtyCharacter: true,
          dirtyAbilityState: false
        });
      }
    });

    this.events.on<HealthChangedPayload>(GameEvent.HEALTH_CHANGED, (payload) => {
      const accountId = this.simulationEcs.world.components.AccountId.value[payload.eid];
      if (typeof accountId === "number" && accountId > 0) {
        this.persistenceSyncSystem.markAccountDirty(accountId, { dirtyCharacter: true, dirtyAbilityState: false });
      }
    });

    this.events.on<DeathPolicyStartedPayload>(GameEvent.DEATH_POLICY_STARTED, (payload) => {
      if (payload.policyId === "player_respawn_immediate") {
        const userId = this.simulationEcs.getPlayerUserIdByEid(payload.eid);
        if (typeof userId === "number") {
          this.queueServerAlertForUser(userId, "You died.", "warning");
        }
      }
    });

    this.events.on<DeathPolicyCompletedPayload>(GameEvent.DEATH_POLICY_COMPLETED, (payload) => {
      if (payload.policyId === "player_respawn_immediate") {
        const userId = this.simulationEcs.getPlayerUserIdByEid(payload.eid);
        if (typeof userId === "number") {
          this.queueServerAlertForUser(userId, "Respawned.", "info");
        }
      }
    });

    // ── Status effects ────────────────────────────────────────────────────
    this.statusEffects = new StatusEffectSystem(
      this.events,
      (targetEid, damage, sourceEid) => this.damageSystem.applyStatusDamageByEid(targetEid, damage, sourceEid),
      (targetEid, heal) => this.damageSystem.applyHealingByEid(targetEid, heal)
    );
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
        this.resetCombatExecutionStateByEid(eid);
        this.controllerSystem.attachAiController(eid);
        this.damageSystem.registerCollider(colliderHandle, eid);
      },
      hasPerceptionTargets: () => this.aiPerceptionTargetByColliderHandle.size > 0,
      resolvePerceptionTargetByColliderHandle: (h) => this.aiPerceptionTargetByColliderHandle.get(h) ?? null,
      usePrimaryAbilityByEid: (eid) => this.abilityExecutionSystem.tryUsePrimaryMouseAbilityByEid(eid),
      applyEntityAppearanceByEid: (eid, patch) =>
        this.appearanceSystem.applyAppearancePatch(eid, "npc_behavior", patch),
      onNpcRespawned: (eid) => {
        this.resetCombatExecutionStateByEid(eid);
        this.deathLifecycleSystem.completeDelayedPolicyByEid(eid);
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
      resolveDummyEid: (dummy) => this.dummyEidByObject.get(dummy) ?? -1,
      registerDummyCollider: (ch, eid) => this.damageSystem.registerCollider(ch, eid)
    });
    this.locationRootSystem.initializeLocations();
    this.itemInventorySystem.initializeWorldItems();
    this.npcAiSystem.initialize();
  }

  // ── User management ───────────────────────────────────────────────────────
  public addUser(user: UserLike): void { this.playerLifecycleSystem.addUser(user); }
  public removeUser(user: UserLike): void {
    this.referenceFrameMembershipByUserId.delete(user.id);
    this.pilotControlIntentByUserId.delete(user.id);
    this.releaseUserPilotSeat(user.id);
    this.uiViewRuntime.closeAllForUser(user);
    this.playerLifecycleSystem.removeUser(user);
  }

  // ── Command handlers ──────────────────────────────────────────────────────
  public applyInputCommands(userId: number, commands: Partial<InputWireCommand>[]): void {
    const eid = this.simulationEcs.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") return;
    if (this.isUserInPilotControlMode(userId)) {
      this.pilotControlIntentByUserId.set(userId, this.resolvePilotIntentFromCommands(commands));
      return;
    }
    this.inputSystem.applyCommands(eid, commands);
  }

  public applyAbilityCommand(user: UserLike, command: Partial<AbilityWireCommand>): void {
    if (typeof this.simulationEcs.getPlayerEidByUserId(user.id) !== "number") return;
    if (this.isUserInPilotControlMode(user.id)) {
      return;
    }
    this.applyForgetAbilityIntent(user, command);
    this.abilityCommandHandler.apply(user, command);
  }

  public applyUiIntentCommand(user: UserLike, command: UiIntentWireCommand): void {
    const viewId = typeof command.viewId === "number" && Number.isFinite(command.viewId)
      ? Math.max(0, Math.min(0xffff, Math.floor(command.viewId)))
      : 0;
    const sequence = typeof command.sequence === "number" && Number.isFinite(command.sequence)
      ? Math.max(0, Math.min(0xffff, Math.floor(command.sequence)))
      : 0;
    if (viewId <= 0) {
      user.queueMessage({
        ntype: NType.UiIntentResultMessage,
        viewId,
        sequence,
        ok: false,
        message: "UI intent rejected: invalid view id.",
        resultJson: "{}"
      });
      return;
    }
    const viewType = this.uiViewRuntime.resolveViewTypeByUserAndId(user.id, viewId);
    if (!viewType) {
      user.queueMessage({
        ntype: NType.UiIntentResultMessage,
        viewId,
        sequence,
        ok: false,
        message: `UI intent rejected: unknown view ${viewId}.`,
        resultJson: "{}"
      });
      return;
    }
    let parsedIntent: unknown = null;
    try {
      parsedIntent = JSON.parse(command.intentJson);
    } catch {
      user.queueMessage({
        ntype: NType.UiIntentResultMessage,
        viewId,
        sequence,
        ok: false,
        message: "UI intent rejected: malformed intent json.",
        resultJson: "{}"
      });
      return;
    }
    if (!parsedIntent || typeof parsedIntent !== "object") {
      user.queueMessage({
        ntype: NType.UiIntentResultMessage,
        viewId,
        sequence,
        ok: false,
        message: "UI intent rejected: invalid payload.",
        resultJson: "{}"
      });
      return;
    }
    const intent = parsedIntent as { kind?: unknown; commandJson?: unknown; command?: unknown };
    if (viewType === "creator") {
      if (intent.kind !== "creator_payload" || typeof intent.commandJson !== "string") {
        user.queueMessage({
          ntype: NType.UiIntentResultMessage,
          viewId,
          sequence,
          ok: false,
          message: "UI intent rejected: invalid creator payload.",
          resultJson: "{}"
        });
        return;
      }
      const payload = decodeCreatorCommandPayloadJson(intent.commandJson, MAX_CREATOR_COMMAND_JSON_BYTES);
      if (!payload) {
        user.queueMessage({
          ntype: NType.UiIntentResultMessage,
          viewId,
          sequence,
          ok: false,
          message: "UI intent rejected: creator payload decode failed.",
          resultJson: "{}"
        });
        return;
      }
      const normalized = normalizeCreatorCommandFromPayload(payload);
      this.applyCreatorCommand(user, normalized);
      user.queueMessage({
        ntype: NType.UiIntentResultMessage,
        viewId,
        sequence,
        ok: true,
        message: "",
        resultJson: "{}"
      });
      return;
    }
    if (viewType === "inventory") {
      if (intent.kind !== "inventory_command" || !intent.command || typeof intent.command !== "object") {
        user.queueMessage({
          ntype: NType.UiIntentResultMessage,
          viewId,
          sequence,
          ok: false,
          message: "UI intent rejected: invalid inventory command payload.",
          resultJson: "{}"
        });
        return;
      }
      const result = this.applyItemCommand(user, intent.command as InventoryWireCommand);
      user.queueMessage({
        ntype: NType.UiIntentResultMessage,
        viewId,
        sequence,
        ok: result.ok,
        message: result.ok ? "" : result.reason,
        resultJson: JSON.stringify({
          action: result.action,
          reason: result.reason
        })
      });
      return;
    }
    if (viewType === "world_interaction") {
      const activateIntent = this.parseWorldInteractionActivateIntent(intent);
      if (!activateIntent) {
        user.queueMessage({
          ntype: NType.UiIntentResultMessage,
          viewId,
          sequence,
          ok: false,
          message: "UI intent rejected: invalid interaction activate payload.",
          resultJson: "{}"
        });
        return;
      }
      const result = this.executeWorldInteractionIntent(user.id, activateIntent);
      user.queueMessage({
        ntype: NType.UiIntentResultMessage,
        viewId,
        sequence,
        ok: result.ok,
        message: result.ok ? "" : result.reason,
        resultJson: JSON.stringify({
          targetId: activateIntent.targetId,
          actionId: activateIntent.actionId,
          slot: activateIntent.slot,
          reason: result.reason
        })
      });
      return;
    }
    user.queueMessage({
      ntype: NType.UiIntentResultMessage,
      viewId,
      sequence,
      ok: false,
      message: `UI intent rejected: unsupported view type "${viewType}".`,
      resultJson: "{}"
    });
  }

  public applyCreatorCommand(user: UserLike, command: {
    sessionId: number; sequence: number; setName?: boolean; name?: string;
    selectBaseBlueprint?: boolean; baseBlueprintId?: number;
    stepField?: boolean; fieldId?: string; fieldDelta?: number;
    setField?: boolean; fieldValueJson?: string;
    submitCreate?: boolean;
    instantiateCreatedBlueprint?: boolean;
    forkItemInstanceBlueprint?: boolean;
    itemInstanceId?: number;
    inspectActorCapabilities?: boolean;
    setActorCapability?: boolean;
    capabilityKey?: string;
    capabilityValue?: number;
  }): void {
    const accountId = this.simulationEcs.getPlayerAccountIdByUserId(user.id);
    if (accountId === null) return;
    if (command.instantiateCreatedBlueprint && !command.submitCreate) {
      const message = "Creation blocked: instantiate requires submit_create in the same command.";
      this.queueCreatorActionResultForUser(user, false, message);
      return;
    }
    if ((command.submitCreate || command.instantiateCreatedBlueprint) && !this.hasActorCapabilityAtLeast(accountId, "creator.author", 1)) {
      const message = "Creation blocked: missing creator.author permission.";
      this.queueCreatorActionResultForUser(user, false, message);
      return;
    }
    if (command.inspectActorCapabilities) {
      this.applyInspectActorCapabilities(user.id, accountId);
      return;
    }
    if (command.setActorCapability) {
      this.applySetActorCapability(user.id, accountId, command.capabilityKey, command.capabilityValue);
      return;
    }
    if (command.forkItemInstanceBlueprint) {
      if (!this.hasActorCapabilityAtLeast(accountId, "creator.clone", 1)) {
        const message = "Blueprint fork blocked: missing creator.clone permission.";
        this.queueCreatorActionResultForUser(user, false, message);
        return;
      }
      this.applyForkBlueprintFromItemInstance(user, accountId, command.itemInstanceId, command.name);
      return;
    }
    const abilityState = this.simulationEcs.getPlayerAbilityStateByUserId(user.id);
    const availableTemplateBlueprintIds = this.ensureBlueprintAccessLoaded(
      accountId,
      "blueprint.template",
      abilityState?.unlockedAbilityIds ?? DEFAULT_UNLOCKED_ABILITY_IDS
    );
    const currentSession = this.creatorSystem.synchronizeSessionAvailability(user.id);
    const activeStationSessionId = this.creatorSystem.getSessionStationSessionId(user.id);
    const stationPolicy = activeStationSessionId
      ? this.locationRootSystem.getStationBySessionId(activeStationSessionId)
      : null;
    const creatorPolicy =
      currentSession?.profileId === "item_creator" && stationPolicy
        ? {
            tierMaxOverride: stationPolicy.tierMaxOverride,
            actorRequirementPolicy: stationPolicy.actorRequirementPolicy
          }
        : null;
    const result = this.creatorSystem.applyCommand({
      userId: user.id,
      accountId,
      availableTemplateBlueprintIds,
      creatorPolicy,
      deferCreatedBlueprintRegistration: Boolean(command.instantiateCreatedBlueprint),
      command
    });
    let creatorSnapshotToReplicate = result.snapshot;

    if (result.createdBlueprint) {
      const createdAbility = buildAbilityDefinitionFromBlueprint(result.createdBlueprint);
      const createdItem = buildItemDefinitionFromBlueprint(result.createdBlueprint);
      if (command.instantiateCreatedBlueprint && !createdItem) {
        const failureMessage = this.formatCreatorInstantiationFailureReason("blueprint_not_item");
        this.creatorSystem.overrideSessionStatus(user.id, failureMessage);
        this.queueCreatorActionResultForUser(user, false, failureMessage, result.createdBlueprint.id, 0);
        const failedCreatorState = this.creatorSystem.synchronizeSessionAvailability(user.id);
        if (failedCreatorState) {
          creatorSnapshotToReplicate = failedCreatorState;
        }
        this.publishCreatorStateForUser(user, creatorSnapshotToReplicate);
        return;
      }
      if (command.instantiateCreatedBlueprint && createdItem) {
        const preflightResult = this.itemInventorySystem.canInstantiateBlueprintItemForUser(
          user.id,
          result.createdBlueprint,
          activeStationSessionId
        );
        if (!preflightResult.ok) {
          const failureMessage = this.formatCreatorInstantiationFailureReason(preflightResult.reason);
          this.creatorSystem.overrideSessionStatus(user.id, failureMessage);
          this.queueCreatorActionResultForUser(user, false, failureMessage, result.createdBlueprint.id, 0);
          const failedCreatorState = this.creatorSystem.synchronizeSessionAvailability(user.id);
          if (failedCreatorState) {
            creatorSnapshotToReplicate = failedCreatorState;
          }
          this.publishCreatorStateForUser(user, creatorSnapshotToReplicate);
          return;
        }
      }
      const createdActivations: RuntimeActivationSpec[] = [];
      if (createdAbility?.projectile) {
        createdActivations.push({
          activationId: `ability:${createdAbility.id}:primary`,
          source: "ability",
          channel: 0,
          cooldownSeconds: Math.max(0, createdAbility.projectile.cooldownSeconds),
          consumeQuantity: 0,
          effects: [{ type: "spawn_projectile", projectile: createdAbility.projectile }]
        });
      } else if (createdAbility?.melee) {
        createdActivations.push({
          activationId: `ability:${createdAbility.id}:primary`,
          source: "ability",
          channel: 0,
          cooldownSeconds: Math.max(0, createdAbility.melee.cooldownSeconds),
          consumeQuantity: 0,
          effects: [{ type: "apply_melee_hit", melee: createdAbility.melee }]
        });
      }
      const runtimeCapabilityEntry = {
        blueprintId: result.createdBlueprint.id,
        ability: createdAbility,
        item: createdItem,
        platform: null,
        activations: createdActivations
      };
      const persistedBlueprint = this.withBlueprintProvenance(result.createdBlueprint, accountId, user.id);
      runtimeCapabilityEntry.blueprintId = persistedBlueprint.id;
      upsertBlueprintRuntimeCapabilityEntry(runtimeCapabilityEntry);
      if (command.instantiateCreatedBlueprint && createdItem) {
        const instantiateResult = this.itemInventorySystem.instantiateBlueprintItemForUser(
          user.id,
          persistedBlueprint,
          activeStationSessionId
        );
        if (!instantiateResult.ok) {
          const failureMessage = this.formatCreatorInstantiationFailureReason(instantiateResult.reason);
          this.creatorSystem.overrideSessionStatus(user.id, failureMessage);
          this.queueCreatorActionResultForUser(user, false, failureMessage, persistedBlueprint.id, 0);
          const failedCreatorState = this.creatorSystem.synchronizeSessionAvailability(user.id);
          if (failedCreatorState) {
            creatorSnapshotToReplicate = failedCreatorState;
          }
          this.publishCreatorStateForUser(user, creatorSnapshotToReplicate);
          return;
        }
        this.creatorSystem.overrideSessionStatus(
          user.id,
          `Created and instantiated "${persistedBlueprint.name}".`
        );
        this.queueCreatorActionResultForUser(
          user,
          true,
          `Created and instantiated "${persistedBlueprint.name}".`,
          persistedBlueprint.id,
          instantiateResult.createdItemInstanceId ?? 0
        );
      }
      const grantedAccessTags = this.resolveGrantedAccessTagsForAuthoring(
        accountId,
        creatorProfileIdToGrantedAccessTags(result.snapshot.profileId)
      );
      const globalGrantedAccessTags = this.resolveGlobalGrantedAccessTagsForAuthoring(accountId, grantedAccessTags);
      this.persistence.saveBlueprintAndGrantAccess({
        blueprint: persistedBlueprint,
        runtimeCapability: runtimeCapabilityEntry,
        createdByAccountId: accountId,
        grantAccessTags: grantedAccessTags,
        globalGrantAccessTags: globalGrantedAccessTags
      });
      for (const accessTag of grantedAccessTags) {
        this.creatorSystem.grantBlueprintAccess(accountId, accessTag, result.createdBlueprint.id);
      }
      if (!grantedAccessTags.includes("blueprint.template")) {
        this.queueServerAlertForUser(
          user.id,
          "Blueprint created but not published to template catalog (missing creator.publish.template permission).",
          "warning"
        );
      }
      if (!command.instantiateCreatedBlueprint) {
        this.queueCreatorActionResultForUser(
          user,
          true,
          `Created blueprint "${persistedBlueprint.name}".`,
          persistedBlueprint.id,
          0
        );
      }
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
        creatorSnapshotToReplicate = nextCreatorState;
      }
    }
    this.publishCreatorStateForUser(user, creatorSnapshotToReplicate);
  }

  private applyForkBlueprintFromItemInstance(
    user: UserLike,
    accountId: number,
    rawItemInstanceId: number | undefined,
    rawName: string | undefined
  ): void {
    const reportFailure = (message: string): void => {
      this.creatorSystem.overrideSessionStatus(user.id, message);
      const failedState = this.creatorSystem.synchronizeSessionAvailability(user.id);
      if (failedState) {
        this.publishCreatorStateForUser(user, failedState);
      }
      this.queueCreatorActionResultForUser(user, false, message);
    };
    const itemInstanceId = typeof rawItemInstanceId === "number" ? Math.max(0, Math.floor(rawItemInstanceId)) : 0;
    if (itemInstanceId <= 0) {
      reportFailure("Blueprint fork failed: invalid item instance.");
      return;
    }
    const inventoryItem = this.itemInventorySystem.getInventoryItemInstanceForUser(user.id, itemInstanceId);
    if (!inventoryItem) {
      reportFailure("Blueprint fork failed: item not found in inventory.");
      return;
    }
    const sourceBlueprint = this.creatorSystem.resolveBlueprintDefinitionById(inventoryItem.definitionId);
    if (!sourceBlueprint) {
      reportFailure("Blueprint fork failed: source blueprint missing.");
      return;
    }
    const nextName = typeof rawName === "string" && rawName.trim().length > 0
      ? rawName.trim()
      : `${sourceBlueprint.name} Copy`;
    const derivedProfileId = this.resolveCreatorProfileForDerivedBlueprint(sourceBlueprint);
    const createdBlueprint = this.creatorSystem.createDerivedBlueprintFromExisting({
      sourceBlueprint,
      name: nextName,
      authoredViaProfile: derivedProfileId,
      derivedFromInstanceId: inventoryItem.itemInstanceId
    });
    const createdAbility = buildAbilityDefinitionFromBlueprint(createdBlueprint);
    const createdItem = buildItemDefinitionFromBlueprint(createdBlueprint);
    const runtimeCapabilityEntry = {
      blueprintId: createdBlueprint.id,
      ability: createdAbility,
      item: createdItem,
      platform: null,
      activations: this.cloneRuntimeActivationSpecs(getBlueprintRuntimeActivationSpecsByBlueprintId(sourceBlueprint.id))
    };
    const persistedBlueprint = this.withBlueprintProvenance(createdBlueprint, accountId, user.id);
    runtimeCapabilityEntry.blueprintId = persistedBlueprint.id;
    upsertBlueprintRuntimeCapabilityEntry(runtimeCapabilityEntry);
    const grantedAccessTags = this.resolveGrantedAccessTagsForAuthoring(
      accountId,
      creatorProfileIdToGrantedAccessTags(derivedProfileId)
    );
    const globalGrantedAccessTags = this.resolveGlobalGrantedAccessTagsForAuthoring(accountId, grantedAccessTags);
    this.persistence.saveBlueprintAndGrantAccess({
      blueprint: persistedBlueprint,
      runtimeCapability: runtimeCapabilityEntry,
      createdByAccountId: accountId,
      grantAccessTags: grantedAccessTags,
      globalGrantAccessTags: globalGrantedAccessTags
    });
    for (const accessTag of grantedAccessTags) {
      this.creatorSystem.grantBlueprintAccess(accountId, accessTag, createdBlueprint.id);
    }
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
    const snap = this.creatorSystem.synchronizeSessionAvailability(user.id);
    if (snap) {
      this.publishCreatorStateForUser(user, snap);
    }
    this.queueCreatorActionResultForUser(
      user,
      true,
      `Created blueprint "${createdBlueprint.name}" from item instance.`,
      persistedBlueprint.id,
      0
    );
  }

  public applyItemCommand(user: UserLike, command: InventoryWireCommand): { ok: boolean; action: number; reason: string } {
    if (typeof this.simulationEcs.getPlayerEidByUserId(user.id) !== "number") {
      return { ok: false, action: 0, reason: "player_missing" };
    }
    const action = typeof command.action === "number" ? Math.floor(command.action) : 0;
    return this.itemInventorySystem.applyCommand(user.id, command);
  }

  public applyPlayerSettingsCommand(user: UserLike, command: Partial<PlayerSettingsWireCommand>): void {
    if (typeof user.accountId !== "number" || typeof command.settingsJson !== "string") {
      return;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(command.settingsJson);
    } catch {
      return;
    }
    const settings = coercePlayerSettings(parsed);
    const accountId = Math.max(1, Math.floor(user.accountId));
    this.playerSettingsByAccountId.set(accountId, settings);
    user.queueMessage({
      ntype: NType.PlayerSettingsMessage,
      settingsJson: JSON.stringify(settings)
    });
    this.persistenceSyncSystem.markAccountDirty(accountId, {
      dirtyCharacter: false,
      dirtyAbilityState: false,
      dirtySettings: true
    });
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
      if (snap) this.publishCreatorStateForUser(user, snap);
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
    if (snap) this.publishCreatorStateForUser(user, snap);
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
    this.tickInteractionViewPhase();
    this.tickPortalTransferPhase();
    this.tickCombatPhase(delta);
    this.tickReplicationPhase();
    this.tickPhysicsFinalizePhase();
  }

  private tickInteractionViewPhase(): void {
    for (const user of this.usersById.values()) {
      const target = this.resolveBestInteractionTargetForUser(user.id)?.descriptor ?? null;
      const payload: WorldInteractionPromptViewState = {
        kind: "world_interaction",
        target
      };
      this.uiViewRuntime.publish(user, "world_interaction", payload as unknown as Record<string, unknown>);
    }
  }

  private resolveBestInteractionTargetForUser(userId: number): ResolvedInteractionTarget | null {
    const runtime = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
    if (!runtime) {
      return null;
    }
    const candidates: ResolvedInteractionTarget[] = [];
    const pickup = this.itemInventorySystem.findBestPickupInteractionForUser(userId);
    if (pickup && pickup.pickupNid > 0) {
      const actionId: WorldInteractionActionId = "pickup_collect";
      const targetId = `pickup:${pickup.pickupNid}`;
      candidates.push({
        targetId,
        actionId,
        targetType: "pickup",
        pickupNid: pickup.pickupNid,
        descriptor: {
          targetId,
          targetType: "pickup",
          label: `Pick up ${pickup.itemName}${pickup.itemQuantity > 1 ? ` x${pickup.itemQuantity}` : ""}`,
          distanceMeters: pickup.distanceMeters,
          priority: 200,
          actions: [{ id: actionId, slot: INTERACTION_SLOT_PRIMARY, label: "Pick Up", enabled: true, priority: 200 }]
        }
      });
    }
    const station = this.tryBeginNearbyStationSession(userId);
    if (station) {
      const templateIds = filterCreatorTemplateBlueprintIdsForStation(
        getBlueprintDefinitionsForProfile(station.creatorProfileId).map((blueprint) => blueprint.id),
        station.allowedTemplateBlueprintIds
      );
      const enabled = templateIds.length > 0;
      const actionId: WorldInteractionActionId = "station_open_creator";
      const targetId = `station:${station.sessionId}`;
      candidates.push({
        targetId,
        actionId,
        targetType: "station",
        stationSessionId: station.sessionId,
        descriptor: {
          targetId,
          targetType: "station",
          label: `Use ${station.creatorProfileId}`,
          distanceMeters: 0,
          priority: 300,
          actions: [{
            id: actionId,
            slot: INTERACTION_SLOT_PRIMARY,
            label: `Use ${station.creatorProfileId}`,
            enabled,
            disabledReason: enabled ? undefined : `No templates are configured for profile ${station.creatorProfileId}.`,
            priority: 300
          }]
        }
      });
    }
    const pilot = this.locationRootSystem.findNearbyPilotConsole({ x: runtime.x, y: runtime.y, z: runtime.z }, 4);
    if (pilot) {
      const actionId: WorldInteractionActionId = "pilot_console_toggle";
      const targetId = `pilot:${pilot.framePid}:${pilot.volumeId}`;
      const seatOwner = this.pilotUserIdByReferenceFramePid.get(pilot.framePid);
      const enabled = typeof seatOwner !== "number" || seatOwner === userId;
      candidates.push({
        targetId,
        actionId,
        targetType: "pilot_console",
        framePid: pilot.framePid,
        volumeId: pilot.volumeId,
        descriptor: {
          targetId,
          targetType: "pilot_console",
          label: "Pilot Console",
          distanceMeters: 0,
          priority: 250,
          actions: [{
            id: actionId,
            slot: INTERACTION_SLOT_PRIMARY,
            label: "Toggle Pilot Console",
            enabled,
            disabledReason: enabled ? undefined : "Pilot console is in use.",
            priority: 250
          }]
        }
      });
    }
    if (candidates.length <= 0) {
      return null;
    }
    candidates.sort((a, b) =>
      (b.descriptor.priority - a.descriptor.priority)
      || (a.descriptor.distanceMeters - b.descriptor.distanceMeters)
      || a.descriptor.targetId.localeCompare(b.descriptor.targetId)
    );
    return candidates[0] ?? null;
  }

  private parseWorldInteractionActivateIntent(intent: { kind?: unknown; [key: string]: unknown }): WorldInteractionActivateIntent | null {
    if (intent.kind !== "interaction_activate") {
      return null;
    }
    const targetId = typeof intent.targetId === "string" ? intent.targetId.trim() : "";
    const actionId = typeof intent.actionId === "string" ? intent.actionId.trim() : "";
    const slot = typeof intent.slot === "number" && Number.isFinite(intent.slot)
      ? Math.max(0, Math.floor(intent.slot))
      : INTERACTION_SLOT_PRIMARY;
    if (targetId.length <= 0 || actionId.length <= 0) {
      return null;
    }
    if (
      actionId !== "pickup_collect"
      && actionId !== "station_open_creator"
      && actionId !== "pilot_console_toggle"
    ) {
      return null;
    }
    return {
      kind: "interaction_activate",
      targetId,
      actionId,
      slot
    };
  }

  private executeWorldInteractionIntent(
    userId: number,
    intent: WorldInteractionActivateIntent
  ): { ok: boolean; reason: string } {
    const resolved = this.resolveBestInteractionTargetForUser(userId);
    if (!resolved) {
      return { ok: false, reason: "No interaction is currently available here." };
    }
    if (resolved.targetId !== intent.targetId) {
      return { ok: false, reason: "Interaction target is no longer valid." };
    }
    const action = resolved.descriptor.actions.find((entry) => entry.id === intent.actionId && entry.slot === intent.slot) ?? null;
    if (!action) {
      return { ok: false, reason: "That interaction action is not available for this target." };
    }
    if (!action.enabled) {
      return {
        ok: false,
        reason:
          typeof action.disabledReason === "string" && action.disabledReason.trim().length > 0
            ? action.disabledReason.trim()
            : "That interaction is currently unavailable."
      };
    }
    const failureState: { reason: string } = { reason: "" };
    const ok = this.executeWorldInteractionTarget(userId, resolved, failureState);
    if (!ok) {
      return {
        ok: false,
        reason: failureState.reason.length > 0 ? failureState.reason : "Interaction execution failed."
      };
    }
    return { ok: true, reason: "" };
  }

  private executeWorldInteractionTarget(
    userId: number,
    target: ResolvedInteractionTarget,
    failureState?: { reason: string }
  ): boolean {
    const setFailureReason = (reason: string): void => {
      if (failureState) {
        failureState.reason = reason;
      }
    };
    if (target.targetType === "pickup") {
      const pickupResult = this.itemInventorySystem.executePickupWorldItemForUser(userId, target.pickupNid);
      const ok = pickupResult.ok;
      if (!ok) {
        setFailureReason(this.formatPickupInteractionFailureReason(pickupResult.reason));
      }
      return ok;
    }
    if (target.targetType === "station") {
      const station = this.tryBeginNearbyStationSession(userId);
      if (!station || station.sessionId !== target.stationSessionId) {
        setFailureReason("Station interaction is no longer valid.");
        return false;
      }
      const accountId = this.simulationEcs.getPlayerAccountIdByUserId(userId);
      const user = this.usersById.get(userId);
      if (typeof accountId !== "number" || !user) {
        return false;
      }
      const templateIds = filterCreatorTemplateBlueprintIdsForStation(
        getBlueprintDefinitionsForProfile(station.creatorProfileId).map((blueprint) => blueprint.id),
        station.allowedTemplateBlueprintIds
      );
      if (templateIds.length <= 0) {
        setFailureReason(`Station unavailable: no templates are configured for profile ${station.creatorProfileId}.`);
        return false;
      }
      const creatorState = this.creatorSystem.initializeSession(
        userId,
        accountId,
        templateIds,
        station.creatorProfileId,
        station.sessionId
      );
      this.publishCreatorStateForUser(user, creatorState);
      return true;
    }
    const memberships = this.referenceFrameMembershipByUserId.get(userId) ?? null;
    if (!memberships || !memberships.has(this.toReferenceFrameMembershipKey(target.framePid, target.volumeId))) {
      setFailureReason("Pilot console interaction is no longer valid.");
      return false;
    }
    const current = this.pilotedReferenceFrameByUserId.get(userId) ?? null;
    if (current && current.framePid === target.framePid) {
      this.actionEffectPipeline.execute({
        type: "pilot_reference_frame_end",
        userId,
        framePid: target.framePid
      });
      return true;
    }
    const seatOwner = this.pilotUserIdByReferenceFramePid.get(target.framePid);
    if (typeof seatOwner === "number" && seatOwner !== userId) {
      setFailureReason("Pilot console is in use.");
      return false;
    }
    this.actionEffectPipeline.execute({
      type: "pilot_reference_frame_begin",
      userId,
      framePid: target.framePid,
      volumeId: target.volumeId
    });
    return true;
  }

  private isUserInPilotControlMode(userId: number): boolean {
    return this.pilotedReferenceFrameByUserId.has(userId);
  }

  private releaseUserPilotSeat(userId: number): void {
    const current = this.pilotedReferenceFrameByUserId.get(userId);
    if (!current) {
      return;
    }
    this.pilotedReferenceFrameByUserId.delete(userId);
    const seatOwner = this.pilotUserIdByReferenceFramePid.get(current.framePid);
    if (seatOwner === userId) {
      this.pilotUserIdByReferenceFramePid.delete(current.framePid);
    }
    this.pilotControlIntentByUserId.delete(userId);
  }

  private resolvePilotIntentFromCommands(commands: Partial<InputWireCommand>[]): {
    forward: number;
    strafe: number;
    ascend: number;
    yawDelta: number;
    sprint: boolean;
  } {
    let forward = 0;
    let strafe = 0;
    let ascend = 0;
    let yawDelta = 0;
    let sprint = false;
    for (const command of commands) {
      if (command.ntype !== NType.InputCommand) continue;
      if (typeof command.forward === "number" && Number.isFinite(command.forward)) {
        forward = Math.max(-1, Math.min(1, command.forward));
      }
      if (typeof command.strafe === "number" && Number.isFinite(command.strafe)) {
        strafe = Math.max(-1, Math.min(1, command.strafe));
      }
      if (typeof command.yawDelta === "number" && Number.isFinite(command.yawDelta)) {
        yawDelta = Math.max(-1, Math.min(1, command.yawDelta));
      }
      const jump = Boolean(command.jump);
      const descend = Boolean(command.useSecondaryHeld || command.useSecondaryPressed);
      ascend = jump ? 1 : (descend ? -1 : 0);
      sprint = Boolean(command.sprint);
    }
    return { forward, strafe, ascend, yawDelta, sprint };
  }

  private tryBeginNearbyStationSession(userId: number): {
    sessionId: string;
    creatorProfileId: CreatorProfileId;
    allowedTemplateBlueprintIds: readonly number[];
    inventorySourcePolicy: "player_only" | "player_and_station";
    consumeOrderPolicy: "player_first" | "station_first";
    tierMaxOverride: number | null;
    actorRequirementPolicy: "enforce" | "ignore";
  } | null {
    const playerState = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
    if (!playerState) {
      return null;
    }
    const nearbyStation = this.locationRootSystem.findNearbyStation(
      { x: playerState.x, y: playerState.y, z: playerState.z },
      this.locationRootSystem.getMaxStationInteractRadius(0.75)
    );
    if (!nearbyStation) {
      return null;
    }
    return {
      sessionId: nearbyStation.sessionId,
      creatorProfileId: nearbyStation.creatorProfileId,
      allowedTemplateBlueprintIds: nearbyStation.allowedTemplateBlueprintIds,
      inventorySourcePolicy: nearbyStation.inventorySourcePolicy,
      consumeOrderPolicy: nearbyStation.consumeOrderPolicy,
      tierMaxOverride: nearbyStation.tierMaxOverride,
      actorRequirementPolicy: nearbyStation.actorRequirementPolicy
    };
  }

  private refreshEquippedVisualAppearanceForUser(userId: number): void {
    const playerState = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
    if (!playerState) {
      return;
    }
    const inventory = this.itemInventorySystem.ensureInventoryLoaded(playerState.accountId);
    const equippedItemBySlot = new Map<"weapon" | "head" | "body" | "legs" | "accessory", number>([
      ["weapon", inventory.equipment.weapon ?? 0],
      ["head", inventory.equipment.head ?? 0],
      ["body", inventory.equipment.body ?? 0],
      ["legs", inventory.equipment.legs ?? 0],
      ["accessory", inventory.equipment.accessory ?? 0]
    ]);
    let weaponArchetypeId = 0;
    let headArchetypeId = 0;
    let bodyArchetypeId = 0;
    let legsArchetypeId = 0;
    let accessoryArchetypeId = 0;
    let weaponTintColorRgb = getDefaultEquippedTintPatch().equippedWeaponTintColorRgb;
    let headTintColorRgb = getDefaultEquippedTintPatch().equippedHeadTintColorRgb;
    let bodyTintColorRgb = getDefaultEquippedTintPatch().equippedBodyTintColorRgb;
    let legsTintColorRgb = getDefaultEquippedTintPatch().equippedLegsTintColorRgb;
    let accessoryTintColorRgb = getDefaultEquippedTintPatch().equippedAccessoryTintColorRgb;
    for (const [slot, itemInstanceId] of equippedItemBySlot) {
      if (itemInstanceId <= 0) {
        continue;
      }
      const item = inventory.itemInstances.find((entry) => entry.itemInstanceId === itemInstanceId) ?? null;
      if (!item) {
        continue;
      }
      const definition = getItemDefinitionById(item.definitionId) ?? getBlueprintRuntimeItemByBlueprintId(item.definitionId);
      if (!definition || definition.modelId <= 0) {
        continue;
      }
      const readyAppearanceBinding = resolveReadyAppearanceRuntimeBinding(definition.readyAppearanceId);
      if (slot === "weapon") {
        weaponArchetypeId = readyAppearanceBinding.equipped.renderArchetypeId ?? definition.modelId;
        weaponTintColorRgb = readyAppearanceBinding.equipped.tintColorRgb;
      } else if (slot === "head") {
        headArchetypeId = readyAppearanceBinding.equipped.renderArchetypeId ?? definition.modelId;
        headTintColorRgb = readyAppearanceBinding.equipped.tintColorRgb;
      } else if (slot === "body") {
        bodyArchetypeId = readyAppearanceBinding.equipped.renderArchetypeId ?? definition.modelId;
        bodyTintColorRgb = readyAppearanceBinding.equipped.tintColorRgb;
      } else if (slot === "legs") {
        legsArchetypeId = readyAppearanceBinding.equipped.renderArchetypeId ?? definition.modelId;
        legsTintColorRgb = readyAppearanceBinding.equipped.tintColorRgb;
      } else {
        accessoryArchetypeId = readyAppearanceBinding.equipped.renderArchetypeId ?? definition.modelId;
        accessoryTintColorRgb = readyAppearanceBinding.equipped.tintColorRgb;
      }
    }
    this.appearanceSystem.clearAppearanceIntentSources(playerState.eid, EQUIPMENT_SLOT_TINT_INTENT_SOURCES);
    this.appearanceSystem.applyAppearancePatch(playerState.eid, "equipment_profile", {
      equippedWeaponArchetypeId: weaponArchetypeId,
      equippedHeadArchetypeId: headArchetypeId,
      equippedBodyArchetypeId: bodyArchetypeId,
      equippedLegsArchetypeId: legsArchetypeId,
      equippedAccessoryArchetypeId: accessoryArchetypeId,
      equippedWeaponTintColorRgb: weaponTintColorRgb,
      equippedHeadTintColorRgb: headTintColorRgb,
      equippedBodyTintColorRgb: bodyTintColorRgb,
      equippedLegsTintColorRgb: legsTintColorRgb,
      equippedAccessoryTintColorRgb: accessoryTintColorRgb
    });
  }

  private applyEquippedSlotTintForUser(userId: number, slot: EquipmentSlot, tintColorRgb: number): boolean {
    const playerState = this.simulationEcs.getPlayerRuntimeStateByUserId(userId);
    if (!playerState) {
      return false;
    }
    const patch = getEquippedSlotTintPatch(slot, tintColorRgb);
    return this.appearanceSystem.applyAppearancePatch(playerState.eid, getEquipmentSlotTintIntentSource(slot), patch);
  }

  private applyRuntimeAppearancePatchByEid(eid: number, patch: EntityAppearancePatch): boolean {
    return this.appearanceSystem.applyAppearancePatch(eid, "runtime_effect", patch);
  }

  private tickPortalTransferPhase(): void {
    const mapInstanceId = (process.env.MAP_INSTANCE_ID ?? "").trim();
    if (mapInstanceId.length <= 0) {
      return;
    }
    const zone = PORTAL_TRANSFER_ZONES.find((candidate) => candidate.sourceMapInstanceId === mapInstanceId);
    if (!zone) {
      return;
    }
    const c = this.simulationEcs.world.components;
    for (const userId of this.simulationEcs.getOnlinePlayerUserIds()) {
      if (this.autoTransferRequestByUserId.has(userId)) {
        continue;
      }
      const cooldownUntil = this.portalTriggerCooldownByUserId.get(userId) ?? 0;
      if (this.elapsedSeconds < cooldownUntil) {
        continue;
      }
      const eid = this.simulationEcs.getPlayerEidByUserId(userId);
      if (typeof eid !== "number") {
        continue;
      }
      const x = c.Position.x[eid] ?? 0;
      const y = c.Position.y[eid] ?? 0;
      const z = c.Position.z[eid] ?? 0;
      const dx = x - zone.centerX;
      const dy = y - zone.centerY;
      const dz = z - zone.centerZ;
      if (dx * dx + dy * dy + dz * dz > zone.sensorRadius * zone.sensorRadius) {
        continue;
      }
      this.autoTransferRequestByUserId.set(userId, zone.targetMapInstanceId);
      this.portalTriggerCooldownByUserId.set(userId, this.elapsedSeconds + PORTAL_TRANSFER_RETRIGGER_SECONDS);
    }
  }

  private tickKinematicWorldFrames(prevElapsed: number): void {
    this.platformSystem.updatePlatforms(prevElapsed, this.elapsedSeconds);
    for (const [userId, pilotState] of this.pilotedReferenceFrameByUserId.entries()) {
      const intent = this.pilotControlIntentByUserId.get(userId) ?? {
        forward: 0,
        strafe: 0,
        ascend: 0,
        yawDelta: 0,
        sprint: false
      };
      this.locationRootSystem.applyPilotControlIntent(pilotState.framePid, intent, SERVER_TICK_SECONDS);
    }
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
    this.applyFallDamagePhase();
    this.npcMovementSystem.stepCharacters(this.npcAiSystem.getNpcEids() as number[], delta, this.elapsedSeconds);
  }

  private applyFallDamagePhase(): void {
    const c = this.simulationEcs.world.components;
    for (const [, eid] of this.getMovementPlayerEntries()) {
      const groundedNow = (c.Grounded.value[eid] ?? 0) !== 0;
      const vy = c.Velocity.y[eid] ?? 0;
      const groundedBefore = this.previousGroundedByEid.get(eid) ?? groundedNow;
      const minVyBefore = this.minAirborneVyByEid.get(eid) ?? 0;

      if (groundedNow) {
        if (!groundedBefore) {
          const impactSpeed = Math.max(0, -minVyBefore);
          const damage = this.computeFallDamageFromImpactSpeed(impactSpeed);
          if (damage > 0) {
            this.damageSystem.applyFallDamageByEid(eid, damage);
          }
        }
        this.minAirborneVyByEid.set(eid, 0);
      } else {
        const nextMinVy = groundedBefore ? Math.min(0, vy) : Math.min(minVyBefore, vy);
        this.minAirborneVyByEid.set(eid, nextMinVy);
      }

      this.previousGroundedByEid.set(eid, groundedNow);
    }
  }

  private computeFallDamageFromImpactSpeed(impactSpeed: number): number {
    if (!Number.isFinite(impactSpeed) || impactSpeed <= FALL_DAMAGE_MIN_IMPACT_SPEED) {
      return 0;
    }
    const damage = Math.floor((impactSpeed - FALL_DAMAGE_MIN_IMPACT_SPEED) * FALL_DAMAGE_PER_SPEED);
    return Math.max(0, Math.min(this.archetypes.player.maxHealth, damage));
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

  public flushDirtyPlayerState(overrides?: {
    saveCharacterSnapshot?: (s: PlayerSnapshot) => void;
    saveAbilityStateSnapshot?: (s: PlayerSnapshot) => void;
    savePlayerSettings?: (accountId: number, settings: PlayerSettings) => void;
  }): void {
    this.persistenceSyncSystem.flushDirtyPlayerState(
      (accountId) => this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(accountId),
      (snap) => { if (overrides?.saveCharacterSnapshot) overrides.saveCharacterSnapshot(snap); else this.persistence.saveCharacterSnapshot(snap); },
      (snap) => { if (overrides?.saveAbilityStateSnapshot) overrides.saveAbilityStateSnapshot(snap); else this.persistence.saveAbilityStateSnapshot(snap); },
      (accountId) => this.getPlayerSettingsByAccountId(accountId),
      (accountId, settings) => {
        if (overrides?.savePlayerSettings) {
          overrides.savePlayerSettings(accountId, settings);
          return;
        }
        this.persistence.savePlayerSettings(accountId, settings);
      }
    );
  }

  public injectPendingLoginSnapshot(accountId: number, snapshot: PlayerSnapshot): void { this.persistenceSyncSystem.queueOfflineSnapshot(accountId, snapshot); }
  public injectPendingInventorySnapshot(accountId: number, snapshot: InventorySnapshot): void {
    this.itemInventorySystem.queuePendingInventorySnapshot(accountId, snapshot);
  }
  public injectPendingPlayerSettings(accountId: number, settings: PlayerSettings): void {
    this.playerSettingsByAccountId.set(Math.max(1, Math.floor(accountId)), coercePlayerSettings(settings));
  }
  public injectPendingActorCapabilities(accountId: number, capabilities: Record<string, number>): void {
    this.actorCapabilitiesByAccountId.set(Math.max(1, Math.floor(accountId)), { ...capabilities });
  }
  public setActorCapabilityByAccountId(accountId: number, capabilityKey: string, value: number): boolean {
    const normalizedAccountId = Math.max(1, Math.floor(accountId));
    const key = typeof capabilityKey === "string" ? capabilityKey.trim() : "";
    if (key.length <= 0 || !Number.isFinite(value)) {
      return false;
    }
    const capabilities = this.ensureActorCapabilitiesLoaded(normalizedAccountId);
    const previous = capabilities[key];
    const next = Number(value);
    if (previous === next) {
      return false;
    }
    capabilities[key] = next;
    this.actorCapabilitiesByAccountId.set(normalizedAccountId, capabilities);
    this.persistence.saveActorCapabilities(normalizedAccountId, capabilities);
    return true;
  }

  public getActorCapabilitiesByAccountId(accountId: number): Readonly<Record<string, number>> {
    return Object.freeze({ ...this.ensureActorCapabilitiesLoaded(accountId) });
  }
  public getPlayerSnapshotByUserId(userId: number): PlayerSnapshot | null {
    const aid = this.simulationEcs.getPlayerAccountIdByUserId(userId);
    if (aid === null) return null;
    return this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(aid);
  }
  public getInventorySnapshotByAccountId(accountId: number): InventorySnapshot {
    return this.itemInventorySystem.ensureInventoryLoaded(accountId);
  }
  public getPlayerSettingsSnapshotByAccountId(accountId: number): PlayerSettings {
    return this.getPlayerSettingsByAccountId(accountId);
  }
  public consumeAutoMapTransferRequests(): ReadonlyArray<{ userId: number; targetMapInstanceId: string }> {
    if (this.autoTransferRequestByUserId.size <= 0) {
      return [];
    }
    const requests: Array<{ userId: number; targetMapInstanceId: string }> = [];
    for (const [userId, targetMapInstanceId] of this.autoTransferRequestByUserId) {
      requests.push({ userId, targetMapInstanceId });
    }
    this.autoTransferRequestByUserId.clear();
    return requests;
  }

  public getRuntimeStats(): {
    onlinePlayers: number;
    activeProjectiles: number;
    pendingOfflineSnapshots: number;
    ecsEntities: number;
    activeNpcs: number;
    inactiveNpcs: number;
    hibernatingNpcs: number;
    replicationNearEntities: number;
    replicationFarEntities: number;
    replicationTotalEntities: number;
    pilotedReferenceFrames: number;
    attackRuntimeActiveInstances: number;
    attackRuntimePooledInstances: number;
    attackRuntimePeakActiveInstances: number;
    effectAuditSuccesses: Readonly<Record<string, number>>;
  } {
    const es = this.simulationEcs.getStats();
    const ai = this.npcAiSystem.getStats();
    const replicationCounts = this.replication.getLiveReplicationCounts();
    const attackRuntimeStats = this.attackRuntimeSystem.getRuntimeStats();
    return {
      onlinePlayers: this.simulationEcs.getOnlinePlayerCount(),
      activeProjectiles: this.projectileSystem.getActiveCount(),
      pendingOfflineSnapshots: this.persistenceSyncSystem.getPendingOfflineSnapshotCount(),
      ecsEntities: es.total,
      activeNpcs: ai.active,
      inactiveNpcs: ai.inactive,
      hibernatingNpcs: ai.hibernating,
      replicationNearEntities: replicationCounts.nearEntities,
      replicationFarEntities: replicationCounts.farEntities,
      replicationTotalEntities: replicationCounts.totalEntities,
      pilotedReferenceFrames: this.pilotedReferenceFrameByUserId.size,
      attackRuntimeActiveInstances: attackRuntimeStats.active,
      attackRuntimePooledInstances: attackRuntimeStats.pooled,
      attackRuntimePeakActiveInstances: attackRuntimeStats.peakActive,
      effectAuditSuccesses: Object.freeze(Object.fromEntries(this.effectAuditSuccessCountByType.entries()))
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private syncCarrierMembershipMessagesForPlayer(userId: number, eid: number): void {
    const collider = this.simulationEcs.getPlayerCollider(eid);
    if (!collider) {
      this.referenceFrameMembershipByUserId.delete(userId);
      return;
    }
    const overlaps = this.locationRootSystem.collectReferenceFrameVolumeMembershipsForCollider(collider);
    const nextKeys = new Set<string>();
    for (let i = 0; i < overlaps.length; i += 1) {
      const membership = overlaps[i];
      if (!membership) continue;
      nextKeys.add(this.toReferenceFrameMembershipKey(membership.framePid, membership.volumeId));
    }
    const previousKeys = this.referenceFrameMembershipByUserId.get(userId) ?? new Set<string>();
    for (const key of previousKeys) {
      if (!nextKeys.has(key)) {
        const parsed = this.parseReferenceFrameMembershipKey(key);
        if (parsed) {
          this.actionEffectPipeline.execute({
            type: "reference_frame_volume_exited",
            userId,
            framePid: parsed.framePid,
            volumeId: parsed.volumeId
          });
        }
      }
    }
    for (const key of nextKeys) {
      if (!previousKeys.has(key)) {
        const parsed = this.parseReferenceFrameMembershipKey(key);
        if (parsed) {
          this.actionEffectPipeline.execute({
            type: "reference_frame_volume_entered",
            userId,
            framePid: parsed.framePid,
            volumeId: parsed.volumeId
          });
        }
      }
    }
    this.referenceFrameMembershipByUserId.set(userId, nextKeys);
    this.syncPilotedReferenceFrameForUser(userId, nextKeys);
  }

  private toReferenceFrameMembershipKey(framePid: number, volumeId: string): string {
    return `${Math.floor(framePid)}:${volumeId}`;
  }

  private parseReferenceFrameMembershipKey(key: string): { framePid: number; volumeId: string } | null {
    const separator = key.indexOf(":");
    if (separator <= 0 || separator >= key.length - 1) {
      return null;
    }
    const framePid = Number(key.slice(0, separator));
    const volumeId = key.slice(separator + 1);
    if (!Number.isFinite(framePid) || volumeId.length === 0) {
      return null;
    }
    return { framePid: Math.floor(framePid), volumeId };
  }

  private syncPilotedReferenceFrameForUser(userId: number, memberships: ReadonlySet<string>): void {
    const current = this.pilotedReferenceFrameByUserId.get(userId) ?? null;
    if (current && !memberships.has(this.toReferenceFrameMembershipKey(current.framePid, current.volumeId))) {
      this.actionEffectPipeline.execute({
        type: "pilot_reference_frame_end",
        userId,
        framePid: current.framePid
      });
    }
  }

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
    for (const record of persistedBlueprints) {
      this.creatorSystem.registerPersistedBlueprint(record.blueprint);
      if (record.runtimeCapability) {
        upsertBlueprintRuntimeCapabilityEntry(record.runtimeCapability);
      }
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
    const projected = getBlueprintRuntimeAbilityByBlueprintId(id);
    return projected ?? null;
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
  private resolveCombatWorldSeed(mapInstanceId: string): number {
    const normalized = mapInstanceId.trim().toLowerCase();
    let hash = 0x811c9dc5;
    for (let i = 0; i < normalized.length; i += 1) {
      hash ^= normalized.charCodeAt(i) ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }
    const seeded = hash >>> 0;
    return seeded === 0 ? 1 : seeded;
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
    ownerEid: number;
    kind: number;
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    radius: number; damage: number; lifetimeSeconds: number;
    maxRange: number; gravity: number; drag: number;
    maxSpeed: number; minSpeed: number; pierceCount: number;
    despawnOnDamageableHit: boolean; despawnOnWorldHit: boolean;
    targetPolicy: {
      allowSelf: boolean;
      allowPlayers: boolean;
      allowNpcs: boolean;
      allowDummies: boolean;
    };
    patternSeed: number;
    patternKind: number;
    patternSpiralFrequencyHz: number;
    patternSpiralStrength: number;
    baseDirX: number;
    baseDirY: number;
    baseDirZ: number;
  }): void {
    const ownerIdentity = this.simulationEcs.resolveCombatOwnerIdentityByEid(req.ownerEid);
    if (!ownerIdentity) {
      return;
    }
    const ownerEid = ownerIdentity.eid;
    const ownerNid = ownerIdentity.nid;
    const eid = this.simulationEcs.createEntityFromPreset("projectile", {
      modelId: this.resolveProjectileModelId(req.kind),
      position: { x: req.x, y: req.y, z: req.z },
      velocity: { x: req.vx, y: req.vy, z: req.vz },
      projectileOwnerEid: ownerEid,
      projectileOwnerNid: ownerNid,
      projectileKind: req.kind,
      projectileRadius: req.radius,
      projectileDamage: req.damage,
      projectileTtl: req.lifetimeSeconds,
      projectileInitialTtl: req.lifetimeSeconds,
      projectileRemainingRange: ProjectileSystem.resolveMaxRange(req.maxRange),
      projectileGravity: ProjectileSystem.resolveOptionalNumber(req.gravity, 0),
      projectileDrag: Math.max(0, ProjectileSystem.resolveOptionalNumber(req.drag, 0)),
      projectileMaxSpeed: Math.max(0, ProjectileSystem.resolveOptionalNumber(req.maxSpeed, Number.POSITIVE_INFINITY)),
      projectileMinSpeed: Math.max(0, ProjectileSystem.resolveOptionalNumber(req.minSpeed, 0)),
      projectileRemainingPierces: Math.max(0, Math.floor(ProjectileSystem.resolveOptionalNumber(req.pierceCount, 0))),
      projectilePatternSeed: req.patternSeed >>> 0,
      projectilePatternKind: Math.max(0, Math.floor(req.patternKind)),
      projectilePatternSpiralFrequencyHz: Math.max(0, req.patternSpiralFrequencyHz),
      projectilePatternSpiralStrength: Math.max(0, req.patternSpiralStrength),
      projectileBaseDirection: { x: req.baseDirX, y: req.baseDirY, z: req.baseDirZ },
      projectileTargetAllowSelf: req.targetPolicy.allowSelf,
      projectileTargetAllowPlayers: req.targetPolicy.allowPlayers,
      projectileTargetAllowNpcs: req.targetPolicy.allowNpcs,
      projectileTargetAllowDummies: req.targetPolicy.allowDummies,
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

  public queueServerAlertForUser(userId: number, text: string, severity: AlertSeverity = "info"): void {
    this.alertDispatcher.queueForUserId(userId, text, severity);
  }

  private queueCreatorActionResultForUser(
    user: UserLike,
    ok: boolean,
    message: string,
    createdBlueprintId = 0,
    createdItemInstanceId = 0
  ): void {
    const creatorViewId = this.uiViewRuntime.resolveViewIdByUserAndType(user.id, "creator");
    user.queueMessage({
      ntype: NType.UiIntentResultMessage,
      viewId: Math.max(0, Math.min(0xffff, Math.floor(creatorViewId))),
      sequence: 0,
      ok,
      message,
      resultJson: JSON.stringify({
        createdBlueprintId: Math.max(0, Math.min(0xffff, Math.floor(createdBlueprintId))),
        createdItemInstanceId: Math.max(0, Math.min(0x7fffffff, Math.floor(createdItemInstanceId)))
      })
    });
  }

  public queueServerAlertForAccount(accountId: number, text: string, severity: AlertSeverity = "info"): void {
    this.alertDispatcher.queueForAccountId(accountId, text, severity);
  }

  private publishCreatorStateForUser(user: UserLike, snapshot: import("../shared/index").CreatorSessionSnapshot): void {
    this.uiViewRuntime.publish(user, "creator", {
      kind: "creator",
      state: snapshot
    });
  }

  private buildInventoryUiViewPayload(snapshot: InventorySnapshot): Record<string, unknown> {
    const descriptorById = new Map<number, unknown>();
    for (const entry of snapshot.itemInstances) {
      const definitionId = Math.max(0, Math.floor(entry.definitionId));
      if (definitionId <= 0 || descriptorById.has(definitionId)) {
        continue;
      }
      const descriptor = getItemDefinitionById(definitionId) ?? getBlueprintRuntimeItemByBlueprintId(definitionId);
      if (!descriptor) {
        continue;
      }
      descriptorById.set(definitionId, descriptor);
    }
    return {
      kind: "inventory",
      state: snapshot,
      itemDescriptors: Array.from(descriptorById.values())
    };
  }

  public broadcastServerAlert(text: string, severity: AlertSeverity = "info"): void {
    this.alertDispatcher.broadcast(text, severity);
  }

  public getServerAlertDispatcher(): ServerAlertDispatcher<UserLike> {
    return this.alertDispatcher;
  }

  private ensurePlayerSettingsLoaded(accountId: number): PlayerSettings {
    const normalizedAccountId = Math.max(1, Math.floor(accountId));
    const existing = this.playerSettingsByAccountId.get(normalizedAccountId);
    if (existing) {
      return existing;
    }
    const loaded = this.persistence.loadPlayerSettings(normalizedAccountId);
    this.playerSettingsByAccountId.set(normalizedAccountId, loaded);
    return loaded;
  }

  private ensureActorCapabilitiesLoaded(accountId: number): Record<string, number> {
    const normalizedAccountId = Math.max(1, Math.floor(accountId));
    const existing = this.actorCapabilitiesByAccountId.get(normalizedAccountId);
    if (existing) {
      return existing;
    }
    const loaded = this.persistence.loadActorCapabilities(normalizedAccountId);
    const merged: Record<string, number> = {
      ...DEFAULT_ACTOR_CAPABILITIES,
      ...loaded
    };
    const changed = Object.keys(DEFAULT_ACTOR_CAPABILITIES).some(
      (key) => !Number.isFinite(loaded[key])
    );
    if (changed) {
      this.persistence.saveActorCapabilities(normalizedAccountId, merged);
    }
    this.actorCapabilitiesByAccountId.set(normalizedAccountId, merged);
    return merged;
  }

  private hasActorCapabilityAtLeast(accountId: number, key: string, minValue: number): boolean {
    const capabilities = this.ensureActorCapabilitiesLoaded(accountId);
    const value = capabilities[key];
    if (!Number.isFinite(value)) {
      return false;
    }
    return Number(value) >= minValue;
  }

  private resolveGrantedAccessTagsForAuthoring(
    accountId: number,
    requestedTags: readonly BlueprintAccessTag[]
  ): BlueprintAccessTag[] {
    const uniqueRequested = Array.from(new Set(requestedTags));
    const canPublishTemplate = this.hasActorCapabilityAtLeast(accountId, "creator.publish.template", 1);
    const filtered = uniqueRequested.filter((tag) => tag !== "blueprint.template" || canPublishTemplate);
    return filtered;
  }

  private resolveCreatorProfileForDerivedBlueprint(sourceBlueprint: BlueprintDefinition): CreatorProfileId {
    const profiles = sourceBlueprint.templateProfiles ?? {};
    const preferredOrder: readonly CreatorProfileId[] = Object.freeze([
      "item_creator",
      "ability_creator",
      "character_creator",
      "mind_creator"
    ]);
    for (const profileId of preferredOrder) {
      if (profiles[profileId]) {
        return profileId;
      }
    }
    if (buildItemDefinitionFromBlueprint(sourceBlueprint)) {
      return "item_creator";
    }
    if (buildAbilityDefinitionFromBlueprint(sourceBlueprint)) {
      return "ability_creator";
    }
    return "item_creator";
  }

  private cloneRuntimeActivationSpecs(specs: readonly RuntimeActivationSpec[]): RuntimeActivationSpec[] {
    const cloned: RuntimeActivationSpec[] = [];
    for (const spec of specs) {
      cloned.push({
        activationId: spec.activationId,
        source: spec.source,
        channel: spec.channel,
        cooldownSeconds: spec.cooldownSeconds,
        consumeQuantity: spec.consumeQuantity,
        effects: spec.effects.map((effect) => {
          if (effect.type === "spawn_projectile") {
            return { type: "spawn_projectile", projectile: { ...effect.projectile } };
          }
          if (effect.type === "apply_melee_hit") {
            return { type: "apply_melee_hit", melee: { ...effect.melee } };
          }
          if (effect.type === "restore_health") {
            return { type: "restore_health", amount: effect.amount };
          }
          if (effect.type === "set_player_render_appearance") {
            return {
              type: "set_player_render_appearance",
              renderArchetypeId: effect.renderArchetypeId,
              materialVariantId: effect.materialVariantId,
              tintColorRgb: effect.tintColorRgb,
              uniformScalePct: effect.uniformScalePct
            };
          }
          return {
            type: "set_equipped_slot_tint",
            slot: effect.slot,
            tintColorRgb: effect.tintColorRgb
          };
        })
      });
    }
    return cloned;
  }

  private formatCreatorInstantiationFailureReason(reason: string): string {
    if (reason.startsWith("actor_requirement_unmet:")) {
      const key = reason.slice("actor_requirement_unmet:".length).trim();
      return key.length > 0
        ? `Creation blocked: actor requirement not met (${key}).`
        : "Creation blocked: actor requirement not met.";
    }
    if (reason.startsWith("required_item_missing:")) {
      const requiredId = Number.parseInt(reason.slice("required_item_missing:".length), 10);
      return Number.isFinite(requiredId) && requiredId > 0
        ? `Creation blocked: required non-consumed item missing (item #${requiredId}).`
        : "Creation blocked: required non-consumed item missing.";
    }
    if (reason.startsWith("missing_resources:")) {
      const [, itemIdRaw, qtyRaw, sourcePolicyRaw] = reason.split(":");
      const itemId = Number.parseInt(itemIdRaw ?? "", 10);
      const qty = Number.parseInt(qtyRaw ?? "", 10);
      const sourcePolicy = sourcePolicyRaw === "player_and_station" ? "player + station inventories" : "player inventory";
      if (Number.isFinite(itemId) && itemId > 0 && Number.isFinite(qty) && qty > 0) {
        return `Creation blocked: missing consumable material item #${itemId} x${qty} from ${sourcePolicy}.`;
      }
      return `Creation blocked: missing consumable materials from ${sourcePolicy}.`;
    }
    if (reason === "station_session_missing") {
      return "Creation blocked: station session is required before instantiation.";
    }
    if (reason === "station_session_invalid") {
      return "Creation blocked: station session is no longer valid at this location.";
    }
    if (reason === "station_policy_missing") {
      return "Creation blocked: station policy data is unavailable.";
    }
    if (reason === "restricted_blueprint_permission_missing") {
      return "Creation blocked: restricted blueprint permission missing.";
    }
    if (reason === "inventory_full") {
      return "Creation blocked: inventory is full.";
    }
    if (reason === "blueprint_not_item") {
      return "Creation blocked: selected blueprint is not an item.";
    }
    if (reason === "player_missing") {
      return "Creation blocked: player runtime state is unavailable.";
    }
    return `Creation blocked: ${reason}.`;
  }

  private formatPickupInteractionFailureReason(reason: string): string {
    if (reason === "inventory_full") {
      return "Pickup blocked: inventory is full.";
    }
    if (reason === "pickup_missing") {
      return "Pickup blocked: target no longer exists.";
    }
    if (reason === "pickup_unavailable") {
      return "Pickup blocked: target is out of range or unavailable.";
    }
    if (reason === "pickup_invalid") {
      return "Pickup blocked: target is not a pickup.";
    }
    if (reason === "pickup_definition_missing") {
      return "Pickup blocked: item definition is unavailable.";
    }
    if (reason === "player_missing") {
      return "Pickup blocked: player runtime state is unavailable.";
    }
    return `Pickup blocked: ${reason}.`;
  }

  private resolveGlobalGrantedAccessTagsForAuthoring(
    accountId: number,
    grantedAccessTags: readonly BlueprintAccessTag[]
  ): BlueprintAccessTag[] {
    if (!this.hasActorCapabilityAtLeast(accountId, "creator.publish.global", 1)) {
      return [];
    }
    return grantedAccessTags.includes("blueprint.template") ? ["blueprint.template"] : [];
  }

  private withBlueprintProvenance(
    blueprint: BlueprintDefinition,
    accountId: number,
    userId: number
  ): BlueprintDefinition {
    const stationSessionId = this.creatorSystem.getSessionStationSessionId(userId) ?? undefined;
    const productionContract = blueprint.components?.ProductionContract as Record<string, unknown> | undefined;
    const productionTierRaw = productionContract?.tier;
    const productionTier = typeof productionTierRaw === "number" && Number.isFinite(productionTierRaw)
      ? Math.max(1, Math.floor(productionTierRaw))
      : undefined;
    const selectedAugments = Array.isArray(productionContract?.selectedAugmentDefinitionIds)
      ? productionContract.selectedAugmentDefinitionIds
          .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
          .map((entry) => Math.max(0, Math.floor(entry)))
      : undefined;
    return cloneBlueprintDefinition(blueprint, {
      metadata: {
        ...blueprint.metadata,
        createdByAccountId: Math.max(1, Math.floor(accountId)),
        authoredAtMs: Date.now(),
        stationSessionId,
        productionTier,
        selectedAugmentDefinitionIds: selectedAugments
      }
    });
  }

  private applyInspectActorCapabilities(userId: number, accountId: number): void {
    const capabilities = this.ensureActorCapabilitiesLoaded(accountId);
    const sortedEntries = Object.entries(capabilities).sort((a, b) => a[0].localeCompare(b[0]));
    const summary = sortedEntries.map(([key, value]) => `${key}=${value}`).join(", ");
    this.queueServerAlertForUser(
      userId,
      summary.length > 0 ? `Capabilities: ${summary}` : "Capabilities: <none>",
      "info"
    );
  }

  private applySetActorCapability(
    userId: number,
    accountId: number,
    rawCapabilityKey: string | undefined,
    rawCapabilityValue: number | undefined
  ): void {
    const capabilityKey = typeof rawCapabilityKey === "string" ? rawCapabilityKey.trim() : "";
    const capabilityValue = typeof rawCapabilityValue === "number" ? rawCapabilityValue : Number.NaN;
    if (capabilityKey.length <= 0 || !Number.isFinite(capabilityValue)) {
      this.queueServerAlertForUser(userId, "Capability update failed: invalid key/value.", "warning");
      return;
    }
    const changed = this.setActorCapabilityByAccountId(accountId, capabilityKey, capabilityValue);
    if (!changed) {
      this.queueServerAlertForUser(userId, `Capability unchanged: ${capabilityKey}=${capabilityValue}.`, "info");
      return;
    }
    this.queueServerAlertForUser(userId, `Capability updated: ${capabilityKey}=${capabilityValue}.`, "success");
  }

  private getPlayerSettingsByAccountId(accountId: number): PlayerSettings {
    const existing = this.playerSettingsByAccountId.get(accountId);
    if (existing) {
      return existing;
    }
    return { ...DEFAULT_PLAYER_SETTINGS };
  }

  private resetCombatExecutionStateByEid(eid: number): void {
    this.abilityExecutionSystem.clearCooldownsForEid(eid);
    this.attackRuntimeSystem.clearAttackerState(eid);
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
          lastProcessedSequence: 0,
          primaryHeld: false, secondaryHeld: false
        });
        this.simulationEcs.registerPlayerPhysicsRefs(eid, ctx.body, ctx.collider);
        this.resetCombatExecutionStateByEid(eid);
        const nid = this.replication.spawnEntity(eid);
        this.simulationEcs.setEntityNidByEid(eid, nid);
        this.simulationEcs.bindPlayerIndexes(user.id, eid);
        this.controllerSystem.attachPlayerController(user.id, eid);
        this.damageSystem.registerCollider(ctx.collider.handle, eid);
        this.previousGroundedByEid.set(eid, true);
        this.minAirborneVyByEid.set(eid, 0);
        this.ensurePunchAssigned(eid);
        this.replication.queueIdentityMessage(user, nid);
        this.events.emit<PlayerSpawnedPayload>(GameEvent.PLAYER_SPAWNED, { userId: user.id, eid, accountId: ctx.accountId, colliderHandle: ctx.collider.handle });
        return eid;
      },
      despawnPlayer: (user, eid) => {
        const accountId = this.simulationEcs.getPlayerAccountIdByUserId(user.id) ?? 0;
        this.referenceFrameMembershipByUserId.delete(user.id);
        this.releaseUserPilotSeat(user.id);
        this.creatorSystem.removeSession(user.id);
        this.resetCombatExecutionStateByEid(eid);
        this.controllerSystem.detachUser(user.id);
        this.previousGroundedByEid.delete(eid);
        this.minAirborneVyByEid.delete(eid);
        this.simulationEcs.unbindPlayerIndexes(user.id, eid);
        this.replication.despawnEntity(eid);
        this.simulationEcs.destroyEid(eid);
        this.events.emit<PlayerDespawnedPayload>(GameEvent.PLAYER_DESPAWNED, { userId: user.id, eid, accountId });
      },
      sendInitialReplicationState: (user, accountId) => {
        const settings = this.ensurePlayerSettingsLoaded(accountId);
        this.ensureActorCapabilitiesLoaded(accountId);
        user.queueMessage({
          ntype: NType.PlayerSettingsMessage,
          settingsJson: JSON.stringify(settings)
        });
        this.queueServerAlertForUser(user.id, "Connected to authoritative server.", "success");
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
        this.publishCreatorStateForUser(user, creatorState);
        this.itemInventorySystem.queueInventoryStateForUser(user.id);
        this.refreshEquippedVisualAppearanceForUser(user.id);
      },
      resolvePlayerRuntimeRefsByUserId: (uid) => {
        const runtime = this.simulationEcs.getPlayerRuntimeStateByUserId(uid);
        if (!runtime) {
          return null;
        }
        return {
          eid: runtime.eid,
          nid: runtime.nid,
          body: runtime.body,
          collider: runtime.collider
        };
      },
      takePendingSnapshotForLogin: (aid) => this.persistenceSyncSystem.takePendingSnapshotForLogin(aid),
      loadPlayerState: (aid) => this.persistence.loadPlayerState(aid),
      queueOfflineSnapshot: (aid, snap) => this.persistenceSyncSystem.queueOfflineSnapshot(aid, snap),
      resolveOfflineSnapshotByAccountId: (aid) => this.simulationEcs.getPlayerPersistenceSnapshotByAccountId(aid),
      markPlayerDirty: (aid, opts) => this.persistenceSyncSystem.markAccountDirty(aid, opts),
      unregisterPlayerCollider: (h) => this.damageSystem.unregisterCollider(h),
      removeProjectilesByOwner: (owner) => this.projectileSystem.removeByOwner(owner),
      viewHalfWidth: 128, viewHalfHeight: 128, viewHalfDepth: 128,
      farViewHalfWidth: 3200, farViewHalfHeight: 1600, farViewHalfDepth: 3200
    });
  }
}


