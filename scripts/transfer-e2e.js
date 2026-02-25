// End-to-end transfer test that verifies client can move from map-a to map-b through orchestrator handoff.
import process from "node:process";
import net from "node:net";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { chromium } from "playwright";

const CLIENT_URL = "http://127.0.0.1:5173";
const ORCH_PORT = 9000;
const CLIENT_PORT = 5173;
const SERVER_START_TIMEOUT_MS = 20000;
const CLIENT_START_TIMEOUT_MS = 22000;
const CONNECT_TIMEOUT_MS = 12000;
const TRANSFER_TIMEOUT_MS = 12000;
const ROOT = process.cwd();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortOpen(host, port, timeoutMs = 500) {
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
    await delay(120);
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
  try {
    return await page.evaluate(() => {
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
  } catch {
    // During full-page reload transfer, execution context can briefly disappear.
    return null;
  }
}

async function waitForPageReadyAfterTransfer(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (!page.isClosed()) {
        await page.waitForLoadState("domcontentloaded", { timeout: 350 });
      }
      return;
    } catch {
      await delay(80);
    }
  }
  throw new Error("Timed out waiting for page reload after transfer.");
}

async function waitForConnected(page, timeoutMs) {
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

async function waitForMapInstance(page, instanceId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readState(page);
    if (state?.mode === "connected" && state?.map?.instanceId === instanceId) {
      return state;
    }
    await delay(120);
  }
  throw new Error(`Timed out waiting for map instance '${instanceId}'.`);
}

async function waitForLocalPlayerNid(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readState(page);
    if (state?.mode === "connected" && state?.player && typeof state.player.nid === "number") {
      return state;
    }
    await delay(120);
  }
  throw new Error("Timed out waiting for local player identity after transfer.");
}

async function main() {
  const managed = [];
  const existingServer = await isPortOpen("127.0.0.1", ORCH_PORT);
  if (!existingServer) {
    const server = startProcess("server", "npm", ["run", "dev:server"]);
    managed.push(server);
    await waitForPortOpen("127.0.0.1", ORCH_PORT, SERVER_START_TIMEOUT_MS, "orchestrator");
  }
  const existingClient = await isPortOpen("127.0.0.1", CLIENT_PORT);
  if (!existingClient) {
    const client = startProcess("client", "npm", [
      "run",
      "dev:client",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(CLIENT_PORT),
      "--strictPort"
    ]);
    managed.push(client);
    await waitForPortOpen("127.0.0.1", CLIENT_PORT, CLIENT_START_TIMEOUT_MS, "client");
  }

  let browser = null;
  let exitCode = 0;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.mouse.click(640, 360);
    const initial = await waitForConnected(page, CONNECT_TIMEOUT_MS);
    if (!initial?.map?.instanceId) {
      throw new Error("Initial map metadata missing from render payload.");
    }
    await page.evaluate(() => {
      window.request_map_transfer?.("map-b");
    });
    await waitForPageReadyAfterTransfer(page, TRANSFER_TIMEOUT_MS);
    await waitForMapInstance(page, "map-b", TRANSFER_TIMEOUT_MS);
    const transferred = await waitForLocalPlayerNid(page, TRANSFER_TIMEOUT_MS);
    console.log(`[transfer] PASS from=${initial.map.instanceId} to=${transferred.map.instanceId}`);
  } catch (error) {
    exitCode = 1;
    console.error("[transfer] FAIL", error);
  } finally {
    if (browser) {
      await browser.close();
    }
    for (const child of managed) {
      await stopProcessTree(child);
    }
    await delay(200);
    process.exit(exitCode);
  }
}

void main();
