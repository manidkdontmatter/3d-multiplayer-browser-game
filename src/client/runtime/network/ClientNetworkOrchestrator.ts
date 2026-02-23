import { normalizeYaw, PLATFORM_DEFINITIONS, SERVER_TICK_SECONDS } from "../../../shared/index";
import { samplePlatformTransform } from "../../../shared/platforms";
import { LocalPhysicsWorld } from "../LocalPhysicsWorld";
import { NetworkClient } from "../NetworkClient";
import { ReconciliationSmoother } from "../ReconciliationSmoother";
import type { MovementInput, PlayerPose } from "../types";

export interface ClientNetworkStepParams {
  delta: number;
  movement: MovementInput;
  isCspActive: boolean;
  orientation: { yaw: number; pitch: number };
  actions: { usePrimaryPressed: boolean; usePrimaryHeld: boolean };
  look: {
    getYaw: () => number;
    getPitch: () => number;
    applyYawDelta: (deltaYaw: number) => void;
  };
}

export class ClientNetworkOrchestrator {
  private readonly reconciliationSmoother: ReconciliationSmoother;
  private lastNonCspYawCarryServerTimeSeconds: number | null = null;

  public constructor(
    private readonly network: NetworkClient,
    private readonly physics: LocalPhysicsWorld
  ) {
    this.reconciliationSmoother = new ReconciliationSmoother({
      getPlatformTransform: (pid) => this.physics.getPlatformTransform(pid),
      getCurrentGroundedPlatformPid: () => this.physics.getKinematicState().groundedPlatformPid
    });
  }

  public onCspModeChanged(): void {
    this.reconciliationSmoother.reset();
  }

  public stepFixed(params: ClientNetworkStepParams): void {
    const { delta, movement, isCspActive, look } = params;
    let yaw = params.orientation.yaw;
    const pitch = params.orientation.pitch;

    this.network.step(delta, movement, { yaw, pitch }, params.actions);

    let preReconciliationPose: PlayerPose | null = null;
    if (isCspActive) {
      this.lastNonCspYawCarryServerTimeSeconds = null;
      const predictedPlatformYawDelta = this.physics.predictAttachedPlatformYawDelta(delta);
      if (Math.abs(predictedPlatformYawDelta) > 1e-6) {
        look.applyYawDelta(predictedPlatformYawDelta);
        this.network.syncSentYaw(look.getYaw());
        yaw = look.getYaw();
      }
      this.physics.step(delta, movement, yaw, pitch);
      preReconciliationPose = this.physics.getPose();
    } else {
      this.applyDeterministicPlatformYawCarryForCspOff(look);
      this.reconciliationSmoother.reset();
    }

    const recon = this.network.consumeReconciliationFrame();
    if (recon) {
      this.physics.setReconciliationState({
        x: recon.ack.x,
        y: recon.ack.y,
        z: recon.ack.z,
        yaw: look.getYaw(),
        pitch: look.getPitch(),
        vx: recon.ack.vx,
        vy: recon.ack.vy,
        vz: recon.ack.vz,
        grounded: recon.ack.grounded,
        groundedPlatformPid: recon.ack.groundedPlatformPid,
        serverTimeSeconds: recon.ack.serverTick * SERVER_TICK_SECONDS
      });

      if (isCspActive) {
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
          this.reconciliationSmoother.applyCorrection(
            preReconciliationPose,
            postReconciliationPose,
            recon.replay.length,
            this.physics.getKinematicState().groundedPlatformPid
          );
        }
      }
    }

    if (isCspActive) {
      this.reconciliationSmoother.syncPlatformFrame();
      this.reconciliationSmoother.decay(delta);
    }
  }

  public getRenderServerTimeSeconds(isCspActive: boolean): number {
    if (isCspActive) {
      return this.physics.getSimulationSeconds();
    }
    const estimatedServerSeconds = this.network.getEstimatedServerTimeSeconds();
    if (estimatedServerSeconds !== null) {
      const interpolationDelaySeconds = this.network.getInterpolationDelayMs() / 1000;
      return Math.max(0, estimatedServerSeconds - interpolationDelaySeconds);
    }
    return this.physics.getSimulationSeconds();
  }

  public getWorldOffset(): { x: number; y: number; z: number } {
    return this.reconciliationSmoother.getWorldOffset();
  }

  public getDiagnostics() {
    return this.reconciliationSmoother.getDiagnostics();
  }

  public reset(): void {
    this.lastNonCspYawCarryServerTimeSeconds = null;
    this.reconciliationSmoother.reset();
  }

  private applyDeterministicPlatformYawCarryForCspOff(look: {
    getYaw: () => number;
    applyYawDelta: (deltaYaw: number) => void;
  }): void {
    const currentServerTimeSeconds = this.getRenderServerTimeSeconds(false);
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
    look.applyYawDelta(yawDelta);
    this.network.syncSentYaw(look.getYaw());
  }
}
