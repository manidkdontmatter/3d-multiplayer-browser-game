import fs from "node:fs";
import inspector from "node:inspector";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output", "multiplayer");
const CLIENT_ORIGIN = "http://127.0.0.1:5173";
const USE_EXISTING_SERVER = process.env.E2E_USE_EXISTING_SERVER === "1";
const USE_EXISTING_CLIENT = process.env.E2E_USE_EXISTING_CLIENT === "1";
const EXISTING_SERVER_URL = process.env.E2E_SERVER_URL;
const E2E_NETSIM_ENABLED = process.env.E2E_NETSIM === "1";
const E2E_HEADLESS = process.env.E2E_HEADLESS !== "0";
const E2E_SIM_ONLY = process.env.E2E_SIM_ONLY !== "0";
const E2E_ENABLE_SPRINT_TEST = process.env.E2E_ENABLE_SPRINT_TEST !== "0";
const E2E_ENABLE_JUMP_TEST = process.env.E2E_ENABLE_JUMP_TEST !== "0";
const E2E_ENABLE_RECONNECT_TEST = process.env.E2E_ENABLE_RECONNECT_TEST !== "0";
const E2E_ENABLE_PRIMARY_ACTION_TEST = process.env.E2E_ENABLE_PRIMARY_ACTION_TEST !== "0";
const ARTIFACTS_ON_PASS = process.env.E2E_ARTIFACTS_ON_PASS === "1";
const ARTIFACTS_ON_FAIL = process.env.E2E_ARTIFACTS_ON_FAIL !== "0";
const MIN_REQUIRED_LOCAL_MOVEMENT = readEnvNumber("E2E_MIN_LOCAL_MOVEMENT", 1.0);
const MIN_REQUIRED_REMOTE_MOVEMENT = readEnvNumber("E2E_MIN_REMOTE_MOVEMENT", 0.75);
const MIN_SPAWN_SEPARATION = readEnvNumber("E2E_MIN_SPAWN_SEPARATION", 0.7); // Player capsule diameter is 0.70, so this checks non-overlap.
const MOVEMENT_POLL_MS = Math.max(16, Math.floor(readEnvNumber("E2E_MOVEMENT_POLL_MS", 120)));
const LOCAL_MOVEMENT_TIMEOUT_MS = readEnvNumber("E2E_LOCAL_MOVEMENT_TIMEOUT_MS", 15000);
const REMOTE_MOVEMENT_TIMEOUT_MS = readEnvNumber("E2E_REMOTE_MOVEMENT_TIMEOUT_MS", 15000);
const DEFAULT_MIN_CLIENT_FPS = E2E_HEADLESS ? 0 : 20;
const MIN_CLIENT_FPS = readEnvNumber("E2E_MIN_CLIENT_FPS", DEFAULT_MIN_CLIENT_FPS);
const FPS_STABILIZATION_TIMEOUT_MS = readEnvNumber("E2E_FPS_STABILIZATION_TIMEOUT_MS", 20000);
const FPS_STABLE_SAMPLE_COUNT = Math.max(1, Math.floor(readEnvNumber("E2E_FPS_STABLE_SAMPLE_COUNT", 3)));
const SERVER_START_TIMEOUT_MS = readEnvNumber("E2E_SERVER_START_TIMEOUT_MS", 20000);
const CLIENT_START_TIMEOUT_MS = readEnvNumber("E2E_CLIENT_START_TIMEOUT_MS", 24000);
const MAX_WALLTIME_MS = Math.max(5000, Math.floor(readEnvNumber("E2E_MAX_WALLTIME_MS", 600000)));
const E2E_CSP_ENABLED = process.env.E2E_CSP === "1";
const CLIENT_CSP_QUERY = E2E_CSP_ENABLED ? "1" : "0";
const MIN_REQUIRED_SPRINT_MOVEMENT = readEnvNumber("E2E_MIN_SPRINT_MOVEMENT", 1.4);
const SPRINT_MOVEMENT_TIMEOUT_MS = readEnvNumber("E2E_SPRINT_MOVEMENT_TIMEOUT_MS", 9000);
const MIN_JUMP_HEIGHT = readEnvNumber("E2E_MIN_JUMP_HEIGHT", 0.55);
const JUMP_TIMEOUT_MS = readEnvNumber("E2E_JUMP_TIMEOUT_MS", 9000);
const JUMP_RETRY_SETTLE_MS = 800;
const DISCONNECT_RECONNECT_TIMEOUT_MS = readEnvNumber("E2E_RECONNECT_TIMEOUT_MS", 12000);
const PAGE_RECONNECT_COOLDOWN_MS = 2200;
const PRIMARY_ACTION_TIMEOUT_MS = readEnvNumber("E2E_PRIMARY_ACTION_TIMEOUT_MS", 7000);
const NETSIM_ACK_DROP = readEnvNumber("E2E_NETSIM_ACK_DROP", 0.15);
const NETSIM_ACK_DELAY_MS = readEnvNumber("E2E_NETSIM_ACK_DELAY_MS", 60);
const NETSIM_ACK_JITTER_MS = readEnvNumber("E2E_NETSIM_ACK_JITTER_MS", 90);
const E2E_VIEWPORT_WIDTH = Math.max(640, Math.floor(readEnvNumber("E2E_VIEWPORT_WIDTH", 960)));
const E2E_VIEWPORT_HEIGHT = Math.max(360, Math.floor(readEnvNumber("E2E_VIEWPORT_HEIGHT", 540)));
const E2E_PROFILE_CAPTURE_MS = Math.max(0, Math.floor(readEnvNumber("E2E_PROFILE_CAPTURE_MS", 0)));
const PROFILE_DIR = path.join(ROOT, "profiling", "multiplayer-e2e");
const E2E_PHASE_TIMING_ENABLED = process.env.E2E_PHASE_TIMING !== "0";
const CHROMIUM_ANTI_THROTTLE_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion,BackForwardCache"
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isPortOpen(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForPortOpen(host, port, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(host, port, 500)) {
      return;
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label} on ${host}:${port}`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to determine free port."));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function parseServerPort(serverUrl) {
  try {
    const parsed = new URL(serverUrl);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    const port = Number(parsed.port || (parsed.protocol === "wss:" ? "443" : "80"));
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      return null;
    }
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
}

function startProcess(name, command, args, envOverrides = {}) {
  const spawnConfig = {
    cwd: ROOT,
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  };

  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `${command} ${args.join(" ")}`], spawnConfig)
      : spawn(command, args, spawnConfig);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}:err] ${chunk}`);
  });

  return child;
}

function stopProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }

    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => resolve());
    } else {
      child.kill("SIGTERM");
      resolve();
    }
  });
}

async function readState(page, scope = "minimal") {
  return page.evaluate((requestedScope) => {
    if (typeof window.render_game_state === "function") {
      const payload = window.render_game_state(requestedScope);
      if (payload && typeof payload === "object") {
        return payload;
      }
    }

    const text = window.render_game_to_text?.();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }, scope);
}

async function advanceTestTime(page, ms = MOVEMENT_POLL_MS) {
  if (!page || page.isClosed()) {
    return;
  }
  await page.evaluate((stepMs) => {
    if (typeof window.advanceTime === "function") {
      window.advanceTime(stepMs);
    }
  }, ms);
}

async function waitForConnectedState(page, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await advanceTestTime(page, MOVEMENT_POLL_MS);
    const state = await readState(page);
    if (state?.mode === "connected") {
      return state;
    }
    await delay(300);
  }
  throw new Error("Timed out waiting for connected state.");
}

async function waitForMinClientFps(page, label, minFps, timeoutMs, stableSamples) {
  const start = Date.now();
  let consecutive = 0;
  let lastFps = 0;
  while (Date.now() - start < timeoutMs) {
    await advanceTestTime(page, MOVEMENT_POLL_MS);
    const state = await readState(page);
    const fps = Number(state?.perf?.fps);
    if (Number.isFinite(fps)) {
      lastFps = fps;
      if (fps >= minFps) {
        consecutive += 1;
        if (consecutive >= stableSamples) {
          return state;
        }
      } else {
        consecutive = 0;
      }
    }
    await delay(MOVEMENT_POLL_MS);
  }
  throw new Error(
    `Timed out waiting for ${label} FPS >= ${minFps} (${stableSamples} samples). Last FPS=${lastFps.toFixed(2)}`
  );
}

function distance2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function findRemotePlayer(state, nid) {
  const remotes = state?.remotePlayers ?? [];
  if (typeof nid === "number") {
    const byNid = remotes.find((remote) => remote.nid === nid);
    if (byNid) {
      return byNid;
    }
  }
  return remotes[0] ?? null;
}

async function waitForLocalMovement(page, baseline, minDistance, timeoutMs) {
  const start = Date.now();
  let latestState = null;
  let latestDistance = 0;

  while (Date.now() - start < timeoutMs) {
    await advanceTestTime(page, MOVEMENT_POLL_MS);
    latestState = await readState(page);
    if (latestState?.player) {
      latestDistance = distance2D(
        latestState.player.x ?? 0,
        latestState.player.z ?? 0,
        baseline.x ?? 0,
        baseline.z ?? 0
      );
      if (latestDistance >= minDistance) {
        return { state: latestState, distance: latestDistance };
      }
    }
    await delay(MOVEMENT_POLL_MS);
  }

  return { state: latestState, distance: latestDistance };
}

async function waitForRemoteMovement(page, baselineRemote, targetNid, minDistance, timeoutMs, driverPage = null) {
  const start = Date.now();
  let latestState = null;
  let latestDistance = 0;

  while (Date.now() - start < timeoutMs) {
    if (driverPage) {
      await advanceTestTime(driverPage, MOVEMENT_POLL_MS);
    }
    await advanceTestTime(page, MOVEMENT_POLL_MS);
    latestState = await readState(page);
    const remote = findRemotePlayer(latestState, targetNid);
    if (remote) {
      latestDistance = distance2D(
        remote.x ?? 0,
        remote.z ?? 0,
        baselineRemote.x ?? 0,
        baselineRemote.z ?? 0
      );
      if (latestDistance >= minDistance) {
        return { state: latestState, distance: latestDistance };
      }
    }
    await delay(MOVEMENT_POLL_MS);
  }

  return { state: latestState, distance: latestDistance };
}

async function waitForRemotePresence(page, targetNid, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await advanceTestTime(page, MOVEMENT_POLL_MS);
    const state = await readState(page);
    const remote = findRemotePlayer(state, targetNid);
    if (remote) {
      return { state, remote };
    }
    await delay(MOVEMENT_POLL_MS);
  }
  return null;
}

async function waitForRemoteProjectileCountIncrease(
  page,
  baselineProjectileCount,
  timeoutMs,
  driverPage = null
) {
  const start = Date.now();
  let latestState = null;
  let latestProjectileCount = baselineProjectileCount;

  while (Date.now() - start < timeoutMs) {
    if (driverPage) {
      await advanceTestTime(driverPage, MOVEMENT_POLL_MS);
    }
    await advanceTestTime(page, MOVEMENT_POLL_MS);
    latestState = await readState(page, "full");
    const projectileCount = Array.isArray(latestState?.projectiles) ? latestState.projectiles.length : 0;
    latestProjectileCount = projectileCount;
    if (projectileCount > baselineProjectileCount) {
      return {
        state: latestState,
        projectileCount,
        triggered: true
      };
    }
    await delay(MOVEMENT_POLL_MS);
  }

  return {
    state: latestState,
    projectileCount: latestProjectileCount,
    triggered: false
  };
}

async function waitForJumpHeight(page, baselineY, minDelta, timeoutMs) {
  const start = Date.now();
  let latestState = null;
  let maxDelta = 0;
  const floor = typeof baselineY === "number" ? baselineY : 0;

  while (Date.now() - start < timeoutMs) {
    await advanceTestTime(page, MOVEMENT_POLL_MS);
    latestState = await readState(page);
    if (latestState?.player) {
      const delta = (latestState.player.y ?? 0) - floor;
      if (delta > maxDelta) {
        maxDelta = delta;
      }
      if (delta >= minDelta) {
        return { state: latestState, delta };
      }
    }
    await delay(MOVEMENT_POLL_MS);
  }

  return { state: latestState, delta: maxDelta };
}

async function runJumpAttempt(page, baselineY) {
  await page.evaluate(() => {
    window.set_test_movement({ forward: 0, strafe: 0, jump: true, sprint: false });
  });
  const result = await waitForJumpHeight(page, baselineY, MIN_JUMP_HEIGHT, JUMP_TIMEOUT_MS);
  await page.evaluate(() => {
    window.set_test_movement(null);
  });
  return result;
}

function profileStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function captureCpuProfiles(pageA, pageB, captureMs, metadata = {}) {
  ensureDir(PROFILE_DIR);
  const stamp = profileStamp();
  const nodeSession = new inspector.Session();
  nodeSession.connect();
  const postNodeProfiler = (method, params = {}) =>
    new Promise((resolve, reject) => {
      nodeSession.post(method, params, (error, result = {}) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });

  const cdpA = await pageA.context().newCDPSession(pageA);
  const cdpB = await pageB.context().newCDPSession(pageB);
  const captureStartedAt = Date.now();
  let iterations = 0;

  try {
    await postNodeProfiler("Profiler.enable");
    await postNodeProfiler("Profiler.start");
    await cdpA.send("Profiler.enable");
    await cdpB.send("Profiler.enable");
    await cdpA.send("Profiler.start");
    await cdpB.send("Profiler.start");

    await pageA.evaluate(() => {
      window.set_test_movement?.({ forward: 1, strafe: 0, jump: false, sprint: false });
    });

    const captureUntil = Date.now() + captureMs;
    while (Date.now() < captureUntil) {
      await advanceTestTime(pageA, MOVEMENT_POLL_MS);
      await advanceTestTime(pageB, MOVEMENT_POLL_MS);
      await readState(pageA);
      await readState(pageB);
      iterations += 1;
      await delay(MOVEMENT_POLL_MS);
    }
  } finally {
    try {
      await pageA.evaluate(() => {
        window.set_test_movement?.(null);
      });
    } catch {
      // ignore cleanup failures during profile capture teardown
    }
  }

  const browserAResult = await cdpA.send("Profiler.stop");
  const browserBResult = await cdpB.send("Profiler.stop");
  const nodeResult = await postNodeProfiler("Profiler.stop");
  await Promise.allSettled([
    cdpA.send("Profiler.disable"),
    cdpB.send("Profiler.disable"),
    postNodeProfiler("Profiler.disable")
  ]);
  nodeSession.disconnect();

  const captureActualMs = Date.now() - captureStartedAt;
  const prefix = `capture-${stamp}`;
  const nodeProfilePath = path.join(PROFILE_DIR, `${prefix}-node.cpuprofile`);
  const browserAProfilePath = path.join(PROFILE_DIR, `${prefix}-browser-a.cpuprofile`);
  const browserBProfilePath = path.join(PROFILE_DIR, `${prefix}-browser-b.cpuprofile`);
  const summaryPath = path.join(PROFILE_DIR, `${prefix}-summary.json`);

  fs.writeFileSync(nodeProfilePath, JSON.stringify(nodeResult.profile ?? {}, null, 2), "utf8");
  fs.writeFileSync(browserAProfilePath, JSON.stringify(browserAResult.profile ?? {}, null, 2), "utf8");
  fs.writeFileSync(browserBProfilePath, JSON.stringify(browserBResult.profile ?? {}, null, 2), "utf8");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        ...metadata,
        requestedCaptureMs: captureMs,
        actualCaptureMs: captureActualMs,
        loopIterations: iterations,
        approxLoopHz: captureActualMs > 0 ? Number((iterations / (captureActualMs / 1000)).toFixed(2)) : 0,
        files: {
          node: nodeProfilePath,
          browserA: browserAProfilePath,
          browserB: browserBProfilePath
        }
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `[multi] PROFILE captured ${captureActualMs}ms (requested ${captureMs}ms) iterations=${iterations} summary=${summaryPath}`
  );
}

function createPhaseTracker(enabled = true) {
  const phases = [];
  let activePhase = null;

  async function run(name, fn) {
    const phase = {
      name,
      startedAt: Date.now(),
      status: "running"
    };
    phases.push(phase);
    activePhase = phase;

    try {
      const result = await fn();
      phase.status = "ok";
      return result;
    } catch (error) {
      phase.status = "error";
      phase.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      phase.endedAt = Date.now();
      phase.durationMs = phase.endedAt - phase.startedAt;
      if (activePhase === phase) {
        activePhase = null;
      }
      if (enabled) {
        const suffix = phase.status === "error" ? ` error="${phase.error}"` : "";
        console.log(`[multi][phase] ${phase.name} ${phase.status} ${phase.durationMs}ms${suffix}`);
      }
    }
  }

  function getActivePhaseName() {
    return activePhase?.name ?? null;
  }

  function getPhases() {
    return phases.map((phase) => ({ ...phase }));
  }

  function printSummary() {
    if (!enabled || phases.length === 0) {
      return;
    }

    const totalMs = phases.reduce((sum, phase) => sum + (phase.durationMs ?? 0), 0);
    const top = [...phases]
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, 8)
      .map((phase) => `${phase.name}:${phase.durationMs ?? 0}ms`)
      .join(", ");
    console.log(`[multi][phase] summary totalPhaseMs=${totalMs} count=${phases.length} top=${top}`);
  }

  return {
    run,
    getActivePhaseName,
    getPhases,
    printSummary
  };
}

async function main() {
  ensureDir(OUTPUT_DIR);
  if (!process.env.SERVER_TICK_LOG) {
    process.env.SERVER_TICK_LOG = "0";
  }

  const runStartedAt = Date.now();
  const phaseTracker = createPhaseTracker(E2E_PHASE_TIMING_ENABLED);
  const managedProcesses = [];
  let serverUrl = "";
  let serverPort = 0;

  if (USE_EXISTING_SERVER) {
    await phaseTracker.run("server:validate-existing", async () => {
      serverUrl = EXISTING_SERVER_URL?.trim() || "ws://127.0.0.1:9001";
      const target = parseServerPort(serverUrl);
      if (!target) {
        throw new Error(`Invalid E2E_SERVER_URL: ${serverUrl}`);
      }
      const existingServerUp = await isPortOpen(target.host, target.port);
      if (!existingServerUp) {
        throw new Error(`E2E_USE_EXISTING_SERVER=1 but no server is reachable at ${serverUrl}`);
      }
      serverPort = target.port;
    });
  } else {
    await phaseTracker.run("server:allocate-port", async () => {
      serverPort = await getFreePort();
      serverUrl = `ws://127.0.0.1:${serverPort}`;
    });
  }

  const clientParams = new URLSearchParams({
    csp: CLIENT_CSP_QUERY,
    server: serverUrl,
    e2e: "1"
  });
  if (E2E_NETSIM_ENABLED) {
    clientParams.set("netsim", "1");
    clientParams.set("ackDrop", String(NETSIM_ACK_DROP));
    clientParams.set("ackDelayMs", String(NETSIM_ACK_DELAY_MS));
    clientParams.set("ackJitterMs", String(NETSIM_ACK_JITTER_MS));
  }
  if (E2E_SIM_ONLY) {
    clientParams.set("e2eSimOnly", "1");
  }
  const clientUrl = `${CLIENT_ORIGIN}?${clientParams.toString()}`;
  const clientAlreadyRunning = await isPortOpen("127.0.0.1", 5173);

  if (!USE_EXISTING_SERVER) {
    await phaseTracker.run("server:start-and-wait", async () => {
      const server = startProcess("server", "npm", ["run", "dev:server"], {
        SERVER_PORT: String(serverPort),
        SERVER_TICK_LOG: process.env.SERVER_TICK_LOG ?? "0"
      });
      managedProcesses.push(server);
      await waitForPortOpen("127.0.0.1", serverPort, SERVER_START_TIMEOUT_MS, "server");
    });
  } else {
    console.log(`[multi] using existing server at ${serverUrl}`);
  }

  if (USE_EXISTING_CLIENT) {
    await phaseTracker.run("client:validate-existing", async () => {
      if (!clientAlreadyRunning) {
        throw new Error("E2E_USE_EXISTING_CLIENT=1 but no client is reachable at http://127.0.0.1:5173");
      }
      console.log(`[multi] using existing client at ${CLIENT_ORIGIN}`);
      await delay(150);
    });
  } else if (!clientAlreadyRunning) {
    await phaseTracker.run("client:start-and-wait", async () => {
      const client = startProcess("client", "npm", [
        "run",
        "dev:client",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        "5173"
      ]);
      managedProcesses.push(client);
      await waitForPortOpen("127.0.0.1", 5173, CLIENT_START_TIMEOUT_MS, "client");
    });
  } else {
    await phaseTracker.run("client:reuse-existing", async () => {
      console.log(`[multi] using existing client at ${CLIENT_ORIGIN}`);
      await delay(150);
    });
  }

  let browserA;
  let browserB;
  let pageA = null;
  let pageB = null;
  let exitCode = 0;
  let beforeA = null;
  let beforeB = null;
  let afterA = null;
  let afterB = null;
  let movedDistanceA = null;
  let movedDistanceRemote = null;
  let sprintDistance = null;
  let jumpHeight = null;
  let primaryActionTriggered = null;
  let primaryActionNonce = null;
  let reconnectSeen = false;
  let reconnectedBState = null;
  let reconnectedRemoteState = null;
  let failureMessage = null;
  let phaseTimingPath = null;
  const logsA = [];
  const logsB = [];
  const walltimeGuard = setTimeout(() => {
    const elapsedMs = Date.now() - runStartedAt;
    const activePhase = phaseTracker.getActivePhaseName() ?? "none";
    console.error(
      `[multi] FAIL exceeded max wall-time of ${MAX_WALLTIME_MS}ms elapsedMs=${elapsedMs} activePhase=${activePhase}; forcing shutdown`
    );
    process.exit(124);
  }, MAX_WALLTIME_MS);
  if (typeof walltimeGuard.unref === "function") {
    walltimeGuard.unref();
  }

  try {
    browserA = await phaseTracker.run("browser-a:launch", async () =>
      chromium.launch({
        headless: E2E_HEADLESS,
        args: CHROMIUM_ANTI_THROTTLE_ARGS
      })
    );
    browserB = await phaseTracker.run("browser-b:launch", async () =>
      chromium.launch({
        headless: E2E_HEADLESS,
        args: CHROMIUM_ANTI_THROTTLE_ARGS
      })
    );
    pageA = await phaseTracker.run("browser-a:new-page", async () =>
      browserA.newPage({ viewport: { width: E2E_VIEWPORT_WIDTH, height: E2E_VIEWPORT_HEIGHT } })
    );
    pageB = await phaseTracker.run("browser-b:new-page", async () =>
      browserB.newPage({ viewport: { width: E2E_VIEWPORT_WIDTH, height: E2E_VIEWPORT_HEIGHT } })
    );
    pageA.on("console", (msg) => {
      logsA.push({ type: msg.type(), text: msg.text() });
    });
    pageB.on("console", (msg) => {
      logsB.push({ type: msg.type(), text: msg.text() });
    });

    await phaseTracker.run("page-a:goto", async () => {
      await pageA.goto(clientUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    });
    await phaseTracker.run("page-b:goto", async () => {
      await pageB.goto(clientUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    });
    await phaseTracker.run("pages:initial-focus", async () => {
      await pageA.mouse.click(640, 360);
      await pageB.mouse.click(640, 360);
      await pageA.waitForTimeout(350);
      await pageB.waitForTimeout(350);
    });

    const initialA = await phaseTracker.run("connect:wait-a", async () => waitForConnectedState(pageA));
    const initialB = await phaseTracker.run("connect:wait-b", async () => waitForConnectedState(pageB));

    const hookStatusA = await phaseTracker.run("hooks:status-a", async () =>
      pageA.evaluate(() => ({
        render: typeof window.render_game_to_text,
        advance: typeof window.advanceTime,
        testMovement: typeof window.set_test_movement,
        testPrimaryAction: typeof window.trigger_test_primary_action
      }))
    );
    const hookStatusB = await phaseTracker.run("hooks:status-b", async () =>
      pageB.evaluate(() => ({
        render: typeof window.render_game_to_text,
        advance: typeof window.advanceTime,
        testMovement: typeof window.set_test_movement,
        testPrimaryAction: typeof window.trigger_test_primary_action
      }))
    );
    if (hookStatusA.testMovement !== "function" || hookStatusB.testMovement !== "function") {
      throw new Error(
        `Missing test movement hook. pageA=${JSON.stringify(hookStatusA)} pageB=${JSON.stringify(hookStatusB)}`
      );
    }

    beforeA = (await phaseTracker.run("state:baseline-a", async () => readState(pageA))) ?? initialA;
    beforeB = (await phaseTracker.run("state:baseline-b", async () => readState(pageB))) ?? initialB;
    const aNid = beforeA.player?.nid;
    if (typeof aNid !== "number") {
      throw new Error("Client A missing local player NID.");
    }
    const remotePresence = await phaseTracker.run("presence:wait-a-on-b", async () =>
      waitForRemotePresence(pageB, aNid, 12000)
    );
    if (!remotePresence) {
      throw new Error("Could not find client A in client B remote player list after connect.");
    }
    beforeB = remotePresence.state ?? beforeB;
    const localA = beforeA.player;
    const localB = beforeB.player;
    if (!localA) {
      throw new Error("Client A missing local player state after connect.");
    }
    if (!localB) {
      throw new Error("Client B missing local player state after connect.");
    }
    const initialSeparation = distance2D(localA.x ?? 0, localA.z ?? 0, localB.x ?? 0, localB.z ?? 0);
    if (initialSeparation < MIN_SPAWN_SEPARATION) {
      throw new Error(
        `Spawn separation too small: expected >=${MIN_SPAWN_SEPARATION.toFixed(2)}, got ${initialSeparation.toFixed(3)}`
      );
    }

    if (E2E_PROFILE_CAPTURE_MS > 0) {
      await phaseTracker.run("profile:capture-cpu", async () =>
        captureCpuProfiles(pageA, pageB, E2E_PROFILE_CAPTURE_MS, {
          mode: "profile-only",
          serverUrl,
          headless: E2E_HEADLESS,
          simOnly: E2E_SIM_ONLY,
          movementPollMs: MOVEMENT_POLL_MS
        })
      );
      console.log("[multi] PROFILE_ONLY done; exiting before functional assertions by design.");
      return;
    }

    await phaseTracker.run("movement:prep-a", async () => {
      await pageA.bringToFront();
      await pageA.mouse.click(640, 360);
      if (MIN_CLIENT_FPS > 0) {
        await waitForMinClientFps(
          pageA,
          "client A",
          MIN_CLIENT_FPS,
          FPS_STABILIZATION_TIMEOUT_MS,
          FPS_STABLE_SAMPLE_COUNT
        );
      }
      await pageA.waitForTimeout(120);
      beforeA = (await readState(pageA)) ?? beforeA;
      await pageA.evaluate(() => {
        window.set_test_movement({ forward: 1, strafe: 0, jump: false, sprint: false });
      });
    });
    const localMove = await phaseTracker.run("movement:local-a", async () =>
      waitForLocalMovement(
        pageA,
        beforeA.player ?? { x: 0, z: 0 },
        MIN_REQUIRED_LOCAL_MOVEMENT,
        LOCAL_MOVEMENT_TIMEOUT_MS
      )
    );
    movedDistanceA = localMove.distance;
    afterA = localMove.state;

    await phaseTracker.run("movement:prep-b", async () => {
      await pageB.bringToFront();
      await pageB.mouse.click(640, 360);
      if (MIN_CLIENT_FPS > 0) {
        await waitForMinClientFps(
          pageB,
          "client B",
          MIN_CLIENT_FPS,
          FPS_STABILIZATION_TIMEOUT_MS,
          FPS_STABLE_SAMPLE_COUNT
        );
      }
      await pageB.waitForTimeout(120);
      beforeB = (await readState(pageB)) ?? beforeB;
    });

    const remoteBeforeOnB = findRemotePlayer(beforeB, aNid);
    if (!remoteBeforeOnB) {
      throw new Error("Could not find client A in client B remote player list before movement.");
    }

    const remoteMove = await phaseTracker.run("movement:remote-b", async () => {
      try {
        return await waitForRemoteMovement(
          pageB,
          remoteBeforeOnB,
          aNid,
          MIN_REQUIRED_REMOTE_MOVEMENT,
          REMOTE_MOVEMENT_TIMEOUT_MS,
          pageA
        );
      } finally {
        await pageA.evaluate(() => {
          window.set_test_movement(null);
        });
      }
    });
    movedDistanceRemote = remoteMove.distance;
    afterB = remoteMove.state;

    if (E2E_ENABLE_PRIMARY_ACTION_TEST) {
      const actionResult = await phaseTracker.run("action:primary-remote", async () => {
        await pageA.bringToFront();
        await pageA.mouse.click(640, 360);
        await pageA.waitForTimeout(120);

        // Select slot 1 (projectile) so remote visibility can be asserted via projectile replication.
        await pageA.keyboard.press("Digit1");
        await pageA.waitForTimeout(60);

        const baselineActionState = (await readState(pageB, "full")) ?? afterB ?? beforeB;
        const baselineProjectileCount = Array.isArray(baselineActionState?.projectiles)
          ? baselineActionState.projectiles.length
          : 0;

        if (hookStatusA.testPrimaryAction === "function") {
          await pageA.evaluate(() => {
            window.trigger_test_primary_action?.(1);
          });
          await advanceTestTime(pageA, MOVEMENT_POLL_MS);
        } else {
          await pageA.mouse.down({ button: "left" });
          await pageA.waitForTimeout(24);
          await pageA.mouse.up({ button: "left" });
        }

        await pageB.bringToFront();
        await pageB.mouse.click(640, 360);
        await pageB.waitForTimeout(90);

        const result = await waitForRemoteProjectileCountIncrease(
          pageB,
          baselineProjectileCount,
          PRIMARY_ACTION_TIMEOUT_MS,
          pageA
        );
        return {
          ...result,
          baselineProjectileCount
        };
      });
      primaryActionTriggered = actionResult.triggered;
      primaryActionNonce = actionResult.projectileCount;
      afterB = actionResult.state ?? afterB;

      if (!primaryActionTriggered) {
        throw new Error(
          `Expected remote projectile count to increase from ${actionResult.baselineProjectileCount}, got ${primaryActionNonce}.`
        );
      }
    }

    if (E2E_ENABLE_SPRINT_TEST) {
      const sprintResult = await phaseTracker.run("movement:sprint-a", async () => {
        await pageA.bringToFront();
        await pageA.mouse.click(640, 360);
        await pageA.waitForTimeout(120);
        const sprintBaseline = afterA?.player ?? beforeA?.player ?? { x: 0, z: 0 };
        await pageA.evaluate(() => {
          window.set_test_movement({ forward: 1, strafe: 0, jump: false, sprint: true });
        });
        const result = await waitForLocalMovement(
          pageA,
          sprintBaseline,
          MIN_REQUIRED_SPRINT_MOVEMENT,
          SPRINT_MOVEMENT_TIMEOUT_MS
        );
        await pageA.evaluate(() => {
          window.set_test_movement(null);
        });
        return result;
      });
      sprintDistance = sprintResult.distance;
      afterA = sprintResult.state ?? afterA;
      if (sprintDistance === null || sprintDistance < MIN_REQUIRED_SPRINT_MOVEMENT) {
        throw new Error(
          `Sprint input failed to accelerate: expected >=${MIN_REQUIRED_SPRINT_MOVEMENT.toFixed(
            2
          )} units, got ${(sprintDistance ?? 0).toFixed(3)}`
        );
      }
      await phaseTracker.run("movement:sprint-cooldown", async () => {
        await pageA.waitForTimeout(400);
      });
    }

    if (E2E_ENABLE_JUMP_TEST) {
      const jumpResult = await phaseTracker.run("movement:jump-a", async () => {
        await pageA.bringToFront();
        await pageA.mouse.click(640, 360);
        await pageA.waitForTimeout(120);
        const jumpBaselineY = afterA?.player?.y ?? beforeA?.player?.y ?? 0;
        let result = await runJumpAttempt(pageA, jumpBaselineY);
        if ((result.delta ?? 0) < MIN_JUMP_HEIGHT) {
          await pageA.waitForTimeout(JUMP_RETRY_SETTLE_MS);
          const retryBaselineY = (await readState(pageA))?.player?.y ?? jumpBaselineY;
          result = await runJumpAttempt(pageA, retryBaselineY);
        }
        return result;
      });
      jumpHeight = jumpResult.delta;
      afterA = jumpResult.state ?? afterA;
      if (jumpHeight === null || jumpHeight < MIN_JUMP_HEIGHT) {
        throw new Error(
          `Jump input failed to gain height: expected >=${MIN_JUMP_HEIGHT.toFixed(2)} units, got ${(jumpHeight ?? 0).toFixed(3)}`
        );
      }
      await phaseTracker.run("movement:jump-cooldown", async () => {
        await pageA.waitForTimeout(600);
      });
    }

    if (E2E_ENABLE_RECONNECT_TEST) {
      await phaseTracker.run("reconnect:b", async () => {
        if (pageB && !pageB.isClosed()) {
          await pageB.close();
          pageB = null;
        }
        await delay(PAGE_RECONNECT_COOLDOWN_MS);

        pageB = await browserB.newPage({ viewport: { width: 1280, height: 720 } });
        pageB.on("console", (msg) => {
          logsB.push({ type: msg.type(), text: msg.text() });
        });
        await pageB.goto(clientUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await pageB.bringToFront();
        await pageB.mouse.click(640, 360);
        await pageB.waitForTimeout(350);

        reconnectedBState = await waitForConnectedState(pageB);
        if (!reconnectedBState.player) {
          throw new Error("Reconnected client B missing local player state.");
        }
        const rehookStatusB = await pageB.evaluate(() => ({
          testMovement: typeof window.set_test_movement
        }));
        if (rehookStatusB.testMovement !== "function") {
          throw new Error("Reconnected client B missing test movement hook.");
        }

        const reconnectedRemote = await waitForRemotePresence(
          pageA,
          reconnectedBState.player.nid,
          DISCONNECT_RECONNECT_TIMEOUT_MS
        );
        if (!reconnectedRemote) {
          throw new Error("Client A never saw client B after reconnect.");
        }
        reconnectSeen = true;
        reconnectedRemoteState = reconnectedRemote.state;
        afterA = reconnectedRemote.state ?? afterA;
        afterB = reconnectedBState;
      });
    }

    if (!afterA) {
      afterA = await phaseTracker.run("state:final-a", async () => readState(pageA));
    }
    if (!afterB) {
      afterB = await phaseTracker.run("state:final-b", async () => readState(pageB));
    }

    if (!afterA || !afterB) {
      throw new Error("Missing post-move state payload.");
    }

    if (movedDistanceA < MIN_REQUIRED_LOCAL_MOVEMENT) {
      throw new Error(
        `Expected client A to move by >=${MIN_REQUIRED_LOCAL_MOVEMENT.toFixed(1)} units, got ${movedDistanceA.toFixed(3)}`
      );
    }

    if (movedDistanceRemote < MIN_REQUIRED_REMOTE_MOVEMENT) {
      throw new Error(
        `Expected remote movement on client B by >=${MIN_REQUIRED_REMOTE_MOVEMENT.toFixed(2)} units, got ${movedDistanceRemote.toFixed(3)}`
      );
    }

    console.log(
      `[multi] PASS server=${serverUrl} movedA=${movedDistanceA.toFixed(2)} movedRemote=${movedDistanceRemote.toFixed(
        2
      )} primary=${E2E_ENABLE_PRIMARY_ACTION_TEST ? String(primaryActionTriggered) : "skipped"} sprint=${
        E2E_ENABLE_SPRINT_TEST ? (sprintDistance ?? 0).toFixed(2) : "skipped"
      } jump=${E2E_ENABLE_JUMP_TEST ? (jumpHeight ?? 0).toFixed(2) : "skipped"} reconnect=${
        E2E_ENABLE_RECONNECT_TEST ? String(reconnectSeen) : "skipped"
      }`
    );
  } catch (error) {
    exitCode = 1;
    failureMessage = error instanceof Error ? error.message : String(error);
    console.error("[multi] FAIL", error);
  } finally {
    clearTimeout(walltimeGuard);
    const totalDurationMs = Date.now() - runStartedAt;
    const shouldWriteArtifacts = exitCode === 0 ? ARTIFACTS_ON_PASS : ARTIFACTS_ON_FAIL;
    if (browserA || browserB) {
      if (shouldWriteArtifacts) {
        try {
          if (pageA && !pageA.isClosed()) {
            if (!afterA) {
              afterA = await readState(pageA);
            }
            await pageA.screenshot({ path: path.join(OUTPUT_DIR, "client-a.png"), fullPage: true });
          }
          if (pageB && !pageB.isClosed()) {
            if (!afterB) {
              afterB = await readState(pageB);
            }
            await pageB.screenshot({ path: path.join(OUTPUT_DIR, "client-b.png"), fullPage: true });
          }
        } catch (artifactError) {
          console.warn("[multi] warning: failed to capture debug artifacts", artifactError);
        }
      }
      if (browserA) {
        await browserA.close();
      }
      if (browserB) {
        await browserB.close();
      }
    }

    if (E2E_PHASE_TIMING_ENABLED) {
      ensureDir(PROFILE_DIR);
      phaseTimingPath = path.join(PROFILE_DIR, `phase-${profileStamp()}.json`);
      const phasePayload = {
        generatedAt: new Date().toISOString(),
        exitCode,
        failureMessage,
        totalDurationMs,
        activePhaseAtExit: phaseTracker.getActivePhaseName(),
        mode: E2E_PROFILE_CAPTURE_MS > 0 ? "profile-only" : "functional",
        config: {
          serverUrl,
          useExistingServer: USE_EXISTING_SERVER,
          useExistingClient: USE_EXISTING_CLIENT,
          headless: E2E_HEADLESS,
          simOnly: E2E_SIM_ONLY,
          movementPollMs: MOVEMENT_POLL_MS
        },
        phases: phaseTracker.getPhases()
      };
      fs.writeFileSync(phaseTimingPath, JSON.stringify(phasePayload, null, 2), "utf8");
      phaseTracker.printSummary();
      console.log(`[multi] PHASE_TIMING ${phaseTimingPath}`);
    }

    if (shouldWriteArtifacts) {
      const summary = {
        beforeA,
        beforeB,
        afterA,
        afterB,
        movedDistanceA,
        movedDistanceRemote,
        primaryActionTriggered,
        primaryActionNonce,
        sprintDistance,
        jumpHeight,
        reconnectSeen,
        reconnectedBState,
        reconnectedRemoteState,
        checks: {
          primaryActionEnabled: E2E_ENABLE_PRIMARY_ACTION_TEST,
          sprintEnabled: E2E_ENABLE_SPRINT_TEST,
          jumpEnabled: E2E_ENABLE_JUMP_TEST,
          reconnectEnabled: E2E_ENABLE_RECONNECT_TEST
        },
        totalDurationMs,
        phaseTimingPath,
        error: failureMessage
      };
      fs.writeFileSync(path.join(OUTPUT_DIR, "state.json"), JSON.stringify(summary, null, 2), "utf8");
      fs.writeFileSync(path.join(OUTPUT_DIR, "console-a.json"), JSON.stringify(logsA, null, 2), "utf8");
      fs.writeFileSync(path.join(OUTPUT_DIR, "console-b.json"), JSON.stringify(logsB, null, 2), "utf8");
    }

    console.log(`[multi] DURATION totalMs=${totalDurationMs} exitCode=${exitCode}`);

    for (const child of managedProcesses) {
      await stopProcessTree(child);
    }
    await delay(250);
    process.exit(exitCode);
  }
}
void main();

