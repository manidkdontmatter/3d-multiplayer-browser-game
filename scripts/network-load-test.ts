// Headless network load harness for a single configurable bot count, with benchmark and hosted inspection modes.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import RAPIER from "@dimforge/rapier3d-compat";
import { Client, type Context } from "nengi";
import { WebSocketClientAdapter } from "nengi-websocket-client-adapter";
import {
  SERVER_TICK_MS,
  SERVER_TICK_RATE,
  WORLD_GROUND_HALF_EXTENT,
  ncontext,
  NType,
  type InputCommand
} from "../src/shared/index";
import { GameServer } from "../src/server/GameServer";

type Mode = "benchmark" | "hosted";

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

  try {
    await server.start(config.serverPort);
    server.resetTickMetrics();
    const wsUrl = `ws://127.0.0.1:${config.serverPort}`;
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

    await sleep(config.warmupSeconds * 1000);
    server.resetTickMetrics();
    await sleep(config.durationSeconds * 1000);

    const metrics = server.getTickMetrics();
    if (!metrics) {
      throw new Error("No tick metrics captured in benchmark window.");
    }

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
      pass: connectResult.connected === config.clients && achievedTps >= SERVER_TICK_RATE * 0.98
    };

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
  } finally {
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
    server.stop();
  }
}

function resolveConfig(): ScenarioConfig {
  const clients = Math.max(1, Math.floor(parsePositiveNumber(process.env.LOAD_CLIENTS, 10)));
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
  const gridColumns = Math.max(1, Math.ceil(Math.sqrt(clients)));
  const gridRows = Math.max(1, Math.ceil(clients / gridColumns));
  const autoSpacing = computeGridSpacing(clients, gridColumns, gridRows);
  const gridSpacing = Math.max(6, parsePositiveNumber(process.env.LOAD_GRID_SPACING, autoSpacing));

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
    mode
  };
}

function resolveMode(raw: string | undefined): Mode {
  const value = String(raw ?? "benchmark").trim().toLowerCase();
  return value === "hosted" ? "hosted" : "benchmark";
}

function computeGridSpacing(clients: number, columns: number, rows: number): number {
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
  for (const client of clients) {
    try {
      await withTimeout(client.connect(wsUrl), timeoutMs, "client connect timeout");
      await sleep(settleMs);
      if (client.isConnected()) {
        connected += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
    if (staggerMs > 0) {
      await sleep(staggerMs);
    }
  }
  return { connected, failed };
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

function makeValidAuthKey(seed: string, index: number): string {
  const hash = createHash("sha256").update(`${seed}:${index}`).digest("hex");
  const alnum = hash.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return alnum.slice(0, 12);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("[load] FAIL", error);
    process.exit(1);
  });
