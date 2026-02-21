import { SERVER_TICK_SECONDS } from "../../../shared/index";

const OFFSET_SMOOTHING = 0.12;
const LARGE_DRIFT_THRESHOLD_SECONDS = 0.35;

export class ServerTimeSync {
  private offsetSeconds = 0;
  private initialized = false;

  public reset(): void {
    this.offsetSeconds = 0;
    this.initialized = false;
  }

  public observeAck(serverTick: number, observedAtMs: number): void {
    if (!Number.isFinite(serverTick) || !Number.isFinite(observedAtMs)) {
      return;
    }
    const sampleServerSeconds = Math.max(0, serverTick) * SERVER_TICK_SECONDS;
    const nowSeconds = observedAtMs / 1000;
    const sampleOffset = sampleServerSeconds - nowSeconds;
    if (!this.initialized) {
      this.offsetSeconds = sampleOffset;
      this.initialized = true;
      return;
    }

    const drift = sampleOffset - this.offsetSeconds;
    if (Math.abs(drift) > LARGE_DRIFT_THRESHOLD_SECONDS) {
      this.offsetSeconds = sampleOffset;
      return;
    }
    this.offsetSeconds += drift * OFFSET_SMOOTHING;
  }

  public getEstimatedServerTimeSeconds(nowMs: number): number | null {
    if (!this.initialized || !Number.isFinite(nowMs)) {
      return null;
    }
    return Math.max(0, nowMs / 1000 + this.offsetSeconds);
  }
}

