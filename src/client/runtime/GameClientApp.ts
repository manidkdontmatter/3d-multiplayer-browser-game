import { Clock } from "three";
import { normalizeYaw, SERVER_TICK_SECONDS } from "../../shared/index";
import { NetworkClient } from "./NetworkClient";
import { InputController } from "./InputController";
import { LocalPhysicsWorld } from "./LocalPhysicsWorld";
import { WorldRenderer } from "./WorldRenderer";
import type { MovementInput, PlayerPose } from "./types";

const FIXED_STEP = 1 / 60;
const YAW_RECONCILE_EPSILON = 0.03;

export class GameClientApp {
  private readonly input: InputController;
  private readonly renderer: WorldRenderer;
  private readonly network = new NetworkClient();
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
  private wasServerGroundedOnPlatform = false;
  private lastPlatformServerYaw: number | null = null;
  private testMovementOverride: MovementInput | null = null;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    statusNode: HTMLElement | null,
    physics: LocalPhysicsWorld,
    cspEnabled: boolean
  ) {
    this.statusNode = statusNode;
    this.physics = physics;
    this.cspEnabled = cspEnabled;
    this.input = new InputController(canvas);
    this.renderer = new WorldRenderer(canvas);
  }

  public static async create(
    canvas: HTMLCanvasElement,
    statusNode: HTMLElement | null
  ): Promise<GameClientApp> {
    const physics = await LocalPhysicsWorld.create();
    const app = new GameClientApp(canvas, statusNode, physics, GameClientApp.resolveCspEnabled());
    await app.network.connect(GameClientApp.resolveServerUrl());
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
    if (!this.running) {
      return;
    }
    this.running = false;
    this.input.detach();
    window.removeEventListener("resize", this.onResize);
    window.cancelAnimationFrame(this.rafId);
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
      this.frozenCameraPose = this.freezeCamera ? this.physics.getPose() : null;
    }
    if (this.input.consumeCspToggle()) {
      this.cspEnabled = !this.cspEnabled;
    }

    this.accumulator += seconds;
    while (this.accumulator >= FIXED_STEP) {
      this.stepFixed(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }

    const pose = this.getRenderPose();
    this.renderer.syncRemotePlayers(this.network.getRemotePlayers());
    this.renderer.syncPlatforms(this.network.getPlatforms());
    this.renderer.render(pose);
    this.updateStatus();
  }

  private stepFixed(delta: number): void {
    const movement = this.testMovementOverride ?? this.input.sampleMovement();
    const yaw = this.input.getYaw();
    const pitch = this.input.getPitch();

    this.network.step(delta, movement, { yaw, pitch });

    const serverGroundedOnPlatform = this.network.isServerGroundedOnPlatform();
    if (this.cspEnabled) {
      this.physics.step(delta, movement, yaw, pitch);
    }

    const recon = this.network.consumeReconciliationFrame();
    if (recon) {
      if (recon.ack.groundedPlatformPid >= 0) {
        // While platform-carried, compose only authoritative platform yaw delta into look yaw.
        if (this.lastPlatformServerYaw !== null) {
          const platformYawDelta = normalizeYaw(recon.ack.yaw - this.lastPlatformServerYaw);
          if (Math.abs(platformYawDelta) > 1e-6) {
            this.input.applyYawDelta(platformYawDelta);
          }
        }
        this.lastPlatformServerYaw = recon.ack.yaw;
        // Keep delta baseline aligned after external yaw adjustment to avoid double-applying carry.
        this.network.syncSentYaw(this.input.getYaw());
      } else if (this.wasServerGroundedOnPlatform) {
        const yawError = normalizeYaw(recon.ack.yaw - this.input.getYaw());
        if (Math.abs(yawError) > YAW_RECONCILE_EPSILON) {
          this.input.applyYawDelta(yawError);
        }
        this.network.syncSentYaw(this.input.getYaw());
        this.lastPlatformServerYaw = null;
      } else {
        this.lastPlatformServerYaw = null;
      }

      if (this.cspEnabled) {
        this.physics.setReconciliationState({
          x: recon.ack.x,
          y: recon.ack.y,
          z: recon.ack.z,
          yaw: recon.ack.yaw,
          pitch: recon.ack.pitch,
          vx: recon.ack.vx,
          vy: recon.ack.vy,
          vz: recon.ack.vz,
          grounded: recon.ack.grounded,
          groundedPlatformPid: recon.ack.groundedPlatformPid,
          serverTimeSeconds: recon.ack.serverTick * SERVER_TICK_SECONDS
        });

        for (const pending of recon.replay) {
          this.physics.step(
            pending.delta,
            pending.movement,
            pending.orientation.yaw,
            pending.orientation.pitch
          );
        }
      }
    }

    this.wasServerGroundedOnPlatform = serverGroundedOnPlatform;
  }

  private updateStatus(): void {
    if (!this.statusNode) {
      return;
    }

    const pose = this.getRenderPose();
    const netState = this.network.getConnectionState();
    this.statusNode.textContent =
      `mode=${netState} | csp=${this.cspEnabled ? "on" : "off"} | cam=${this.freezeCamera ? "frozen" : "follow"} | fps=${this.fps.toFixed(0)} | low<30=${this.lowFpsFrameCount} | x=${pose.x.toFixed(2)} y=${pose.y.toFixed(2)} z=${pose.z.toFixed(2)}`;
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
      this.renderer.syncRemotePlayers(this.network.getRemotePlayers());
      this.renderer.syncPlatforms(this.network.getPlatforms());
      this.renderer.render(this.getRenderPose());
      this.updateStatus();
    };

    window.render_game_to_text = () => {
      const pose = this.getRenderPose();
      const payload = {
        mode: this.network.getConnectionState(),
        pointerLock: document.pointerLockElement === this.canvas,
        coordinateSystem: "right-handed; +x right, +y up, +z forward",
        player: {
          ...pose,
          nid: this.network.getLocalPlayerNid()
        },
        platforms: this.network.getPlatforms().map((p) => ({
          nid: p.nid,
          pid: p.pid,
          kind: p.kind,
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: p.yaw
        })),
        remotePlayers: this.network.getRemotePlayers().map((p) => ({
          nid: p.nid,
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: p.yaw,
          pitch: p.pitch
        }))
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
  }

  private getRenderPose() {
    if (this.freezeCamera && this.frozenCameraPose) {
      return { ...this.frozenCameraPose };
    }
    if (!this.cspEnabled) {
      const serverPose = this.network.getLocalPlayerPose();
      if (serverPose) {
        return {
          x: serverPose.x,
          y: serverPose.y,
          z: serverPose.z,
          yaw: serverPose.yaw,
          pitch: serverPose.pitch
        };
      }
    }
    return this.physics.getPose();
  }

  private readonly onResize = (): void => {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  };

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
}
