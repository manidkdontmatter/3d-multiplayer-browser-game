// Reproduces forward-only speed variation while sweeping yaw in flying mode, far from world geometry.
import process from "node:process";
import { chromium } from "playwright";
import {
  delay,
  isPortOpen,
  waitForPortOpen,
  startProcess,
  stopProcessTree,
  waitForConnectedState,
  readStateFromRenderText
} from "./e2e/harness.js";

const CLIENT_URL = "http://127.0.0.1:5173";
const SERVER_PORT = 9001;
const CLIENT_PORT = 5173;
const SERVER_START_TIMEOUT_MS = 18000;
const CLIENT_START_TIMEOUT_MS = 22000;
const CONNECT_TIMEOUT_MS = 9000;

function normalizeYaw(value) {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
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
    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 12000 });
    await page.mouse.click(640, 360);
    await waitForConnectedState(page, CONNECT_TIMEOUT_MS);

    // Enable fly mode.
    await page.evaluate(() => {
      window.set_test_movement?.({
        forward: 0,
        strafe: 0,
        jump: false,
        toggleFlyPressed: true,
        sprint: false
      });
      window.advanceTime?.(50);
      window.set_test_movement?.(null);
    });

    // Move upward and away from geometry.
    await page.evaluate(() => {
      window.set_test_look_angles?.(0, 1.2);
      window.set_test_movement?.({
        forward: 1,
        strafe: 0,
        jump: false,
        toggleFlyPressed: false,
        sprint: false
      });
    });
    for (let i = 0; i < 120; i += 1) {
      await page.evaluate(() => window.advanceTime?.(50));
    }

    // Level look, keep only forward held.
    await page.evaluate(() => {
      window.set_test_look_angles?.(0, 0);
      window.set_test_movement?.({
        forward: 1,
        strafe: 0,
        jump: false,
        toggleFlyPressed: false,
        sprint: false
      });
    });

    let state = await readStateFromRenderText(page);
    if (!state?.player) {
      throw new Error("Missing player state.");
    }
    let previous = { x: state.player.x, y: state.player.y, z: state.player.z };
    let yaw = state.player.yaw ?? 0;
    const samples = [];

    // Sweep yaw through full circle while keeping W held.
    const yawStep = Math.PI / 64;
    const stepMs = 50;
    for (let step = 0; step < 256; step += 1) {
      yaw = normalizeYaw(yaw + yawStep);
      await page.evaluate((nextYaw) => {
        window.set_test_look_angles?.(nextYaw, 0);
      }, yaw);
      await page.evaluate((ms) => window.advanceTime?.(ms), stepMs);
      state = await readStateFromRenderText(page);
      if (!state?.player) continue;
      const curr = { x: state.player.x, y: state.player.y, z: state.player.z };
      const dt = stepMs / 1000;
      const vx = (curr.x - previous.x) / dt;
      const vy = (curr.y - previous.y) / dt;
      const vz = (curr.z - previous.z) / dt;
      const speed = Math.hypot(vx, vy, vz);
      samples.push({
        yaw: state.player.yaw,
        speed,
        x: curr.x,
        y: curr.y,
        z: curr.z
      });
      previous = curr;
    }

    await page.evaluate(() => window.set_test_movement?.(null));

    if (samples.length === 0) {
      throw new Error("No speed samples captured.");
    }
    const speeds = samples.map((entry) => entry.speed);
    const min = Math.min(...speeds);
    const max = Math.max(...speeds);
    const mean = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
    const bins = Array.from({ length: 8 }, () => []);
    for (const sample of samples) {
      const normalized = (normalizeYaw(sample.yaw) + Math.PI) / (Math.PI * 2);
      const index = Math.max(0, Math.min(7, Math.floor(normalized * 8)));
      bins[index].push(sample.speed);
    }
    const binMeans = bins.map((bin) => {
      if (bin.length <= 0) return 0;
      return bin.reduce((sum, value) => sum + value, 0) / bin.length;
    });

    console.log("[velocity-heading-investigation] SUMMARY");
    console.log(
      JSON.stringify(
        {
          sampleCount: samples.length,
          minSpeed: Number(min.toFixed(4)),
          maxSpeed: Number(max.toFixed(4)),
          meanSpeed: Number(mean.toFixed(4)),
          spread: Number((max - min).toFixed(4)),
          octantMeans: binMeans.map((value) => Number(value.toFixed(4))),
          firstSamples: samples.slice(0, 16).map((entry) => ({
            yaw: Number(entry.yaw.toFixed(4)),
            speed: Number(entry.speed.toFixed(4))
          }))
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error("[velocity-heading-investigation] FAIL", error);
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
