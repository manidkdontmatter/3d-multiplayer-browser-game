import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output", "multiplayer");
const CLIENT_ORIGIN = "http://127.0.0.1:5173";
const MIN_REQUIRED_LOCAL_MOVEMENT = 1.0;
const MIN_REQUIRED_REMOTE_MOVEMENT = 0.75;
const MIN_SPAWN_SEPARATION = 0.9;
const MOVEMENT_POLL_MS = 120;
const LOCAL_MOVEMENT_TIMEOUT_MS = 15000;
const REMOTE_MOVEMENT_TIMEOUT_MS = 15000;
const E2E_CSP_ENABLED = process.env.E2E_CSP === "1";
const CLIENT_CSP_QUERY = E2E_CSP_ENABLED ? "1" : "0";
const MIN_REQUIRED_SPRINT_MOVEMENT = 1.4;
const SPRINT_MOVEMENT_TIMEOUT_MS = 9000;
const MIN_JUMP_HEIGHT = 0.55;
const JUMP_TIMEOUT_MS = 9000;
const DISCONNECT_RECONNECT_TIMEOUT_MS = 12000;
const PAGE_RECONNECT_COOLDOWN_MS = 2200;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function readState(page) {
  return page.evaluate(() => {
    const text = window.render_game_to_text?.();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
}

async function waitForConnectedState(page, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readState(page);
    if (state?.mode === "connected") {
      return state;
    }
    await delay(300);
  }
  throw new Error("Timed out waiting for connected state.");
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

async function waitForRemoteMovement(page, baselineRemote, targetNid, minDistance, timeoutMs) {
  const start = Date.now();
  let latestState = null;
  let latestDistance = 0;

  while (Date.now() - start < timeoutMs) {
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
    const state = await readState(page);
    const remote = findRemotePlayer(state, targetNid);
    if (remote) {
      return { state, remote };
    }
    await delay(MOVEMENT_POLL_MS);
  }
  return null;
}

async function waitForJumpHeight(page, baselineY, minDelta, timeoutMs) {
  const start = Date.now();
  let latestState = null;
  let maxDelta = 0;
  const floor = typeof baselineY === "number" ? baselineY : 0;

  while (Date.now() - start < timeoutMs) {
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

async function main() {
  ensureDir(OUTPUT_DIR);
  if (!process.env.SERVER_TICK_LOG) {
    process.env.SERVER_TICK_LOG = "0";
  }
  const managedProcesses = [];
  const serverPort = await getFreePort();
  const serverUrl = `ws://127.0.0.1:${serverPort}`;
  const clientUrl = `${CLIENT_ORIGIN}?csp=${CLIENT_CSP_QUERY}&server=${encodeURIComponent(serverUrl)}`;
  const clientAlreadyRunning = await isPortOpen("127.0.0.1", 5173);

  const server = startProcess("server", "npm", ["run", "dev:server"], {
    SERVER_PORT: String(serverPort),
    SERVER_TICK_LOG: process.env.SERVER_TICK_LOG ?? "0"
  });
  managedProcesses.push(server);
  await delay(3500);

  if (!clientAlreadyRunning) {
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
    await delay(6000);
  } else {
    console.log(`[multi] using existing client at ${CLIENT_ORIGIN}`);
    await delay(1000);
  }

  let browser;
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
  let reconnectSeen = false;
  let reconnectedBState = null;
  let reconnectedRemoteState = null;
  let failureMessage = null;
  const logsA = [];
  const logsB = [];

  try {
    browser = await chromium.launch({ headless: true });
    pageA = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    pageB = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    pageA.on("console", (msg) => {
      logsA.push({ type: msg.type(), text: msg.text() });
    });
    pageB.on("console", (msg) => {
      logsB.push({ type: msg.type(), text: msg.text() });
    });

    await pageA.goto(clientUrl, { waitUntil: "networkidle", timeout: 30000 });
    await pageB.goto(clientUrl, { waitUntil: "networkidle", timeout: 30000 });
    await pageA.mouse.click(640, 360);
    await pageB.mouse.click(640, 360);
    await pageA.waitForTimeout(1400);
    await pageB.waitForTimeout(1400);

    const initialA = await waitForConnectedState(pageA);
    const initialB = await waitForConnectedState(pageB);

    const hookStatusA = await pageA.evaluate(() => ({
      render: typeof window.render_game_to_text,
      advance: typeof window.advanceTime,
      testMovement: typeof window.set_test_movement
    }));
    const hookStatusB = await pageB.evaluate(() => ({
      render: typeof window.render_game_to_text,
      advance: typeof window.advanceTime,
      testMovement: typeof window.set_test_movement
    }));
    if (hookStatusA.testMovement !== "function" || hookStatusB.testMovement !== "function") {
      throw new Error(
        `Missing test movement hook. pageA=${JSON.stringify(hookStatusA)} pageB=${JSON.stringify(hookStatusB)}`
      );
    }

    beforeA = initialA;
    beforeB = initialB;
    const aNid = beforeA.player?.nid;
    if (typeof aNid !== "number") {
      throw new Error("Client A missing local player NID.");
    }
    const remotePresence = await waitForRemotePresence(pageB, aNid, 12000);
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

    // Keep A foregrounded during movement input to avoid background-tab throttling.
    await pageA.bringToFront();
    await pageA.mouse.click(640, 360);
    await pageA.waitForTimeout(120);

    await pageA.evaluate(() => {
      window.set_test_movement({ forward: 1, strafe: 0, jump: false, sprint: false });
    });
    const localMove = await waitForLocalMovement(
      pageA,
      beforeA.player ?? { x: 0, z: 0 },
      MIN_REQUIRED_LOCAL_MOVEMENT,
      LOCAL_MOVEMENT_TIMEOUT_MS
    );
    await pageA.evaluate(() => {
      window.set_test_movement(null);
    });
    movedDistanceA = localMove.distance;
    afterA = localMove.state;

    // Then foreground B to observe replicated movement updates.
    await pageB.bringToFront();
    await pageB.mouse.click(640, 360);
    await pageB.waitForTimeout(120);

    const remoteBeforeOnB = findRemotePlayer(beforeB, aNid);
    if (!remoteBeforeOnB) {
      throw new Error("Could not find client A in client B remote player list before movement.");
    }

    const remoteMove = await waitForRemoteMovement(
      pageB,
      remoteBeforeOnB,
      aNid,
      MIN_REQUIRED_REMOTE_MOVEMENT,
      REMOTE_MOVEMENT_TIMEOUT_MS
    );
    movedDistanceRemote = remoteMove.distance;
    afterB = remoteMove.state;

    await pageA.bringToFront();
    await pageA.mouse.click(640, 360);
    await pageA.waitForTimeout(120);
    const sprintBaseline = afterA?.player ?? beforeA?.player ?? { x: 0, z: 0 };
    await pageA.evaluate(() => {
      window.set_test_movement({ forward: 1, strafe: 0, jump: false, sprint: true });
    });
    const sprintResult = await waitForLocalMovement(
      pageA,
      sprintBaseline,
      MIN_REQUIRED_SPRINT_MOVEMENT,
      SPRINT_MOVEMENT_TIMEOUT_MS
    );
    await pageA.evaluate(() => {
      window.set_test_movement(null);
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
    await pageA.waitForTimeout(400);

    await pageA.bringToFront();
    await pageA.mouse.click(640, 360);
    await pageA.waitForTimeout(120);
    const jumpBaselineY = afterA?.player?.y ?? beforeA?.player?.y ?? 0;
    await pageA.evaluate(() => {
      window.set_test_movement({ forward: 0, strafe: 0, jump: true, sprint: false });
    });
    const jumpResult = await waitForJumpHeight(
      pageA,
      jumpBaselineY,
      MIN_JUMP_HEIGHT,
      JUMP_TIMEOUT_MS
    );
    await pageA.evaluate(() => {
      window.set_test_movement(null);
    });
    jumpHeight = jumpResult.delta;
    afterA = jumpResult.state ?? afterA;
    if (jumpHeight === null || jumpHeight < MIN_JUMP_HEIGHT) {
      throw new Error(
        `Jump input failed to gain height: expected >=${MIN_JUMP_HEIGHT.toFixed(
          2
        )} units, got ${(jumpHeight ?? 0).toFixed(3)}`
      );
    }
    await pageA.waitForTimeout(600);

    if (pageB && !pageB.isClosed()) {
      await pageB.close();
      pageB = null;
    }
    await delay(PAGE_RECONNECT_COOLDOWN_MS);

    pageB = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    pageB.on("console", (msg) => {
      logsB.push({ type: msg.type(), text: msg.text() });
    });
    await pageB.goto(clientUrl, { waitUntil: "networkidle", timeout: 30000 });
    await pageB.bringToFront();
    await pageB.mouse.click(640, 360);
    await pageB.waitForTimeout(1400);

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

    if (!afterA) {
      afterA = await readState(pageA);
    }
    if (!afterB) {
      afterB = await readState(pageB);
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
      )} sprint=${(sprintDistance ?? 0).toFixed(2)} jump=${(jumpHeight ?? 0).toFixed(2)} reconnect=${reconnectSeen}`
    );
  } catch (error) {
    exitCode = 1;
    failureMessage = error instanceof Error ? error.message : String(error);
    console.error("[multi] FAIL", error);
  } finally {
    if (browser) {
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
      await browser.close();
    }

    const summary = {
      beforeA,
      beforeB,
      afterA,
      afterB,
      movedDistanceA,
      movedDistanceRemote,
      sprintDistance,
      jumpHeight,
      reconnectSeen,
      reconnectedBState,
      reconnectedRemoteState,
      error: failureMessage
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, "state.json"), JSON.stringify(summary, null, 2), "utf8");
    fs.writeFileSync(path.join(OUTPUT_DIR, "console-a.json"), JSON.stringify(logsA, null, 2), "utf8");
    fs.writeFileSync(path.join(OUTPUT_DIR, "console-b.json"), JSON.stringify(logsB, null, 2), "utf8");

    for (const child of managedProcesses) {
      await stopProcessTree(child);
    }
    await delay(600);
    process.exit(exitCode);
  }
}

void main();
