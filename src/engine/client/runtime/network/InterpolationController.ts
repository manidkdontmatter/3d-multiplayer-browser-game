/**
 * Purpose: This file smooths remote state movement between network updates.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { SERVER_TICK_RATE } from "../../../shared/config";

const SERVER_TICK_INTERVAL_MS = 1000 / SERVER_TICK_RATE;
const INTERPOLATION_DELAY_MIN_MS = 40;
const INTERPOLATION_DELAY_MAX_MS = 220;
const INTERPOLATION_DELAY_BASE_TICKS = 1.6;
const INTERPOLATION_DELAY_UPDATE_HOLD_MS = 10_000;
const INTERPOLATION_DELAY_STEP_MS = 5;
const INTERPOLATION_DELAY_FIXED_TEST_MS = 150;
const INTERPOLATION_DELAY_FORCE_FIXED_FOR_TEST = false;
const SNAPSHOT_JITTER_SMOOTHING = 0.15;

export class InterpolationController {
  private config = {
    minMs: INTERPOLATION_DELAY_MIN_MS,
    maxMs: INTERPOLATION_DELAY_MAX_MS,
    baseTicks: INTERPOLATION_DELAY_BASE_TICKS,
    holdMs: INTERPOLATION_DELAY_UPDATE_HOLD_MS,
    stepMs: INTERPOLATION_DELAY_STEP_MS
  };
  private lastSnapshotArrivalAtMs: number | null = null;
  private snapshotJitterMs = 0;
  private interpolationDelayMs = 100;
  private targetInterpolationDelayMs = 100;
  private holdUntilMs = 0;

  public reset(): void {
    this.lastSnapshotArrivalAtMs = null;
    this.snapshotJitterMs = 0;
    this.interpolationDelayMs = 100;
    this.targetInterpolationDelayMs = 100;
    this.holdUntilMs = 0;
  }

  public observeSnapshotArrival(nowMs: number): void {
    if (this.lastSnapshotArrivalAtMs === null) {
      this.lastSnapshotArrivalAtMs = nowMs;
      return;
    }

    const intervalMs = nowMs - this.lastSnapshotArrivalAtMs;
    const jitterSample = Math.abs(intervalMs - SERVER_TICK_INTERVAL_MS);
    this.snapshotJitterMs =
      this.snapshotJitterMs === 0
        ? jitterSample
        : this.snapshotJitterMs * (1 - SNAPSHOT_JITTER_SMOOTHING) + jitterSample * SNAPSHOT_JITTER_SMOOTHING;
    this.lastSnapshotArrivalAtMs = nowMs;
  }

  public update(latencyMs: number): void {
    if (INTERPOLATION_DELAY_FORCE_FIXED_FOR_TEST) {
      this.interpolationDelayMs = INTERPOLATION_DELAY_FIXED_TEST_MS;
      this.targetInterpolationDelayMs = INTERPOLATION_DELAY_FIXED_TEST_MS;
      return;
    }
    const safeLatencyMs = Number.isFinite(latencyMs) ? latencyMs : 0;
    const baseDelayMs = SERVER_TICK_INTERVAL_MS * this.config.baseTicks;
    const jitterBudgetMs = Math.min(this.snapshotJitterMs * 2.2, 110);
    const latencyBudgetMs = Math.min(Math.max(safeLatencyMs * 0.1, 0), 45);
    const candidateDelayMs = this.clampNumber(
      baseDelayMs + jitterBudgetMs + latencyBudgetMs,
      this.config.minMs,
      this.config.maxMs
    );

    const nowMs = performance.now();
    if (nowMs >= this.holdUntilMs) {
      this.targetInterpolationDelayMs = candidateDelayMs;
      this.holdUntilMs = nowMs + this.config.holdMs;
    }

    if (Math.abs(this.interpolationDelayMs - this.targetInterpolationDelayMs) <= this.config.stepMs) {
      this.interpolationDelayMs = this.targetInterpolationDelayMs;
      return;
    }
    if (this.interpolationDelayMs < this.targetInterpolationDelayMs) {
      this.interpolationDelayMs += this.config.stepMs;
    } else {
      this.interpolationDelayMs -= this.config.stepMs;
    }
  }

  public getInterpolationDelayMs(): number {
    return this.interpolationDelayMs;
  }

  public getAckJitterMs(): number {
    return this.snapshotJitterMs;
  }

  public getTuning(): {
    minMs: number;
    maxMs: number;
    baseTicks: number;
    holdMs: number;
    stepMs: number;
  } {
    return { ...this.config };
  }

  public setTuning(tuning: Partial<{ minMs: number; maxMs: number; baseTicks: number; holdMs: number; stepMs: number }>): void {
    if (typeof tuning.minMs === "number" && Number.isFinite(tuning.minMs)) {
      this.config.minMs = Math.max(0, tuning.minMs);
    }
    if (typeof tuning.maxMs === "number" && Number.isFinite(tuning.maxMs)) {
      this.config.maxMs = Math.max(this.config.minMs, tuning.maxMs);
    }
    if (typeof tuning.baseTicks === "number" && Number.isFinite(tuning.baseTicks)) {
      this.config.baseTicks = Math.max(0, tuning.baseTicks);
    }
    if (typeof tuning.holdMs === "number" && Number.isFinite(tuning.holdMs)) {
      this.config.holdMs = Math.max(0, tuning.holdMs);
    }
    if (typeof tuning.stepMs === "number" && Number.isFinite(tuning.stepMs)) {
      this.config.stepMs = Math.max(0.1, tuning.stepMs);
    }
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
