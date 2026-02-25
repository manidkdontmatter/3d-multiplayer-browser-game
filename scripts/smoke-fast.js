// Fast headless smoke test that self-manages server/client startup and verifies basic connectivity.
import process from "node:process";
import net from "node:net";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { chromium } from "playwright";

const CLIENT_URL = "http://127.0.0.1:5173";
const SERVER_PORT = 9001;
const CLIENT_PORT = 5173;
const SERVER_START_TIMEOUT_MS = 18000;
const CLIENT_START_TIMEOUT_MS = 22000;
const CONNECT_TIMEOUT_MS = 9000;
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

async function main() {
  const managedProcesses = [];

  const serverAlreadyRunning = await isPortOpen("127.0.0.1", SERVER_PORT);
  if (!serverAlreadyRunning) {
    const server = startProcess("server", "npm", ["run", "dev:server"]);
    managedProcesses.push(server);
    await waitForPortOpen("127.0.0.1", SERVER_PORT, SERVER_START_TIMEOUT_MS, "server");
  }

  const clientAlreadyRunning = await isPortOpen("127.0.0.1", CLIENT_PORT);
  if (!clientAlreadyRunning) {
    const client = startProcess("client", "npm", [
      "run",
      "dev:client",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(CLIENT_PORT)
    ]);
    managedProcesses.push(client);
    await waitForPortOpen("127.0.0.1", CLIENT_PORT, CLIENT_START_TIMEOUT_MS, "client");
  }

  let browser;
  let exitCode = 0;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const logs = [];
    page.on("console", (msg) => {
      logs.push({ type: msg.type(), text: msg.text() });
    });

    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 12000 });
    await page.mouse.click(640, 360);
    await waitForConnectedState(page, CONNECT_TIMEOUT_MS);

    const hasFatalConsoleError = logs.some(
      (entry) =>
        entry.type === "error" &&
        !entry.text.includes("ERR_CONNECTION_REFUSED") &&
        !entry.text.includes("WebSocket connection")
    );
    if (hasFatalConsoleError) {
      throw new Error("Console contained runtime errors.");
    }

    console.log("[smoke-fast] PASS");
  } catch (error) {
    console.error("[smoke-fast] FAIL", error);
    exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
    for (const child of managedProcesses) {
      await stopProcessTree(child);
    }
    await delay(200);
    process.exit(exitCode);
  }
}

void main();
