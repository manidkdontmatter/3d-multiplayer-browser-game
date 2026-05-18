// End-to-end projectile damage test that validates training dummy damage after projectile cast.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import {
  ensureDir,
  delay,
  isPortOpen,
  waitForPortOpen,
  startProcess,
  stopProcessTree,
  readStateFromRenderText,
  waitForConnectedState,
  hasFatalConsoleErrors,
  ROOT
} from "./e2e/harness.js";

const OUTPUT_DIR = path.join(ROOT, "output", "projectile-damage");
const CLIENT_URL = process.env.E2E_CLIENT_URL ?? "http://127.0.0.1:5173";
const SERVER_URL = "ws://127.0.0.1:9001";
const SERVER_START_TIMEOUT_MS = 18000;
const CLIENT_START_TIMEOUT_MS = 22000;
const CONNECT_TIMEOUT_MS = 12000;
const APPROACH_TIMEOUT_MS = 18000;
const DAMAGE_TIMEOUT_MS = 3200;

async function approachTrainingDummy(page) {
  const start = Date.now();
  while (Date.now() - start < APPROACH_TIMEOUT_MS) {
    const state = await readStateFromRenderText(page);
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
    if (distance <= 10) {
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
    const state = await readStateFromRenderText(page);
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
      console.log(`[projectile-damage] using existing server at ${SERVER_URL}`);
    }
    if (!clientAlreadyRunning) {
      managedProcesses.push(
        startProcess("client", "npm", ["run", "dev:client", "--", "--host", "127.0.0.1", "--port", "5173"])
      );
      await waitForPortOpen("127.0.0.1", 5173, CLIENT_START_TIMEOUT_MS, "client");
    } else {
      console.log(`[projectile-damage] using existing client at ${CLIENT_URL}`);
    }

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (msg) => logs.push({ type: msg.type(), text: msg.text() }));
    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.mouse.click(640, 360);
    await waitForConnectedState(page, CONNECT_TIMEOUT_MS);
    await page.keyboard.press("Digit1");
    await page.waitForTimeout(120);

    await approachTrainingDummy(page);
    const preAttackState = await readStateFromRenderText(page);
    const dummyBefore = preAttackState?.trainingDummies?.[0];
    if (!dummyBefore || typeof dummyBefore.health !== "number") {
      throw new Error("Training dummy state unavailable.");
    }

    await page.evaluate(() => {
      window.trigger_test_primary_action?.(1);
      window.advanceTime?.(180);
    });
    const afterSingleHit = await waitForDummyHealthBelow(page, dummyBefore.health, DAMAGE_TIMEOUT_MS);
    await page.evaluate(() => {
      window.set_test_movement?.(null);
    });
    finalState = await readStateFromRenderText(page);

    if (hasFatalConsoleErrors(logs)) {
      throw new Error("Console contained runtime errors.");
    }

    console.log(`[projectile-damage] PASS dummyHealth ${dummyBefore.health} -> ${afterSingleHit}`);
  } catch (error) {
    exitCode = 1;
    console.error("[projectile-damage] FAIL", error);
  } finally {
    if (page) {
      try {
        if (!finalState) {
          finalState = await readStateFromRenderText(page);
        }
        await page.screenshot({ path: path.join(OUTPUT_DIR, "projectile-damage.png"), fullPage: true });
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