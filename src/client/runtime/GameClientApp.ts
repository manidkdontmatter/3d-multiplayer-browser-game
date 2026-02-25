// Main client runtime loop coordinating input, networking, prediction, rendering, and UI state.
import { Clock } from "three";
import {
  ABILITY_ID_NONE,
  DEFAULT_HOTBAR_ABILITY_IDS,
  DEFAULT_PRIMARY_MOUSE_SLOT,
  DEFAULT_SECONDARY_MOUSE_SLOT,
  getAbilityDefinitionById,
  movementModeToLabel,
  type BootstrapRequest,
  type BootstrapResponse,
  type RuntimeMapConfig
} from "../../shared/index";
import { NetworkClient } from "./NetworkClient";
import { InputController } from "./InputController";
import { LocalPhysicsWorld } from "./LocalPhysicsWorld";
import { DeterministicPlatformTimeline } from "./DeterministicPlatformTimeline";
import { RenderSnapshotAssembler } from "./RenderSnapshotAssembler";
import { WorldRenderer } from "./WorldRenderer";
import { ClientNetworkOrchestrator } from "./network/ClientNetworkOrchestrator";
import type { MovementInput, PlayerPose, RenderFrameSnapshot } from "./types";
import { AbilityHud } from "../ui/AbilityHud";
import { resolveAccessKey } from "../auth/accessKey";
import { AuthPanel } from "../ui/AuthPanel";

const FIXED_STEP = 1 / 60;
const LOOK_PITCH_LIMIT = 1.45;
const TRANSFER_BOOTSTRAP_STORAGE_KEY = "mapTransferBootstrapV1";
const TRANSFER_BOOTSTRAP_TTL_MS = 15_000;

interface TransferBootstrapPayload {
  wsUrl: string;
  joinTicket: string;
  mapConfig: RuntimeMapConfig;
  accessKeyScopeUrl: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
}

export type ClientCreatePhase = "physics" | "network" | "ready";

export class GameClientApp {
  private readonly input: InputController;
  private readonly renderer: WorldRenderer;
  private readonly abilityHud: AbilityHud;
  private readonly authPanel: AuthPanel;
  private readonly connectedPlayersNode: HTMLDivElement;
  private readonly network = new NetworkClient();
  private readonly networkOrchestrator: ClientNetworkOrchestrator;
  private readonly platformTimeline = new DeterministicPlatformTimeline();
  private readonly renderSnapshotAssembler: RenderSnapshotAssembler;
  private readonly clock = new Clock();
  private readonly physics: LocalPhysicsWorld;
  private accumulator = 0;
  private running = false;
  private rafId = 0;
  private readonly statusNode: HTMLElement | null;
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
  private testPrimaryHeld = false;
  private testSecondaryHeld = false;
  private activeAccessKey: string | null = null;
  private transferInProgress = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    statusNode: HTMLElement | null,
    physics: LocalPhysicsWorld,
    cspEnabled: boolean,
    e2eSimulationOnly: boolean,
    private readonly serverUrl: string,
    initialAccessKey: string,
    private readonly joinTicket: string | null
  ) {
    this.statusNode = statusNode;
    this.physics = physics;
    this.cspEnabled = cspEnabled;
    this.e2eSimulationOnly = e2eSimulationOnly;
    this.input = new InputController(canvas);
    this.abilityHud = AbilityHud.mount(document, {
      initialHotbarAssignments: this.hotbarAbilityIds,
      initialPrimaryMouseSlot: this.primaryMouseSlot,
      initialSecondaryMouseSlot: this.secondaryMouseSlot,
      onHotbarAssignmentChanged: (slot, abilityId) => {
        this.network.queueHotbarAssignment(slot, abilityId);
      },
      onAbilityForgotten: (abilityId) => {
        this.network.queueForgetAbility(abilityId);
      },
      onAbilityCreatorCommand: (command) => {
        this.network.queueAbilityCreatorCommand(command);
      }
    });
    this.authPanel = AuthPanel.mount(document, {
      serverUrl: this.serverUrl,
      initialAccessKey
    });
    this.activeAccessKey = initialAccessKey.length > 0 ? initialAccessKey : null;
    this.connectedPlayersNode = document.createElement("div");
    this.connectedPlayersNode.id = "connected-players-indicator";
    this.connectedPlayersNode.textContent = "Connected Players: 0";
    document.body.append(this.connectedPlayersNode);
    this.renderer = new WorldRenderer(canvas);
    this.networkOrchestrator = new ClientNetworkOrchestrator(this.network, this.physics);
    this.renderSnapshotAssembler = new RenderSnapshotAssembler({
      getRenderSnapshotState: (frameDeltaSeconds) => this.createRenderSnapshot(frameDeltaSeconds)
    });
  }

  public static async create(
    canvas: HTMLCanvasElement,
    statusNode: HTMLElement | null,
    onCreatePhase?: (phase: ClientCreatePhase) => void
  ): Promise<GameClientApp> {
    const connectionTarget = await GameClientApp.resolveConnectionTarget();
    if (connectionTarget.mapConfig) {
      GameClientApp.installRuntimeMapConfig(connectionTarget.mapConfig);
    }
    onCreatePhase?.("physics");
    const physics = await LocalPhysicsWorld.create();
    const serverUrl = connectionTarget.serverUrl;
    const resolvedAccessKey = resolveAccessKey(connectionTarget.accessKeyScopeUrl ?? serverUrl);
    const accessKey = resolvedAccessKey.key.length > 0 ? resolvedAccessKey.key : null;
    const app = new GameClientApp(
      canvas,
      statusNode,
      physics,
      GameClientApp.resolveCspEnabled(),
      GameClientApp.resolveE2eSimulationOnly(),
      serverUrl,
      accessKey ?? "",
      connectionTarget.joinTicket
    );
    onCreatePhase?.("network");
    await app.network.connect(serverUrl, accessKey, { joinTicket: app.joinTicket });
    onCreatePhase?.("ready");
    app.updateStatus();
    app.registerTestingHooks();
    return app;
  }

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.input.attach();
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
      window.removeEventListener("resize", this.onResize);
      window.cancelAnimationFrame(this.rafId);
    }
    this.renderer.dispose();
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
      const open = this.abilityHud.toggleMainMenu();
      this.input.setMainUiOpen(open);
      if (document.pointerLockElement === this.canvas) {
        void document.exitPointerLock();
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
    this.applyAbilityEvents();
    this.applyAbilityCreatorEvents();

    const renderSnapshot = this.renderSnapshotAssembler.build(seconds);
    this.renderer.apply(renderSnapshot);
    this.updateStatus();
  }

  private stepFixed(delta: number): void {
    const mainUiOpen = this.abilityHud.isMainMenuOpen();
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
    const usePrimaryPressed = !mainUiOpen && (this.input.consumePrimaryActionTrigger() || this.consumeTestPrimaryActionTrigger());
    const useSecondaryPressed = !mainUiOpen && (this.input.consumeSecondaryActionTrigger() || this.consumeTestSecondaryActionTrigger());
    const usePrimaryHeld = !mainUiOpen && (this.input.isPrimaryActionHeld() || this.testPrimaryHeld);
    const useSecondaryHeld = !mainUiOpen && (this.input.isSecondaryActionHeld() || this.testSecondaryHeld);
    const castSlotPressed = !mainUiOpen && queuedDirectCastSlot !== null;
    const castSlotIndex = queuedDirectCastSlot ?? 0;

    if (usePrimaryPressed && this.getAbilityDefinitionAtSlot(this.primaryMouseSlot)?.melee) {
      this.renderer.triggerLocalMeleePunch();
    }
    if (useSecondaryPressed && this.getAbilityDefinitionAtSlot(this.secondaryMouseSlot)?.melee) {
      this.renderer.triggerLocalMeleePunch();
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

    this.sampleGroundingDiagnostics();
  }

  private applyAbilityEvents(): void {
    const events = this.network.consumeAbilityEvents();
    if (!events) {
      return;
    }

    for (const definition of events.definitions) {
      this.abilityHud.upsertAbility(definition);
    }

    if (events.abilityState) {
      this.hotbarAbilityIds = [...events.abilityState.hotbarAbilityIds];
      this.primaryMouseSlot = events.abilityState.primaryMouseSlot;
      this.secondaryMouseSlot = events.abilityState.secondaryMouseSlot;
      this.abilityHud.setHotbarAssignments(this.hotbarAbilityIds);
      this.abilityHud.setMouseBindings(this.primaryMouseSlot, this.secondaryMouseSlot);
    }
    if (events.ownedAbilityIds) {
      this.abilityHud.setOwnedAbilityIds(events.ownedAbilityIds);
    }
  }

  private applyAbilityCreatorEvents(): void {
    const creatorState = this.network.consumeAbilityCreatorState();
    if (!creatorState) {
      return;
    }
    this.abilityHud.setAbilityCreatorState(creatorState);
  }

  private updateStatus(): void {
    this.updateConnectedPlayersIndicator();

    if (!this.statusNode) {
      return;
    }

    const pose = this.getRenderPose();
    const netState = this.network.getConnectionState();
    const cspActive = this.isCspActive();
    const cspLabel = cspActive ? "on" : "off";
    const reconDiagnostics = this.networkOrchestrator.getDiagnostics();
    const smoothingMagnitude = reconDiagnostics.worldOffsetMagnitude;
    const yawErrorDegrees = (reconDiagnostics.lastYawError * 180) / Math.PI;
    const interpDelayMs = this.network.getInterpolationDelayMs();
    const ackJitterMs = this.network.getAckJitterMs();
    const localHealth = this.network.getLocalPlayerPose()?.health ?? 100;
    const projectileCount = this.network.getProjectiles().length;
    const lmbAbilityName = this.resolveAbilityName(this.hotbarAbilityIds[this.primaryMouseSlot] ?? ABILITY_ID_NONE);
    const rmbAbilityName = this.resolveAbilityName(this.hotbarAbilityIds[this.secondaryMouseSlot] ?? ABILITY_ID_NONE);
    const localMovementModeLabel = movementModeToLabel(this.resolveLocalMovementMode());
    this.statusNode.textContent =
      `mode=${netState} | csp=${cspLabel} | move=${localMovementModeLabel} | menu=${this.abilityHud.isMainMenuOpen() ? "open" : "closed"} | cam=${this.freezeCamera ? "frozen" : "follow"} | hp=${localHealth} | lmb=${this.primaryMouseSlot + 1}:${lmbAbilityName} | rmb=${this.secondaryMouseSlot + 1}:${rmbAbilityName} | bolts=${projectileCount} | airTicks=${this.totalUngroundedFixedTicks} | airEntries=${this.totalUngroundedEntries} | fps=${this.fps.toFixed(0)} | low<30=${this.lowFpsFrameCount} | interp=${interpDelayMs.toFixed(0)}ms jit=${ackJitterMs.toFixed(1)}ms | corr=${reconDiagnostics.lastPositionError.toFixed(2)}m/${yawErrorDegrees.toFixed(1)}deg | smooth=${smoothingMagnitude.toFixed(2)} | replay=${reconDiagnostics.lastReplayCount} | hs=${reconDiagnostics.hardSnapCorrections}/${reconDiagnostics.totalCorrections} | x=${pose.x.toFixed(2)} y=${pose.y.toFixed(2)} z=${pose.z.toFixed(2)}`;
  }

  private updateConnectedPlayersIndicator(): void {
    const remoteCount = this.network.getRemotePlayers().length;
    const localCount = this.network.getLocalPlayerNid() === null ? 0 : 1;
    const aoiCount = remoteCount + localCount;
    const serverPlayers = this.network.getServerPlayerCount();
    const playersText = serverPlayers === null ? "..." : String(serverPlayers);
    this.connectedPlayersNode.textContent = `Players: ${playersText}\nAOI: ${aoiCount}`;
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
    const basePayload: RenderGameStatePayload = {
      mode: this.network.getConnectionState(),
      pointerLock: document.pointerLockElement === this.canvas,
      coordinateSystem: "right-handed; +x right, +y up, -z forward",
      player: {
        ...pose,
        nid: this.network.getLocalPlayerNid(),
        movementMode: movementModeToLabel(this.resolveLocalMovementMode())
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
      platforms: this.getRenderPlatformStates().map((p) => ({
        nid: p.nid,
        modelId: p.modelId,
        x: p.x,
        y: p.y,
        z: p.z,
        rotation: p.rotation
      })),
      projectiles: this.network.getProjectiles().map((projectile) => ({
        nid: projectile.nid,
        modelId: projectile.modelId,
        x: projectile.x,
        y: projectile.y,
        z: projectile.z
      })),
      trainingDummies: this.network.getTrainingDummies().map((dummy) => ({
        nid: dummy.nid,
        modelId: dummy.modelId,
        x: dummy.x,
        y: dummy.y,
        z: dummy.z,
        rotation: dummy.rotation,
        health: dummy.health,
        maxHealth: dummy.maxHealth
      })),
      localAbility: {
        ui: {
          mainMenuOpen: this.abilityHud.isMainMenuOpen()
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
        interpolationDelayMs: this.network.getInterpolationDelayMs(),
        ackJitterMs: this.network.getAckJitterMs()
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
      if (!this.e2eSimulationOnly) {
        const renderSnapshot = this.renderSnapshotAssembler.build(FIXED_STEP);
        this.renderer.apply(renderSnapshot);
        this.updateStatus();
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
    return {
      frameDeltaSeconds,
      localPose: this.getRenderPose(),
      localGrounded: this.resolveLocalGroundedState(),
      localMovementMode: this.resolveLocalMovementMode(),
      localPlayerNid: this.network.getLocalPlayerNid(),
      remotePlayers: this.network.getRemotePlayers(),
      abilityUseEvents: this.network.consumeAbilityUseEvents(),
      platforms: this.getRenderPlatformStates(),
      trainingDummies: this.network.getTrainingDummies(),
      projectiles: this.network.getProjectiles()
    };
  }

  private getRenderPosition(): { x: number; y: number; z: number } {
    if (this.isCspActive()) {
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

  private static resolveServerUrl(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get("server") ?? "ws://localhost:9001";
  }

  private static async resolveConnectionTarget(): Promise<{
    serverUrl: string;
    joinTicket: string | null;
    mapConfig?: RuntimeMapConfig;
    accessKeyScopeUrl?: string;
  }> {
    const transferBootstrap = GameClientApp.consumeTransferBootstrapPayload();
    if (transferBootstrap) {
      return {
        serverUrl: transferBootstrap.wsUrl,
        joinTicket: transferBootstrap.joinTicket,
        mapConfig: transferBootstrap.mapConfig,
        accessKeyScopeUrl: transferBootstrap.accessKeyScopeUrl ?? undefined
      };
    }

    const params = new URLSearchParams(window.location.search);
    const directServerUrl = params.get("server");
    if (typeof directServerUrl === "string" && directServerUrl.length > 0) {
      return {
        serverUrl: directServerUrl,
        joinTicket: null,
        accessKeyScopeUrl: directServerUrl
      };
    }

    const orchestratorUrl = params.get("orchestrator") ?? "http://localhost:9000";
    const accessKey = resolveAccessKey(orchestratorUrl).key;
    const authKey = accessKey.length > 0 ? accessKey : null;
    const response = await fetch(`${orchestratorUrl}/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        authKey
      } satisfies BootstrapRequest)
    });
    if (!response.ok) {
      throw new Error(`Bootstrap failed with status ${response.status}`);
    }
    const payload = (await response.json()) as BootstrapResponse;
    if (!payload.ok || typeof payload.wsUrl !== "string" || typeof payload.joinTicket !== "string") {
      throw new Error(payload.error ?? "Bootstrap response malformed.");
    }
    if (payload.mapConfig) {
      GameClientApp.installRuntimeMapConfig(payload.mapConfig);
    }

    return {
      serverUrl: payload.wsUrl,
      joinTicket: payload.joinTicket,
      accessKeyScopeUrl: orchestratorUrl
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
    this.transferInProgress = true;
    if (this.stageFullReloadTransfer(transfer)) {
      return;
    }
    GameClientApp.installRuntimeMapConfig(transfer.mapConfig);
    void this.network
      .connect(transfer.wsUrl, this.activeAccessKey, { joinTicket: transfer.joinTicket })
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
      accessKeyScopeUrl: this.resolveAccessKeyScopeUrl(),
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

  private resolveAccessKeyScopeUrl(): string | null {
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
        accessKeyScopeUrl:
          typeof parsed.accessKeyScopeUrl === "string" && parsed.accessKeyScopeUrl.length > 0
            ? parsed.accessKeyScopeUrl
            : null,
        issuedAtMs: Number(parsed.issuedAtMs) || now,
        expiresAtMs
      };
    } catch {
      return null;
    }
  }
}
