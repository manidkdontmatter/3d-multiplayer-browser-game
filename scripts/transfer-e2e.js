// End-to-end transfer test that verifies client can move from map-a to map-b through orchestrator handoff.
import process from "node:process";
import { chromium } from "playwright";
import {
  delay,
  isPortOpen,
  waitForPortOpen,
  startProcess,
  stopProcessTree,
  readStateFromRenderText,
  waitForConnectedState
} from "./e2e/harness.js";

const CLIENT_URL = "http://127.0.0.1:5173";
const ORCH_PORT = 9000;
const CLIENT_PORT = 5173;
const SERVER_START_TIMEOUT_MS = 20000;
const CLIENT_START_TIMEOUT_MS = 22000;
const CONNECT_TIMEOUT_MS = 12000;
const TRANSFER_TIMEOUT_MS = 12000;

async function readState(page) {
  return readStateFromRenderText(page, { suppressEvalErrors: true });
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
    const initial = await waitForConnectedState(page, CONNECT_TIMEOUT_MS, { suppressEvalErrors: true });
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