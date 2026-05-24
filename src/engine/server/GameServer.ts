/**
 * Purpose: This file coordinates authoritative server behavior.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { performance } from "node:perf_hooks";
import type { Context } from "nengi";
import type { InventorySnapshot } from "../shared/items";
import { NType, SERVER_PORT, SERVER_TICK_MS, SERVER_TICK_SECONDS } from "../shared/index";
import { GameSimulation } from "./GameSimulation";
import { MapProcessIpcChannel } from "./ipc/MapProcessIpcChannel";
import type { MapRuntimeMetricsSnapshot } from "./orchestrator/OrchestratorProtocol";
import { PersistenceService } from "./persistence/PersistenceService";
import { OrchestratorPersistenceBridge } from "./persistence/OrchestratorPersistenceBridge";
import {
  NET_DIAGNOSTICS_WARNING_AVG_IN_BYTES,
  NET_DIAGNOSTICS_WARNING_AVG_IN_MESSAGES,
  NET_DIAGNOSTICS_WARNING_AVG_OUT_BYTES,
  NET_DIAGNOSTICS_WARNING_AVG_OUT_MESSAGES,
  NET_DIAGNOSTICS_WARNING_P95_IN_BYTES,
  NET_DIAGNOSTICS_WARNING_P95_IN_MESSAGES,
  NET_DIAGNOSTICS_WARNING_P95_OUT_BYTES,
  NET_DIAGNOSTICS_WARNING_P95_OUT_MESSAGES
} from "../shared/netcode";
import { ServerNetworkHost } from "./net/ServerNetworkHost";
import {
  ServerNetDiagnosticsCollector,
  type ServerNetDiagnosticsSnapshot
} from "./net/ServerNetDiagnosticsCollector";
import { ServerNetworkEventRouter } from "./net/ServerNetworkEventRouter";

const MAX_TICK_INTERVAL_SAMPLES = 6000;
const MAX_TICK_DURATION_SAMPLES = 6000;
const MAX_REPLICATION_FANOUT_SAMPLES = 1800;
const DEFAULT_PERSIST_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_HEALTH_LOG_INTERVAL_MS = 30000;
const DEFAULT_NET_DIAGNOSTICS_BROADCAST_INTERVAL_MS = 1000;

export interface TickPhaseMetrics {
  readonly samples: number;
  readonly drainQueueMeanMs: number;
  readonly drainQueueMaxMs: number;
  readonly simulationMeanMs: number;
  readonly simulationMaxMs: number;
  readonly postSimulationMeanMs: number;
  readonly postSimulationMaxMs: number;
  readonly networkMeanMs: number;
  readonly networkMaxMs: number;
}

export class GameServer {
  private readonly netDiagnostics: ServerNetDiagnosticsCollector;
  private readonly networkHost: ServerNetworkHost;
  private readonly simulation: GameSimulation;
  private readonly persistence: PersistenceService;
  private readonly networkEventRouter: ServerNetworkEventRouter;
  private readonly orchestratorPersistenceBridge: OrchestratorPersistenceBridge | null;
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
  private tickDurationSampleWriteIndex = 0;
  private tickOverBudgetCount = 0;
  private tickIntervalAccumMs = 0;
  private tickIntervalCount = 0;
  private catchUpLoopCount = 0;
  private catchUpStepCount = 0;
  private skippedTickResyncCount = 0;
  private lastHealthLogMs = 0;
  private nextNetDiagnosticsBroadcastAtMs = 0;
  private lastTickStartMs: number | null = null;
  private readonly tickIntervalsMs: number[] = [];
  private tickIntervalSampleWriteIndex = 0;
  private tickIntervalTotalSamples = 0;
  private lastLiveMetricsSampleCount = 0;
  private tickPhaseDrainQueueAccumMs = 0;
  private tickPhaseDrainQueueMaxMs = 0;
  private tickPhaseSimulationAccumMs = 0;
  private tickPhaseSimulationMaxMs = 0;
  private tickPhasePostSimulationAccumMs = 0;
  private tickPhasePostSimulationMaxMs = 0;
  private tickPhaseNetworkAccumMs = 0;
  private tickPhaseNetworkMaxMs = 0;
  private readonly inputDiagnosticsEnabled =
    process.env.SERVER_INPUT_DIAGNOSTICS === "1" || process.env.SERVER_INPUT_DIAGNOSTICS === "true";
  private tickCounter = 0;
  private commandIngressTotalCommandSets = 0;
  private commandIngressTotalInputCommands = 0;
  private commandIngressPeakInputCommandsPerPlayerPerSecond = 0;
  private readonly replicationEntitiesPerPlayerSamples: number[] = [];
  private replicationEntitiesPerPlayerSampleWriteIndex = 0;

  public constructor(context: Context, private readonly ipcChannel: MapProcessIpcChannel | null = null) {
    this.netDiagnostics = new ServerNetDiagnosticsCollector();
    this.networkHost = new ServerNetworkHost(context, this.netDiagnostics);
    this.persistFlushIntervalMs = this.resolvePersistFlushIntervalMs();
    this.healthLogIntervalMs = this.resolveHealthLogIntervalMs();
    this.persistence = new PersistenceService(process.env.SERVER_DATA_PATH ?? "./data/game.sqlite");
    this.orchestratorPersistenceBridge = this.createOrchestratorPersistenceBridge();
    this.simulation = new GameSimulation(
      this.networkHost.getGlobalChannel(),
      this.networkHost.getNearChannel() as any,
      this.networkHost.getFarChannel() as any,
      this.persistence,
      (position) => this.networkHost.createUserView(position),
      this.ipcChannel
    );
    this.networkEventRouter = new ServerNetworkEventRouter(
      this.networkHost,
      this.simulation,
      this.persistence,
      this.ipcChannel
    );
  }

  public async start(port = SERVER_PORT): Promise<void> {
    await this.networkHost.start({
      port,
      onListen: () => {
        console.log(`[server] nengi listening on ws://localhost:${port}`);
      },
      onHandshake: async (handshake: unknown) => {
        const resolved = await this.resolveHandshakeAuthKey(handshake);
        const authKey = resolved.authKey;
        const allowGuestAuth = process.env.SERVER_ALLOW_GUEST_AUTH !== "0";
        if (typeof authKey !== "string" || authKey.length === 0) {
          if (allowGuestAuth) {
            return {};
          }
          throw new Error("authKey required.");
        }
        return {
          authKey,
          ...(typeof resolved.accountId === "number" ? { accountId: resolved.accountId } : {}),
          ...(resolved.playerSnapshot ? { playerSnapshot: resolved.playerSnapshot } : {}),
          ...(resolved.inventoryState ? { inventoryState: resolved.inventoryState } : {}),
          ...(typeof resolved.transferId === "string" ? { transferId: resolved.transferId } : {})
        };
      }
    });

    this.running = true;
    const now = performance.now();
    this.serverStartAtMs = now;
    this.nextTickAtMs = now + SERVER_TICK_MS;
    this.nextPersistFlushAtMs = now + this.persistFlushIntervalMs;
    this.nextNetDiagnosticsBroadcastAtMs = now + DEFAULT_NET_DIAGNOSTICS_BROADCAST_INTERVAL_MS;
    this.lastHealthLogMs = now;
    this.scheduleLoop(0);
  }

  private async resolveHandshakeAuthKey(handshake: unknown): Promise<{
    authKey?: string;
    accountId?: number;
    playerSnapshot?: unknown;
    inventoryState?: InventorySnapshot | null;
    transferId?: string | null;
  }> {
    if (!handshake || typeof handshake !== "object") {
      throw new Error("Handshake payload required.");
    }
    const baseAuthKey =
      (handshake as { accountKey?: unknown; authKey?: unknown }).accountKey
      ?? (handshake as { accountKey?: unknown; authKey?: unknown }).authKey;
    const directAuthKey = typeof baseAuthKey === "string" ? baseAuthKey : undefined;
    const mapInstanceId = process.env.MAP_INSTANCE_ID;
    if (!this.ipcChannel?.isAvailable() || !mapInstanceId) {
      return directAuthKey ? { authKey: directAuthKey } : {};
    }

    const joinTicketRaw = (handshake as { joinTicket?: unknown }).joinTicket;
    if (typeof joinTicketRaw !== "string" || joinTicketRaw.length === 0) {
      throw new Error("joinTicket required.");
    }

    const json = await this.ipcChannel.request("ConsumeJoinTicket", {
        joinTicket: joinTicketRaw,
        mapInstanceId
      });
    if (!json.ok) {
      const reason = typeof json.error === "string" ? json.error : "unknown";
      throw new Error(`joinTicket denied: ${reason}`);
    }
    const validatedAuthKey = typeof json.authKey === "string" ? json.authKey : undefined;
    const accountId = typeof json.accountId === "number" && Number.isFinite(json.accountId)
      ? Math.max(1, Math.floor(json.accountId))
      : undefined;
    const playerSnapshot =
      json.playerSnapshot && typeof json.playerSnapshot === "object" ? json.playerSnapshot : undefined;
    const inventoryState =
      json.inventoryState && typeof json.inventoryState === "object"
        ? (json.inventoryState as InventorySnapshot)
        : null;
    return {
      ...(validatedAuthKey ? { authKey: validatedAuthKey } : {}),
      ...(typeof accountId === "number" ? { accountId } : {}),
      ...(playerSnapshot ? { playerSnapshot } : {}),
      ...(inventoryState ? { inventoryState } : {}),
      transferId: typeof json.transferId === "string" ? json.transferId : null
    };
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
    this.tickPhaseDrainQueueAccumMs = 0;
    this.tickPhaseDrainQueueMaxMs = 0;
    this.tickPhaseSimulationAccumMs = 0;
    this.tickPhaseSimulationMaxMs = 0;
    this.tickPhasePostSimulationAccumMs = 0;
    this.tickPhasePostSimulationMaxMs = 0;
    this.tickPhaseNetworkAccumMs = 0;
    this.tickPhaseNetworkMaxMs = 0;
  }

  public getTickPhaseMetrics(): TickPhaseMetrics | null {
    const samples = this.tickDurationCount;
    if (samples <= 0) {
      return null;
    }
    return {
      samples,
      drainQueueMeanMs: this.tickPhaseDrainQueueAccumMs / samples,
      drainQueueMaxMs: this.tickPhaseDrainQueueMaxMs,
      simulationMeanMs: this.tickPhaseSimulationAccumMs / samples,
      simulationMaxMs: this.tickPhaseSimulationMaxMs,
      postSimulationMeanMs: this.tickPhasePostSimulationAccumMs / samples,
      postSimulationMaxMs: this.tickPhasePostSimulationMaxMs,
      networkMeanMs: this.tickPhaseNetworkAccumMs / samples,
      networkMaxMs: this.tickPhaseNetworkMaxMs
    };
  }

  public getNetDiagnosticsSnapshot(nowMs = Date.now()): ServerNetDiagnosticsSnapshot {
    return this.captureNetDiagnostics(nowMs);
  }

  public getRuntimeStats(): {
    onlinePlayers: number;
    activeProjectiles: number;
    pendingOfflineSnapshots: number;
    activeNpcs: number;
    inactiveNpcs: number;
    hibernatingNpcs: number;
    replicationNearEntities: number;
    replicationFarEntities: number;
    replicationTotalEntities: number;
    pilotedReferenceFrames: number;
    effectAuditSuccesses: Readonly<Record<string, number>>;
  } {
    return this.simulation.getRuntimeStats();
  }

  public getMapRuntimeMetricsSnapshot(nowMs = Date.now()): MapRuntimeMetricsSnapshot {
    const runtime = this.simulation.getRuntimeStats();
    const nowPerformanceMs = performance.now();
    const uptimeSeconds = Math.max(0, Math.floor((nowPerformanceMs - this.serverStartAtMs) / 1000));
    const avgDuration = this.tickDurationCount > 0 ? this.tickDurationAccumMs / this.tickDurationCount : 0;
    const avgInterval = this.tickIntervalCount > 0 ? this.tickIntervalAccumMs / this.tickIntervalCount : 0;
    const stddevDurationMs = this.computeStdDev(this.tickDurationSamplesMs, avgDuration);
    const effectiveTps = avgInterval > 0 ? 1000 / avgInterval : 0;
    const overBudgetPercent = this.tickDurationCount > 0 ? (this.tickOverBudgetCount / this.tickDurationCount) * 100 : 0;
    const p95TickDurationMs = this.computeP95(this.tickDurationSamplesMs);
    const worstSpikeOverTargetMs = Math.max(0, this.tickDurationMaxMs - SERVER_TICK_MS);
    const netDiagnostics = this.captureNetDiagnostics(nowMs);
    const replicationWindow = this.computeReplicationEntitiesPerPlayerWindow();
    return {
      uptimeSeconds,
      onlinePlayers: runtime.onlinePlayers,
      activeNpcs: runtime.activeNpcs,
      inactiveNpcs: runtime.inactiveNpcs,
      hibernatingNpcs: runtime.hibernatingNpcs,
      activeProjectiles: runtime.activeProjectiles,
      pendingOfflineSnapshots: runtime.pendingOfflineSnapshots,
      pilotedReferenceFrames: runtime.pilotedReferenceFrames,
      tick: {
        targetMs: SERVER_TICK_MS,
        lastDurationMs: this.lastTickDurationMs,
        meanDurationMs: avgDuration,
        stddevDurationMs,
        p95DurationMs: p95TickDurationMs,
        maxDurationMs: this.tickDurationMaxMs,
        worstSpikeOverTargetMs,
        overBudgetPercent,
        effectiveTps
      },
      loop: {
        catchUpLoopCount: this.catchUpLoopCount,
        catchUpStepCount: this.catchUpStepCount,
        skippedTickResyncCount: this.skippedTickResyncCount
      },
      net: {
        connectedPlayers: netDiagnostics.connectedPlayers,
        windowSeconds: netDiagnostics.windowSeconds,
        avgInboundBytesPerSecond: netDiagnostics.avgInboundBytesPerSecond,
        avgOutboundBytesPerSecond: netDiagnostics.avgOutboundBytesPerSecond,
        avgInboundMessagesPerSecond: netDiagnostics.avgInboundMessagesPerSecond,
        avgOutboundMessagesPerSecond: netDiagnostics.avgOutboundMessagesPerSecond,
        p95InboundBytesPerSecond: netDiagnostics.p95InboundBytesPerSecond,
        p95OutboundBytesPerSecond: netDiagnostics.p95OutboundBytesPerSecond,
        p95InboundMessagesPerSecond: netDiagnostics.p95InboundMessagesPerSecond,
        p95OutboundMessagesPerSecond: netDiagnostics.p95OutboundMessagesPerSecond,
        warningMask: netDiagnostics.warningMask
      },
      commandIngress: {
        commandSetsPerSecond: uptimeSeconds > 0 ? this.commandIngressTotalCommandSets / uptimeSeconds : 0,
        inputCommandsPerSecond: uptimeSeconds > 0 ? this.commandIngressTotalInputCommands / uptimeSeconds : 0,
        peakInputCommandsPerPlayerPerSecond: this.commandIngressPeakInputCommandsPerPlayerPerSecond
      },
      replication: {
        nearEntities: runtime.replicationNearEntities,
        farEntities: runtime.replicationFarEntities,
        totalEntities: runtime.replicationTotalEntities,
        entitiesPerPlayer:
          runtime.onlinePlayers > 0 ? runtime.replicationTotalEntities / runtime.onlinePlayers : 0,
        entitiesPerPlayerWindow: replicationWindow
      }
    };
  }

  private tick(): void {
    this.tickCounter += 1;
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

    const phaseDrainStart = performance.now();
    this.networkEventRouter.drainQueue();
    const inputStats = this.networkEventRouter.consumeLastDrainInputStats();
    this.recordCommandIngress(inputStats);
    if (this.inputDiagnosticsEnabled) {
      if (inputStats.commandSets > 0 || inputStats.inputCommands > 0) {
        const details = inputStats.byUserId
          .map((entry) => `u${entry.userId}:sets=${entry.commandSets},inputs=${entry.inputCommands}`)
          .join(" ");
        console.log(
          `[input-diag] tick=${this.tickCounter} commandSets=${inputStats.commandSets} inputCommands=${inputStats.inputCommands}${details.length > 0 ? ` ${details}` : ""}`
        );
      }
    }
    const phaseDrainMs = performance.now() - phaseDrainStart;
    this.tickPhaseDrainQueueAccumMs += phaseDrainMs;
    if (phaseDrainMs > this.tickPhaseDrainQueueMaxMs) {
      this.tickPhaseDrainQueueMaxMs = phaseDrainMs;
    }

    const phaseSimulationStart = performance.now();
    this.simulation.step(SERVER_TICK_SECONDS);
    const phaseSimulationMs = performance.now() - phaseSimulationStart;
    this.tickPhaseSimulationAccumMs += phaseSimulationMs;
    if (phaseSimulationMs > this.tickPhaseSimulationMaxMs) {
      this.tickPhaseSimulationMaxMs = phaseSimulationMs;
    }

    const phasePostSimulationStart = performance.now();
    this.recordReplicationFanoutSample();
    this.maybeFlushPersistence(performance.now());
    this.maybeBroadcastNetDiagnostics(performance.now());
    const phasePostSimulationMs = performance.now() - phasePostSimulationStart;
    this.tickPhasePostSimulationAccumMs += phasePostSimulationMs;
    if (phasePostSimulationMs > this.tickPhasePostSimulationMaxMs) {
      this.tickPhasePostSimulationMaxMs = phasePostSimulationMs;
    }

    const phaseNetworkStart = performance.now();
    this.networkHost.step();
    const phaseNetworkMs = performance.now() - phaseNetworkStart;
    this.tickPhaseNetworkAccumMs += phaseNetworkMs;
    if (phaseNetworkMs > this.tickPhaseNetworkMaxMs) {
      this.tickPhaseNetworkMaxMs = phaseNetworkMs;
    }

    const tickDurationMs = performance.now() - tickStart;
    this.lastTickDurationMs = tickDurationMs;
    this.tickDurationAccumMs += tickDurationMs;
    this.tickDurationCount += 1;
    this.pushTickDurationSample(tickDurationMs);
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

    if (this.isConsoleHealthLogEnabled() && now - this.lastHealthLogMs >= this.healthLogIntervalMs) {
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
      if (this.orchestratorPersistenceBridge) {
        this.simulation.flushDirtyPlayerState({
          saveCharacterSnapshot: (snapshot) =>
            this.orchestratorPersistenceBridge?.enqueue(snapshot, {
              saveCharacter: true,
              saveAbilityState: false
            }),
          saveAbilityStateSnapshot: (snapshot) =>
            this.orchestratorPersistenceBridge?.enqueue(snapshot, {
              saveCharacter: false,
              saveAbilityState: true
            }),
          savePlayerSettings: (accountId, settings) =>
            this.orchestratorPersistenceBridge?.enqueueSettings(accountId, settings)
        });
        void this.orchestratorPersistenceBridge.flushPending().catch((error) => {
          console.error("[server] orchestrator persistence flush failed", error);
        });
        return;
      }

      this.simulation.flushDirtyPlayerState();
    } catch (error) {
      console.error("[server] persistence flush failed", error);
    }
  }

  private createOrchestratorPersistenceBridge(): OrchestratorPersistenceBridge | null {
    if (!this.ipcChannel?.isAvailable()) {
      return null;
    }
    return new OrchestratorPersistenceBridge(this.ipcChannel);
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
    if (!Number.isFinite(raw) || raw < DEFAULT_HEALTH_LOG_INTERVAL_MS) {
      return DEFAULT_HEALTH_LOG_INTERVAL_MS;
    }
    return Math.floor(raw);
  }

  private isConsoleHealthLogEnabled(): boolean {
    return process.env.SERVER_HEALTH_CONSOLE === "1" || process.env.SERVER_HEALTH_CONSOLE === "true";
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
    const pilotCount = runtime.pilotedReferenceFrames;
    const effectAuditTop = Object.entries(runtime.effectAuditSuccesses)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => `${type}:${count}`)
      .join(",");
    const targetTps = SERVER_TICK_MS > 0 ? 1000 / SERVER_TICK_MS : 0;
    const netDiagnostics = this.captureNetDiagnostics(Date.now());
    const netSummary = this.formatNetDiagnosticsSummary(netDiagnostics);

    console.log(
      `[server] health uptime=${uptimeSeconds}s players=${runtime.onlinePlayers} npcs(active/inactive/hibernating)=${runtime.activeNpcs}/${runtime.inactiveNpcs}/${runtime.hibernatingNpcs} projectiles=${runtime.activeProjectiles} piloted_frames=${pilotCount} effect_top=${effectAuditTop || "none"} tps=${effectiveTps.toFixed(2)}/${targetTps.toFixed(2)} tick_ms(avg/p95/max)=${avgDuration.toFixed(3)}/${p95TickDurationMs.toFixed(3)}/${this.tickDurationMaxMs.toFixed(3)} over_budget=${overBudgetPercent.toFixed(1)}% catchup(loops/steps)=${this.catchUpLoopCount}/${this.catchUpStepCount} resyncs=${this.skippedTickResyncCount} pending_snapshots=${runtime.pendingOfflineSnapshots} ${netSummary}`
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

  private computeStdDev(samples: readonly number[], mean: number): number {
    if (samples.length <= 0) {
      return 0;
    }
    let varianceSum = 0;
    for (const sample of samples) {
      const diff = sample - mean;
      varianceSum += diff * diff;
    }
    return Math.sqrt(varianceSum / samples.length);
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

  private pushTickDurationSample(durationMs: number): void {
    if (this.tickDurationSamplesMs.length < MAX_TICK_DURATION_SAMPLES) {
      this.tickDurationSamplesMs.push(durationMs);
    } else {
      this.tickDurationSamplesMs[this.tickDurationSampleWriteIndex] = durationMs;
      this.tickDurationSampleWriteIndex =
        (this.tickDurationSampleWriteIndex + 1) % MAX_TICK_DURATION_SAMPLES;
    }
  }

  private recordCommandIngress(inputStats: {
    commandSets: number;
    inputCommands: number;
    byUserId: ReadonlyArray<{ userId: number; commandSets: number; inputCommands: number }>;
  }): void {
    this.commandIngressTotalCommandSets += Math.max(0, inputStats.commandSets);
    this.commandIngressTotalInputCommands += Math.max(0, inputStats.inputCommands);
    for (const user of inputStats.byUserId) {
      const perSecond = user.inputCommands / SERVER_TICK_SECONDS;
      if (perSecond > this.commandIngressPeakInputCommandsPerPlayerPerSecond) {
        this.commandIngressPeakInputCommandsPerPlayerPerSecond = perSecond;
      }
    }
  }

  private recordReplicationFanoutSample(): void {
    const runtime = this.simulation.getRuntimeStats();
    const value =
      runtime.onlinePlayers > 0
        ? runtime.replicationTotalEntities / runtime.onlinePlayers
        : 0;
    if (this.replicationEntitiesPerPlayerSamples.length < MAX_REPLICATION_FANOUT_SAMPLES) {
      this.replicationEntitiesPerPlayerSamples.push(value);
      return;
    }
    this.replicationEntitiesPerPlayerSamples[this.replicationEntitiesPerPlayerSampleWriteIndex] = value;
    this.replicationEntitiesPerPlayerSampleWriteIndex =
      (this.replicationEntitiesPerPlayerSampleWriteIndex + 1) % MAX_REPLICATION_FANOUT_SAMPLES;
  }

  private computeReplicationEntitiesPerPlayerWindow(): {
    samples: number;
    mean: number;
    p95: number;
    max: number;
  } {
    if (this.replicationEntitiesPerPlayerSamples.length <= 0) {
      return { samples: 0, mean: 0, p95: 0, max: 0 };
    }
    const samples = [...this.replicationEntitiesPerPlayerSamples];
    let sum = 0;
    let max = 0;
    for (const sample of samples) {
      sum += sample;
      if (sample > max) {
        max = sample;
      }
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.max(0, Math.floor(samples.length * 0.95)))] ?? 0;
    return {
      samples: this.replicationEntitiesPerPlayerSamples.length,
      mean: sum / this.replicationEntitiesPerPlayerSamples.length,
      p95,
      max
    };
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

  public reserveIncomingTransfer(): void {
    // Reservation is a bounded readiness check in Phase 1; source release still gates authority transfer.
  }

  public finalizeSourceRelease(accountId: number, transferId: string): boolean {
    return this.networkEventRouter.releaseAuthorityForTransfer(accountId, transferId);
  }

  private maybeBroadcastNetDiagnostics(nowMs: number): void {
    if (nowMs < this.nextNetDiagnosticsBroadcastAtMs) {
      return;
    }
    const snapshot = this.captureNetDiagnostics(Date.now());
    const users = this.networkHost.getConnectedUsers();
    for (const user of users) {
      user.queueMessage({
        ntype: NType.ServerNetDiagnosticsMessage,
        connectedPlayers: snapshot.connectedPlayers,
        windowSeconds: snapshot.windowSeconds,
        avgInboundBytesPerSecond: snapshot.avgInboundBytesPerSecond,
        avgOutboundBytesPerSecond: snapshot.avgOutboundBytesPerSecond,
        avgInboundMessagesPerSecond: snapshot.avgInboundMessagesPerSecond,
        avgOutboundMessagesPerSecond: snapshot.avgOutboundMessagesPerSecond,
        p95InboundBytesPerSecond: snapshot.p95InboundBytesPerSecond,
        p95OutboundBytesPerSecond: snapshot.p95OutboundBytesPerSecond,
        p95InboundMessagesPerSecond: snapshot.p95InboundMessagesPerSecond,
        p95OutboundMessagesPerSecond: snapshot.p95OutboundMessagesPerSecond,
        warningMask: snapshot.warningMask
      });
    }
    this.nextNetDiagnosticsBroadcastAtMs = nowMs + DEFAULT_NET_DIAGNOSTICS_BROADCAST_INTERVAL_MS;
  }

  private captureNetDiagnostics(nowMs: number): ServerNetDiagnosticsSnapshot {
    const connectedUserIds = this.networkHost.getConnectedUsers().map((user) => user.id);
    return this.netDiagnostics.createSnapshot(connectedUserIds, nowMs);
  }

  private formatNetDiagnosticsSummary(snapshot: ServerNetDiagnosticsSnapshot): string {
    const avgOutKib = snapshot.avgOutboundBytesPerSecond / 1024;
    const p95OutKib = snapshot.p95OutboundBytesPerSecond / 1024;
    const avgInKib = snapshot.avgInboundBytesPerSecond / 1024;
    const p95InKib = snapshot.p95InboundBytesPerSecond / 1024;
    const warningText = this.describeNetWarningMask(snapshot.warningMask);
    return `net(avg_out_kib_s_per_player/p95=${avgOutKib.toFixed(2)}/${p95OutKib.toFixed(2)} avg_in_kib_s_per_player/p95=${avgInKib.toFixed(2)}/${p95InKib.toFixed(2)} avg_out_msgs_s_per_player/p95=${snapshot.avgOutboundMessagesPerSecond.toFixed(2)}/${snapshot.p95OutboundMessagesPerSecond.toFixed(2)} avg_in_msgs_s_per_player/p95=${snapshot.avgInboundMessagesPerSecond.toFixed(2)}/${snapshot.p95InboundMessagesPerSecond.toFixed(2)} warn=${warningText})`;
  }

  private describeNetWarningMask(mask: number): string {
    if (mask === 0) {
      return "ok";
    }
    const parts: string[] = [];
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_OUT_BYTES) parts.push("avg out bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_IN_BYTES) parts.push("avg in bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_OUT_MESSAGES) parts.push("avg out messages");
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_IN_MESSAGES) parts.push("avg in messages");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_OUT_BYTES) parts.push("p95 out bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_IN_BYTES) parts.push("p95 in bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_OUT_MESSAGES) parts.push("p95 out messages");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_IN_MESSAGES) parts.push("p95 in messages");
    return parts.join(", ");
  }
}

