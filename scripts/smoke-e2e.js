import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output", "smoke");
const CLIENT_URL = "http://127.0.0.1:5173";
const SERVER_URL = "ws://127.0.0.1:9001";

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
    await delay(3500);
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
    await delay(6000);
  } else {
    console.log(`[smoke] using existing client at ${CLIENT_URL}`);
    await delay(1000);
  }

  let browser;
  let exitCode = 0;
  const logs = [];

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    page.on("console", (msg) => {
      logs.push({ type: msg.type(), text: msg.text() });
    });

    await page.goto(CLIENT_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.mouse.click(640, 360);
    await page.waitForTimeout(2000);

    const stateText = await page.evaluate(() => {
      return typeof window.render_game_to_text === "function"
        ? window.render_game_to_text()
        : "missing render_game_to_text";
    });

    await page.screenshot({ path: path.join(OUTPUT_DIR, "smoke.png"), fullPage: true });

    fs.writeFileSync(path.join(OUTPUT_DIR, "state.json"), stateText, "utf8");
    fs.writeFileSync(path.join(OUTPUT_DIR, "console.json"), JSON.stringify(logs, null, 2), "utf8");

    if (stateText === "missing render_game_to_text") {
      throw new Error("Client did not expose window.render_game_to_text");
    }

    const parsed = JSON.parse(stateText);
    if (parsed.mode !== "connected") {
      throw new Error(`Expected connected mode, got ${parsed.mode}`);
    }

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
    if (browser) {
      await browser.close();
    }
    for (const child of managedProcesses) {
      await stopProcessTree(child);
    }
    await delay(600);
    process.exit(exitCode);
  }
}

void main();
