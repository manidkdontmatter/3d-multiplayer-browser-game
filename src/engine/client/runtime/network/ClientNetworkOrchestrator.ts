/**
 * Purpose: This file coordinates client-side behavior and presentation, and handles network transport, message flow, or network state.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  getLocationDefinitionByPid,
  normalizeYaw,
  PLATFORM_DEFINITIONS,
  sampleLocationTransform,
  SERVER_TICK_SECONDS
} from "../../../shared/index";
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
  private lastNonCspYawCarryServerTimeSeconds: number | null = null;

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
      this.lastNonCspYawCarryServerTimeSeconds = null;
      const predictedPlatformYawDelta = this.physics.predictAttachedPlatformYawDelta(delta);
      const predictedFrameYawDelta = this.physics.predictCarriedFrameYawDelta(delta);
      const predictedYawDelta = normalizeYaw(predictedPlatformYawDelta + predictedFrameYawDelta);
      if (Math.abs(predictedYawDelta) > 1e-6) {
        look.applyYawDelta(predictedYawDelta);
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
    if (groundedPlatformPid >= 0) {
      const definition = PLATFORM_DEFINITIONS.find((platform) => platform.pid === groundedPlatformPid);
      if (!definition) {
        return;
      }

      const previousPose = samplePlatformTransform(definition, previousServerTimeSeconds);
      const currentPose = samplePlatformTransform(definition, currentServerTimeSeconds);
      this.applyYawCarryDelta(look, normalizeYaw(currentPose.yaw - previousPose.yaw));
      return;
    }

    const carriedFramePid = this.network.getServerCarriedFramePid();
    if (carriedFramePid < 0) {
      return;
    }
    const location = getLocationDefinitionByPid(carriedFramePid);
    if (!location || location.motion === "static") {
      return;
    }

    const previousPose = sampleLocationTransform(location, previousServerTimeSeconds);
    const currentPose = sampleLocationTransform(location, currentServerTimeSeconds);
    this.applyYawCarryDelta(look, normalizeYaw(currentPose.yaw - previousPose.yaw));
  }

  private applyYawCarryDelta(
    look: {
      getYaw: () => number;
      applyYawDelta: (deltaYaw: number) => void;
    },
    yawDelta: number
  ): void {
    if (Math.abs(yawDelta) <= 1e-6) {
      return;
    }
    look.applyYawDelta(yawDelta);
    this.network.syncSentYaw(look.getYaw());
  }
}
