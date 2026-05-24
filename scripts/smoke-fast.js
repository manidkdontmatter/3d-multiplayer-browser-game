// Fast headless smoke test that self-manages server/client startup and verifies basic connectivity.
import process from "node:process";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import {
  delay,
  isPortOpen,
  waitForPortOpen,
  startProcess,
  stopProcessTree,
  waitForConnectedState,
  hasFatalConsoleErrors
} from "./e2e/harness.js";

const CLIENT_URL = "http://127.0.0.1:5173";
const SERVER_PORT = 9001;
const CLIENT_PORT = 5173;
const SERVER_START_TIMEOUT_MS = 18000;
const CLIENT_START_TIMEOUT_MS = 22000;
const CONNECT_TIMEOUT_MS = 9000;

async function main() {
  const managedProcesses = [];
  ensureAssetManifestReady();

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

    if (hasFatalConsoleErrors(logs)) {
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

function ensureAssetManifestReady() {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/ensure-asset-manifest.ts"],
    {
      stdio: "inherit",
      shell: false
    }
  );
  if (result.status !== 0) {
    throw new Error(`assets:ensure:manifest failed with exit code ${result.status ?? 1}`);
  }
}

void main();
