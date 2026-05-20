/**
 * Purpose: This file coordinates client-side behavior and presentation, and handles network transport, message flow, or network state.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  normalizeYaw,
  SERVER_TICK_SECONDS
} from "../../../shared/index";
import { LocalPhysicsWorld } from "../LocalPhysicsWorld";
import { NetworkClient } from "../NetworkClient";
import { ReconciliationSmoother } from "../ReconciliationSmoother";
import type { MovementInput, PlayerPose } from "../types";

export interface ClientNetworkStepParams {
  delta: number;
  movement: MovementInput;
  isCspActive: boolean;
  orientation: { yaw: number; pitch: number };
  actions: {
    usePrimaryPressed: boolean;
    usePrimaryHeld: boolean;
    useSecondaryPressed: boolean;
    useSecondaryHeld: boolean;
    castSlotPressed: boolean;
    castSlotIndex: number;
  };
  look: {
    getYaw: () => number;
    getPitch: () => number;
    applyYawDelta: (deltaYaw: number) => void;
  };
}

export class ClientNetworkOrchestrator {
  private readonly reconciliationSmoother: ReconciliationSmoother;
  private renderServerTimeSeconds: number | null = null;

  public constructor(
    private readonly network: NetworkClient,
    private readonly physics: LocalPhysicsWorld
  ) {
    this.reconciliationSmoother = new ReconciliationSmoother({
      getPlatformTransform: (pid) => this.physics.getPlatformTransform(pid),
      getReferenceFrameTransform: (pid) => this.physics.getMovingLocationTransform(pid),
      getCurrentGroundedPlatformPid: () => this.physics.getKinematicState().groundedPlatformPid,
      getCurrentCarriedFramePid: () => this.physics.getKinematicState().carriedFramePid
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
      const predictedPlatformYawDelta = this.physics.predictAttachedPlatformYawDelta(delta);
      const predictedYawDelta = normalizeYaw(predictedPlatformYawDelta);
      if (Math.abs(predictedYawDelta) > 1e-6) {
        look.applyYawDelta(predictedYawDelta);
        this.network.syncSentYaw(look.getYaw());
        yaw = look.getYaw();
      }
      this.physics.step(delta, movement, yaw, pitch);
      preReconciliationPose = this.physics.getPose();
    } else {
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
        carriedFramePid: recon.ack.carriedFramePid,
        movementMode: recon.ack.movementMode,
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
          const kinematic = this.physics.getKinematicState();
          this.reconciliationSmoother.applyCorrection(
            preReconciliationPose,
            postReconciliationPose,
            recon.replay.length,
            kinematic.groundedPlatformPid,
            kinematic.carriedFramePid
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
    if (this.renderServerTimeSeconds === null) {
      this.updateRenderServerTimeClock(isCspActive, 0);
    }
    return this.renderServerTimeSeconds ?? 0;
  }

  public advanceRenderServerTime(seconds: number, isCspActive: boolean): number {
    this.updateRenderServerTimeClock(isCspActive, seconds);
    return this.renderServerTimeSeconds ?? 0;
  }

  private updateRenderServerTimeClock(isCspActive: boolean, seconds: number): void {
    const dt = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const target = this.resolveRenderServerTimeTargetSeconds(isCspActive);
    if (this.renderServerTimeSeconds === null || !Number.isFinite(this.renderServerTimeSeconds)) {
      this.renderServerTimeSeconds = target;
      return;
    }
    if (dt > 0) {
      this.renderServerTimeSeconds += dt;
    }
    const error = target - this.renderServerTimeSeconds;
    if (Math.abs(error) > 0.5) {
      this.renderServerTimeSeconds = target;
      return;
    }
    const correctionGain = Math.min(1, dt * 8);
    this.renderServerTimeSeconds += error * correctionGain;
    if (this.renderServerTimeSeconds < 0) {
      this.renderServerTimeSeconds = 0;
    }
  }

  private resolveRenderServerTimeTargetSeconds(isCspActive: boolean): number {
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
    this.reconciliationSmoother.reset();
    this.renderServerTimeSeconds = null;
  }
}
