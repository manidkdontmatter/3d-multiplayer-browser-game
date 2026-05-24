/**
 * Purpose: This file coordinates client-side behavior and presentation.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { Clock } from "three";
import {
  ABILITY_ID_NONE,
  ALERT_SEVERITIES,
  DEFAULT_HOTBAR_ABILITY_IDS,
  DEFAULT_PRIMARY_MOUSE_SLOT,
  DEFAULT_SECONDARY_MOUSE_SLOT,
  NET_DIAGNOSTICS_WARNING_AVG_IN_BYTES,
  NET_DIAGNOSTICS_WARNING_AVG_IN_MESSAGES,
  NET_DIAGNOSTICS_WARNING_AVG_OUT_BYTES,
  NET_DIAGNOSTICS_WARNING_AVG_OUT_MESSAGES,
  NET_DIAGNOSTICS_WARNING_P95_IN_BYTES,
  NET_DIAGNOSTICS_WARNING_P95_IN_MESSAGES,
  NET_DIAGNOSTICS_WARNING_P95_OUT_BYTES,
  NET_DIAGNOSTICS_WARNING_P95_OUT_MESSAGES,
  coerceClientLocalSettings,
  getAbilityDefinitionById,
  getLocationStationSockets,
  getLocationStationCreatorProfile,
  getLocationStationInteractionLabel,
  getLocationStationAllowedTemplateBlueprintIds,
  getLocationDefinitionByPid,
  getLocationPilotConsoleSockets,
  getItemDefinitionById,
  getBlueprintDefinitionsForProfile,
  filterCreatorTemplateBlueprintIdsForStation,
  buildWorldInteractionSocketCandidates,
  findNearestInteractionSocket,
  getWorldInteractionActions,
  resolveWorldInteractionActionBySlot,
  getCreatorAppearanceOptions,
  resolveReadyAppearanceRuntimeBinding,
  resolveActivationAppearanceRuntimeBinding,
  type WorldInteractionAction,
  worldInteractionSlotToKeyLabel,
  movementModeToLabel,
  type ClientLocalSettings,
  INVENTORY_MAX_SLOTS,
  type CreatorProfileId,
  type PlayerSettings,
  coercePlayerSettings,
  normalizeYaw,
  type InventorySnapshot,
  type RuntimeMapConfig
} from "../../shared/index";
import type { BootstrapRequest, BootstrapResponse } from "../../shared/bootstrapProtocol";
import { NetworkClient } from "./NetworkClient";
import { InputController } from "./InputController";
import { SettingsSaveScheduler } from "./SettingsSaveScheduler";
import { LocalPhysicsWorld } from "./LocalPhysicsWorld";
import { DeterministicPlatformTimeline } from "./DeterministicPlatformTimeline";
import { RenderSnapshotAssembler } from "./RenderSnapshotAssembler";
import { WorldRenderer } from "./WorldRenderer";
import { ClientNetworkOrchestrator } from "./network/ClientNetworkOrchestrator";
import type { MovementInput, PlayerPose, RenderFrameSnapshot } from "./types";
import { ensureAccountKey, resolveAccountKey } from "../auth/accountKey";
import {
  type NetworkDiagnosticsSnapshot
} from "../ui/NetworkDiagnosticsPanel";
import { preloadAssetGroup } from "../assets/assetLoader";
import {
  ASSET_GROUP_CREATOR_APPEARANCE,
  ASSET_CATALOG,
  ASSET_GROUP_SFX,
  ASSET_GROUP_WORLD_DEFAULT
} from "../assets/assetManifest";
import { ClientUiManager } from "../ui/ClientUiManager";

const FIXED_STEP = 1 / 60;
const LOOK_PITCH_LIMIT = 1.45;
const TRANSFER_BOOTSTRAP_STORAGE_KEY = "mapTransferBootstrapV1";
const TRANSFER_BOOTSTRAP_TTL_MS = 15_000;
const PLAYER_SETTINGS_LOCAL_CACHE_KEY = "playerSettingsLocalCache";
const CLIENT_LOCAL_SETTINGS_CACHE_KEY = "clientLocalSettingsCache";
const SETTINGS_SAVE_DEBOUNCE_MS = 1500;
const TEST_ALERT_INTERVAL_SECONDS = 60;
const CLIENT_KINEMATICS_SPEED_SMOOTH_SECONDS = 0.5;

interface TransferBootstrapPayload {
  wsUrl: string;
  joinTicket: string;
  mapConfig: RuntimeMapConfig;
  accountKeyScopeUrl: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
}

export type ClientCreatePhase = "physics" | "network" | "ready";
type WorldInteractTarget =
  | {
      kind: "pickup";
      pickupNid: number;
      pickupContext: { itemName: string; itemQuantity: number };
      actions: readonly WorldInteractionAction[];
    }
  | { kind: "station"; actions: readonly WorldInteractionAction[] }
  | { kind: "pilot_console"; actions: readonly WorldInteractionAction[] };

export class GameClientApp {
  private readonly input: InputController;
  private readonly renderer: WorldRenderer;
  private readonly ui: ClientUiManager;
  private readonly network = new NetworkClient();
  private readonly networkOrchestrator: ClientNetworkOrchestrator;
  private readonly platformTimeline = new DeterministicPlatformTimeline();
  private readonly renderSnapshotAssembler: RenderSnapshotAssembler;
  private readonly clock = new Clock();
  private readonly physics: LocalPhysicsWorld;
  private accumulator = 0;
  private running = false;
  private uiDestroyed = false;
  private rendererDisposed = false;
  private networkDisconnected = false;
  private rafId = 0;
  private fps = 0;
  private fpsSampleSeconds = 0;
  private fpsSampleFrames = 0;
  private lowFpsFrameCount = 0;
  private freezeCamera = false;
  private frozenCameraPose: PlayerPose | null = null;
  private cspEnabled: boolean;
  private readonly e2eSimulationOnly: boolean;
  private testMovementOverride: MovementInput | null = null;
  private totalUngroundedFixedTicks = 0;
  private totalUngroundedEntries = 0;
  private groundingSampleInitialized = false;
  private groundedLastFixedTick = true;
  private hotbarAbilityIds = [...DEFAULT_HOTBAR_ABILITY_IDS];
  private primaryMouseSlot = DEFAULT_PRIMARY_MOUSE_SLOT;
  private secondaryMouseSlot = DEFAULT_SECONDARY_MOUSE_SLOT;
  private queuedTestPrimaryActionCount = 0;
  private queuedTestSecondaryActionCount = 0;
  private queuedTestInteractCount = 0;
  private queuedTestInteractSlot = 0;
  private testPrimaryHeld = false;
  private testSecondaryHeld = false;
  private activeAccountKey: string | null = null;
  private transferInProgress = false;
  private currentWorldInteractTarget: WorldInteractTarget | null = null;
  private playerSettings = coercePlayerSettings(null);
  private clientLocalSettings = coerceClientLocalSettings(null);
  private readonly settingsSaveScheduler = new SettingsSaveScheduler(SETTINGS_SAVE_DEBOUNCE_MS);
  private inventoryState: InventorySnapshot = { maxSlots: INVENTORY_MAX_SLOTS, itemInstances: [], equipment: {}, hotbarSlots: [] };
  private readonly visualCarrierPreviousYawByFramePid = new Map<number, number>();
  private renderedLocationFrameSnapshot: ReadonlyMap<
    number,
    { x: number; y: number; z: number; rotation: { x: number; y: number; z: number; w: number } }
  > = new Map();
  private previousPhysicsRenderPose: { x: number; y: number; z: number } | null = null;
  private currentPhysicsRenderPose: { x: number; y: number; z: number } | null = null;
  private testAlertElapsedSeconds = 0;
  private previousKinematicsPose: { x: number; y: number; z: number } | null = null;
  private currentClientFrameVelocity = { x: 0, y: 0, z: 0 };
  private smoothedClientSpeed = 0;
  private lastCreatorSessionId = 0;
  private pendingStationCreatorOpenUntilMs = 0;
  private readonly testAlertsEnabled: boolean;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    physics: LocalPhysicsWorld,
    cspEnabled: boolean,
    e2eSimulationOnly: boolean,
    private readonly serverUrl: string,
    initialAccountKey: string,
    private readonly joinTicket: string | null
  ) {
    this.physics = physics;
    this.cspEnabled = cspEnabled;
    this.e2eSimulationOnly = e2eSimulationOnly;
    this.testAlertsEnabled = GameClientApp.resolveTestAlertsEnabled();
    this.playerSettings = GameClientApp.loadCachedPlayerSettings();
    this.clientLocalSettings = GameClientApp.loadCachedClientLocalSettings();
    this.input = new InputController(canvas);
    this.applyInputSettings(this.playerSettings);
    this.ui = ClientUiManager.mount(document, {
      initialHotbarAssignments: this.hotbarAbilityIds,
      initialPrimaryMouseSlot: this.primaryMouseSlot,
      initialSecondaryMouseSlot: this.secondaryMouseSlot,
      initialPlayerSettings: this.playerSettings,
      initialClientLocalSettings: this.clientLocalSettings,
      onHotbarAssignmentChanged: (slot, abilityId) => {
        if (abilityId <= 0) {
          this.network.queueClearHotbarSlot(slot);
          return;
        }
        this.network.queueAssignHotbarAbilitySlot(slot, abilityId);
      },
      onAbilityForgotten: (abilityId) => {
        this.network.queueForgetAbility(abilityId);
      },
      onCreatorCommand: (command) => {
        this.network.queueCreatorCommand(command);
      },
      onInventoryItemDropped: (itemInstanceId) => {
        this.network.queueDropInventoryItem(itemInstanceId);
      },
      onInventoryItemUsed: (itemInstanceId, channel) => {
        this.network.queueUseInventoryItemWithChannel(itemInstanceId, channel);
      },
      onInventoryItemEquipped: (itemInstanceId) => {
        this.network.queueEquipInventoryItem(itemInstanceId);
      },
      onInventorySlotUnequipped: (slot) => {
        this.network.queueUnequipInventorySlot(slot);
      },
      onHotbarItemAssigned: (slot, itemInstanceId) => {
        this.network.queueAssignHotbarItemSlot(slot, itemInstanceId);
      },
      onHotbarSlotCleared: (slot) => {
        this.network.queueClearHotbarSlot(slot);
      },
      onHotbarSlotMoved: (sourceSlot, targetSlot) => {
        this.network.queueMoveHotbarSlot(sourceSlot, targetSlot);
      },
      onHotbarSlotExecuted: (slot, channel) => {
        this.network.queueExecuteHotbarSlot(slot, channel);
      },
      onHotbarSlotDropped: (slot) => {
        this.network.queueDropHotbarSlot(slot);
      },
      onPlayerSettingsChanged: (settingsPatch) => {
        this.applyPlayerSettingsPatch(settingsPatch, true);
      },
      onClientLocalSettingsChanged: (settingsPatch) => {
        this.applyClientLocalSettingsPatch(settingsPatch);
      }
    });
    this.activeAccountKey = initialAccountKey.length > 0 ? initialAccountKey : null;
    this.renderer = new WorldRenderer(canvas, {
      clientLocalSettings: this.clientLocalSettings
    });
    this.renderer.setFieldOfView(this.playerSettings.fieldOfView);
    this.renderer.setGraphicsPreset(this.clientLocalSettings.graphicsPreset);
    this.networkOrchestrator = new ClientNetworkOrchestrator(this.network, this.physics);
    this.renderSnapshotAssembler = new RenderSnapshotAssembler({
      getRenderSnapshotState: (frameDeltaSeconds) => this.createRenderSnapshot(frameDeltaSeconds)
    });
    const initialPhysicsPose = this.physics.getPose();
    const initialRenderPose = { x: initialPhysicsPose.x, y: initialPhysicsPose.y, z: initialPhysicsPose.z };
    this.previousPhysicsRenderPose = initialRenderPose;
    this.currentPhysicsRenderPose = initialRenderPose;
  }

  public static async create(
    canvas: HTMLCanvasElement,
    onCreatePhase?: (phase: ClientCreatePhase) => void
  ): Promise<GameClientApp> {
    const connectionTarget = await GameClientApp.resolveConnectionTarget();
    if (connectionTarget.mapConfig) {
      GameClientApp.installRuntimeMapConfig(connectionTarget.mapConfig);
    }
    onCreatePhase?.("physics");
    const physics = await LocalPhysicsWorld.create();
    const serverUrl = connectionTarget.serverUrl;
    const resolvedAccountKey = ensureAccountKey(connectionTarget.accountKeyScopeUrl ?? serverUrl);
    const accountKey = resolvedAccountKey.key.length > 0 ? resolvedAccountKey.key : null;
    const app = new GameClientApp(
      canvas,
      physics,
      GameClientApp.resolveCspEnabled(),
      GameClientApp.resolveE2eSimulationOnly(),
      serverUrl,
      accountKey ?? "",
      connectionTarget.joinTicket
    );
    void preloadAssetGroup(ASSET_GROUP_WORLD_DEFAULT, { priority: "near" }).catch((error) => {
      console.warn("[assets] world preload group failed", error);
    });
    void preloadAssetGroup(ASSET_GROUP_SFX, { priority: "background" }).catch((error) => {
      console.warn("[assets] sfx preload group failed", error);
    });
    void preloadAssetGroup(ASSET_GROUP_CREATOR_APPEARANCE, { priority: "background" }).catch((error) => {
      console.warn("[assets] creator appearance preload group failed", error);
    });
    onCreatePhase?.("network");
    await app.network.connect(serverUrl, accountKey, { joinTicket: app.joinTicket });
    if (app.network.getConnectionState() !== "connected" && app.joinTicket && connectionTarget.accountKeyScopeUrl) {
      const fallback = await GameClientApp.bootstrapFromOrchestrator(connectionTarget.accountKeyScopeUrl);
      if (fallback) {
        GameClientApp.installRuntimeMapConfig(fallback.mapConfig);
        await app.network.connect(fallback.wsUrl, accountKey, { joinTicket: fallback.joinTicket });
      }
    }
    onCreatePhase?.("ready");
    app.updateDiagnosticsOverlay(0);
    app.registerTestingHooks();
    return app;
  }

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.input.attach();
    window.addEventListener("beforeunload", this.onBeforeUnload);
    window.addEventListener("resize", this.onResize);
    this.onResize();
    if (!this.e2eSimulationOnly) {
      this.clock.start();
      this.rafId = window.requestAnimationFrame(this.loop);
    }
  }

  public stop(): void {
    if (this.running) {
      this.running = false;
      this.input.detach();
      window.removeEventListener("beforeunload", this.onBeforeUnload);
      window.removeEventListener("resize", this.onResize);
      window.cancelAnimationFrame(this.rafId);
    }
    if (!this.networkDisconnected) {
      this.network.disconnect("client-stop");
      this.networkDisconnected = true;
    }
    if (!this.uiDestroyed) {
      this.ui.destroy();
      this.uiDestroyed = true;
    }
    if (!this.rendererDisposed) {
      this.renderer.dispose();
      this.rendererDisposed = true;
    }
  }

  private readonly loop = (): void => {
    const frameDelta = Math.min(this.clock.getDelta(), 0.1);
    this.advance(frameDelta);
    this.rafId = window.requestAnimationFrame(this.loop);
  };

  private advance(seconds: number): void {
    this.maybeHandleMapTransferInstruction();
    this.trackFps(seconds);

    if (this.input.consumeMainMenuToggle()) {
      const open = this.ui.toggleMainMenu();
      this.input.setMainUiOpen(open);
      if (!open) {
        this.flushSettingsNow();
      }
      if (document.pointerLockElement === this.canvas) {
        void document.exitPointerLock();
      }
    }

    this.currentWorldInteractTarget = this.resolveWorldInteractTarget();
    const queuedInteractSlot = this.input.consumeInteractSlotTrigger();
    const queuedTestInteractSlot = this.consumeTestInteractTriggerSlot();
    const interactSlot = queuedInteractSlot ?? queuedTestInteractSlot;
    if (!this.ui.isMainMenuOpen() && interactSlot !== null) {
      const target = this.currentWorldInteractTarget;
      if (target) {
        const resolvedAction = this.resolveTargetActionBySlot(target, interactSlot);
        if (!resolvedAction) {
          this.ui.showAlert("That interaction key is not available for this target.", "warning");
          return;
        }
        if (!resolvedAction.enabled) {
          this.ui.showAlert(
            resolvedAction.disabledReason && resolvedAction.disabledReason.trim().length > 0
              ? resolvedAction.disabledReason
              : "That interaction is currently unavailable.",
            "warning"
          );
          return;
        }
        if (resolvedAction.id === "pickup_collect" && target.kind === "pickup") {
          this.network.queuePickupWorldItem(target.pickupNid, interactSlot);
        } else {
          if (target.kind === "station" && resolvedAction.id === "station_open_creator") {
            this.pendingStationCreatorOpenUntilMs = performance.now() + 1500;
            this.ui.setCreatorState(null);
            this.ui.openCreatorSection();
            this.input.setMainUiOpen(true);
            if (document.pointerLockElement === this.canvas) {
              void document.exitPointerLock();
            }
          }
          // Authoritative world interact fallback (station session / pilot console toggle).
          this.network.queuePickupWorldItem(0, interactSlot);
        }
      } else {
        this.network.queuePickupWorldItem(0, interactSlot);
      }
    }

    if (this.input.consumeCameraFreezeToggle()) {
      this.freezeCamera = !this.freezeCamera;
      this.frozenCameraPose = this.freezeCamera ? this.getRenderPose() : null;
    }
    if (this.input.consumeCspToggle()) {
      this.cspEnabled = !this.cspEnabled;
      this.networkOrchestrator.onCspModeChanged();
    }
    if (this.input.consumeDiagnosticsToggle()) {
      this.ui.toggleDiagnostics();
    }

    for (const bindingIntent of this.input.consumeBindingIntents()) {
      if (bindingIntent.target === "primary") {
        this.network.queuePrimaryMouseSlot(bindingIntent.slot);
      } else {
        this.network.queueSecondaryMouseSlot(bindingIntent.slot);
      }
    }

    this.accumulator += seconds;
    while (this.accumulator >= FIXED_STEP) {
      this.stepFixed(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this.network.updateInterpolatedSnapshots();
    this.applyAbilityEvents();
    this.applyAbilityCreatorEvents();
    this.applyInventoryEvents();
    this.applyCreatorActionResultEvents();
    this.applyInventoryFeedbackEvents();
    this.applySettingsEvents();
    this.applyServerAlertEvents();
    this.maybeFlushSettingsDebounced();
    this.updateHealthBar(seconds);

    const renderSnapshot = this.renderSnapshotAssembler.build(seconds);
    this.renderer.apply(renderSnapshot);
    this.renderedLocationFrameSnapshot = this.renderer.getRenderedLocationFrameSnapshot();
    this.applyVisualCarrierYawFromRenderedLocations();
    this.updateInteractPrompt();
    this.updateDiagnosticsOverlay(seconds);
    this.updateTestAlert(seconds);
  }

  private updateTestAlert(deltaSeconds: number): void {
    if (!this.testAlertsEnabled) {
      return;
    }
    this.testAlertElapsedSeconds += deltaSeconds;
    while (this.testAlertElapsedSeconds >= TEST_ALERT_INTERVAL_SECONDS) {
      this.testAlertElapsedSeconds -= TEST_ALERT_INTERVAL_SECONDS;
      const randomSeverity = ALERT_SEVERITIES[Math.floor(Math.random() * ALERT_SEVERITIES.length)] ?? "info";
      this.ui.showAlert(`Test alert [${randomSeverity}]: queued notification system active.`, randomSeverity);
    }
  }

  private stepFixed(delta: number): void {
    const mainUiOpen = this.ui.isMainMenuOpen();
    let movement =
      mainUiOpen
        ? { forward: 0, strafe: 0, jump: false, toggleFlyPressed: false, sprint: false }
        : (this.testMovementOverride ?? this.input.sampleMovement());
    if (!mainUiOpen && this.testMovementOverride?.toggleFlyPressed) {
      movement = { ...movement, toggleFlyPressed: true };
      this.testMovementOverride = { ...this.testMovementOverride, toggleFlyPressed: false };
    }
    const yaw = this.input.getYaw();
    const pitch = this.input.getPitch();

    const queuedDirectCastSlot = this.input.consumeDirectCastSlotTrigger();
    const usePrimaryPressedRaw = !mainUiOpen && (this.input.consumePrimaryActionTrigger() || this.consumeTestPrimaryActionTrigger());
    const useSecondaryPressedRaw = !mainUiOpen && (this.input.consumeSecondaryActionTrigger() || this.consumeTestSecondaryActionTrigger());
    const usePrimaryHeldRaw = !mainUiOpen && (this.input.isPrimaryActionHeld() || this.testPrimaryHeld);
    const useSecondaryHeldRaw = !mainUiOpen && (this.input.isSecondaryActionHeld() || this.testSecondaryHeld);
    const primaryHotbarPayload = this.inventoryState.hotbarSlots[this.primaryMouseSlot] ?? null;
    const secondaryHotbarPayload = this.inventoryState.hotbarSlots[this.secondaryMouseSlot] ?? null;
    const primaryUsesPayloadHotbar = primaryHotbarPayload !== null;
    const secondaryUsesPayloadHotbar = secondaryHotbarPayload !== null;
    const usePrimaryPressed = usePrimaryPressedRaw && !primaryUsesPayloadHotbar;
    const useSecondaryPressed = useSecondaryPressedRaw && !secondaryUsesPayloadHotbar;
    const usePrimaryHeld = usePrimaryHeldRaw && !primaryUsesPayloadHotbar;
    const useSecondaryHeld = useSecondaryHeldRaw && !secondaryUsesPayloadHotbar;
    const castSlotPressed = !mainUiOpen && queuedDirectCastSlot !== null;
    const castSlotIndex = queuedDirectCastSlot ?? 0;

    if (usePrimaryPressed && this.getAbilityDefinitionAtSlot(this.primaryMouseSlot)?.melee) {
      this.renderer.triggerLocalMeleePunch();
    }
    if (useSecondaryPressed && this.getAbilityDefinitionAtSlot(this.secondaryMouseSlot)?.melee) {
      this.renderer.triggerLocalMeleePunch();
    }
    if (usePrimaryPressedRaw && primaryUsesPayloadHotbar) {
      this.network.queueExecuteHotbarSlot(this.primaryMouseSlot, 0);
    }
    if (useSecondaryPressedRaw && secondaryUsesPayloadHotbar) {
      this.network.queueExecuteHotbarSlot(this.secondaryMouseSlot, 1);
    }

    this.networkOrchestrator.stepFixed({
      delta,
      movement,
      isCspActive: this.isCspActive(),
      orientation: { yaw, pitch },
      actions: {
        usePrimaryPressed,
        usePrimaryHeld,
        useSecondaryPressed,
        useSecondaryHeld,
        castSlotPressed,
        castSlotIndex
      },
      look: {
        getYaw: () => this.input.getYaw(),
        getPitch: () => this.input.getPitch(),
        applyYawDelta: (deltaYaw) => this.input.applyYawDelta(deltaYaw)
      }
    });

    const physicsPose = this.physics.getPose();
    this.previousPhysicsRenderPose = this.currentPhysicsRenderPose ?? {
      x: physicsPose.x,
      y: physicsPose.y,
      z: physicsPose.z
    };
    this.currentPhysicsRenderPose = {
      x: physicsPose.x,
      y: physicsPose.y,
      z: physicsPose.z
    };

    this.sampleGroundingDiagnostics();
  }

  private applyAbilityEvents(): void {
    const events = this.network.consumeAbilityEvents();
    if (!events) {
      return;
    }

    for (const definition of events.definitions) {
      this.ui.upsertAbility(definition);
    }

    if (events.abilityState) {
      this.primaryMouseSlot = events.abilityState.primaryMouseSlot;
      this.secondaryMouseSlot = events.abilityState.secondaryMouseSlot;
      this.ui.setMouseBindings(this.primaryMouseSlot, this.secondaryMouseSlot);
    }
    if (events.ownedAbilityIds) {
      this.ui.setOwnedAbilityIds(events.ownedAbilityIds);
    }
  }

  private applyAbilityCreatorEvents(): void {
    const genCreatorState = this.network.consumeCreatorState();
    if (genCreatorState) {
      this.ui.setCreatorState(genCreatorState);
      if (
        genCreatorState.sessionId > 0 &&
        genCreatorState.sessionId !== this.lastCreatorSessionId &&
        performance.now() <= this.pendingStationCreatorOpenUntilMs
      ) {
        this.ui.openCreatorSection();
        this.pendingStationCreatorOpenUntilMs = 0;
      }
      this.lastCreatorSessionId = genCreatorState.sessionId;
    }
  }

  private applyInventoryEvents(): void {
    const inventoryState = this.network.consumeInventoryState();
    if (!inventoryState) {
      return;
    }
    this.inventoryState = inventoryState;
    this.syncAbilityAssignmentsFromInventoryHotbar();
    this.ui.setInventoryState(inventoryState);
  }

  private syncAbilityAssignmentsFromInventoryHotbar(): void {
    const nextAssignments = new Array<number>(this.hotbarAbilityIds.length).fill(ABILITY_ID_NONE);
    const slots = this.inventoryState.hotbarSlots;
    for (let slot = 0; slot < nextAssignments.length; slot += 1) {
      const payload = slots[slot] ?? null;
      if (payload?.kind === "ability") {
        nextAssignments[slot] = payload.refId;
      }
    }
    this.hotbarAbilityIds = nextAssignments;
    this.ui.setHotbarAssignments(this.hotbarAbilityIds);
  }

  private applyCreatorActionResultEvents(): void {
    const results = this.network.consumeCreatorActionResults();
    for (const result of results) {
      const text = result.message.trim();
      if (text.length <= 0) {
        continue;
      }
      this.ui.showAlert(text, result.ok ? "success" : "warning");
    }
  }

  private applyInventoryFeedbackEvents(): void {
    const feedbacks = this.network.consumeInventoryActionFeedback();
    for (const feedback of feedbacks) {
      if (feedback.ok) {
        continue;
      }
      console.warn(`[inventory] action=${feedback.action} failed reason=${feedback.reason}`);
    }
  }

  private applySettingsEvents(): void {
    const state = this.network.consumeSettingsState();
    if (!state) {
      return;
    }
    this.applyPlayerSettingsPatch(state.settings, false);
  }

  private applyServerAlertEvents(): void {
    const alerts = this.network.consumeServerAlerts();
    for (const alert of alerts) {
      this.ui.showAlert(alert.text, alert.severity);
    }
  }

  private maybeFlushSettingsDebounced(): void {
    const nowMs = performance.now();
    if (!this.settingsSaveScheduler.consumeShouldFlush(nowMs)) {
      return;
    }
    this.sendSettingsToServer();
  }

  private flushSettingsNow(): void {
    if (!this.settingsSaveScheduler.forceFlush()) {
      return;
    }
    this.sendSettingsToServer();
  }

  private sendSettingsToServer(): void {
    if (this.network.getConnectionState() !== "connected") {
      this.settingsSaveScheduler.markDirty(performance.now());
      return;
    }
    const settings = this.buildSettingsSnapshot();
    this.network.queuePlayerSettings(JSON.stringify(settings));
  }

  private applyPlayerSettingsPatch(settingsPatch: Partial<PlayerSettings>, markDirtyForServer: boolean): void {
    const normalized = coercePlayerSettings({
      ...this.playerSettings,
      ...settingsPatch
    });
    this.playerSettings = normalized;
    this.applyInputSettings(normalized);
    this.ui.setPlayerSettings(normalized);
    this.renderer.setFieldOfView(normalized.fieldOfView);
    GameClientApp.saveCachedPlayerSettings(normalized);
    if (markDirtyForServer) {
      this.settingsSaveScheduler.markDirty(performance.now());
    }
  }

  private applyInputSettings(settings: PlayerSettings): void {
    this.input.setDigitKeysActivateHotbar(settings.digitKeysActivateHotbar);
    this.input.setMouseSensitivity(settings.mouseSensitivity);
    this.input.setMouseSmoothingEnabled(settings.mouseSmoothing);
  }

  private applyClientLocalSettingsPatch(settingsPatch: Partial<ClientLocalSettings>): void {
    const previous = this.clientLocalSettings;
    const normalized = coerceClientLocalSettings({
      ...previous,
      ...settingsPatch
    });
    this.clientLocalSettings = normalized;
    this.ui.setClientLocalSettings(normalized);
    this.renderer.setGraphicsPreset(normalized.graphicsPreset);
    GameClientApp.saveCachedClientLocalSettings(normalized);
    if (normalized.antiAliasingMode !== previous.antiAliasingMode) {
      window.location.reload();
    }
  }

  private buildSettingsSnapshot(): PlayerSettings {
    return this.playerSettings;
  }

  private updateDiagnosticsOverlay(frameDeltaSeconds: number): void {
    this.updateConnectedPlayersIndicator();
    this.ui.updateDiagnostics(this.buildNetworkDiagnosticsSnapshot());
    this.updateClientKinematics(frameDeltaSeconds);
  }

  private updateHealthBar(deltaSeconds: number): void {
    const localPlayerRuntime = this.network.getLocalPlayerPose();
    this.ui.updateLocalPlayerHealth(
      localPlayerRuntime?.health ?? null,
      localPlayerRuntime?.maxHealth ?? null,
      deltaSeconds
    );
  }

  private updateClientKinematics(frameDeltaSeconds: number): void {
    const pose = this.getRenderPose();
    if (
      this.previousKinematicsPose &&
      Number.isFinite(frameDeltaSeconds) &&
      frameDeltaSeconds > 0
    ) {
      const invDelta = 1 / frameDeltaSeconds;
      this.currentClientFrameVelocity.x = (pose.x - this.previousKinematicsPose.x) * invDelta;
      this.currentClientFrameVelocity.y = (pose.y - this.previousKinematicsPose.y) * invDelta;
      this.currentClientFrameVelocity.z = (pose.z - this.previousKinematicsPose.z) * invDelta;
    } else {
      this.currentClientFrameVelocity.x = 0;
      this.currentClientFrameVelocity.y = 0;
      this.currentClientFrameVelocity.z = 0;
    }
    this.previousKinematicsPose = { x: pose.x, y: pose.y, z: pose.z };
    const instantaneousSpeed = Math.hypot(
      this.currentClientFrameVelocity.x,
      this.currentClientFrameVelocity.y,
      this.currentClientFrameVelocity.z
    );
    const speedAlpha = Number.isFinite(frameDeltaSeconds) && frameDeltaSeconds > 0
      ? Math.max(0, Math.min(1, frameDeltaSeconds / CLIENT_KINEMATICS_SPEED_SMOOTH_SECONDS))
      : 1;
    this.smoothedClientSpeed += (instantaneousSpeed - this.smoothedClientSpeed) * speedAlpha;
    const physicsKinematic = this.physics.getKinematicState();
    const horizontalSpeed = Math.hypot(physicsKinematic.vx, physicsKinematic.vz);
    this.ui.updateClientKinematics({
      x: pose.x,
      y: pose.y,
      z: pose.z,
      renderSpeed: this.smoothedClientSpeed,
      physicsVx: physicsKinematic.vx,
      physicsVy: physicsKinematic.vy,
      physicsVz: physicsKinematic.vz,
      horizontalSpeed
    });
  }

  private buildNetworkDiagnosticsSnapshot(): NetworkDiagnosticsSnapshot {
    const remotePlayers = this.network.getRemotePlayers();
    const localCount = this.network.getLocalPlayerNid() === null ? 0 : 1;
    const aoiPlayers = remotePlayers.length + localCount;
    const mapConfig = GameClientApp.readRuntimeMapConfig();
    const mapLabel =
      mapConfig ? `${mapConfig.instanceId} (${mapConfig.mapId})` : "unknown";
    const localPlayerNid = this.network.getLocalPlayerNid();
    const netDiagnostics = this.network.getServerNetDiagnostics();
    return {
      connectionMode: this.network.getConnectionState(),
      endpoint: this.network.getCurrentServerUrl() ?? this.serverUrl,
      mapLabel,
      localPlayerNid: localPlayerNid === null ? "--" : String(localPlayerNid),
      cspLabel: this.isCspActive() ? "on" : "off",
      movementModeLabel: movementModeToLabel(this.resolveLocalMovementMode()),
      pingMs: `${this.network.getLatencyMs().toFixed(1)} ms`,
      interpolationDelayMs: `${this.network.getInterpolationDelayMs().toFixed(1)} ms`,
      ackJitterMs: `${this.network.getAckJitterMs().toFixed(1)} ms`,
      serverClockOffsetMs: `${this.network.getServerClockOffsetMs().toFixed(1)} ms`,
      serverPlayers:
        this.network.getServerPlayerCount() === null ? "--" : String(this.network.getServerPlayerCount()),
      netWindow: netDiagnostics ? `${netDiagnostics.windowSeconds}s` : "--",
      netBudgetStatus: this.formatNetWarningStatus(netDiagnostics?.warningMask ?? 0),
      netOutBytesPerSecond: this.formatNetKibPerSecondPair(
        netDiagnostics?.avgOutboundBytesPerSecond ?? 0,
        netDiagnostics?.p95OutboundBytesPerSecond ?? 0
      ),
      netInBytesPerSecond: this.formatNetKibPerSecondPair(
        netDiagnostics?.avgInboundBytesPerSecond ?? 0,
        netDiagnostics?.p95InboundBytesPerSecond ?? 0
      ),
      netOutMessagesPerSecond: this.formatNetRatePair(
        netDiagnostics?.avgOutboundMessagesPerSecond ?? 0,
        netDiagnostics?.p95OutboundMessagesPerSecond ?? 0
      ),
      netInMessagesPerSecond: this.formatNetRatePair(
        netDiagnostics?.avgInboundMessagesPerSecond ?? 0,
        netDiagnostics?.p95InboundMessagesPerSecond ?? 0
      ),
      aoiPlayers: String(aoiPlayers),
      locationRoots: String(this.network.getLocationRoots().length),
      worldEntities: String(this.network.getWorldEntities().length),
      projectiles: String(this.network.getProjectiles().length),
      fps: this.fps.toFixed(1),
      lowFpsFrames: String(this.lowFpsFrameCount)
    };
  }

  private updateConnectedPlayersIndicator(): void {
    const remoteCount = this.network.getRemotePlayers().length;
    const localCount = this.network.getLocalPlayerNid() === null ? 0 : 1;
    const aoiCount = remoteCount + localCount;
    const serverPlayers = this.network.getServerPlayerCount();
    const playersText = serverPlayers === null ? "..." : String(serverPlayers);
    this.ui.updatePlayerCount(playersText, aoiCount);
  }

  private trackFps(seconds: number): void {
    if (seconds > 0 && 1 / seconds < 30) {
      this.lowFpsFrameCount += 1;
    }

    this.fpsSampleSeconds += seconds;
    this.fpsSampleFrames += 1;
    if (this.fpsSampleSeconds < 0.25) {
      return;
    }

    const sampleFps = this.fpsSampleFrames / this.fpsSampleSeconds;
    this.fps = this.fps === 0 ? sampleFps : this.fps * 0.75 + sampleFps * 0.25;
    this.fpsSampleSeconds = 0;
    this.fpsSampleFrames = 0;
  }

  private buildRenderGameStatePayload(scope: "full" | "minimal" = "full"): RenderGameStatePayload {
    const pose = this.getRenderPose();
    const reconDiagnostics = this.networkOrchestrator.getDiagnostics();
    const remotePlayers = this.network.getRemotePlayers();
    const localKinematic = this.physics.getKinematicState();
    const basePayload: RenderGameStatePayload = {
      mode: this.network.getConnectionState(),
      pointerLock: document.pointerLockElement === this.canvas,
      coordinateSystem: "right-handed; +x right, +y up, -z forward",
      player: {
        ...pose,
        nid: this.network.getLocalPlayerNid(),
        movementMode: movementModeToLabel(this.resolveLocalMovementMode()),
        groundedPlatformPid: localKinematic.groundedPlatformPid,
        carriedFramePid: localKinematic.carriedFramePid
      },
      remotePlayers: remotePlayers.map((p) => ({
        nid: p.nid,
        x: p.x,
        y: p.y,
        z: p.z,
        grounded: p.grounded,
        movementMode: movementModeToLabel(p.movementMode),
        health: p.health
      })),
      perf: {
        fps: this.fps,
        lowFpsFrameCount: this.lowFpsFrameCount
      },
      map: GameClientApp.readRuntimeMapConfig()
    };

    if (scope === "minimal") {
      return basePayload;
    }

    return {
      ...basePayload,
      worldAnchors: this.network.getWorldAnchors().map((location) => ({
        nid: location.nid,
        modelId: location.modelId,
        worldAnchorId: location.worldAnchorId,
        worldAnchorKind: location.worldAnchorKind,
        worldAnchorArchetypeId: location.worldAnchorArchetypeId,
        worldAnchorSeed: location.worldAnchorSeed,
        worldAnchorEnvironmentId: location.worldAnchorEnvironmentId,
        worldAnchorStreamingRadius: location.worldAnchorStreamingRadius,
        worldAnchorInfluenceRadius: location.worldAnchorInfluenceRadius,
        x: location.x,
        y: location.y,
        z: location.z,
        rotation: location.rotation
      })),
      locationRoots: this.network.getWorldAnchors().map((location) => ({ ...location })),
      projectiles: this.network.getProjectiles().map((projectile) => ({
        nid: projectile.nid,
        modelId: projectile.modelId,
        x: projectile.x,
        y: projectile.y,
        z: projectile.z
      })),
      worldEntities: [
        ...this.getRenderPlatformStates(),
        ...this.network.getWorldEntities()
      ].map((e) => ({
        nid: e.nid,
        modelId: e.modelId,
        renderArchetypeId: e.renderArchetypeId,
        materialVariantId: e.materialVariantId,
        tintColorRgb: e.tintColorRgb,
        uniformScalePct: e.uniformScalePct,
        x: e.x, y: e.y, z: e.z,
        rotationX: e.rotationX, rotationY: e.rotationY, rotationZ: e.rotationZ, rotationW: e.rotationW,
        health: e.health,
        maxHealth: e.maxHealth,
        pickupDefinitionId: e.pickupDefinitionId,
        itemQuantity: e.itemQuantity
      })),
      inventory: {
        items: this.inventoryState.itemInstances.map((item) => ({
          itemInstanceId: item.itemInstanceId,
          definitionId: item.definitionId,
          name: getItemDefinitionById(item.definitionId)?.name ?? "Unknown",
          quantity: item.quantity,
          slotIndex: item.slotIndex
        })),
        equipment: this.inventoryState.equipment
      },
      worldInteraction: this.currentWorldInteractTarget
        ? {
            kind: this.currentWorldInteractTarget.kind,
            actions: this.currentWorldInteractTarget.actions.map((action) => ({
              slot: action.slot,
              label: action.label,
              enabled: action.enabled,
              disabledReason: action.disabledReason
            }))
          }
        : null,
      localAbility: {
        ui: {
          mainMenuOpen: this.ui.isMainMenuOpen()
        },
        bindings: {
          primaryMouseSlot: this.primaryMouseSlot,
          secondaryMouseSlot: this.secondaryMouseSlot,
          primaryAbilityId: this.hotbarAbilityIds[this.primaryMouseSlot] ?? ABILITY_ID_NONE,
          secondaryAbilityId: this.hotbarAbilityIds[this.secondaryMouseSlot] ?? ABILITY_ID_NONE
        },
        hotbar: this.hotbarAbilityIds.map((abilityId, slot) => ({
          slot,
          abilityId,
          abilityName: this.resolveAbilityName(abilityId)
        })),
        catalog: this.network.getAbilityCatalog().map((ability) => ({
          id: ability.id,
          name: ability.name,
          category: ability.category,
          hasProjectile: Boolean(ability.projectile),
          hasMelee: Boolean(ability.melee)
        }))
      },
      netTiming: {
        latencyMs: this.network.getLatencyMs(),
        interpolationDelayMs: this.network.getInterpolationDelayMs(),
        ackJitterMs: this.network.getAckJitterMs(),
        serverClockOffsetMs: this.network.getServerClockOffsetMs()
      },
      reconciliation: {
        lastError: {
          position: reconDiagnostics.lastPositionError,
          yaw: reconDiagnostics.lastYawError,
          pitch: reconDiagnostics.lastPitchError
        },
        smoothingOffset: {
          x: reconDiagnostics.rawOffset.x,
          y: reconDiagnostics.rawOffset.y,
          z: reconDiagnostics.rawOffset.z,
          yaw: 0,
          pitch: 0,
          positionMagnitude: reconDiagnostics.worldOffsetMagnitude
        },
        lastReplayCount: reconDiagnostics.lastReplayCount,
        totalCorrections: reconDiagnostics.totalCorrections,
        hardSnapCorrections: reconDiagnostics.hardSnapCorrections
      }
    };
  }

  private registerTestingHooks(): void {
    window.advanceTime = (ms: number) => {
      const clampedMs = Math.max(1, Math.min(ms, 5000));
      const steps = Math.max(1, Math.round(clampedMs / (FIXED_STEP * 1000)));
      for (let i = 0; i < steps; i++) {
        this.stepFixed(FIXED_STEP);
      }
      this.applyAbilityEvents();
      this.applyInventoryEvents();
      if (!this.e2eSimulationOnly) {
        const renderSnapshot = this.renderSnapshotAssembler.build(FIXED_STEP);
        this.renderer.apply(renderSnapshot);
        this.updateInteractPrompt();
        this.updateDiagnosticsOverlay(FIXED_STEP);
      }
    };

    window.render_game_state = (scope = "full") => {
      return this.buildRenderGameStatePayload(scope);
    };

    window.render_game_to_text = () => {
      return JSON.stringify(this.buildRenderGameStatePayload("full"));
    };

    window.set_test_movement = (movement) => {
      if (!movement) {
        this.testMovementOverride = null;
        return;
      }
      this.testMovementOverride = {
        forward: movement.forward,
        strafe: movement.strafe,
        jump: movement.jump,
        toggleFlyPressed: Boolean(movement.toggleFlyPressed),
        sprint: movement.sprint
      };
    };
    window.trigger_test_primary_action = (count = 1) => {
      const normalized = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
      this.queuedTestPrimaryActionCount = Math.min(
        this.queuedTestPrimaryActionCount + normalized,
        1024
      );
    };
    window.trigger_test_secondary_action = (count = 1) => {
      const normalized = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
      this.queuedTestSecondaryActionCount = Math.min(
        this.queuedTestSecondaryActionCount + normalized,
        1024
      );
    };
    window.trigger_test_interact = (count = 1, slot = 0) => {
      const normalized = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
      const normalizedSlot = Number.isFinite(slot) ? Math.max(0, Math.floor(slot)) : 0;
      this.queuedTestInteractSlot = normalizedSlot;
      this.queuedTestInteractCount = Math.min(this.queuedTestInteractCount + normalized, 1024);
    };
    window.drop_first_inventory_item = () => {
      const first = this.inventoryState.itemInstances[0];
      if (first) {
        this.network.queueDropInventoryItem(first.itemInstanceId);
      }
    };
    window.use_first_inventory_item = () => {
      const firstUsable = this.inventoryState.itemInstances.find((item) =>
        Boolean(getItemDefinitionById(item.definitionId)?.use)
      );
      if (firstUsable) {
        this.network.queueUseInventoryItem(firstUsable.itemInstanceId);
      }
    };
    window.equip_first_equipment_item = () => {
      const firstEquipment = this.inventoryState.itemInstances.find((item) =>
        Boolean(getItemDefinitionById(item.definitionId)?.equipSlot)
      );
      if (firstEquipment) {
        this.network.queueEquipInventoryItem(firstEquipment.itemInstanceId);
      }
    };
    window.set_test_primary_hold = (held) => {
      this.testPrimaryHeld = Boolean(held);
    };
    window.set_test_secondary_hold = (held) => {
      this.testSecondaryHeld = Boolean(held);
    };
    window.set_test_look_angles = (yaw, pitch) => {
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
        return;
      }
      this.input.setLookAngles(yaw, pitch);
    };
    window.request_map_transfer = (targetMapInstanceId) => {
      if (typeof targetMapInstanceId !== "string") {
        return;
      }
      this.network.queueMapTransfer(targetMapInstanceId);
    };
    window.get_creator_state = () => {
      const state = this.network.getLatestCreatorState();
      if (!state) {
        return null;
      }
      return {
        sessionId: state.sessionId,
        profileId: state.profileId,
        baseBlueprintId: state.draft.baseBlueprintId,
        draft: {
          name: state.draft.name,
          profileId: state.draft.profileId,
          baseBlueprintId: state.draft.baseBlueprintId,
          fieldValues: { ...state.draft.fieldValues }
        },
        capacity: {
          statBudgetTotal: state.capacity.statBudgetTotal,
          statBudgetSpent: state.capacity.statBudgetSpent,
          statBudgetRemaining: state.capacity.statBudgetRemaining,
          attributeBudget: { ...state.capacity.attributeBudget },
          attributeSlots: { ...state.capacity.attributeSlots }
        },
        availableBlueprintIds: state.availableBlueprints.map((entry) => entry.id),
        availableBlueprintCount: state.availableBlueprintCount,
        validation: state.validation,
        productionPreview: state.productionPreview
      };
    };
    window.send_creator_command = (command) => {
      if (!command || typeof command !== "object") {
        return;
      }
      this.network.queueCreatorCommand(command);
    };
    window.get_recent_alerts = () => {
      return this.ui.getRecentAlerts().map((entry) => ({ text: entry.text, severity: entry.severity }));
    };
    window.inspect_creator_appearance_rollout = () => {
      const appearanceBindings = getCreatorAppearanceOptions().map((option) => {
        const readyBinding = resolveReadyAppearanceRuntimeBinding(option.value);
        const activationBinding = resolveActivationAppearanceRuntimeBinding(option.value);
        return {
          appearanceId: option.value,
          ready: {
            equipped: {
              assetId: readyBinding.equipped.assetId,
              renderArchetypeId: readyBinding.equipped.renderArchetypeId ?? null,
              previewTextureUrl: readyBinding.equipped.previewTextureUrl
            },
            pickup: {
              assetId: readyBinding.pickup.assetId,
              renderArchetypeId: readyBinding.pickup.renderArchetypeId ?? null,
              previewTextureUrl: readyBinding.pickup.previewTextureUrl
            }
          },
          activation: {
            assetId: activationBinding.assetId,
            projectileKind: activationBinding.projectileKind,
            previewTextureUrl: activationBinding.previewTextureUrl
          }
        };
      });
      const itemByInstanceId = new Map(this.inventoryState.itemInstances.map((item) => [item.itemInstanceId, item]));
      const equippedItems = Object.entries(this.inventoryState.equipment)
        .map(([slot, itemInstanceId]) => {
          const item = itemByInstanceId.get(itemInstanceId ?? 0);
          if (!item) {
            return null;
          }
          const definition = getItemDefinitionById(item.definitionId);
          if (!definition) {
            return null;
          }
          return {
            slot,
            itemInstanceId: item.itemInstanceId,
            definitionId: definition.id,
            key: definition.key,
            name: definition.name,
            readyAppearanceId: definition.readyAppearanceId ?? null,
            readyAppearanceEquippedAssetId: definition.readyAppearanceEquippedAssetId ?? definition.readyAppearanceAssetId ?? null,
            readyAppearancePickupAssetId: definition.readyAppearancePickupAssetId ?? definition.readyAppearanceAssetId ?? null
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const worldPickups = this.network.getWorldEntities()
        .filter((entry) => entry.pickupDefinitionId > 0)
        .map((entry) => {
          const definition = getItemDefinitionById(entry.pickupDefinitionId);
          if (!definition) {
            return null;
          }
          return {
            nid: entry.nid,
            definitionId: definition.id,
            key: definition.key,
            name: definition.name,
            readyAppearanceId: definition.readyAppearanceId ?? null,
            readyAppearancePickupAssetId: definition.readyAppearancePickupAssetId ?? definition.readyAppearanceAssetId ?? null
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const ownedAbilities = this.network.getOwnedAbilityIds()
        .map((abilityId) => {
          const definition = this.network.getAbilityById(abilityId);
          if (!definition) {
            return null;
          }
          return {
            abilityId: definition.id,
            key: definition.key,
            name: definition.name,
            activationAppearanceId: definition.activationAppearanceId ?? null,
            activationAppearanceAssetId: definition.activationAppearanceAssetId ?? null
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      return {
        appearanceBindings,
        equippedItems,
        worldPickups,
        ownedAbilities
      };
    };
    window.validate_creator_appearance_rollout = () => {
      const snapshot = window.inspect_creator_appearance_rollout?.();
      const issues: string[] = [];
      if (!snapshot) {
        return {
          ok: false,
          issues: ["Creator appearance snapshot is unavailable."],
          counts: { bindings: 0, equippedItems: 0, worldPickups: 0, ownedAbilities: 0 }
        };
      }
      const assetIds = new Set(ASSET_CATALOG.map((entry) => entry.id));
      for (const binding of snapshot.appearanceBindings) {
        if (!binding.ready.equipped.assetId || !assetIds.has(binding.ready.equipped.assetId)) {
          issues.push(`Missing/unknown equipped asset id for appearance "${binding.appearanceId}".`);
        }
        if (!binding.ready.pickup.assetId || !assetIds.has(binding.ready.pickup.assetId)) {
          issues.push(`Missing/unknown pickup asset id for appearance "${binding.appearanceId}".`);
        }
        if (!binding.activation.assetId || !assetIds.has(binding.activation.assetId)) {
          issues.push(`Missing/unknown activation asset id for appearance "${binding.appearanceId}".`);
        }
        if (binding.ready.equipped.renderArchetypeId === null || binding.ready.pickup.renderArchetypeId === null) {
          issues.push(`Missing ready render archetype for appearance "${binding.appearanceId}".`);
        }
      }
      for (const item of snapshot.equippedItems) {
        if (item.readyAppearanceId && !item.readyAppearanceEquippedAssetId) {
          issues.push(`Equipped item "${item.name}" (${item.slot}) missing ready equipped asset id.`);
        }
        if (item.readyAppearanceId && !item.readyAppearancePickupAssetId) {
          issues.push(`Equipped item "${item.name}" (${item.slot}) missing ready pickup asset id.`);
        }
      }
      for (const pickup of snapshot.worldPickups) {
        if (pickup.readyAppearanceId && !pickup.readyAppearancePickupAssetId) {
          issues.push(`World pickup "${pickup.name}" missing ready pickup asset id.`);
        }
      }
      for (const ability of snapshot.ownedAbilities) {
        if (ability.activationAppearanceId && !ability.activationAppearanceAssetId) {
          issues.push(`Owned ability "${ability.name}" missing activation appearance asset id.`);
        }
      }
      return {
        ok: issues.length <= 0,
        issues,
        counts: {
          bindings: snapshot.appearanceBindings.length,
          equippedItems: snapshot.equippedItems.length,
          worldPickups: snapshot.worldPickups.length,
          ownedAbilities: snapshot.ownedAbilities.length
        }
      };
    };
    window.inspect_actor_capabilities = () => {
      this.network.queueCreatorCommand({ inspectActorCapabilities: true });
    };
    window.set_actor_capability = (key, value) => {
      if (typeof key !== "string" || key.trim().length <= 0 || !Number.isFinite(value)) {
        return;
      }
      this.network.queueCreatorCommand({
        setActorCapability: true,
        capabilityKey: key.trim(),
        capabilityValue: value
      });
    };
  }

  private getRenderPose() {
    if (this.freezeCamera && this.frozenCameraPose) {
      return { ...this.frozenCameraPose };
    }
    const renderPosition = this.getRenderPosition();
    const renderOffset = this.networkOrchestrator.getWorldOffset();
    return {
      x: renderPosition.x + renderOffset.x,
      y: renderPosition.y + renderOffset.y,
      z: renderPosition.z + renderOffset.z,
      yaw: this.input.getYaw(),
      pitch: Math.max(-LOOK_PITCH_LIMIT, Math.min(LOOK_PITCH_LIMIT, this.input.getPitch()))
    };
  }

  private createRenderSnapshot(frameDeltaSeconds: number): RenderFrameSnapshot {
    const renderServerTimeSeconds = this.networkOrchestrator.advanceRenderServerTime(
      frameDeltaSeconds,
      this.isCspActive()
    );
    const worldEntities = [
      ...this.getRenderPlatformStatesAt(renderServerTimeSeconds),
      ...this.network.getWorldEntities()
    ];
    const localPlayerRuntime = this.network.getLocalPlayerPose();
    return {
      frameDeltaSeconds,
      renderServerTimeSeconds,
      localPose: this.getRenderPose(),
      localGrounded: this.resolveLocalGroundedState(),
      localMovementMode: this.resolveLocalMovementMode(),
      localPlayerNid: this.network.getLocalPlayerNid(),
      localEquippedWeaponArchetypeId: localPlayerRuntime?.equippedWeaponArchetypeId ?? 0,
      localEquippedWeaponTintColorRgb: localPlayerRuntime?.equippedWeaponTintColorRgb ?? 0xffffff,
      localEquippedHeadArchetypeId: localPlayerRuntime?.equippedHeadArchetypeId ?? 0,
      localEquippedHeadTintColorRgb: localPlayerRuntime?.equippedHeadTintColorRgb ?? 0xffffff,
      localEquippedBodyArchetypeId: localPlayerRuntime?.equippedBodyArchetypeId ?? 0,
      localEquippedBodyTintColorRgb: localPlayerRuntime?.equippedBodyTintColorRgb ?? 0xffffff,
      localEquippedLegsArchetypeId: localPlayerRuntime?.equippedLegsArchetypeId ?? 0,
      localEquippedLegsTintColorRgb: localPlayerRuntime?.equippedLegsTintColorRgb ?? 0xffffff,
      localEquippedAccessoryArchetypeId: localPlayerRuntime?.equippedAccessoryArchetypeId ?? 0,
      localEquippedAccessoryTintColorRgb: localPlayerRuntime?.equippedAccessoryTintColorRgb ?? 0xffffff,
      remotePlayers: this.network.getRemotePlayers(),
      abilityUseEvents: this.network.consumeAbilityUseEvents(),
      worldAnchors: this.network.getWorldAnchors(),
      locationRoots: this.network.getWorldAnchors(),
      worldEntities,
      projectiles: this.network.getProjectiles()
    };
  }

  private getRenderPosition(): { x: number; y: number; z: number } {
    if (this.isCspActive()) {
      const previous = this.previousPhysicsRenderPose;
      const current = this.currentPhysicsRenderPose;
      if (previous && current) {
        const alpha = Math.max(0, Math.min(1, this.accumulator / FIXED_STEP));
        return {
          x: previous.x + (current.x - previous.x) * alpha,
          y: previous.y + (current.y - previous.y) * alpha,
          z: previous.z + (current.z - previous.z) * alpha
        };
      }
      const pose = this.physics.getPose();
      return { x: pose.x, y: pose.y, z: pose.z };
    }

    const authoritative = this.network.getLocalPlayerPose();
    if (authoritative) {
      return { x: authoritative.x, y: authoritative.y, z: authoritative.z };
    }

    const fallback = this.physics.getPose();
    return { x: fallback.x, y: fallback.y, z: fallback.z };
  }

  private getRenderPlatformStates() {
    return this.platformTimeline.sampleStates(this.networkOrchestrator.getRenderServerTimeSeconds(this.isCspActive()));
  }

  private getRenderPlatformStatesAt(renderServerTimeSeconds: number) {
    return this.platformTimeline.sampleStates(renderServerTimeSeconds);
  }

  private readonly onResize = (): void => {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  };

  private resolveAbilityName(abilityId: number): string {
    return (
      this.network.getAbilityById(abilityId)?.name ?? getAbilityDefinitionById(abilityId)?.name ?? "Empty"
    );
  }

  private getAbilityDefinitionAtSlot(slot: number) {
    const normalizedSlot = Math.max(0, Math.min(this.hotbarAbilityIds.length - 1, Math.floor(slot)));
    const abilityId = this.hotbarAbilityIds[normalizedSlot] ?? ABILITY_ID_NONE;
    return this.network.getAbilityById(abilityId) ?? getAbilityDefinitionById(abilityId);
  }

  private resolveLocalGroundedState(): boolean {
    if (this.isCspActive()) {
      return this.physics.isGrounded();
    }
    return this.network.getLocalPlayerPose()?.grounded ?? this.physics.isGrounded();
  }

  private resolveLocalMovementMode() {
    if (this.isCspActive()) {
      return this.physics.getKinematicState().movementMode;
    }
    return this.network.getLocalPlayerPose()?.movementMode ?? this.physics.getKinematicState().movementMode;
  }

  private consumeTestPrimaryActionTrigger(): boolean {
    if (this.queuedTestPrimaryActionCount <= 0) {
      return false;
    }
    this.queuedTestPrimaryActionCount -= 1;
    return true;
  }

  private consumeTestSecondaryActionTrigger(): boolean {
    if (this.queuedTestSecondaryActionCount <= 0) {
      return false;
    }
    this.queuedTestSecondaryActionCount -= 1;
    return true;
  }

  private consumeTestInteractTriggerSlot(): number | null {
    if (this.queuedTestInteractCount <= 0) {
      return null;
    }
    this.queuedTestInteractCount -= 1;
    return this.queuedTestInteractSlot;
  }

  private resolveInteractionTargetNid(): number | null {
    const pose = this.getRenderPose();
    const direction = this.computeViewDirection(pose.yaw, pose.pitch);
    let bestNid: number | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const entity of this.network.getWorldEntities().filter(e => e.pickupDefinitionId > 0)) {
      const dx = entity.x - pose.x;
      const dy = entity.y + 0.85 - pose.y;
      const dz = entity.z - pose.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > 3.35 || distance <= 0.001) {
        continue;
      }
      const dot = (dx * direction.x + dy * direction.y + dz * direction.z) / distance;
      if (dot < 0.42) {
        continue;
      }
      const score = dot * 2 - distance * 0.22;
      if (score > bestScore) {
        bestScore = score;
        bestNid = entity.nid;
      }
    }
    return bestNid;
  }

  private updateInteractPrompt(): void {
    if (this.ui.isMainMenuOpen()) {
      this.ui.clearInteractPrompt();
      return;
    }
    if (!this.currentWorldInteractTarget) {
      this.ui.clearInteractPrompt();
      return;
    }
    this.ui.showInteractPromptActions(
      Array.from(
        new Map(
          this.currentWorldInteractTarget.actions.map((action) => [
            `${action.id}:${action.slot}`,
            {
              keyLabel: this.getInteractKeyLabel(action.slot),
              label: action.label,
              enabled: action.enabled,
              disabledReason: action.disabledReason
            }
          ])
        ).values()
      )
    );
  }

  private resolveWorldInteractTarget(): WorldInteractTarget | null {
    const pickupNid = this.resolveInteractionTargetNid();
    if (pickupNid !== null) {
      const item = this.network.getWorldEntities().find((entry) => entry.nid === pickupNid && entry.pickupDefinitionId > 0);
      const definition = item ? getItemDefinitionById(item.pickupDefinitionId) : null;
      if (item) {
        const itemName = definition?.name ?? `Item #${item.pickupDefinitionId}`;
        return {
          kind: "pickup",
          pickupNid,
          pickupContext: { itemName, itemQuantity: item.itemQuantity },
          actions: getWorldInteractionActions("pickup", {
            itemName,
            itemQuantity: item.itemQuantity
          })
        };
      }
    }
    const pose = this.getRenderPose();
    const nearbyStationPrompt = this.findNearbyStationPrompt(pose);
    if (nearbyStationPrompt) {
      const profileTemplateIds = getBlueprintDefinitionsForProfile(nearbyStationPrompt.creatorProfileId).map((blueprint) => blueprint.id);
      const filteredTemplateIds = filterCreatorTemplateBlueprintIdsForStation(
        profileTemplateIds,
        nearbyStationPrompt.allowedTemplateBlueprintIds
      );
      const templateCount = filteredTemplateIds.length;
      const actions = getWorldInteractionActions("station").map((action) => ({
        ...action,
        label: nearbyStationPrompt.label,
        enabled: templateCount > 0,
        disabledReason: templateCount > 0
          ? undefined
          : `No creator templates are configured for profile ${nearbyStationPrompt.creatorProfileId} on this station.`
      }));
      return { kind: "station", actions };
    }
    const referenceFrames = this.network.getActiveCarrierFramePids();
    if (referenceFrames.length > 0 && this.findNearbyPilotConsolePrompt(pose)) {
      return { kind: "pilot_console", actions: getWorldInteractionActions("pilot_console") };
    }
    return null;
  }

  private resolveTargetActionBySlot(target: WorldInteractTarget, slot: number): WorldInteractionAction | null {
    if (target.kind === "pickup") {
      return resolveWorldInteractionActionBySlot("pickup", slot, {
        itemName: target.pickupContext.itemName,
        itemQuantity: target.pickupContext.itemQuantity
      }) ?? target.actions.find((action) => action.slot === slot) ?? null;
    }
    return resolveWorldInteractionActionBySlot(target.kind, slot) ?? target.actions.find((action) => action.slot === slot) ?? null;
  }

  private getInteractKeyLabel(slot: number): string {
    return worldInteractionSlotToKeyLabel(slot);
  }

  private findNearbyStationPrompt(pose: { x: number; y: number; z: number }): {
    label: string;
    creatorProfileId: CreatorProfileId;
    allowedTemplateBlueprintIds: readonly number[];
  } | null {
    const roots = this.network.getLocationRoots();
    let best: {
      label: string;
      creatorProfileId: CreatorProfileId;
      allowedTemplateBlueprintIds: readonly number[];
    } | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const root of roots) {
      const definition = getLocationDefinitionByPid(root.worldAnchorId);
      if (!definition) {
        continue;
      }
      const sockets = getLocationStationSockets(definition);
      if (sockets.length <= 0) {
        continue;
      }
      const rendered = this.resolveRenderedLocationRootByCarrierFramePid(root.worldAnchorId);
      const rootX = rendered?.x ?? root.x;
      const rootY = rendered?.y ?? root.y;
      const rootZ = rendered?.z ?? root.z;
      const yaw = rendered
        ? this.extractYawFromRotationQuaternion(rendered.rotation)
        : this.extractYawFromRotationQuaternion(root.rotation);
      const candidates = buildWorldInteractionSocketCandidates(
        { x: rootX, y: rootY, z: rootZ, yaw },
        sockets,
        (socket) => ({
          label: getLocationStationInteractionLabel(socket),
          creatorProfileId: getLocationStationCreatorProfile(socket),
          allowedTemplateBlueprintIds: getLocationStationAllowedTemplateBlueprintIds(socket)
        })
      );
      const nearest = findNearestInteractionSocket(
        { x: pose.x, y: pose.y, z: pose.z },
        candidates,
        { maxDistance: Number.POSITIVE_INFINITY, extraSlack: 0.75 }
      );
      if (nearest && nearest.distanceSq < bestDistanceSq) {
        best = nearest.payload;
        bestDistanceSq = nearest.distanceSq;
      }
    }
    return best;
  }

  private computeViewDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
    const cosPitch = Math.cos(pitch);
    const x = -Math.sin(yaw) * cosPitch;
    const y = Math.sin(pitch);
    const z = -Math.cos(yaw) * cosPitch;
    const magnitude = Math.hypot(x, y, z);
    if (magnitude <= 1e-6) {
      return { x: 0, y: 0, z: -1 };
    }
    return {
      x: x / magnitude,
      y: y / magnitude,
      z: z / magnitude
    };
  }

  private sampleGroundingDiagnostics(): void {
    const groundedNow = this.resolveLocalGroundedState();
    if (!this.groundingSampleInitialized) {
      this.groundingSampleInitialized = true;
      this.groundedLastFixedTick = groundedNow;
      return;
    }
    if (!groundedNow) {
      this.totalUngroundedFixedTicks += 1;
      if (this.groundedLastFixedTick) {
        this.totalUngroundedEntries += 1;
      }
    }
    this.groundedLastFixedTick = groundedNow;
  }

  private formatNetKibPerSecondPair(avgBytesPerSecond: number, p95BytesPerSecond: number): string {
    return `${(avgBytesPerSecond / 1024).toFixed(2)} / ${(p95BytesPerSecond / 1024).toFixed(2)}`;
  }

  private formatNetRatePair(avgRate: number, p95Rate: number): string {
    return `${avgRate.toFixed(2)} / ${p95Rate.toFixed(2)}`;
  }

  private formatNetWarningStatus(mask: number): string {
    if (mask === 0) {
      return "ok";
    }
    const parts: string[] = [];
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_OUT_BYTES) parts.push("avg out bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_IN_BYTES) parts.push("avg in bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_OUT_MESSAGES) parts.push("avg out msg");
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_IN_MESSAGES) parts.push("avg in msg");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_OUT_BYTES) parts.push("p95 out bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_IN_BYTES) parts.push("p95 in bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_OUT_MESSAGES) parts.push("p95 out msg");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_IN_MESSAGES) parts.push("p95 in msg");
    return `warn: ${parts.join(", ")}`;
  }

  private static resolveServerUrl(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get("server") ?? "ws://localhost:9001";
  }

  private static async resolveConnectionTarget(): Promise<{
    serverUrl: string;
    joinTicket: string | null;
    mapConfig?: RuntimeMapConfig;
    accountKeyScopeUrl?: string;
  }> {
    const transferBootstrap = GameClientApp.consumeTransferBootstrapPayload();
    if (transferBootstrap) {
      return {
        serverUrl: transferBootstrap.wsUrl,
        joinTicket: transferBootstrap.joinTicket,
        mapConfig: transferBootstrap.mapConfig,
        accountKeyScopeUrl: transferBootstrap.accountKeyScopeUrl ?? undefined
      };
    }

    const params = new URLSearchParams(window.location.search);
    const directServerUrl = params.get("server");
    if (typeof directServerUrl === "string" && directServerUrl.length > 0) {
      return {
        serverUrl: directServerUrl,
        joinTicket: null,
        accountKeyScopeUrl: directServerUrl
      };
    }

    const orchestratorUrl = params.get("orchestrator") ?? "http://localhost:9000";
    const payload = await GameClientApp.bootstrapFromOrchestrator(orchestratorUrl);
    if (!payload) {
      throw new Error("Bootstrap response malformed.");
    }

    return {
      serverUrl: payload.wsUrl,
      joinTicket: payload.joinTicket,
      mapConfig: payload.mapConfig,
      accountKeyScopeUrl: orchestratorUrl
    };
  }

  private static async bootstrapFromOrchestrator(orchestratorUrl: string): Promise<{
    wsUrl: string;
    joinTicket: string;
    mapConfig: RuntimeMapConfig;
  } | null> {
    const accountKey = ensureAccountKey(orchestratorUrl).key;
    const authKey = accountKey.length > 0 ? accountKey : null;
    const response = await fetch(`${orchestratorUrl}/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountKey: authKey,
        authKey
      } satisfies BootstrapRequest)
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as BootstrapResponse;
    if (
      !payload.ok ||
      typeof payload.wsUrl !== "string" ||
      typeof payload.joinTicket !== "string" ||
      !payload.mapConfig
    ) {
      return null;
    }
    return {
      wsUrl: payload.wsUrl,
      joinTicket: payload.joinTicket,
      mapConfig: payload.mapConfig
    };
  }

  private static installRuntimeMapConfig(config: RuntimeMapConfig): void {
    const globalObject = globalThis as unknown as { __runtimeMapConfig?: RuntimeMapConfig };
    globalObject.__runtimeMapConfig = config;
  }

  private static readRuntimeMapConfig(): RuntimeMapConfig | null {
    const globalObject = globalThis as unknown as { __runtimeMapConfig?: RuntimeMapConfig };
    return globalObject.__runtimeMapConfig ?? null;
  }

  private static resolveCspEnabled(): boolean {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("csp");
    if (raw === "1" || raw === "true") {
      return true;
    }
    return false;
  }

  private static resolveE2eSimulationOnly(): boolean {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("e2eSimOnly");
    return raw === "1" || raw === "true";
  }

  private static resolveTestAlertsEnabled(): boolean {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("testAlerts");
    return raw === "1" || raw === "true";
  }

  private static loadCachedPlayerSettings(): PlayerSettings {
    if (typeof window === "undefined" || !window.localStorage) {
      return coercePlayerSettings(null);
    }
    try {
      const raw = window.localStorage.getItem(PLAYER_SETTINGS_LOCAL_CACHE_KEY);
      if (!raw) {
        return coercePlayerSettings(null);
      }
      return coercePlayerSettings(JSON.parse(raw));
    } catch {
      return coercePlayerSettings(null);
    }
  }

  private static saveCachedPlayerSettings(settings: PlayerSettings): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(PLAYER_SETTINGS_LOCAL_CACHE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage failures; setting still applies for this session.
    }
  }

  private static loadCachedClientLocalSettings(): ClientLocalSettings {
    if (typeof window === "undefined" || !window.localStorage) {
      return coerceClientLocalSettings(null);
    }
    try {
      const raw = window.localStorage.getItem(CLIENT_LOCAL_SETTINGS_CACHE_KEY);
      if (!raw) {
        return coerceClientLocalSettings(null);
      }
      return coerceClientLocalSettings(JSON.parse(raw));
    } catch {
      return coerceClientLocalSettings(null);
    }
  }

  private static saveCachedClientLocalSettings(settings: ClientLocalSettings): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(CLIENT_LOCAL_SETTINGS_CACHE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage failures; setting still applies for this session.
    }
  }

  private readonly onBeforeUnload = (): void => {
    this.flushSettingsNow();
  };

  private isCspActive(): boolean {
    return this.cspEnabled;
  }

  private maybeHandleMapTransferInstruction(): void {
    if (this.transferInProgress) {
      return;
    }
    const transfer = this.network.consumeMapTransferInstruction();
    if (!transfer) {
      return;
    }
    this.flushSettingsNow();
    this.transferInProgress = true;
    if (this.stageFullReloadTransfer(transfer)) {
      return;
    }
    GameClientApp.installRuntimeMapConfig(transfer.mapConfig);
    void this.network
      .connect(transfer.wsUrl, this.activeAccountKey, { joinTicket: transfer.joinTicket })
      .finally(() => {
        this.transferInProgress = false;
      });
  }

  private stageFullReloadTransfer(transfer: { wsUrl: string; joinTicket: string; mapConfig: RuntimeMapConfig }): boolean {
    const now = Date.now();
    const payload: TransferBootstrapPayload = {
      wsUrl: transfer.wsUrl,
      joinTicket: transfer.joinTicket,
      mapConfig: transfer.mapConfig,
      accountKeyScopeUrl: this.resolveAccountKeyScopeUrl(),
      issuedAtMs: now,
      expiresAtMs: now + TRANSFER_BOOTSTRAP_TTL_MS
    };
    try {
      sessionStorage.setItem(TRANSFER_BOOTSTRAP_STORAGE_KEY, JSON.stringify(payload));
      window.location.reload();
      return true;
    } catch (error) {
      console.warn("[client] transfer reload staging failed; falling back to in-app reconnect", error);
      return false;
    }
  }

  private resolveAccountKeyScopeUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    const orchestratorUrl = params.get("orchestrator");
    if (typeof orchestratorUrl === "string" && orchestratorUrl.length > 0) {
      return orchestratorUrl;
    }
    return null;
  }

  private static consumeTransferBootstrapPayload(): TransferBootstrapPayload | null {
    try {
      const raw = sessionStorage.getItem(TRANSFER_BOOTSTRAP_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      sessionStorage.removeItem(TRANSFER_BOOTSTRAP_STORAGE_KEY);
      const parsed = JSON.parse(raw) as Partial<TransferBootstrapPayload>;
      if (
        typeof parsed.wsUrl !== "string" ||
        parsed.wsUrl.length === 0 ||
        typeof parsed.joinTicket !== "string" ||
        parsed.joinTicket.length === 0 ||
        !parsed.mapConfig ||
        typeof parsed.mapConfig !== "object"
      ) {
        return null;
      }
      const now = Date.now();
      const expiresAtMs = Number(parsed.expiresAtMs);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs < now) {
        return null;
      }
      return {
        wsUrl: parsed.wsUrl,
        joinTicket: parsed.joinTicket,
        mapConfig: parsed.mapConfig as RuntimeMapConfig,
        accountKeyScopeUrl:
          typeof parsed.accountKeyScopeUrl === "string" && parsed.accountKeyScopeUrl.length > 0
            ? parsed.accountKeyScopeUrl
            : null,
        issuedAtMs: Number(parsed.issuedAtMs) || now,
        expiresAtMs
      };
    } catch {
      return null;
    }
  }

  private applyVisualCarrierYawFromRenderedLocations(): void {
    const framePids = this.network.getActiveCarrierFramePids();
    if (framePids.length === 0) {
      this.visualCarrierPreviousYawByFramePid.clear();
      return;
    }

    const activeFrameSet = new Set<number>(framePids);
    for (const trackedFramePid of this.visualCarrierPreviousYawByFramePid.keys()) {
      if (!activeFrameSet.has(trackedFramePid)) {
        this.visualCarrierPreviousYawByFramePid.delete(trackedFramePid);
      }
    }

    let combinedDeltaYaw = 0;
    for (let i = 0; i < framePids.length; i += 1) {
      const framePid = framePids[i];
      if (framePid === undefined) {
        continue;
      }
      const location = getLocationDefinitionByPid(framePid);
      if (!location || location.motion === "static") {
        this.visualCarrierPreviousYawByFramePid.delete(framePid);
        continue;
      }
      const locationRoot = this.resolveRenderedLocationRootByCarrierFramePid(framePid);
      if (!locationRoot) {
        continue;
      }
      const currentYaw = this.extractYawFromRotationQuaternion(locationRoot.rotation);
      if (!Number.isFinite(currentYaw)) {
        continue;
      }
      const previousYaw = this.visualCarrierPreviousYawByFramePid.get(framePid);
      this.visualCarrierPreviousYawByFramePid.set(framePid, currentYaw);
      if (previousYaw === undefined) {
        continue;
      }
      combinedDeltaYaw = normalizeYaw(combinedDeltaYaw + normalizeYaw(currentYaw - previousYaw));
    }

    if (Math.abs(combinedDeltaYaw) <= 1e-6) {
      return;
    }
    this.input.applyYawDelta(combinedDeltaYaw);
    this.network.syncSentYaw(this.input.getYaw());
  }

  private resolveRenderedLocationRootByCarrierFramePid(framePid: number) {
    return this.renderedLocationFrameSnapshot.get(framePid) ?? null;
  }

  private extractYawFromRotationQuaternion(rotation: {
    x: number;
    y: number;
    z: number;
    w: number;
  }): number {
    const sinYawCosPitch = 2 * (rotation.w * rotation.y + rotation.x * rotation.z);
    const cosYawCosPitch = 1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z);
    return Math.atan2(sinYawCosPitch, cosYawCosPitch);
  }

  private findNearbyPilotConsolePrompt(pose: { x: number; y: number; z: number }): boolean {
    const candidates: Array<{
      payload: boolean;
      socketPoint: { x: number; y: number; z: number };
      interactRadius: number;
    }> = [];
    const roots = this.network.getLocationRoots();
    for (const root of roots) {
      const definition = getLocationDefinitionByPid(root.worldAnchorId);
      if (!definition || definition.motion === "static") {
        continue;
      }
      const sockets = getLocationPilotConsoleSockets(definition);
      if (sockets.length <= 0) {
        continue;
      }
      const rendered = this.resolveRenderedLocationRootByCarrierFramePid(root.worldAnchorId);
      const rootX = rendered?.x ?? root.x;
      const rootY = rendered?.y ?? root.y;
      const rootZ = rendered?.z ?? root.z;
      const yaw = rendered
        ? this.extractYawFromRotationQuaternion(rendered.rotation)
        : this.extractYawFromRotationQuaternion(root.rotation);
      candidates.push(
        ...buildWorldInteractionSocketCandidates(
          { x: rootX, y: rootY, z: rootZ, yaw },
          sockets,
          () => true
        )
      );
    }
    return Boolean(findNearestInteractionSocket(
      { x: pose.x, y: pose.y, z: pose.z },
      candidates,
      { maxDistance: 4, extraSlack: 0 }
    ));
  }
}



