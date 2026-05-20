/**
 * Purpose: This file handles network transport, message flow, or network state, and simulates many clients/actions to measure server/network scalability.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import fs from "node:fs";
import inspector from "node:inspector";
import path from "node:path";
import process from "node:process";
import { PerformanceObserver, constants, performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import net from "node:net";
import RAPIER from "@dimforge/rapier3d-compat";
import { init as initNavigation } from "recast-navigation";
import { Client, type Context } from "nengi";
import { WebSocketClientAdapter } from "nengi-websocket-client-adapter";
import {
  SERVER_TICK_MS,
  SERVER_TICK_RATE,
  WORLD_GROUND_HALF_EXTENT,
  ncontext,
  NType,
  type InputCommand
} from "../src/engine/shared/index";
import { GameServer } from "../src/engine/server/GameServer";
import { initializeSharedGameData } from "../src/game/shared/index";
import { initServerArchetypes } from "../src/game/server/serverArchetypes";

type Mode = "benchmark" | "hosted";
type Topology = "auto" | "sparse" | "clustered";

type ScenarioConfig = {
  clients: number;
  gridRows: number;
  warmupSeconds: number;
  durationSeconds: number;
  connectStaggerMs: number;
  connectTimeoutMs: number;
  connectSettleMs: number;
  serverPort: number;
  gridSpacing: number;
  gridColumns: number;
  mode: Mode;
  topology: Topology;
  useExistingServer: boolean;
  clientsOnly: boolean;
  serverUrl: string;
};

type ScenarioResult = {
  clients: number;
  connected: number;
  failed: number;
  connectTimeSeconds: number;
  meanTickMs: number;
  p95TickMs: number;
  maxTickMs: number;
  stddevTickMs: number;
  achievedTps: number;
  targetTps: number;
  p95AbsErrorMs: number;
  samples: number;
  rssMb: number;
  heapUsedMb: number;
  netAvgOutBytesPerSecondPerPlayer: number;
  netP95OutBytesPerSecondPerPlayer: number;
  netAvgInBytesPerSecondPerPlayer: number;
  netP95InBytesPerSecondPerPlayer: number;
  netAvgOutMessagesPerSecondPerPlayer: number;
  netP95OutMessagesPerSecondPerPlayer: number;
  netAvgInMessagesPerSecondPerPlayer: number;
  netP95InMessagesPerSecondPerPlayer: number;
  netWarningMask: number;
  phaseSamples: number;
  phaseDrainQueueMeanMs: number;
  phaseDrainQueueMaxMs: number;
  phaseSimulationMeanMs: number;
  phaseSimulationMaxMs: number;
  phasePostSimulationMeanMs: number;
  phasePostSimulationMaxMs: number;
  phaseNetworkMeanMs: number;
  phaseNetworkMaxMs: number;
  gcEvents: number;
  gcMajorEvents: number;
  gcTotalMs: number;
  gcMaxMs: number;
  gcP95Ms: number;
  heapUsedStartMb: number;
  heapUsedEndMb: number;
  heapUsedDeltaMb: number;
  heapUsedPeakMb: number;
  pass: boolean;
};

class LoadClient {
  private readonly client: Client;
  private readonly id: number;
  private sequence = 0;
  private connected = false;
  private readonly handshake: { authVersion: number; authKey?: string };

  public constructor(context: Context, id: number, authKey: string | null) {
    this.id = id;
    this.client = new Client(context, WebSocketClientAdapter, SERVER_TICK_RATE);
    this.handshake = {
      authVersion: 1
    };
    if (typeof authKey === "string" && authKey.length > 0) {
      this.handshake.authKey = authKey;
    }
    this.client.setDisconnectHandler(() => {
      this.connected = false;
    });
    this.client.setWebsocketErrorHandler(() => {
      this.connected = false;
    });
    this.client.setWebsocketErrorHandler((event: unknown) => {
      this.connected = false;
      const details = formatConnectError(event);
      if (details.length > 0) {
        console.warn(`[load] websocket_error client=${this.id} ${details}`);
      }
    });
  }

  public async connect(url: string): Promise<void> {
    await this.client.connect(url, this.handshake);
    this.connected = true;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public flushCommand(elapsedSeconds: number): void {
    if (!this.connected) {
      return;
    }

    const phase = elapsedSeconds * 0.75 + this.id * 0.03;
    const rawForward = Math.sin(phase);
    const rawStrafe = Math.cos(phase * 0.7);
    const magnitude = Math.hypot(rawForward, rawStrafe) || 1;
    const forward = rawForward / magnitude;
    const strafe = rawStrafe / magnitude;
    const yaw = normalizeAngle(phase * 0.2);
    const pitch = normalizeAngle(Math.sin(phase * 0.05) * 0.08);

    const command: InputCommand = {
      ntype: NType.InputCommand,
      sequence: this.sequence & 0xffff,
      forward,
      strafe,
      jump: false,
      toggleFlyPressed: false,
      sprint: (this.id + Math.floor(elapsedSeconds)) % 9 === 0,
      usePrimaryPressed: false,
      usePrimaryHeld: false,
      useSecondaryPressed: false,
      useSecondaryHeld: false,
      castSlotPressed: false,
      castSlotIndex: 0,
      yaw,
      yawDelta: 0,
      pitch
    };

    this.sequence += 1;
    this.client.addCommand(command);
    this.client.flush();
    this.drainInbound();
  }

  public disconnect(): void {
    this.connected = false;
    const socket = (this.client.adapter as { socket?: WebSocket | null } | undefined)?.socket;
    if (socket && (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING)) {
      socket.close(1000, "load-test shutdown");
    }
  }

  private drainInbound(): void {
    const network = this.client.network as { messages?: unknown[]; frames?: unknown[] };
    if (Array.isArray(network.messages) && network.messages.length > 0) {
      network.messages.length = 0;
    }
    if (Array.isArray(network.frames) && network.frames.length > 0) {
      network.frames.length = 0;
    }
  }
}

async function main(): Promise<void> {
  initializeSharedGameData();
  initServerArchetypes();
  ensureExperimentalWebSocketEnabled();
  const config = resolveConfig();
  const reportDir = path.join(process.cwd(), "profiling", "network-load");
  ensureDir(reportDir);

  console.log(
    `[load] mode=${config.mode} clients=${config.clients} warmup=${config.warmupSeconds}s duration=${config.durationSeconds}s`
  );
  console.log(
    `[load] grid columns=${config.gridColumns} rows=${config.gridRows} spacing=${config.gridSpacing.toFixed(2)} world_half_extent=${WORLD_GROUND_HALF_EXTENT}`
  );

  await RAPIER.init();
  await initNavigation();

  const runTag = Date.now();
  process.env.SERVER_DATA_PATH = path.join(reportDir, `load-db-${runTag}.sqlite`);
  process.env.SERVER_TICK_LOG = "0";
  process.env.SERVER_TICK_METRICS = "0";
  process.env.SERVER_ALLOW_GUEST_AUTH = "1";
  process.env.SERVER_DISABLE_PERSISTENCE_WRITES = "1";
  process.env.SERVER_AUTH_DISABLE_RATE_LIMIT = "1";
  process.env.SERVER_LOAD_TEST_SPAWN_MODE = "grid";
  process.env.SERVER_LOAD_TEST_GRID_COLUMNS = String(config.gridColumns);
  process.env.SERVER_LOAD_TEST_GRID_ROWS = String(config.gridRows);
  process.env.SERVER_LOAD_TEST_GRID_SPACING = String(config.gridSpacing);

  const server = new GameServer(ncontext);
  const clients = createClients(config.clients, `load-${runTag}`);
  let commandTimer: NodeJS.Timeout | null = null;
  let hostedLogTimer: NodeJS.Timeout | null = null;
  let cpuProfiler: CpuProfilerSession | null = null;
  let gcMonitor: GcAndHeapMonitor | null = null;

  try {
    if (!config.useExistingServer) {
      await server.start(config.serverPort);
      await waitForPortOpen("127.0.0.1", config.serverPort, 10_000, "load test nengi ws");
    }
    server.resetTickMetrics();
    const wsUrl = config.serverUrl;
    const connectStart = performance.now();
    const connectResult = await connectClients(
      clients,
      wsUrl,
      config.connectStaggerMs,
      config.connectTimeoutMs,
      config.connectSettleMs
    );
    const connectElapsedSeconds = (performance.now() - connectStart) / 1000;
    const connectedClients = clients.filter((client) => client.isConnected());

    console.log(
      `[load] connected=${connectResult.connected}/${config.clients} failed=${connectResult.failed} connect_time=${connectElapsedSeconds.toFixed(2)}s`
    );

    const runStart = performance.now();
    commandTimer = setInterval(() => {
      const elapsedSeconds = (performance.now() - runStart) / 1000;
      for (const client of connectedClients) {
        client.flushCommand(elapsedSeconds);
      }
    }, SERVER_TICK_MS);

    if (config.mode === "hosted") {
      console.log(`[load] hosted mode active on ws://127.0.0.1:${config.serverPort}`);
      console.log(
        `[load] join from browser client using: http://127.0.0.1:5173/?server=ws://127.0.0.1:${config.serverPort}`
      );
      hostedLogTimer = setInterval(() => {
        const metrics = server.getTickMetrics();
        if (!metrics) {
          return;
        }
        const tps = metrics.mean_ms > 0 ? 1000 / metrics.mean_ms : 0;
        console.log(
          `[load] live tps=${tps.toFixed(2)}/${SERVER_TICK_RATE.toFixed(2)} mean=${metrics.mean_ms.toFixed(3)}ms p95=${metrics.p95_ms.toFixed(3)}ms samples=${metrics.samples}`
        );
      }, 5000);
      await waitForSignal();
      return;
    }

    gcMonitor = createGcAndHeapMonitor(true);
    gcMonitor.start();
    await sleep(config.warmupSeconds * 1000);
    server.resetTickMetrics();
    cpuProfiler = createCpuProfilerSession({
      enabled: process.env.LOAD_PROFILE_CPU === "1",
      outputDir: reportDir,
      label: `network-load-c${config.clients}`
    });
    await cpuProfiler.start();
    await sleep(config.durationSeconds * 1000);
    await cpuProfiler.stop();
    cpuProfiler = null;
    const gcStats = gcMonitor.stop();
    gcMonitor = null;

    const metrics = server.getTickMetrics();
    if (config.clientsOnly) {
      if (connectResult.connected !== config.clients) {
        throw new Error(
          `clients-only connection baseline failed: connected=${connectResult.connected}/${config.clients}`
        );
      }
      console.log(
        `[load] clients-only complete connected=${connectResult.connected}/${config.clients} failed=${connectResult.failed}`
      );
      return;
    }
    if (!metrics) {
      throw new Error("No tick metrics captured in benchmark window.");
    }
    const phaseMetrics = server.getTickPhaseMetrics();
    const netSnapshot = server.getNetDiagnosticsSnapshot(Date.now());

    const mem = process.memoryUsage();
    const achievedTps = metrics.mean_ms > 0 ? 1000 / metrics.mean_ms : 0;
    const result: ScenarioResult = {
      clients: config.clients,
      connected: connectResult.connected,
      failed: connectResult.failed,
      connectTimeSeconds: round3(connectElapsedSeconds),
      meanTickMs: round3(metrics.mean_ms),
      p95TickMs: round3(metrics.p95_ms),
      maxTickMs: round3(metrics.max_ms),
      stddevTickMs: round3(metrics.stddev_ms),
      achievedTps: round3(achievedTps),
      targetTps: SERVER_TICK_RATE,
      p95AbsErrorMs: round3(metrics.p95_abs_error_ms),
      samples: metrics.samples,
      rssMb: round3(mem.rss / (1024 * 1024)),
      heapUsedMb: round3(mem.heapUsed / (1024 * 1024)),
      netAvgOutBytesPerSecondPerPlayer: round3(netSnapshot.avgOutboundBytesPerSecond),
      netP95OutBytesPerSecondPerPlayer: round3(netSnapshot.p95OutboundBytesPerSecond),
      netAvgInBytesPerSecondPerPlayer: round3(netSnapshot.avgInboundBytesPerSecond),
      netP95InBytesPerSecondPerPlayer: round3(netSnapshot.p95InboundBytesPerSecond),
      netAvgOutMessagesPerSecondPerPlayer: round3(netSnapshot.avgOutboundMessagesPerSecond),
      netP95OutMessagesPerSecondPerPlayer: round3(netSnapshot.p95OutboundMessagesPerSecond),
      netAvgInMessagesPerSecondPerPlayer: round3(netSnapshot.avgInboundMessagesPerSecond),
      netP95InMessagesPerSecondPerPlayer: round3(netSnapshot.p95InboundMessagesPerSecond),
      netWarningMask: netSnapshot.warningMask,
      phaseSamples: phaseMetrics?.samples ?? 0,
      phaseDrainQueueMeanMs: round3(phaseMetrics?.drainQueueMeanMs ?? 0),
      phaseDrainQueueMaxMs: round3(phaseMetrics?.drainQueueMaxMs ?? 0),
      phaseSimulationMeanMs: round3(phaseMetrics?.simulationMeanMs ?? 0),
      phaseSimulationMaxMs: round3(phaseMetrics?.simulationMaxMs ?? 0),
      phasePostSimulationMeanMs: round3(phaseMetrics?.postSimulationMeanMs ?? 0),
      phasePostSimulationMaxMs: round3(phaseMetrics?.postSimulationMaxMs ?? 0),
      phaseNetworkMeanMs: round3(phaseMetrics?.networkMeanMs ?? 0),
      phaseNetworkMaxMs: round3(phaseMetrics?.networkMaxMs ?? 0),
      gcEvents: gcStats.events,
      gcMajorEvents: gcStats.majorEvents,
      gcTotalMs: round3(gcStats.totalDurationMs),
      gcMaxMs: round3(gcStats.maxDurationMs),
      gcP95Ms: round3(gcStats.p95DurationMs),
      heapUsedStartMb: round3(gcStats.heapUsedStartMb),
      heapUsedEndMb: round3(gcStats.heapUsedEndMb),
      heapUsedDeltaMb: round3(gcStats.heapUsedEndMb - gcStats.heapUsedStartMb),
      heapUsedPeakMb: round3(gcStats.heapUsedPeakMb),
      pass: connectResult.connected === config.clients && achievedTps >= SERVER_TICK_RATE * 0.98
    };
    enforceScenarioBudgets(result);

    const reportPath = path.join(
      reportDir,
      `network-load-c${config.clients}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          config,
          result
        },
        null,
        2
      ),
      "utf8"
    );

    console.log(`[load] report=${reportPath}`);
    console.log(
      `[load] result clients=${result.clients} connected=${result.connected}/${config.clients} tps=${result.achievedTps.toFixed(2)}/${result.targetTps.toFixed(2)} mean=${result.meanTickMs.toFixed(3)}ms p95=${result.p95TickMs.toFixed(3)}ms max=${result.maxTickMs.toFixed(3)}ms pass=${String(result.pass)}`
    );
    console.log(
      `[load] net avg_out_bytes_s_pp=${result.netAvgOutBytesPerSecondPerPlayer.toFixed(2)} p95_out_bytes_s_pp=${result.netP95OutBytesPerSecondPerPlayer.toFixed(2)} avg_in_bytes_s_pp=${result.netAvgInBytesPerSecondPerPlayer.toFixed(2)} p95_in_bytes_s_pp=${result.netP95InBytesPerSecondPerPlayer.toFixed(2)} avg_out_msgs_s_pp=${result.netAvgOutMessagesPerSecondPerPlayer.toFixed(2)} p95_out_msgs_s_pp=${result.netP95OutMessagesPerSecondPerPlayer.toFixed(2)} avg_in_msgs_s_pp=${result.netAvgInMessagesPerSecondPerPlayer.toFixed(2)} p95_in_msgs_s_pp=${result.netP95InMessagesPerSecondPerPlayer.toFixed(2)} warn_mask=${result.netWarningMask}`
    );
    console.log(
      `[load] phase_ms drain(mean/max)=${result.phaseDrainQueueMeanMs.toFixed(3)}/${result.phaseDrainQueueMaxMs.toFixed(3)} sim(mean/max)=${result.phaseSimulationMeanMs.toFixed(3)}/${result.phaseSimulationMaxMs.toFixed(3)} post(mean/max)=${result.phasePostSimulationMeanMs.toFixed(3)}/${result.phasePostSimulationMaxMs.toFixed(3)} net(mean/max)=${result.phaseNetworkMeanMs.toFixed(3)}/${result.phaseNetworkMaxMs.toFixed(3)} samples=${result.phaseSamples}`
    );
    console.log(
      `[load] gc events=${result.gcEvents} major=${result.gcMajorEvents} total_ms=${result.gcTotalMs.toFixed(3)} p95_ms=${result.gcP95Ms.toFixed(3)} max_ms=${result.gcMaxMs.toFixed(3)} heap_mb(start/end/delta/peak)=${result.heapUsedStartMb.toFixed(2)}/${result.heapUsedEndMb.toFixed(2)}/${result.heapUsedDeltaMb.toFixed(2)}/${result.heapUsedPeakMb.toFixed(2)}`
    );
  } finally {
    if (gcMonitor) {
      gcMonitor.stop();
      gcMonitor = null;
    }
    if (cpuProfiler) {
      await cpuProfiler.stop();
      cpuProfiler = null;
    }
    if (hostedLogTimer) {
      clearInterval(hostedLogTimer);
    }
    if (commandTimer) {
      clearInterval(commandTimer);
    }
    for (const client of clients) {
      client.disconnect();
    }
    await sleep(150);
    if (!config.useExistingServer) {
      server.stop();
    }
  }
}

function resolveConfig(): ScenarioConfig {
  const clients = Math.max(1, Math.floor(parsePositiveNumber(process.env.LOAD_CLIENTS, 100)));
  const mode = resolveMode(process.env.LOAD_MODE);
  const serverPort = Math.max(1025, Math.floor(parsePositiveNumber(process.env.LOAD_SERVER_PORT, 9300)));
  const warmupSeconds = parsePositiveNumber(process.env.LOAD_WARMUP_SECONDS, 5);
  const durationSeconds = parsePositiveNumber(process.env.LOAD_DURATION_SECONDS, 20);
  const defaultStaggerMs = mode === "hosted" ? 0 : 10;
  const defaultSettleMs = mode === "hosted" ? 0 : 900;
  const connectStaggerMs = Math.max(
    0,
    Math.floor(parsePositiveNumber(process.env.LOAD_CONNECT_STAGGER_MS, defaultStaggerMs))
  );
  const connectTimeoutMs = Math.max(
    1000,
    Math.floor(parsePositiveNumber(process.env.LOAD_CONNECT_TIMEOUT_MS, 30000))
  );
  const connectSettleMs = Math.max(
    0,
    Math.floor(parsePositiveNumber(process.env.LOAD_CONNECT_SETTLE_MS, defaultSettleMs))
  );
  const useExistingServer = process.env.LOAD_USE_EXISTING_SERVER === "1";
  const clientsOnly = process.env.LOAD_CLIENTS_ONLY === "1";
  const topology = resolveTopology(process.env.LOAD_TOPOLOGY);
  const gridColumns = Math.max(1, Math.ceil(Math.sqrt(clients)));
  const gridRows = Math.max(1, Math.ceil(clients / gridColumns));
  const autoSpacing = computeGridSpacing(clients, gridColumns, gridRows, topology);
  const gridSpacing = Math.max(6, parsePositiveNumber(process.env.LOAD_GRID_SPACING, autoSpacing));
  const serverUrl = process.env.LOAD_SERVER_URL?.trim() || `ws://127.0.0.1:${serverPort}`;

  return {
    clients,
    gridRows,
    warmupSeconds,
    durationSeconds,
    connectStaggerMs,
    connectTimeoutMs,
    connectSettleMs,
    serverPort,
    gridSpacing,
    gridColumns,
    mode,
    topology,
    useExistingServer,
    clientsOnly,
    serverUrl
  };
}

function resolveMode(raw: string | undefined): Mode {
  const value = String(raw ?? "benchmark").trim().toLowerCase();
  return value === "hosted" ? "hosted" : "benchmark";
}

function resolveTopology(raw: string | undefined): Topology {
  const value = String(raw ?? "auto").trim().toLowerCase();
  if (value === "sparse") return "sparse";
  if (value === "clustered") return "clustered";
  return "auto";
}

function computeGridSpacing(clients: number, columns: number, rows: number, topology: Topology): number {
  if (topology === "clustered") {
    return 10;
  }
  if (topology === "sparse") {
    return 40;
  }
  const usableSpan = WORLD_GROUND_HALF_EXTENT * 2 * 0.85;
  const spacingX = columns <= 1 ? usableSpan : usableSpan / (columns - 1);
  const spacingZ = rows <= 1 ? usableSpan : usableSpan / (rows - 1);
  return Math.max(6, Math.min(spacingX, spacingZ));
}

function createClients(count: number, authPrefix: string): LoadClient[] {
  const clients: LoadClient[] = [];
  const useAuthKeys = process.env.LOAD_USE_AUTH_KEYS === "1";
  for (let i = 0; i < count; i += 1) {
    const id = i + 1;
    const authKey = useAuthKeys ? makeValidAuthKey(authPrefix, id) : null;
    clients.push(new LoadClient(ncontext, id, authKey));
  }
  return clients;
}

async function connectClients(
  clients: LoadClient[],
  wsUrl: string,
  staggerMs: number,
  timeoutMs: number,
  settleMs: number
): Promise<{ connected: number; failed: number }> {
  let connected = 0;
  let failed = 0;
  const errorCounts = new Map<string, number>();
  for (const client of clients) {
    try {
      await withTimeout(client.connect(wsUrl), timeoutMs, "client connect timeout");
      await sleep(settleMs);
      if (client.isConnected()) {
        connected += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      const message = formatConnectError(error);
      errorCounts.set(message, (errorCounts.get(message) ?? 0) + 1);
    }
    if (staggerMs > 0) {
      await sleep(staggerMs);
    }
  }
  if (errorCounts.size > 0) {
    const summary = [...errorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([message, count]) => `${count}x ${message}`)
      .join(" | ");
    console.warn(`[load] connect_failures ${summary}`);
  }
  return { connected, failed };
}

function formatConnectError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : error.name;
  }
  if (typeof error === "object" && error !== null) {
    const event = error as {
      type?: unknown;
      message?: unknown;
      reason?: unknown;
      error?: unknown;
      target?: { readyState?: unknown; url?: unknown };
    };
    const type = typeof event.type === "string" ? event.type : "unknown";
    const message = typeof event.message === "string" ? event.message : "";
    const reason = typeof event.reason === "string" ? event.reason : "";
    const nested = event.error instanceof Error ? event.error.message : "";
    const readyState =
      typeof event.target?.readyState === "number" ? String(event.target.readyState) : "n/a";
    const targetUrl = typeof event.target?.url === "string" ? event.target.url : "";
    const parts = [
      `event:${type}`,
      message.length > 0 ? `message:${message}` : "",
      reason.length > 0 ? `reason:${reason}` : "",
      nested.length > 0 ? `error:${nested}` : "",
      `readyState:${readyState}`,
      targetUrl.length > 0 ? `url:${targetUrl}` : ""
    ].filter((part) => part.length > 0);
    return parts.join(" ");
  }
  return String(error ?? "unknown connect error");
}

function ensureExperimentalWebSocketEnabled(): void {
  const ok = "WebSocket" in globalThis && typeof WebSocket === "function";
  if (!ok) {
    throw new Error(
      "Global WebSocket missing. Run with: node --experimental-websocket --import tsx scripts/network-load-test.ts"
    );
  }
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function waitForSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    const onSignal = (): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) {
    angle -= Math.PI * 2;
  }
  while (angle < -Math.PI) {
    angle += Math.PI * 2;
  }
  return angle;
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

async function waitForPortOpen(
  host: string,
  port: number,
  timeoutMs: number,
  label: string
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(host, port, 600)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label} on ${host}:${port}`);
}

async function isPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function makeValidAuthKey(seed: string, index: number): string {
  const hash = createHash("sha256").update(`${seed}:${index}`).digest("hex");
  const alnum = hash.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return alnum.slice(0, 12);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

type CpuProfilerSession = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type GcAndHeapSnapshot = {
  events: number;
  majorEvents: number;
  totalDurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
  heapUsedStartMb: number;
  heapUsedEndMb: number;
  heapUsedPeakMb: number;
};

type GcAndHeapMonitor = {
  start: () => void;
  stop: () => GcAndHeapSnapshot;
};

function createGcAndHeapMonitor(enabled: boolean): GcAndHeapMonitor {
  if (!enabled) {
    const zero: GcAndHeapSnapshot = {
      events: 0,
      majorEvents: 0,
      totalDurationMs: 0,
      p95DurationMs: 0,
      maxDurationMs: 0,
      heapUsedStartMb: 0,
      heapUsedEndMb: 0,
      heapUsedPeakMb: 0
    };
    return {
      start: () => undefined,
      stop: () => zero
    };
  }
  const gcDurations: number[] = [];
  let events = 0;
  let majorEvents = 0;
  let totalDurationMs = 0;
  let maxDurationMs = 0;
  let heapUsedStartMb = 0;
  let heapUsedEndMb = 0;
  let heapUsedPeakMb = 0;
  let samplingHandle: NodeJS.Timeout | null = null;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const duration = Number(entry.duration);
      if (!Number.isFinite(duration)) continue;
      events += 1;
      totalDurationMs += duration;
      gcDurations.push(duration);
      if (duration > maxDurationMs) {
        maxDurationMs = duration;
      }
      const detailKind = Number((entry as { detail?: { kind?: number } }).detail?.kind ?? 0);
      if (detailKind === constants.NODE_PERFORMANCE_GC_MAJOR) {
        majorEvents += 1;
      }
    }
  });

  return {
    start: () => {
      heapUsedStartMb = process.memoryUsage().heapUsed / (1024 * 1024);
      heapUsedPeakMb = heapUsedStartMb;
      observer.observe({ entryTypes: ["gc"], buffered: true });
      samplingHandle = setInterval(() => {
        const heapUsed = process.memoryUsage().heapUsed / (1024 * 1024);
        if (heapUsed > heapUsedPeakMb) {
          heapUsedPeakMb = heapUsed;
        }
      }, 250);
    },
    stop: () => {
      if (samplingHandle) {
        clearInterval(samplingHandle);
        samplingHandle = null;
      }
      observer.disconnect();
      heapUsedEndMb = process.memoryUsage().heapUsed / (1024 * 1024);
      if (heapUsedEndMb > heapUsedPeakMb) {
        heapUsedPeakMb = heapUsedEndMb;
      }
      const p95DurationMs = computeP95(gcDurations);
      return {
        events,
        majorEvents,
        totalDurationMs,
        p95DurationMs,
        maxDurationMs,
        heapUsedStartMb,
        heapUsedEndMb,
        heapUsedPeakMb
      };
    }
  };
}

function computeP95(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * 0.95)));
  return sorted[index] ?? 0;
}

function createCpuProfilerSession(options: {
  enabled: boolean;
  outputDir: string;
  label: string;
}): CpuProfilerSession {
  if (!options.enabled) {
    return {
      start: async () => undefined,
      stop: async () => undefined
    };
  }

  const session = new inspector.Session();
  let started = false;
  let stopped = false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const profilePath = path.join(options.outputDir, `${options.label}-${stamp}.cpuprofile`);
  const post = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      session.post(method, params, (error, result = {}) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result as Record<string, unknown>);
      });
    });

  return {
    start: async () => {
      if (started) {
        return;
      }
      session.connect();
      await post("Profiler.enable");
      await post("Profiler.start");
      started = true;
    },
    stop: async () => {
      if (!started || stopped) {
        return;
      }
      try {
        const result = await post("Profiler.stop");
        fs.writeFileSync(profilePath, JSON.stringify(result.profile ?? {}, null, 2), "utf8");
        console.log(`[load] cpu_profile=${profilePath}`);
      } finally {
        await post("Profiler.disable").catch(() => undefined);
        session.disconnect();
        stopped = true;
      }
    }
  };
}

function enforceScenarioBudgets(result: ScenarioResult): void {
  if (process.env.LOAD_ENFORCE_PASS !== "1") {
    return;
  }
  const minTpsRatio = parsePositiveNumber(process.env.LOAD_MIN_TPS_RATIO, 0.98);
  const maxP95TickMs = parsePositiveNumber(process.env.LOAD_MAX_P95_TICK_MS, Number.POSITIVE_INFINITY);
  const maxMeanTickMs = parsePositiveNumber(process.env.LOAD_MAX_MEAN_TICK_MS, Number.POSITIVE_INFINITY);
  const minConnectedRatio = parsePositiveNumber(process.env.LOAD_MIN_CONNECTED_RATIO, 1);
  const maxAvgOutBytesPerSecondPerPlayer = parsePositiveNumber(
    process.env.LOAD_MAX_AVG_OUT_BYTES_PER_SECOND_PER_PLAYER,
    Number.POSITIVE_INFINITY
  );
  const maxP95OutBytesPerSecondPerPlayer = parsePositiveNumber(
    process.env.LOAD_MAX_P95_OUT_BYTES_PER_SECOND_PER_PLAYER,
    Number.POSITIVE_INFINITY
  );
  const maxAvgOutMessagesPerSecondPerPlayer = parsePositiveNumber(
    process.env.LOAD_MAX_AVG_OUT_MESSAGES_PER_SECOND_PER_PLAYER,
    Number.POSITIVE_INFINITY
  );
  const maxP95OutMessagesPerSecondPerPlayer = parsePositiveNumber(
    process.env.LOAD_MAX_P95_OUT_MESSAGES_PER_SECOND_PER_PLAYER,
    Number.POSITIVE_INFINITY
  );
  const maxHeapDeltaMb = parsePositiveNumber(process.env.LOAD_MAX_HEAP_DELTA_MB, Number.POSITIVE_INFINITY);
  const maxGcP95Ms = parsePositiveNumber(process.env.LOAD_MAX_GC_P95_MS, Number.POSITIVE_INFINITY);
  const maxGcTotalMs = parsePositiveNumber(process.env.LOAD_MAX_GC_TOTAL_MS, Number.POSITIVE_INFINITY);
  const achievedRatio = result.targetTps > 0 ? result.achievedTps / result.targetTps : 0;
  const connectedRatio = result.clients > 0 ? result.connected / result.clients : 0;

  if (!result.pass) {
    throw new Error(
      `Load baseline failed: connected=${result.connected}/${result.clients} tps=${result.achievedTps.toFixed(2)}/${result.targetTps.toFixed(2)}`
    );
  }
  if (achievedRatio < minTpsRatio) {
    throw new Error(
      `Achieved TPS ratio below budget: actual=${achievedRatio.toFixed(3)} min=${minTpsRatio.toFixed(3)}`
    );
  }
  if (result.p95TickMs > maxP95TickMs) {
    throw new Error(
      `P95 tick ms above budget: actual=${result.p95TickMs.toFixed(3)} max=${maxP95TickMs.toFixed(3)}`
    );
  }
  if (result.meanTickMs > maxMeanTickMs) {
    throw new Error(
      `Mean tick ms above budget: actual=${result.meanTickMs.toFixed(3)} max=${maxMeanTickMs.toFixed(3)}`
    );
  }
  if (connectedRatio < minConnectedRatio) {
    throw new Error(
      `Connected ratio below budget: actual=${connectedRatio.toFixed(3)} min=${minConnectedRatio.toFixed(3)}`
    );
  }
  if (result.netAvgOutBytesPerSecondPerPlayer > maxAvgOutBytesPerSecondPerPlayer) {
    throw new Error(
      `Avg outbound bytes/s/player above budget: actual=${result.netAvgOutBytesPerSecondPerPlayer.toFixed(2)} max=${maxAvgOutBytesPerSecondPerPlayer.toFixed(2)}`
    );
  }
  if (result.netP95OutBytesPerSecondPerPlayer > maxP95OutBytesPerSecondPerPlayer) {
    throw new Error(
      `P95 outbound bytes/s/player above budget: actual=${result.netP95OutBytesPerSecondPerPlayer.toFixed(2)} max=${maxP95OutBytesPerSecondPerPlayer.toFixed(2)}`
    );
  }
  if (result.netAvgOutMessagesPerSecondPerPlayer > maxAvgOutMessagesPerSecondPerPlayer) {
    throw new Error(
      `Avg outbound messages/s/player above budget: actual=${result.netAvgOutMessagesPerSecondPerPlayer.toFixed(2)} max=${maxAvgOutMessagesPerSecondPerPlayer.toFixed(2)}`
    );
  }
  if (result.netP95OutMessagesPerSecondPerPlayer > maxP95OutMessagesPerSecondPerPlayer) {
    throw new Error(
      `P95 outbound messages/s/player above budget: actual=${result.netP95OutMessagesPerSecondPerPlayer.toFixed(2)} max=${maxP95OutMessagesPerSecondPerPlayer.toFixed(2)}`
    );
  }
  if (result.heapUsedDeltaMb > maxHeapDeltaMb) {
    throw new Error(
      `Heap delta above budget: actual=${result.heapUsedDeltaMb.toFixed(2)}MB max=${maxHeapDeltaMb.toFixed(2)}MB`
    );
  }
  if (result.gcP95Ms > maxGcP95Ms) {
    throw new Error(
      `GC p95 above budget: actual=${result.gcP95Ms.toFixed(3)}ms max=${maxGcP95Ms.toFixed(3)}ms`
    );
  }
  if (result.gcTotalMs > maxGcTotalMs) {
    throw new Error(
      `GC total above budget: actual=${result.gcTotalMs.toFixed(3)}ms max=${maxGcTotalMs.toFixed(3)}ms`
    );
  }
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("[load] FAIL", error);
    process.exit(1);
  });
