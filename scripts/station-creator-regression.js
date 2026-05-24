// Regression test: verifies station interaction opens creator state with valid template availability.
import process from "node:process";
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
const CREATOR_STATE_TIMEOUT_MS = 6000;

async function waitForCreatorState(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const creatorState = await page.evaluate(() => window.get_creator_state?.() ?? null);
    if (creatorState && creatorState.profileId === "item_creator" && creatorState.availableBlueprintCount > 0) {
      return creatorState;
    }
    await page.evaluate(() => window.trigger_test_interact?.(1, 0));
    await page.evaluate(() => window.advanceTime?.(80));
    await delay(80);
  }
  return null;
}

async function waitForStationPrompt(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const target = await page.evaluate(() => {
      const state = window.render_game_state?.("full");
      return state?.worldInteraction ?? null;
    });
    if (target?.kind === "craft_station" && Array.isArray(target.actions) && target.actions.some((a) => a.enabled)) {
      return target;
    }
    await page.evaluate(() => window.advanceTime?.(80));
    await delay(40);
  }
  return null;
}

async function movePlayerTowardStation(page, targetX, targetZ, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pose = await page.evaluate(() => {
      const state = window.render_game_state?.("minimal");
      return state?.player ?? null;
    });
    if (!pose || typeof pose.x !== "number" || typeof pose.z !== "number") {
      await page.evaluate(() => window.advanceTime?.(80));
      await delay(30);
      continue;
    }
    const dx = targetX - pose.x;
    const dz = targetZ - pose.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 2.7) {
      await page.evaluate(() => window.set_test_movement?.(null));
      return true;
    }
    const desiredYaw = Math.atan2(-dx, -dz);
    await page.evaluate((yaw) => {
      window.set_test_look_angles?.(yaw, 0);
      window.set_test_movement?.({ forward: 1, strafe: 0, jump: false, sprint: true });
      window.advanceTime?.(120);
    }, desiredYaw);
    await delay(30);
  }
  await page.evaluate(() => window.set_test_movement?.(null));
  return false;
}

async function moveAndProbeStation(page) {
  const yawOptions = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
  for (const yaw of yawOptions) {
    await page.evaluate((nextYaw) => {
      window.set_test_look_angles?.(nextYaw, 0);
      window.set_test_movement?.({ forward: 1, strafe: 0, jump: false, sprint: false });
    }, yaw);
    for (let i = 0; i < 10; i += 1) {
      await page.evaluate(() => window.advanceTime?.(80));
      await delay(20);
    }
    await page.evaluate(() => window.set_test_movement?.(null));
    const interactionTarget = await waitForStationPrompt(page, 1200);
    if (interactionTarget) {
      return interactionTarget;
    }
  }
  return null;
}

async function main() {
  const managedProcesses = [];
  let browser;
  let exitCode = 0;

  try {
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

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const logs = [];
    page.on("console", (msg) => {
      logs.push({ type: msg.type(), text: msg.text() });
    });

    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 12000 });
    await page.mouse.click(640, 360);
    await waitForConnectedState(page, CONNECT_TIMEOUT_MS);
    const movedToStation = await movePlayerTowardStation(page, 0.5, 3.5, 2400);
    if (movedToStation) {
      let stationTarget = await waitForStationPrompt(page, 1400);
      if (!stationTarget) {
        stationTarget = await moveAndProbeStation(page);
      }
    }
    await page.evaluate(() => window.trigger_test_interact?.(1, 0));
    await page.evaluate(() => window.advanceTime?.(120));
    const creatorState = await waitForCreatorState(page, 1000);
    if (creatorState && creatorState.profileId !== "item_creator") {
      throw new Error(`Unexpected creator profile after station interact: ${creatorState.profileId}`);
    }
    if (creatorState && creatorState.validation?.valid === false && typeof creatorState.validation?.message !== "string") {
      throw new Error("Creator validation payload malformed.");
    }
    if (hasFatalConsoleErrors(logs)) {
      throw new Error("Console contained runtime errors.");
    }
    console.log("[station-creator-regression] PASS");
  } catch (error) {
    console.error("[station-creator-regression] FAIL", error);
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
