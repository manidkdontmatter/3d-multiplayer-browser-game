import { performance } from "node:perf_hooks";
import {
  Channel,
  ChannelAABB3D,
  Instance,
  NetworkEvent,
  type Context
} from "nengi";
import { SERVER_PORT, SERVER_TICK_MS, SERVER_TICK_SECONDS } from "../shared/index";
import { GameSimulation } from "./GameSimulation";
import { PersistenceService } from "./persistence/PersistenceService";

type QueueEvent = {
  type: NetworkEvent;
  user?: {
    id: number;
    queueMessage: (message: unknown) => void;
    remoteAddress?: string;
    networkAdapter?: {
      disconnect?: (user: unknown, reason: unknown) => void;
    };
    accountId?: number;
  };
  commands?: unknown[];
  payload?: unknown;
};

const MAX_TICK_INTERVAL_SAMPLES = 6000;
const DEFAULT_PERSIST_FLUSH_INTERVAL_MS = 5000;

export class GameServer {
  private readonly instance: Instance;
  private readonly globalChannel: Channel;
  private readonly spatialChannel: ChannelAABB3D;
  private readonly simulation: GameSimulation;
  private readonly persistence: PersistenceService;
  private adapter: { listen: (port: number, ready: () => void) => void; close?: () => void } | null = null;
  private loopHandle: NodeJS.Timeout | null = null;
  private running = false;
  private nextTickAtMs = 0;
  private nextPersistFlushAtMs = 0;
  private readonly persistFlushIntervalMs: number;
  private lastTickDurationMs = 0;
  private tickDurationAccumMs = 0;
  private tickDurationCount = 0;
  private tickDurationMaxMs = 0;
  private tickIntervalAccumMs = 0;
  private tickIntervalCount = 0;
  private lastTickDurationLogMs = 0;
  private lastTickStartMs: number | null = null;
  private readonly tickIntervalsMs: number[] = [];
  private tickIntervalSampleWriteIndex = 0;
  private tickIntervalTotalSamples = 0;
  private lastLiveMetricsSampleCount = 0;

  public constructor(context: Context) {
    this.instance = new Instance(context);
    this.globalChannel = new Channel(this.instance.localState);
    this.spatialChannel = new ChannelAABB3D(this.instance.localState);
    this.persistFlushIntervalMs = this.resolvePersistFlushIntervalMs();
    this.persistence = new PersistenceService(process.env.SERVER_DATA_PATH ?? "./data/game.sqlite");
    this.simulation = new GameSimulation(this.globalChannel, this.spatialChannel, this.persistence);
  }

  public async start(port = SERVER_PORT): Promise<void> {
    this.instance.onConnect = async (handshake: unknown) => {
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
    };

    this.adapter = await this.createNetworkAdapter();
    this.adapter.listen(port, () => {
      console.log(`[server] nengi listening on ws://localhost:${port}`);
    });

    this.running = true;
    const now = performance.now();
    this.nextTickAtMs = now + SERVER_TICK_MS;
    this.nextPersistFlushAtMs = now + this.persistFlushIntervalMs;
    this.lastTickDurationLogMs = now;
    this.scheduleLoop(0);
  }

  public stop(): void {
    this.running = false;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }

    this.flushPersistenceNow();

    if (this.adapter?.close) {
      this.adapter.close();
    }
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

  private async createNetworkAdapter(): Promise<{
    listen: (port: number, ready: () => void) => void;
    close?: () => void;
  }> {
    const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
    const nodeSupportsUws = nodeMajor === 16 || nodeMajor === 18 || nodeMajor === 20;
    const allowUws = process.env.NENGI_TRANSPORT !== "ws" && nodeSupportsUws;

    if (allowUws) {
      try {
        const { uWebSocketsInstanceAdapter } = await import("nengi-uws-instance-adapter");
        console.log("[server] transport=uws");
        return new uWebSocketsInstanceAdapter(this.instance.network, {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[server] uWS adapter unavailable (${message}). Falling back to ws.`);
      }
    }

    if (!nodeSupportsUws && process.env.NENGI_TRANSPORT !== "ws") {
      console.warn(
        `[server] Node ${process.versions.node} does not support uWebSockets.js in this setup. Using ws fallback.`
      );
    }

    const { WsInstanceAdapter } = await import("./transport/WsInstanceAdapter");
    console.log("[server] transport=ws");
    return new WsInstanceAdapter(this.instance.network);
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

    while (!this.instance.queue.isEmpty()) {
      const event = this.instance.queue.next() as QueueEvent;

      if (event.type === NetworkEvent.UserConnected && event.user) {
        this.handleUserConnected(event.user, event.payload);
        continue;
      }

      if (event.type === NetworkEvent.CommandSet && event.user) {
        this.simulation.applyCommands(event.user, event.commands ?? []);
        continue;
      }

      if (event.type === NetworkEvent.UserDisconnected && event.user) {
        this.simulation.removeUser(event.user);
      }
    }

    this.simulation.step(SERVER_TICK_SECONDS);
    this.maybeFlushPersistence(performance.now());
    this.instance.step();

    const tickDurationMs = performance.now() - tickStart;
    this.lastTickDurationMs = tickDurationMs;
    this.tickDurationAccumMs += tickDurationMs;
    this.tickDurationCount += 1;
    if (tickDurationMs > this.tickDurationMaxMs) {
      this.tickDurationMaxMs = tickDurationMs;
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

    // If we're very late, resync to avoid endless catch-up spiral.
    if (now - this.nextTickAtMs > SERVER_TICK_MS * maxCatchUpSteps) {
      this.nextTickAtMs = now + SERVER_TICK_MS;
    }

    if (process.env.SERVER_TICK_LOG !== "0" && now - this.lastTickDurationLogMs >= 1000) {
      const avgDuration =
        this.tickDurationCount > 0 ? this.tickDurationAccumMs / this.tickDurationCount : 0;
      const avgInterval =
        this.tickIntervalCount > 0 ? this.tickIntervalAccumMs / this.tickIntervalCount : 0;
      const effectiveTps = avgInterval > 0 ? 1000 / avgInterval : 0;
      console.log(
        `[server] tick exec avg=${avgDuration.toFixed(3)}ms max=${this.tickDurationMaxMs.toFixed(3)}ms last=${this.lastTickDurationMs.toFixed(3)}ms | interval avg=${avgInterval.toFixed(3)}ms tps=${effectiveTps.toFixed(2)}`
      );
      this.tickDurationAccumMs = 0;
      this.tickDurationCount = 0;
      this.tickDurationMaxMs = 0;
      this.tickIntervalAccumMs = 0;
      this.tickIntervalCount = 0;
      this.lastTickDurationLogMs = now;
    }

    const delay = this.nextTickAtMs - performance.now();
    this.scheduleLoop(delay);
  }

  private handleUserConnected(
    user: NonNullable<QueueEvent["user"]>,
    payload: unknown
  ): void {
    const authKey = (payload as { authKey?: unknown } | undefined)?.authKey;
    const auth = this.persistence.authenticateOrCreate(authKey, user.remoteAddress);
    if (!auth.ok || !auth.accountId) {
      this.disconnectUser(user, {
        code: auth.code,
        retryAfterMs: auth.retryAfterMs
      });
      return;
    }

    user.accountId = auth.accountId;
    this.simulation.addUser(user);
  }

  private disconnectUser(user: NonNullable<QueueEvent["user"]>, reason: unknown): void {
    try {
      user.networkAdapter?.disconnect?.(user, reason);
    } catch (error) {
      console.warn("[server] failed to disconnect rejected user", error);
    }
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
