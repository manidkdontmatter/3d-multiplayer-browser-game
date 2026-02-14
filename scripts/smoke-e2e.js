import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output", "smoke");
const CLIENT_URL = process.env.E2E_CLIENT_URL ?? "http://127.0.0.1:5173";
const SERVER_URL = "ws://127.0.0.1:9001";
const SERVER_START_TIMEOUT_MS = readEnvNumber("E2E_SERVER_START_TIMEOUT_MS", 18000);
const CLIENT_START_TIMEOUT_MS = readEnvNumber("E2E_CLIENT_START_TIMEOUT_MS", 22000);
const CONNECT_TIMEOUT_MS = readEnvNumber("E2E_CONNECT_TIMEOUT_MS", 12000);
const ARTIFACTS_ON_PASS = process.env.E2E_ARTIFACTS_ON_PASS === "1";
const ARTIFACTS_ON_FAIL = process.env.E2E_ARTIFACTS_ON_FAIL !== "0";

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
    await delay(200);
  }
  throw new Error("Timed out waiting for connected state.");
}

async function main() {
  ensureDir(OUTPUT_DIR);
  if (!process.env.SERVER_TICK_LOG) {
    process.env.SERVER_TICK_LOG = "0";
  }

  const managedProcesses = [];
  const serverAlreadyRunning = await isPortOpen("127.0.0.1", 9001);
  const clientAlreadyRunning = await isPortOpen("127.0.0.1", 5173);

  if (!serverAlreadyRunning) {
    const server = startProcess("server", "npm", ["run", "dev:server"]);
    managedProcesses.push(server);
    await waitForPortOpen("127.0.0.1", 9001, SERVER_START_TIMEOUT_MS, "server");
  } else {
    console.log(`[smoke] using existing server at ${SERVER_URL}`);
  }

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
    await waitForPortOpen("127.0.0.1", 5173, CLIENT_START_TIMEOUT_MS, "client");
  } else {
    console.log(`[smoke] using existing client at ${CLIENT_URL}`);
  }

  let browser;
  let page;
  let exitCode = 0;
  let finalState = null;
  const logs = [];

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    page.on("console", (msg) => {
      logs.push({ type: msg.type(), text: msg.text() });
    });

    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.mouse.click(640, 360);
    finalState = await waitForConnectedState(page, CONNECT_TIMEOUT_MS);

    const hasFatalConsoleError = logs.some(
      (entry) =>
        entry.type === "error" &&
        !entry.text.includes("ERR_CONNECTION_REFUSED") &&
        !entry.text.includes("WebSocket connection")
    );
    if (hasFatalConsoleError) {
      throw new Error("Console contained runtime errors. See output/smoke/console.json");
    }

    console.log(`[smoke] PASS server=${SERVER_URL} client=${CLIENT_URL}`);
  } catch (error) {
    exitCode = 1;
    console.error("[smoke] FAIL", error);
  } finally {
    const shouldWriteArtifacts = exitCode === 0 ? ARTIFACTS_ON_PASS : ARTIFACTS_ON_FAIL;
    if (shouldWriteArtifacts && page) {
      try {
        if (!finalState) {
          finalState = await readState(page);
        }
        await page.screenshot({ path: path.join(OUTPUT_DIR, "smoke.png"), fullPage: true });
      } catch (artifactError) {
        console.warn("[smoke] warning: failed to capture screenshot artifact", artifactError);
      }
      fs.writeFileSync(path.join(OUTPUT_DIR, "state.json"), JSON.stringify(finalState ?? null), "utf8");
      fs.writeFileSync(path.join(OUTPUT_DIR, "console.json"), JSON.stringify(logs, null, 2), "utf8");
    }

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
