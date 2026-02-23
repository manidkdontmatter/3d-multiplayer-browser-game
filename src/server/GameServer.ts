import { performance } from "node:perf_hooks";
import type { Context } from "nengi";
import { SERVER_PORT, SERVER_TICK_MS, SERVER_TICK_SECONDS } from "../shared/index";
import { GameSimulation } from "./GameSimulation";
import { PersistenceService } from "./persistence/PersistenceService";
import { ServerNetworkHost } from "./net/ServerNetworkHost";
import { ServerNetworkEventRouter } from "./net/ServerNetworkEventRouter";

const MAX_TICK_INTERVAL_SAMPLES = 6000;
const DEFAULT_PERSIST_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_HEALTH_LOG_INTERVAL_MS = 5000;

export class GameServer {
  private readonly networkHost: ServerNetworkHost;
  private readonly simulation: GameSimulation;
  private readonly persistence: PersistenceService;
  private readonly networkEventRouter: ServerNetworkEventRouter;
  private loopHandle: NodeJS.Timeout | null = null;
  private running = false;
  private nextTickAtMs = 0;
  private nextPersistFlushAtMs = 0;
  private readonly healthLogIntervalMs: number;
  private readonly persistFlushIntervalMs: number;
  private serverStartAtMs = 0;
  private lastTickDurationMs = 0;
  private tickDurationAccumMs = 0;
  private tickDurationCount = 0;
  private tickDurationMaxMs = 0;
  private readonly tickDurationSamplesMs: number[] = [];
  private tickOverBudgetCount = 0;
  private tickIntervalAccumMs = 0;
  private tickIntervalCount = 0;
  private catchUpLoopCount = 0;
  private catchUpStepCount = 0;
  private skippedTickResyncCount = 0;
  private lastHealthLogMs = 0;
  private lastTickStartMs: number | null = null;
  private readonly tickIntervalsMs: number[] = [];
  private tickIntervalSampleWriteIndex = 0;
  private tickIntervalTotalSamples = 0;
  private lastLiveMetricsSampleCount = 0;

  public constructor(context: Context) {
    this.networkHost = new ServerNetworkHost(context);
    this.persistFlushIntervalMs = this.resolvePersistFlushIntervalMs();
    this.healthLogIntervalMs = this.resolveHealthLogIntervalMs();
    this.persistence = new PersistenceService(process.env.SERVER_DATA_PATH ?? "./data/game.sqlite");
    this.simulation = new GameSimulation(
      this.networkHost.getGlobalChannel(),
      this.networkHost.getSpatialChannel(),
      this.persistence,
      (position) => this.networkHost.createUserView(position)
    );
    this.networkEventRouter = new ServerNetworkEventRouter(
      this.networkHost,
      this.simulation,
      this.persistence
    );
  }

  public async start(port = SERVER_PORT): Promise<void> {
    await this.networkHost.start({
      port,
      onListen: () => {
        console.log(`[server] nengi listening on ws://localhost:${port}`);
      },
      onHandshake: async (handshake: unknown) => {
        if (!handshake || typeof handshake !== "object") {
          throw new Error("Handshake payload required.");
        }
        const authKey = (handshake as { authKey?: unknown }).authKey;
        if (typeof authKey !== "string" || authKey.length === 0) {
          throw new Error("authKey required.");
        }
        return {
          authKey
        };
      }
    });

    this.running = true;
    const now = performance.now();
    this.serverStartAtMs = now;
    this.nextTickAtMs = now + SERVER_TICK_MS;
    this.nextPersistFlushAtMs = now + this.persistFlushIntervalMs;
    this.lastHealthLogMs = now;
    this.scheduleLoop(0);
  }

  public stop(): void {
    this.running = false;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }

    this.flushPersistenceNow();

    this.networkHost.stop();
    this.persistence.close();

    if (process.env.SERVER_TICK_METRICS === "1") {
      const metrics = this.getTickMetrics();
      if (metrics) {
        console.log(`[server] tick-metrics ${JSON.stringify(metrics)}`);
      }
    }
  }

  public getTickMetrics():
    | {
        target_ms: number;
        samples: number;
        mean_ms: number;
        stddev_ms: number;
        min_ms: number;
        max_ms: number;
        p95_ms: number;
        p95_abs_error_ms: number;
      }
    | null {
    return this.computeTickMetrics();
  }

  public resetTickMetrics(): void {
    this.tickIntervalsMs.length = 0;
    this.tickIntervalSampleWriteIndex = 0;
    this.tickIntervalTotalSamples = 0;
    this.lastTickStartMs = null;
    this.lastLiveMetricsSampleCount = 0;
  }

  private tick(): void {
    const tickStart = performance.now();
    const now = performance.now();
    if (this.lastTickStartMs !== null) {
      const intervalMs = now - this.lastTickStartMs;
      this.pushTickIntervalSample(intervalMs);
      this.tickIntervalAccumMs += intervalMs;
      this.tickIntervalCount += 1;
      if (
        process.env.SERVER_TICK_METRICS === "1" &&
        this.tickIntervalTotalSamples - this.lastLiveMetricsSampleCount >= 300
      ) {
        const metrics = this.computeTickMetrics();
        if (metrics) {
          console.log(`[server] tick-metrics-live ${JSON.stringify(metrics)}`);
          this.lastLiveMetricsSampleCount = this.tickIntervalTotalSamples;
        }
      }
    }
    this.lastTickStartMs = now;

    this.networkEventRouter.drainQueue();

    this.simulation.step(SERVER_TICK_SECONDS);
    this.maybeFlushPersistence(performance.now());
    this.networkHost.step();

    const tickDurationMs = performance.now() - tickStart;
    this.lastTickDurationMs = tickDurationMs;
    this.tickDurationAccumMs += tickDurationMs;
    this.tickDurationCount += 1;
    this.tickDurationSamplesMs.push(tickDurationMs);
    if (tickDurationMs > this.tickDurationMaxMs) {
      this.tickDurationMaxMs = tickDurationMs;
    }
    if (tickDurationMs > SERVER_TICK_MS) {
      this.tickOverBudgetCount += 1;
    }
  }

  private scheduleLoop(delayMs: number): void {
    this.loopHandle = setTimeout(() => this.runLoop(), Math.max(0, delayMs));
  }

  private runLoop(): void {
    if (!this.running) {
      return;
    }

    const now = performance.now();
    let steps = 0;
    const maxCatchUpSteps = 4;

    while (steps < maxCatchUpSteps && now >= this.nextTickAtMs) {
      this.tick();
      this.nextTickAtMs += SERVER_TICK_MS;
      steps += 1;
    }
    if (steps > 1) {
      this.catchUpLoopCount += 1;
      this.catchUpStepCount += steps - 1;
    }

    // If we're very late, resync to avoid endless catch-up spiral.
    if (now - this.nextTickAtMs > SERVER_TICK_MS * maxCatchUpSteps) {
      this.nextTickAtMs = now + SERVER_TICK_MS;
      this.skippedTickResyncCount += 1;
    }

    if (process.env.SERVER_TICK_LOG !== "0" && now - this.lastHealthLogMs >= this.healthLogIntervalMs) {
      this.logHealth(now);
    }

    const delay = this.nextTickAtMs - performance.now();
    this.scheduleLoop(delay);
  }

  private maybeFlushPersistence(nowMs: number): void {
    if (nowMs < this.nextPersistFlushAtMs) {
      return;
    }
    this.flushPersistenceNow();
    this.nextPersistFlushAtMs = nowMs + this.persistFlushIntervalMs;
  }

  private flushPersistenceNow(): void {
    try {
      this.simulation.flushDirtyPlayerState();
    } catch (error) {
      console.error("[server] persistence flush failed", error);
    }
  }

  private resolvePersistFlushIntervalMs(): number {
    const raw = Number(process.env.SERVER_PERSIST_FLUSH_MS ?? DEFAULT_PERSIST_FLUSH_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < 250) {
      return DEFAULT_PERSIST_FLUSH_INTERVAL_MS;
    }
    return Math.floor(raw);
  }

  private resolveHealthLogIntervalMs(): number {
    const raw = Number(process.env.SERVER_HEALTH_LOG_MS ?? DEFAULT_HEALTH_LOG_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw < 1000) {
      return DEFAULT_HEALTH_LOG_INTERVAL_MS;
    }
    return Math.floor(raw);
  }

  private logHealth(nowMs: number): void {
    const avgDuration =
      this.tickDurationCount > 0 ? this.tickDurationAccumMs / this.tickDurationCount : 0;
    const avgInterval =
      this.tickIntervalCount > 0 ? this.tickIntervalAccumMs / this.tickIntervalCount : 0;
    const effectiveTps = avgInterval > 0 ? 1000 / avgInterval : 0;
    const overBudgetPercent =
      this.tickDurationCount > 0 ? (this.tickOverBudgetCount / this.tickDurationCount) * 100 : 0;
    const p95TickDurationMs = this.computeP95(this.tickDurationSamplesMs);
    const uptimeSeconds = Math.max(0, Math.floor((nowMs - this.serverStartAtMs) / 1000));
    const runtime = this.simulation.getRuntimeStats();
    const targetTps = SERVER_TICK_MS > 0 ? 1000 / SERVER_TICK_MS : 0;

    console.log(
      `[server] health uptime=${uptimeSeconds}s players=${runtime.onlinePlayers} projectiles=${runtime.activeProjectiles} tps=${effectiveTps.toFixed(2)}/${targetTps.toFixed(2)} tick_ms(avg/p95/max)=${avgDuration.toFixed(3)}/${p95TickDurationMs.toFixed(3)}/${this.tickDurationMaxMs.toFixed(3)} over_budget=${overBudgetPercent.toFixed(1)}% catchup(loops/steps)=${this.catchUpLoopCount}/${this.catchUpStepCount} resyncs=${this.skippedTickResyncCount} pending_snapshots=${runtime.pendingOfflineSnapshots}`
    );

    this.tickDurationAccumMs = 0;
    this.tickDurationCount = 0;
    this.tickDurationMaxMs = 0;
    this.tickDurationSamplesMs.length = 0;
    this.tickOverBudgetCount = 0;
    this.tickIntervalAccumMs = 0;
    this.tickIntervalCount = 0;
    this.catchUpLoopCount = 0;
    this.catchUpStepCount = 0;
    this.skippedTickResyncCount = 0;
    this.lastHealthLogMs = nowMs;
  }

  private computeP95(samples: readonly number[]): number {
    if (samples.length === 0) {
      return 0;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * 0.95)));
    return sorted[index] ?? 0;
  }

  private pushTickIntervalSample(intervalMs: number): void {
    if (this.tickIntervalsMs.length < MAX_TICK_INTERVAL_SAMPLES) {
      this.tickIntervalsMs.push(intervalMs);
    } else {
      this.tickIntervalsMs[this.tickIntervalSampleWriteIndex] = intervalMs;
      this.tickIntervalSampleWriteIndex =
        (this.tickIntervalSampleWriteIndex + 1) % MAX_TICK_INTERVAL_SAMPLES;
    }
    this.tickIntervalTotalSamples += 1;
  }

  private computeTickMetrics():
    | {
        target_ms: number;
        samples: number;
        mean_ms: number;
        stddev_ms: number;
        min_ms: number;
        max_ms: number;
        p95_ms: number;
        p95_abs_error_ms: number;
      }
    | null {
    if (this.tickIntervalsMs.length === 0) {
      return null;
    }

    const samples = [...this.tickIntervalsMs];
    const count = samples.length;
    const targetMs = SERVER_TICK_MS;
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const sample of samples) {
      sum += sample;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    const mean = sum / count;
    let varianceSum = 0;
    for (const sample of samples) {
      const diff = sample - mean;
      varianceSum += diff * diff;
    }
    const stddev = Math.sqrt(varianceSum / count);
    samples.sort((a, b) => a - b);
    const p95Index = Math.min(count - 1, Math.max(0, Math.floor(count * 0.95)));
    const p95 = samples[p95Index] ?? mean;

    return {
      target_ms: targetMs,
      samples: count,
      mean_ms: mean,
      stddev_ms: stddev,
      min_ms: min,
      max_ms: max,
      p95_ms: p95,
      p95_abs_error_ms: Math.abs(p95 - targetMs)
    };
  }
}
