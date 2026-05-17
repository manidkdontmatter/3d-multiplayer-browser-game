/**
 * Purpose: This file reconciles client prediction with authoritative server updates.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { normalizeYaw } from "../../shared/index";
import type { PlayerPose } from "./types";

const RECONCILE_POSITION_SMOOTH_RATE = 14;
const RECONCILE_POSITION_SNAP_THRESHOLD = 2.5;
const RECONCILE_YAW_SNAP_THRESHOLD = Math.PI * 0.75;
const RECONCILE_OFFSET_EPSILON = 0.0005;

export interface PlatformTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

type CorrectionFrameKind = "platform" | "reference";

interface CorrectionFrameKey {
  kind: CorrectionFrameKind;
  pid: number;
}

export interface ReconciliationSmootherOptions {
  getPlatformTransform: (pid: number) => PlatformTransform | null;
  getReferenceFrameTransform: (pid: number) => PlatformTransform | null;
  getCurrentGroundedPlatformPid: () => number | null;
  getCurrentCarriedFramePid: () => number | null;
}

export interface ReconciliationDiagnostics {
  lastPositionError: number;
  lastYawError: number;
  lastPitchError: number;
  lastReplayCount: number;
  totalCorrections: number;
  hardSnapCorrections: number;
  rawOffset: { x: number; y: number; z: number };
  worldOffsetMagnitude: number;
}

export class ReconciliationSmoother {
  private worldOffset = { x: 0, y: 0, z: 0 };
  private correctionFrame: CorrectionFrameKey | null = null;
  private frameLocalOffset = { x: 0, z: 0 };
  private lastPositionError = 0;
  private lastYawError = 0;
  private lastPitchError = 0;
  private lastReplayCount = 0;
  private totalCorrections = 0;
  private hardSnapCorrections = 0;

  public constructor(private readonly options: ReconciliationSmootherOptions) {}

  public applyCorrection(
    preReconciliationPose: PlayerPose,
    postReconciliationPose: PlayerPose,
    replayCount: number,
    groundedPlatformPid: number | null,
    carriedFramePid: number | null
  ): void {
    const currentOffset = this.getWorldOffset();
    const preRenderedPose = {
      x: preReconciliationPose.x + currentOffset.x,
      y: preReconciliationPose.y + currentOffset.y,
      z: preReconciliationPose.z + currentOffset.z
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

    this.lastPositionError = positionError;
    this.lastYawError = yawError;
    this.lastPitchError = pitchError;
    this.lastReplayCount = replayCount;
    this.totalCorrections += 1;

    if (shouldHardSnap) {
      this.hardSnapCorrections += 1;
      this.reset();
      return;
    }

    this.setOffsetFromWorld(
      {
        x: preRenderedPose.x - postReconciliationPose.x,
        y: preRenderedPose.y - postReconciliationPose.y,
        z: preRenderedPose.z - postReconciliationPose.z
      },
      this.selectCorrectionFrame(groundedPlatformPid, carriedFramePid)
    );
  }

  public syncPlatformFrame(): void {
    if (this.correctionFrame === null) {
      return;
    }

    const currentFrame = this.selectCorrectionFrame(
      this.options.getCurrentGroundedPlatformPid(),
      this.options.getCurrentCarriedFramePid()
    );
    if (this.isSameCorrectionFrame(currentFrame, this.correctionFrame)) {
      return;
    }

    const worldOffset = this.getWorldOffset();
    this.setOffsetFromWorld(worldOffset, currentFrame);
  }

  public decay(deltaSeconds: number): void {
    const clampedDelta = Math.max(0, deltaSeconds);
    const positionDecay = Math.exp(-RECONCILE_POSITION_SMOOTH_RATE * clampedDelta);
    if (this.correctionFrame === null) {
      this.worldOffset.x *= positionDecay;
      this.worldOffset.z *= positionDecay;
      if (Math.abs(this.worldOffset.x) < RECONCILE_OFFSET_EPSILON) {
        this.worldOffset.x = 0;
      }
      if (Math.abs(this.worldOffset.z) < RECONCILE_OFFSET_EPSILON) {
        this.worldOffset.z = 0;
      }
    } else {
      this.frameLocalOffset.x *= positionDecay;
      this.frameLocalOffset.z *= positionDecay;
      if (Math.abs(this.frameLocalOffset.x) < RECONCILE_OFFSET_EPSILON) {
        this.frameLocalOffset.x = 0;
      }
      if (Math.abs(this.frameLocalOffset.z) < RECONCILE_OFFSET_EPSILON) {
        this.frameLocalOffset.z = 0;
      }
    }
    this.worldOffset.y *= positionDecay;
    if (Math.abs(this.worldOffset.y) < RECONCILE_OFFSET_EPSILON) {
      this.worldOffset.y = 0;
    }
  }

  public reset(): void {
    this.worldOffset = { x: 0, y: 0, z: 0 };
    this.correctionFrame = null;
    this.frameLocalOffset = { x: 0, z: 0 };
  }

  public getWorldOffset(): { x: number; y: number; z: number } {
    if (this.correctionFrame === null) {
      return { ...this.worldOffset };
    }

    const frame = this.getCorrectionFrameTransform(this.correctionFrame);
    if (!frame) {
      return { ...this.worldOffset };
    }

    const cos = Math.cos(frame.yaw);
    const sin = Math.sin(frame.yaw);
    return {
      x: this.frameLocalOffset.x * cos + this.frameLocalOffset.z * sin,
      y: this.worldOffset.y,
      z: -this.frameLocalOffset.x * sin + this.frameLocalOffset.z * cos
    };
  }

  public getDiagnostics(): ReconciliationDiagnostics {
    const worldOffset = this.getWorldOffset();
    return {
      lastPositionError: this.lastPositionError,
      lastYawError: this.lastYawError,
      lastPitchError: this.lastPitchError,
      lastReplayCount: this.lastReplayCount,
      totalCorrections: this.totalCorrections,
      hardSnapCorrections: this.hardSnapCorrections,
      rawOffset: { ...this.worldOffset },
      worldOffsetMagnitude: Math.hypot(worldOffset.x, worldOffset.y, worldOffset.z)
    };
  }

  private setOffsetFromWorld(
    worldOffset: { x: number; y: number; z: number },
    correctionFrame: CorrectionFrameKey | null
  ): void {
    this.worldOffset.y = worldOffset.y;
    if (correctionFrame === null) {
      this.worldOffset.x = worldOffset.x;
      this.worldOffset.z = worldOffset.z;
      this.correctionFrame = null;
      this.frameLocalOffset = { x: 0, z: 0 };
      return;
    }

    const frame = this.getCorrectionFrameTransform(correctionFrame);
    if (!frame) {
      this.worldOffset.x = worldOffset.x;
      this.worldOffset.z = worldOffset.z;
      this.correctionFrame = null;
      this.frameLocalOffset = { x: 0, z: 0 };
      return;
    }

    const cos = Math.cos(frame.yaw);
    const sin = Math.sin(frame.yaw);
    this.correctionFrame = correctionFrame;
    this.frameLocalOffset.x = worldOffset.x * cos - worldOffset.z * sin;
    this.frameLocalOffset.z = worldOffset.x * sin + worldOffset.z * cos;
    this.worldOffset.x = 0;
    this.worldOffset.z = 0;
  }

  private selectCorrectionFrame(
    groundedPlatformPid: number | null,
    carriedFramePid: number | null
  ): CorrectionFrameKey | null {
    if (groundedPlatformPid !== null) {
      return { kind: "platform", pid: groundedPlatformPid };
    }
    if (carriedFramePid !== null) {
      return { kind: "reference", pid: carriedFramePid };
    }
    return null;
  }

  private getCorrectionFrameTransform(frame: CorrectionFrameKey): PlatformTransform | null {
    return frame.kind === "platform"
      ? this.options.getPlatformTransform(frame.pid)
      : this.options.getReferenceFrameTransform(frame.pid);
  }

  private isSameCorrectionFrame(a: CorrectionFrameKey | null, b: CorrectionFrameKey | null): boolean {
    if (a === null || b === null) {
      return a === b;
    }
    return a.kind === b.kind && a.pid === b.pid;
  }
}
