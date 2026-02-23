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

export interface ReconciliationSmootherOptions {
  getPlatformTransform: (pid: number) => PlatformTransform | null;
  getCurrentGroundedPlatformPid: () => number | null;
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
  private platformPid: number | null = null;
  private platformLocalOffset = { x: 0, z: 0 };
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
    groundedPlatformPid: number | null
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
      groundedPlatformPid
    );
  }

  public syncPlatformFrame(): void {
    if (this.platformPid === null) {
      return;
    }

    const currentGroundedPlatformPid = this.options.getCurrentGroundedPlatformPid();
    if (currentGroundedPlatformPid === this.platformPid) {
      return;
    }

    const worldOffset = this.getWorldOffset();
    this.setOffsetFromWorld(worldOffset, currentGroundedPlatformPid);
  }

  public decay(deltaSeconds: number): void {
    const clampedDelta = Math.max(0, deltaSeconds);
    const positionDecay = Math.exp(-RECONCILE_POSITION_SMOOTH_RATE * clampedDelta);
    if (this.platformPid === null) {
      this.worldOffset.x *= positionDecay;
      this.worldOffset.z *= positionDecay;
      if (Math.abs(this.worldOffset.x) < RECONCILE_OFFSET_EPSILON) {
        this.worldOffset.x = 0;
      }
      if (Math.abs(this.worldOffset.z) < RECONCILE_OFFSET_EPSILON) {
        this.worldOffset.z = 0;
      }
    } else {
      this.platformLocalOffset.x *= positionDecay;
      this.platformLocalOffset.z *= positionDecay;
      if (Math.abs(this.platformLocalOffset.x) < RECONCILE_OFFSET_EPSILON) {
        this.platformLocalOffset.x = 0;
      }
      if (Math.abs(this.platformLocalOffset.z) < RECONCILE_OFFSET_EPSILON) {
        this.platformLocalOffset.z = 0;
      }
    }
    this.worldOffset.y *= positionDecay;
    if (Math.abs(this.worldOffset.y) < RECONCILE_OFFSET_EPSILON) {
      this.worldOffset.y = 0;
    }
  }

  public reset(): void {
    this.worldOffset = { x: 0, y: 0, z: 0 };
    this.platformPid = null;
    this.platformLocalOffset = { x: 0, z: 0 };
  }

  public getWorldOffset(): { x: number; y: number; z: number } {
    if (this.platformPid === null) {
      return { ...this.worldOffset };
    }

    const platform = this.options.getPlatformTransform(this.platformPid);
    if (!platform) {
      return { ...this.worldOffset };
    }

    const cos = Math.cos(platform.yaw);
    const sin = Math.sin(platform.yaw);
    return {
      x: this.platformLocalOffset.x * cos + this.platformLocalOffset.z * sin,
      y: this.worldOffset.y,
      z: -this.platformLocalOffset.x * sin + this.platformLocalOffset.z * cos
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
    groundedPlatformPid: number | null
  ): void {
    this.worldOffset.y = worldOffset.y;
    if (groundedPlatformPid === null) {
      this.worldOffset.x = worldOffset.x;
      this.worldOffset.z = worldOffset.z;
      this.platformPid = null;
      this.platformLocalOffset = { x: 0, z: 0 };
      return;
    }

    const platform = this.options.getPlatformTransform(groundedPlatformPid);
    if (!platform) {
      this.worldOffset.x = worldOffset.x;
      this.worldOffset.z = worldOffset.z;
      this.platformPid = null;
      this.platformLocalOffset = { x: 0, z: 0 };
      return;
    }

    const cos = Math.cos(platform.yaw);
    const sin = Math.sin(platform.yaw);
    this.platformPid = groundedPlatformPid;
    this.platformLocalOffset.x = worldOffset.x * cos - worldOffset.z * sin;
    this.platformLocalOffset.z = worldOffset.x * sin + worldOffset.z * cos;
    this.worldOffset.x = 0;
    this.worldOffset.z = 0;
  }
}
