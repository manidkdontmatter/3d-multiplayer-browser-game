import { Clock } from "three";
import {
  ABILITY_ID_NONE,
  DEFAULT_HOTBAR_ABILITY_IDS,
  getAbilityDefinitionById,
  normalizeYaw,
  PLATFORM_DEFINITIONS,
  SERVER_TICK_SECONDS
} from "../../shared/index";
import { samplePlatformTransform } from "../../shared/platforms";
import { NetworkClient } from "./NetworkClient";
import { InputController } from "./InputController";
import { LocalPhysicsWorld } from "./LocalPhysicsWorld";
import { DeterministicPlatformTimeline } from "./DeterministicPlatformTimeline";
import { WorldRenderer } from "./WorldRenderer";
import type { MovementInput, PlayerPose } from "./types";
import { AbilityHud } from "../ui/AbilityHud";
import { resolveAccessKey, storeAccessKey, writeAccessKeyToFragment } from "../auth/accessKey";
import { AuthPanel } from "../ui/AuthPanel";

const FIXED_STEP = 1 / 60;
const RECONCILE_POSITION_SMOOTH_RATE = 14;
const RECONCILE_POSITION_SNAP_THRESHOLD = 2.5;
const RECONCILE_YAW_SNAP_THRESHOLD = Math.PI * 0.75;
const RECONCILE_OFFSET_EPSILON = 0.0005;
const LOOK_PITCH_LIMIT = 1.45;

export type ClientCreatePhase = "physics" | "network" | "ready";

export class GameClientApp {
  private readonly input: InputController;
  private readonly renderer: WorldRenderer;
  private readonly abilityHud: AbilityHud;
  private readonly authPanel: AuthPanel;
  private readonly network = new NetworkClient();
  private readonly platformTimeline = new DeterministicPlatformTimeline();
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
  private predictedPlatformYawCarrySinceAck = 0;
  private testMovementOverride: MovementInput | null = null;
  private lastNonCspYawCarryServerTimeSeconds: number | null = null;
  private reconciliationRenderOffset = { x: 0, y: 0, z: 0 };
  private reconciliationRenderOffsetPlatformPid: number | null = null;
  private reconciliationRenderOffsetPlatformLocal = { x: 0, z: 0 };
  private lastReconcilePositionError = 0;
  private lastReconcileYawError = 0;
  private lastReconcilePitchError = 0;
  private lastReconcileReplayCount = 0;
  private reconcileCorrectionCount = 0;
  private reconcileHardSnapCount = 0;
  private totalUngroundedFixedTicks = 0;
  private totalUngroundedEntries = 0;
  private groundingSampleInitialized = false;
  private groundedLastFixedTick = true;
  private hotbarAbilityIds = [...DEFAULT_HOTBAR_ABILITY_IDS];
  private lastQueuedHotbarSlot = 0;
  private queuedTestPrimaryActionCount = 0;
  private testPrimaryHeld = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    statusNode: HTMLElement | null,
    physics: LocalPhysicsWorld,
    cspEnabled: boolean,
    private readonly serverUrl: string,
    initialAccessKey: string
  ) {
    this.statusNode = statusNode;
    this.physics = physics;
    this.cspEnabled = cspEnabled;
    this.input = new InputController(canvas);
    this.abilityHud = AbilityHud.mount(document, {
      initialHotbarAssignments: this.hotbarAbilityIds,
      initialSelectedSlot: this.input.getSelectedHotbarSlot(),
      onHotbarSlotSelected: (slot) => {
        this.input.setSelectedHotbarSlot(slot);
        this.network.queueLoadoutSelection(slot);
        this.lastQueuedHotbarSlot = slot;
      },
      onHotbarAssignmentChanged: (slot, abilityId) => {
        this.hotbarAbilityIds[slot] = abilityId;
        this.input.setSelectedHotbarSlot(slot);
        this.abilityHud.setSelectedSlot(slot, false);
        this.network.queueLoadoutSelection(slot);
        this.network.queueLoadoutAssignment(slot, abilityId);
        this.lastQueuedHotbarSlot = slot;
      }
    });
    this.authPanel = AuthPanel.mount(document, {
      serverUrl: this.serverUrl,
      initialAccessKey
    });
    this.renderer = new WorldRenderer(canvas);
  }

  public static async create(
    canvas: HTMLCanvasElement,
    statusNode: HTMLElement | null,
    onCreatePhase?: (phase: ClientCreatePhase) => void
  ): Promise<GameClientApp> {
    onCreatePhase?.("physics");
    const physics = await LocalPhysicsWorld.create();
    const serverUrl = GameClientApp.resolveServerUrl();
    const resolvedAccessKey = resolveAccessKey(serverUrl);
    storeAccessKey(serverUrl, resolvedAccessKey.key);
    writeAccessKeyToFragment(resolvedAccessKey.key);
    const app = new GameClientApp(
      canvas,
      statusNode,
      physics,
      GameClientApp.resolveCspEnabled(),
      serverUrl,
      resolvedAccessKey.key
    );
    onCreatePhase?.("network");
    await app.network.connect(serverUrl, resolvedAccessKey.key);
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
    this.clock.start();
    this.rafId = window.requestAnimationFrame(this.loop);
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
    this.trackFps(seconds);
    if (this.input.consumeCameraFreezeToggle()) {
      this.freezeCamera = !this.freezeCamera;
      this.frozenCameraPose = this.freezeCamera ? this.getRenderPose() : null;
    }
    if (this.input.consumeCspToggle()) {
      this.cspEnabled = !this.cspEnabled;
      this.resetReconciliationSmoothing();
    }
    let shouldReleasePointerLock = false;
    if (this.input.consumeAbilityLoadoutToggle()) {
      const loadoutOpen = this.abilityHud.toggleLoadoutPanel();
      shouldReleasePointerLock = shouldReleasePointerLock || loadoutOpen;
    }
    if (shouldReleasePointerLock && document.pointerLockElement === this.canvas) {
      void document.exitPointerLock();
    }
    const selectedSlot = this.input.getSelectedHotbarSlot();
    if (selectedSlot !== this.lastQueuedHotbarSlot) {
      this.network.queueLoadoutSelection(selectedSlot);
      this.lastQueuedHotbarSlot = selectedSlot;
    }
    this.abilityHud.setSelectedSlot(selectedSlot, false);

    this.accumulator += seconds;
    while (this.accumulator >= FIXED_STEP) {
      this.stepFixed(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this.applyAbilityEvents();

    const pose = this.getRenderPose();
    this.renderer.syncLocalPlayer(pose, {
      frameDeltaSeconds: seconds,
      grounded: this.resolveLocalGroundedState()
    });
    this.renderer.setLocalPlayerNid(this.network.getLocalPlayerNid());
    this.renderer.syncRemotePlayers(this.network.getRemotePlayers(), seconds);
    this.renderer.applyAbilityUseEvents(this.network.consumeAbilityUseEvents());
    this.renderer.syncPlatforms(this.getRenderPlatformStates());
    this.renderer.syncTrainingDummies(this.network.getTrainingDummies());
    this.renderer.syncProjectiles(this.network.getProjectiles(), seconds);
    this.renderer.render(pose);
    this.updateStatus();
  }

  private stepFixed(delta: number): void {
    const movement = this.testMovementOverride ?? this.input.sampleMovement();
    let yaw = this.input.getYaw();
    const pitch = this.input.getPitch();
    const usePrimaryPressed =
      this.input.consumePrimaryActionTrigger() || this.consumeTestPrimaryActionTrigger();
    const usePrimaryHeld = this.input.isPrimaryActionHeld() || this.testPrimaryHeld;
    if (usePrimaryPressed && this.getSelectedAbilityDefinition()?.melee) {
      this.renderer.triggerLocalMeleePunch();
    }
    this.network.step(
      delta,
      movement,
      { yaw, pitch },
      {
        usePrimaryPressed,
        usePrimaryHeld
      }
    );

    const cspActive = this.isCspActive();
    let preReconciliationPose: PlayerPose | null = null;
    if (cspActive) {
      this.lastNonCspYawCarryServerTimeSeconds = null;
      const predictedPlatformYawDelta = this.physics.predictAttachedPlatformYawDelta(delta);
      if (Math.abs(predictedPlatformYawDelta) > 1e-6) {
        this.input.applyYawDelta(predictedPlatformYawDelta);
        this.network.syncSentYaw(this.input.getYaw());
        this.predictedPlatformYawCarrySinceAck = normalizeYaw(
          this.predictedPlatformYawCarrySinceAck + predictedPlatformYawDelta
        );
        yaw = this.input.getYaw();
      }
      this.physics.step(delta, movement, yaw, pitch);
      preReconciliationPose = this.physics.getPose();
    } else {
      this.predictedPlatformYawCarrySinceAck = 0;
      this.applyDeterministicPlatformYawCarryForCspOff();
      this.resetReconciliationSmoothing();
    }

    const recon = this.network.consumeReconciliationFrame();
    if (recon) {
      this.predictedPlatformYawCarrySinceAck = 0;

      this.physics.setReconciliationState({
        x: recon.ack.x,
        y: recon.ack.y,
        z: recon.ack.z,
        yaw: this.input.getYaw(),
        pitch: this.input.getPitch(),
        vx: recon.ack.vx,
        vy: recon.ack.vy,
        vz: recon.ack.vz,
        grounded: recon.ack.grounded,
        groundedPlatformPid: recon.ack.groundedPlatformPid,
        serverTimeSeconds: recon.ack.serverTick * SERVER_TICK_SECONDS
      });

      if (cspActive) {
        for (const pending of recon.replay) {
          this.physics.step(
            pending.delta,
            pending.movement,
            pending.orientation.yaw,
            pending.orientation.pitch
          );
        }

        const postReconciliationPose = this.physics.getPose();
        if (preReconciliationPose) {
          this.updateReconciliationSmoothing(
            preReconciliationPose,
            postReconciliationPose,
            recon.replay.length
          );
        }
      }
    }

    if (cspActive) {
      this.syncReconciliationOffsetPlatformFrame();
      this.decayReconciliationSmoothing(delta);
    }

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

    if (events.loadout) {
      this.hotbarAbilityIds = [...events.loadout.abilityIds];
      this.input.setSelectedHotbarSlot(events.loadout.selectedHotbarSlot);
      this.lastQueuedHotbarSlot = events.loadout.selectedHotbarSlot;
      this.abilityHud.setHotbarAssignments(this.hotbarAbilityIds);
      this.abilityHud.setSelectedSlot(events.loadout.selectedHotbarSlot, false);
    }

  }

  private updateStatus(): void {
    if (!this.statusNode) {
      return;
    }

    const pose = this.getRenderPose();
    const netState = this.network.getConnectionState();
    const cspActive = this.isCspActive();
    const cspLabel = cspActive ? "on" : "off";
    const smoothingMagnitude = this.getReconciliationOffsetMagnitude();
    const yawErrorDegrees = (this.lastReconcileYawError * 180) / Math.PI;
    const interpDelayMs = this.network.getInterpolationDelayMs();
    const ackJitterMs = this.network.getAckJitterMs();
    const localHealth = this.network.getLocalPlayerPose()?.health ?? 100;
    const projectileCount = this.network.getProjectiles().length;
    const activeSlot = this.input.getSelectedHotbarSlot() + 1;
    const selectedAbilityId = this.hotbarAbilityIds[activeSlot - 1] ?? ABILITY_ID_NONE;
    const activeAbilityName = this.resolveAbilityName(selectedAbilityId);
    this.statusNode.textContent =
      `mode=${netState} | csp=${cspLabel} | cam=${this.freezeCamera ? "frozen" : "follow"} | hp=${localHealth} | slot=${activeSlot}:${activeAbilityName} | bolts=${projectileCount} | airTicks=${this.totalUngroundedFixedTicks} | airEntries=${this.totalUngroundedEntries} | fps=${this.fps.toFixed(0)} | low<30=${this.lowFpsFrameCount} | interp=${interpDelayMs.toFixed(0)}ms jit=${ackJitterMs.toFixed(1)}ms | corr=${this.lastReconcilePositionError.toFixed(2)}m/${yawErrorDegrees.toFixed(1)}deg | smooth=${smoothingMagnitude.toFixed(2)} | replay=${this.lastReconcileReplayCount} | hs=${this.reconcileHardSnapCount}/${this.reconcileCorrectionCount} | x=${pose.x.toFixed(2)} y=${pose.y.toFixed(2)} z=${pose.z.toFixed(2)}`;
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

  private registerTestingHooks(): void {
    window.advanceTime = (ms: number) => {
      const clampedMs = Math.max(1, Math.min(ms, 5000));
      const steps = Math.max(1, Math.round(clampedMs / (FIXED_STEP * 1000)));
      for (let i = 0; i < steps; i++) {
        this.stepFixed(FIXED_STEP);
      }
      this.applyAbilityEvents();
      this.renderer.syncLocalPlayer(this.getRenderPose(), {
        frameDeltaSeconds: FIXED_STEP,
        grounded: this.resolveLocalGroundedState()
      });
      this.renderer.setLocalPlayerNid(this.network.getLocalPlayerNid());
      this.renderer.syncRemotePlayers(this.network.getRemotePlayers(), FIXED_STEP);
      this.renderer.applyAbilityUseEvents(this.network.consumeAbilityUseEvents());
      this.renderer.syncPlatforms(this.getRenderPlatformStates());
      this.renderer.syncTrainingDummies(this.network.getTrainingDummies());
      this.renderer.syncProjectiles(this.network.getProjectiles(), FIXED_STEP);
      this.renderer.render(this.getRenderPose());
      this.updateStatus();
    };

    window.render_game_to_text = () => {
      const pose = this.getRenderPose();
      const selectedSlot = this.input.getSelectedHotbarSlot();
      const selectedAbilityId = this.hotbarAbilityIds[selectedSlot] ?? ABILITY_ID_NONE;
      const payload = {
        mode: this.network.getConnectionState(),
        pointerLock: document.pointerLockElement === this.canvas,
        coordinateSystem: "right-handed; +x right, +y up, -z forward",
        player: {
          ...pose,
          nid: this.network.getLocalPlayerNid()
        },
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
        remotePlayers: this.network.getRemotePlayers().map((p) => ({
          nid: p.nid,
          modelId: p.modelId,
          x: p.x,
          y: p.y,
          z: p.z,
          rotation: p.rotation,
          grounded: p.grounded,
          health: p.health
        })),
        localAbility: {
          selectedSlot,
          selectedAbilityId,
          ui: {
            loadoutPanelOpen: this.abilityHud.isLoadoutPanelOpen()
          },
          selectedAbilityName: this.resolveAbilityName(selectedAbilityId),
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
        perf: {
          fps: this.fps,
          lowFpsFrameCount: this.lowFpsFrameCount
        },
        reconciliation: {
          lastError: {
            position: this.lastReconcilePositionError,
            yaw: this.lastReconcileYawError,
            pitch: this.lastReconcilePitchError
          },
          smoothingOffset: {
            x: this.reconciliationRenderOffset.x,
            y: this.reconciliationRenderOffset.y,
            z: this.reconciliationRenderOffset.z,
            yaw: 0,
            pitch: 0,
            positionMagnitude: this.getReconciliationOffsetMagnitude()
          },
          lastReplayCount: this.lastReconcileReplayCount,
          totalCorrections: this.reconcileCorrectionCount,
          hardSnapCorrections: this.reconcileHardSnapCount
        }
      };
      return JSON.stringify(payload);
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
    window.set_test_primary_hold = (held) => {
      this.testPrimaryHeld = Boolean(held);
    };
    window.set_test_look_angles = (yaw, pitch) => {
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
        return;
      }
      this.input.setLookAngles(yaw, pitch);
    };
  }

  private getRenderPose() {
    if (this.freezeCamera && this.frozenCameraPose) {
      return { ...this.frozenCameraPose };
    }
    const renderPosition = this.getRenderPosition();
    const renderOffset = this.getReconciliationRenderOffsetWorld();
    return {
      x: renderPosition.x + renderOffset.x,
      y: renderPosition.y + renderOffset.y,
      z: renderPosition.z + renderOffset.z,
      yaw: this.input.getYaw(),
      pitch: Math.max(-LOOK_PITCH_LIMIT, Math.min(LOOK_PITCH_LIMIT, this.input.getPitch()))
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
    return this.platformTimeline.sampleStates(this.resolveRenderServerTimeSeconds());
  }

  private resolveRenderServerTimeSeconds(): number {
    if (this.isCspActive()) {
      return this.physics.getSimulationSeconds();
    }
    const estimatedServerSeconds = this.network.getEstimatedServerTimeSeconds();
    if (estimatedServerSeconds !== null) {
      const interpolationDelaySeconds = this.network.getInterpolationDelayMs() / 1000;
      return Math.max(0, estimatedServerSeconds - interpolationDelaySeconds);
    }
    return this.physics.getSimulationSeconds();
  }

  private applyDeterministicPlatformYawCarryForCspOff(): void {
    const currentServerTimeSeconds = this.resolveRenderServerTimeSeconds();
    const previousServerTimeSeconds = this.lastNonCspYawCarryServerTimeSeconds;
    this.lastNonCspYawCarryServerTimeSeconds = currentServerTimeSeconds;
    if (previousServerTimeSeconds === null) {
      return;
    }

    const groundedPlatformPid = this.network.getServerGroundedPlatformPid();
    if (groundedPlatformPid < 0) {
      return;
    }
    const definition = PLATFORM_DEFINITIONS.find((platform) => platform.pid === groundedPlatformPid);
    if (!definition) {
      return;
    }

    const previousPose = samplePlatformTransform(definition, previousServerTimeSeconds);
    const currentPose = samplePlatformTransform(definition, currentServerTimeSeconds);
    const yawDelta = normalizeYaw(currentPose.yaw - previousPose.yaw);
    if (Math.abs(yawDelta) <= 1e-6) {
      return;
    }
    this.input.applyYawDelta(yawDelta);
    this.network.syncSentYaw(this.input.getYaw());
  }

  private updateReconciliationSmoothing(
    preReconciliationPose: PlayerPose,
    postReconciliationPose: PlayerPose,
    replayCount: number
  ): void {
    const currentRenderOffset = this.getReconciliationRenderOffsetWorld();
    const preRenderedPose = {
      x: preReconciliationPose.x + currentRenderOffset.x,
      y: preReconciliationPose.y + currentRenderOffset.y,
      z: preReconciliationPose.z + currentRenderOffset.z
    };

    const positionError = Math.hypot(
      preReconciliationPose.x - postReconciliationPose.x,
      preReconciliationPose.y - postReconciliationPose.y,
      preReconciliationPose.z - postReconciliationPose.z
    );
    const yawError = Math.abs(normalizeYaw(preReconciliationPose.yaw - postReconciliationPose.yaw));
    const pitchError = Math.abs(preReconciliationPose.pitch - postReconciliationPose.pitch);
    const shouldHardSnap =
      positionError > RECONCILE_POSITION_SNAP_THRESHOLD || yawError > RECONCILE_YAW_SNAP_THRESHOLD;

    this.lastReconcilePositionError = positionError;
    this.lastReconcileYawError = yawError;
    this.lastReconcilePitchError = pitchError;
    this.lastReconcileReplayCount = replayCount;
    this.reconcileCorrectionCount += 1;

    if (shouldHardSnap) {
      this.reconcileHardSnapCount += 1;
      this.resetReconciliationSmoothing();
      return;
    }

    this.setReconciliationRenderOffsetFromWorld(
      {
        x: preRenderedPose.x - postReconciliationPose.x,
        y: preRenderedPose.y - postReconciliationPose.y,
        z: preRenderedPose.z - postReconciliationPose.z
      },
      this.physics.getKinematicState().groundedPlatformPid
    );
  }

  private decayReconciliationSmoothing(delta: number): void {
    const clampedDelta = Math.max(0, delta);
    const positionDecay = Math.exp(-RECONCILE_POSITION_SMOOTH_RATE * clampedDelta);
    if (this.reconciliationRenderOffsetPlatformPid === null) {
      this.reconciliationRenderOffset.x *= positionDecay;
      this.reconciliationRenderOffset.z *= positionDecay;
      if (Math.abs(this.reconciliationRenderOffset.x) < RECONCILE_OFFSET_EPSILON) {
        this.reconciliationRenderOffset.x = 0;
      }
      if (Math.abs(this.reconciliationRenderOffset.z) < RECONCILE_OFFSET_EPSILON) {
        this.reconciliationRenderOffset.z = 0;
      }
    } else {
      this.reconciliationRenderOffsetPlatformLocal.x *= positionDecay;
      this.reconciliationRenderOffsetPlatformLocal.z *= positionDecay;
      if (Math.abs(this.reconciliationRenderOffsetPlatformLocal.x) < RECONCILE_OFFSET_EPSILON) {
        this.reconciliationRenderOffsetPlatformLocal.x = 0;
      }
      if (Math.abs(this.reconciliationRenderOffsetPlatformLocal.z) < RECONCILE_OFFSET_EPSILON) {
        this.reconciliationRenderOffsetPlatformLocal.z = 0;
      }
    }
    this.reconciliationRenderOffset.y *= positionDecay;

    if (Math.abs(this.reconciliationRenderOffset.y) < RECONCILE_OFFSET_EPSILON) {
      this.reconciliationRenderOffset.y = 0;
    }
  }

  private resetReconciliationSmoothing(): void {
    this.reconciliationRenderOffset = { x: 0, y: 0, z: 0 };
    this.reconciliationRenderOffsetPlatformPid = null;
    this.reconciliationRenderOffsetPlatformLocal = { x: 0, z: 0 };
    this.predictedPlatformYawCarrySinceAck = 0;
  }

  private getReconciliationOffsetMagnitude(): number {
    const renderOffset = this.getReconciliationRenderOffsetWorld();
    return Math.hypot(renderOffset.x, renderOffset.y, renderOffset.z);
  }

  private getReconciliationRenderOffsetWorld(): { x: number; y: number; z: number } {
    if (this.reconciliationRenderOffsetPlatformPid === null) {
      return { ...this.reconciliationRenderOffset };
    }

    const platform = this.physics.getPlatformTransform(this.reconciliationRenderOffsetPlatformPid);
    if (!platform) {
      return { ...this.reconciliationRenderOffset };
    }

    const cos = Math.cos(platform.yaw);
    const sin = Math.sin(platform.yaw);
    return {
      x: this.reconciliationRenderOffsetPlatformLocal.x * cos + this.reconciliationRenderOffsetPlatformLocal.z * sin,
      y: this.reconciliationRenderOffset.y,
      z:
        -this.reconciliationRenderOffsetPlatformLocal.x * sin +
        this.reconciliationRenderOffsetPlatformLocal.z * cos
    };
  }

  private setReconciliationRenderOffsetFromWorld(
    worldOffset: { x: number; y: number; z: number },
    groundedPlatformPid: number | null
  ): void {
    this.reconciliationRenderOffset.y = worldOffset.y;
    if (groundedPlatformPid === null) {
      this.reconciliationRenderOffset.x = worldOffset.x;
      this.reconciliationRenderOffset.z = worldOffset.z;
      this.reconciliationRenderOffsetPlatformPid = null;
      this.reconciliationRenderOffsetPlatformLocal = { x: 0, z: 0 };
      return;
    }

    const platform = this.physics.getPlatformTransform(groundedPlatformPid);
    if (!platform) {
      this.reconciliationRenderOffset.x = worldOffset.x;
      this.reconciliationRenderOffset.z = worldOffset.z;
      this.reconciliationRenderOffsetPlatformPid = null;
      this.reconciliationRenderOffsetPlatformLocal = { x: 0, z: 0 };
      return;
    }

    const cos = Math.cos(platform.yaw);
    const sin = Math.sin(platform.yaw);
    this.reconciliationRenderOffsetPlatformPid = groundedPlatformPid;
    this.reconciliationRenderOffsetPlatformLocal.x = worldOffset.x * cos - worldOffset.z * sin;
    this.reconciliationRenderOffsetPlatformLocal.z = worldOffset.x * sin + worldOffset.z * cos;
    this.reconciliationRenderOffset.x = 0;
    this.reconciliationRenderOffset.z = 0;
  }

  private syncReconciliationOffsetPlatformFrame(): void {
    if (this.reconciliationRenderOffsetPlatformPid === null) {
      return;
    }

    const currentGroundedPlatformPid = this.physics.getKinematicState().groundedPlatformPid;
    if (currentGroundedPlatformPid === this.reconciliationRenderOffsetPlatformPid) {
      return;
    }

    const worldOffset = this.getReconciliationRenderOffsetWorld();
    this.setReconciliationRenderOffsetFromWorld(worldOffset, currentGroundedPlatformPid);
  }

  private readonly onResize = (): void => {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  };

  private resolveAbilityName(abilityId: number): string {
    return (
      this.network.getAbilityById(abilityId)?.name ?? getAbilityDefinitionById(abilityId)?.name ?? "Empty"
    );
  }

  private resolveLocalGroundedState(): boolean {
    if (this.isCspActive()) {
      return this.physics.isGrounded();
    }
    return this.network.getLocalPlayerPose()?.grounded ?? this.physics.isGrounded();
  }

  private getSelectedAbilityDefinition() {
    const selectedSlot = this.input.getSelectedHotbarSlot();
    const abilityId = this.hotbarAbilityIds[selectedSlot] ?? ABILITY_ID_NONE;
    return this.network.getAbilityById(abilityId) ?? getAbilityDefinitionById(abilityId);
  }

  private consumeTestPrimaryActionTrigger(): boolean {
    if (this.queuedTestPrimaryActionCount <= 0) {
      return false;
    }
    this.queuedTestPrimaryActionCount -= 1;
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

  private static resolveCspEnabled(): boolean {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("csp");
    if (raw === "1" || raw === "true") {
      return true;
    }
    return false;
  }

  private isCspActive(): boolean {
    return this.cspEnabled;
  }
}
