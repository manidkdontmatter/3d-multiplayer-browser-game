import { SERVER_TICK_RATE } from "../../../shared/config";

const SERVER_TICK_INTERVAL_MS = 1000 / SERVER_TICK_RATE;
const INTERPOLATION_DELAY_MIN_MS = 40;
const INTERPOLATION_DELAY_MAX_MS = 220;
const INTERPOLATION_DELAY_BASE_TICKS = 1.6;
const INTERPOLATION_DELAY_SMOOTHING = 0.01;
const ACK_JITTER_SMOOTHING = 0.15;

export class InterpolationController {
  private lastAckArrivalAtMs: number | null = null;
  private ackJitterMs = 0;
  private interpolationDelayMs = 100;

  public reset(): void {
    this.lastAckArrivalAtMs = null;
    this.ackJitterMs = 0;
    this.interpolationDelayMs = 100;
  }

  public observeAckArrival(nowMs: number): void {
    if (this.lastAckArrivalAtMs === null) {
      this.lastAckArrivalAtMs = nowMs;
      return;
    }

    const intervalMs = nowMs - this.lastAckArrivalAtMs;
    const jitterSample = Math.abs(intervalMs - SERVER_TICK_INTERVAL_MS);
    this.ackJitterMs =
      this.ackJitterMs === 0
        ? jitterSample
        : this.ackJitterMs * (1 - ACK_JITTER_SMOOTHING) + jitterSample * ACK_JITTER_SMOOTHING;
    this.lastAckArrivalAtMs = nowMs;
  }

  public update(latencyMs: number): void {
    const safeLatencyMs = Number.isFinite(latencyMs) ? latencyMs : 0;
    const baseDelayMs = SERVER_TICK_INTERVAL_MS * INTERPOLATION_DELAY_BASE_TICKS;
    const jitterBudgetMs = Math.min(this.ackJitterMs * 2.2, 110);
    const latencyBudgetMs = Math.min(Math.max(safeLatencyMs * 0.1, 0), 45);
    const targetDelayMs = this.clampNumber(
      baseDelayMs + jitterBudgetMs + latencyBudgetMs,
      INTERPOLATION_DELAY_MIN_MS,
      INTERPOLATION_DELAY_MAX_MS
    );
    this.interpolationDelayMs =
      this.interpolationDelayMs * (1 - INTERPOLATION_DELAY_SMOOTHING) +
      targetDelayMs * INTERPOLATION_DELAY_SMOOTHING;
  }

  public getInterpolationDelayMs(): number {
    return this.interpolationDelayMs;
  }

  public getAckJitterMs(): number {
    return this.ackJitterMs;
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
