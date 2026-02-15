import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, execFile } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output", "melee");
const CLIENT_URL = process.env.E2E_CLIENT_URL ?? "http://127.0.0.1:5173";
const SERVER_URL = "ws://127.0.0.1:9001";
const SERVER_START_TIMEOUT_MS = 18000;
const CLIENT_START_TIMEOUT_MS = 22000;
const CONNECT_TIMEOUT_MS = 12000;
const APPROACH_TIMEOUT_MS = 18000;
const DAMAGE_TIMEOUT_MS = 3000;

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

function startProcess(name, command, args) {
  const spawnConfig = {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  };
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `${command} ${args.join(" ")}`], spawnConfig)
      : spawn(command, args, spawnConfig);
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}:err] ${chunk}`));
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
      return;
    }
    child.kill("SIGTERM");
    resolve();
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

async function waitForConnectedState(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readState(page);
    if (state?.mode === "connected") {
      return state;
    }
    await delay(120);
  }
  throw new Error("Timed out waiting for connected state.");
}

async function approachTrainingDummy(page) {
  const start = Date.now();
  while (Date.now() - start < APPROACH_TIMEOUT_MS) {
    const state = await readState(page);
    const player = state?.player;
    const dummy = state?.trainingDummies?.[0];
    if (!player || !dummy) {
      await delay(100);
      continue;
    }
    const dx = dummy.x - player.x;
    const dz = dummy.z - player.z;
    const distance = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    await page.evaluate(
      ({ nextYaw }) => {
        window.set_test_look_angles?.(nextYaw, 0);
      },
      { nextYaw: yaw }
    );
    if (distance <= 1.7) {
      await page.evaluate(() => {
        window.set_test_movement?.(null);
      });
      return;
    }
    await page.evaluate(() => {
      window.set_test_movement?.({ forward: 1, strafe: 0, jump: false, sprint: false });
      window.advanceTime?.(80);
    });
  }
  throw new Error("Timed out while approaching training dummy.");
}

async function waitForDummyHealthBelow(page, baselineHealth, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readState(page);
    const dummy = state?.trainingDummies?.[0];
    if (dummy && typeof dummy.health === "number" && dummy.health < baselineHealth) {
      return dummy.health;
    }
    await page.evaluate(() => {
      window.advanceTime?.(60);
    });
  }
  throw new Error(`Timed out waiting for dummy health to drop below ${baselineHealth}.`);
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const managedProcesses = [];
  let browser;
  let page;
  let exitCode = 0;
  const logs = [];
  let finalState = null;

  try {
    const serverAlreadyRunning = await isPortOpen("127.0.0.1", 9001);
    const clientAlreadyRunning = await isPortOpen("127.0.0.1", 5173);
    if (!serverAlreadyRunning) {
      managedProcesses.push(startProcess("server", "npm", ["run", "dev:server"]));
      await waitForPortOpen("127.0.0.1", 9001, SERVER_START_TIMEOUT_MS, "server");
    } else {
      console.log(`[melee] using existing server at ${SERVER_URL}`);
    }
    if (!clientAlreadyRunning) {
      managedProcesses.push(startProcess("client", "npm", ["run", "dev:client", "--", "--host", "127.0.0.1", "--port", "5173"]));
      await waitForPortOpen("127.0.0.1", 5173, CLIENT_START_TIMEOUT_MS, "client");
    } else {
      console.log(`[melee] using existing client at ${CLIENT_URL}`);
    }

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (msg) => logs.push({ type: msg.type(), text: msg.text() }));
    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.mouse.click(640, 360);
    await waitForConnectedState(page, CONNECT_TIMEOUT_MS);
    await page.keyboard.press("Digit2");
    await page.waitForTimeout(120);

    await approachTrainingDummy(page);
    const preAttackState = await readState(page);
    const dummyBefore = preAttackState?.trainingDummies?.[0];
    if (!dummyBefore || typeof dummyBefore.health !== "number") {
      throw new Error("Training dummy state unavailable.");
    }

    await page.evaluate(() => {
      window.trigger_test_primary_action?.(1);
      window.advanceTime?.(80);
    });
    const afterSingleHit = await waitForDummyHealthBelow(page, dummyBefore.health, DAMAGE_TIMEOUT_MS);

    await page.evaluate(() => {
      window.set_test_primary_hold?.(true);
    });
    const holdStart = Date.now();
    while (Date.now() - holdStart < 1500) {
      await page.evaluate(() => {
        window.advanceTime?.(80);
      });
      await delay(80);
    }
    await page.evaluate(() => {
      window.set_test_primary_hold?.(false);
      window.set_test_movement?.(null);
    });
    finalState = await readState(page);
    const dummyAfterHold = finalState?.trainingDummies?.[0];
    if (!dummyAfterHold || typeof dummyAfterHold.health !== "number") {
      throw new Error("Training dummy state unavailable after hold test.");
    }
    if (!(dummyAfterHold.health < afterSingleHit)) {
      throw new Error("Expected hold-repeat melee attacks to further reduce dummy health.");
    }

    const hasFatalConsoleError = logs.some(
      (entry) =>
        entry.type === "error" &&
        !entry.text.includes("ERR_CONNECTION_REFUSED") &&
        !entry.text.includes("WebSocket connection")
    );
    if (hasFatalConsoleError) {
      throw new Error("Console contained runtime errors.");
    }

    console.log(
      `[melee] PASS dummyHealth ${dummyBefore.health} -> ${afterSingleHit} -> ${dummyAfterHold.health}`
    );
  } catch (error) {
    exitCode = 1;
    console.error("[melee] FAIL", error);
  } finally {
    if (page) {
      try {
        if (!finalState) {
          finalState = await readState(page);
        }
        await page.screenshot({ path: path.join(OUTPUT_DIR, "melee.png"), fullPage: true });
      } catch {
        // best-effort artifacts only
      }
    }
    fs.writeFileSync(path.join(OUTPUT_DIR, "state.json"), JSON.stringify(finalState ?? null), "utf8");
    fs.writeFileSync(path.join(OUTPUT_DIR, "console.json"), JSON.stringify(logs, null, 2), "utf8");
    if (browser) {
      await browser.close();
    }
    for (const child of managedProcesses) {
      await stopProcessTree(child);
    }
    await delay(250);
    process.exit(exitCode);
  }
}

void main();
