/**
 * Purpose: This file runs a standalone authoritative server instance for split-process network load profiling.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import fs from "node:fs";
import inspector from "node:inspector";
import path from "node:path";
import process from "node:process";
import { init as initNavigation } from "recast-navigation";
import RAPIER from "@dimforge/rapier3d-compat";
import { ncontext } from "../src/engine/shared/index";
import { GameServer } from "../src/engine/server/GameServer";
import { initializeSharedGameData } from "../src/game/shared/index";
import { initServerArchetypes } from "../src/game/server/serverArchetypes";

const port = Math.max(1025, Number(process.env.LOAD_SERVER_PORT ?? 9300));
const reportDir = path.join(process.cwd(), "profiling", "network-load");
const profileEnabled = process.env.LOAD_PROFILE_CPU === "1";
const autoShutdownMs = Math.max(0, Number(process.env.LOAD_SERVER_AUTO_SHUTDOWN_MS ?? 0));
const profileCaptureMs = Math.max(0, Number(process.env.LOAD_SERVER_PROFILE_CAPTURE_MS ?? 0));
const runLabel = String(process.env.LOAD_RUN_LABEL ?? "default").trim() || "default";

let server: GameServer | null = null;
let profiler: inspector.Session | null = null;
let profilerStarted = false;
let profilePath: string | null = null;
let netSampleTimer: NodeJS.Timeout | null = null;
let peakActiveNet: ReturnType<GameServer["getNetDiagnosticsSnapshot"]> | null = null;
let lastActiveNet: ReturnType<GameServer["getNetDiagnosticsSnapshot"]> | null = null;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function post(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!profiler) {
    return Promise.resolve({});
  }
  return new Promise((resolve, reject) => {
    profiler!.post(method, params, (error, result = {}) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result as Record<string, unknown>);
    });
  });
}

async function startProfiler(): Promise<void> {
  if (!profileEnabled || profilerStarted) {
    return;
  }
  ensureDir(reportDir);
  profiler = new inspector.Session();
  profiler.connect();
  await post("Profiler.enable");
  await post("Profiler.start");
  profilerStarted = true;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  profilePath = path.join(reportDir, `network-load-server-${stamp}.cpuprofile`);
}

async function stopProfiler(): Promise<void> {
  if (!profilerStarted || !profiler) {
    return;
  }
  try {
    const result = await post("Profiler.stop");
    if (profilePath) {
      fs.writeFileSync(profilePath, JSON.stringify(result.profile ?? {}, null, 2), "utf8");
      console.log(`[load-server] cpu_profile=${profilePath}`);
    }
  } finally {
    await post("Profiler.disable").catch(() => undefined);
    profiler.disconnect();
    profiler = null;
    profilerStarted = false;
  }
}

async function shutdown(code: number): Promise<void> {
  if (netSampleTimer) {
    clearInterval(netSampleTimer);
    netSampleTimer = null;
  }
  await stopProfiler();
  if (server) {
    const tick = server.getTickMetrics();
    const phase = server.getTickPhaseMetrics();
    const net = server.getNetDiagnosticsSnapshot(Date.now());
    const summary = {
      generatedAt: new Date().toISOString(),
      runLabel,
      exitCode: code,
      config: {
        serverPort: port,
        profileEnabled,
        autoShutdownMs,
        profileCaptureMs,
        clients: Number(process.env.LOAD_CLIENTS ?? 0),
        topology: String(process.env.LOAD_TOPOLOGY ?? "auto"),
        warmupSeconds: Number(process.env.LOAD_WARMUP_SECONDS ?? 0),
        durationSeconds: Number(process.env.LOAD_DURATION_SECONDS ?? 0),
        connectStaggerMs: Number(process.env.LOAD_CONNECT_STAGGER_MS ?? 0),
        connectSettleMs: Number(process.env.LOAD_CONNECT_SETTLE_MS ?? 0)
      },
      tick,
      phase,
      net,
      netLastActive: lastActiveNet,
      netPeakActive: peakActiveNet,
      cpuProfilePath: profilePath
    };
    const summaryPath = path.join(
      reportDir,
      `network-load-summary-${runLabel}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
    console.log(`[load-server] summary=${summaryPath}`);
    if (tick) {
      console.log(
        `[load-server] tick tps=${(tick.mean_ms > 0 ? 1000 / tick.mean_ms : 0).toFixed(2)}/${(1000 / tick.target_ms).toFixed(2)} mean=${tick.mean_ms.toFixed(3)}ms p95=${tick.p95_ms.toFixed(3)}ms max=${tick.max_ms.toFixed(3)}ms`
      );
    }
    if (phase) {
      console.log(
        `[load-server] phase drain(mean/max)=${phase.drainQueueMeanMs.toFixed(3)}/${phase.drainQueueMaxMs.toFixed(3)} sim(mean/max)=${phase.simulationMeanMs.toFixed(3)}/${phase.simulationMaxMs.toFixed(3)} post(mean/max)=${phase.postSimulationMeanMs.toFixed(3)}/${phase.postSimulationMaxMs.toFixed(3)} net(mean/max)=${phase.networkMeanMs.toFixed(3)}/${phase.networkMaxMs.toFixed(3)} samples=${phase.samples}`
      );
    }
    console.log(
      `[load-server] net connected=${net.connectedPlayers} window_s=${net.windowSeconds} avg_out_bytes_s_pp=${net.avgOutboundBytesPerSecond.toFixed(2)} p95_out_bytes_s_pp=${net.p95OutboundBytesPerSecond.toFixed(2)} avg_in_bytes_s_pp=${net.avgInboundBytesPerSecond.toFixed(2)} p95_in_bytes_s_pp=${net.p95InboundBytesPerSecond.toFixed(2)} avg_out_msgs_s_pp=${net.avgOutboundMessagesPerSecond.toFixed(2)} p95_out_msgs_s_pp=${net.p95OutboundMessagesPerSecond.toFixed(2)} avg_in_msgs_s_pp=${net.avgInboundMessagesPerSecond.toFixed(2)} p95_in_msgs_s_pp=${net.p95InboundMessagesPerSecond.toFixed(2)} warn_mask=${net.warningMask}`
    );
    if (lastActiveNet) {
      console.log(
        `[load-server] net_last_active connected=${lastActiveNet.connectedPlayers} window_s=${lastActiveNet.windowSeconds} avg_out_bytes_s_pp=${lastActiveNet.avgOutboundBytesPerSecond.toFixed(2)} p95_out_bytes_s_pp=${lastActiveNet.p95OutboundBytesPerSecond.toFixed(2)} avg_in_bytes_s_pp=${lastActiveNet.avgInboundBytesPerSecond.toFixed(2)} p95_in_bytes_s_pp=${lastActiveNet.p95InboundBytesPerSecond.toFixed(2)} avg_out_msgs_s_pp=${lastActiveNet.avgOutboundMessagesPerSecond.toFixed(2)} p95_out_msgs_s_pp=${lastActiveNet.p95OutboundMessagesPerSecond.toFixed(2)} avg_in_msgs_s_pp=${lastActiveNet.avgInboundMessagesPerSecond.toFixed(2)} p95_in_msgs_s_pp=${lastActiveNet.p95InboundMessagesPerSecond.toFixed(2)} warn_mask=${lastActiveNet.warningMask}`
      );
    }
    if (peakActiveNet) {
      console.log(
        `[load-server] net_peak_active connected=${peakActiveNet.connectedPlayers} window_s=${peakActiveNet.windowSeconds} avg_out_bytes_s_pp=${peakActiveNet.avgOutboundBytesPerSecond.toFixed(2)} p95_out_bytes_s_pp=${peakActiveNet.p95OutboundBytesPerSecond.toFixed(2)} avg_in_bytes_s_pp=${peakActiveNet.avgInboundBytesPerSecond.toFixed(2)} p95_in_bytes_s_pp=${peakActiveNet.p95InboundBytesPerSecond.toFixed(2)} avg_out_msgs_s_pp=${peakActiveNet.avgOutboundMessagesPerSecond.toFixed(2)} p95_out_msgs_s_pp=${peakActiveNet.p95OutboundMessagesPerSecond.toFixed(2)} avg_in_msgs_s_pp=${peakActiveNet.avgInboundMessagesPerSecond.toFixed(2)} p95_in_msgs_s_pp=${peakActiveNet.p95InboundMessagesPerSecond.toFixed(2)} warn_mask=${peakActiveNet.warningMask}`
      );
    }
    server.stop();
    server = null;
  }
  process.exit(code);
}

async function main(): Promise<void> {
  initializeSharedGameData();
  initServerArchetypes();
  ensureDir(reportDir);

  process.env.SERVER_DATA_PATH = path.join(reportDir, `load-db-split-${Date.now()}.sqlite`);
  process.env.SERVER_TICK_LOG = "0";
  process.env.SERVER_TICK_METRICS = "0";
  process.env.SERVER_ALLOW_GUEST_AUTH = "1";
  process.env.SERVER_DISABLE_PERSISTENCE_WRITES = "1";
  process.env.SERVER_AUTH_DISABLE_RATE_LIMIT = "1";

  await RAPIER.init();
  await initNavigation();

  await startProfiler();
  if (profileCaptureMs > 0) {
    setTimeout(() => {
      void stopProfiler();
    }, profileCaptureMs);
  }

  server = new GameServer(ncontext);
  await server.start(port);
  console.log(`[load-server] listening ws://127.0.0.1:${port}`);
  netSampleTimer = setInterval(() => {
    if (!server) {
      return;
    }
    const snapshot = server.getNetDiagnosticsSnapshot(Date.now());
    if (snapshot.connectedPlayers <= 0) {
      return;
    }
    lastActiveNet = snapshot;
    if (!peakActiveNet || snapshot.avgOutboundBytesPerSecond > peakActiveNet.avgOutboundBytesPerSecond) {
      peakActiveNet = snapshot;
    }
  }, 1000);

  process.on("SIGINT", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });
  if (autoShutdownMs > 0) {
    setTimeout(() => {
      void shutdown(0);
    }, autoShutdownMs);
  }
}

void main().catch((error) => {
  console.error("[load-server] FAIL", error);
  void shutdown(1);
});
