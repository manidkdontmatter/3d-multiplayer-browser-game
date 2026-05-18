// Headless smoke test that verifies server/client startup, connection, and main UI toggling.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import {
  ensureDir,
  delay,
  readEnvNumber,
  isPortOpen,
  waitForPortOpen,
  startProcess,
  stopProcessTree,
  readStateFromRenderText,
  waitForConnectedState,
  hasFatalConsoleErrors,
  ROOT
} from "./e2e/harness.js";

const OUTPUT_DIR = path.join(ROOT, "output", "smoke");
const CLIENT_URL = process.env.E2E_CLIENT_URL ?? "http://127.0.0.1:5173";
const SERVER_URL = "ws://127.0.0.1:9001";
const SERVER_START_TIMEOUT_MS = readEnvNumber("E2E_SERVER_START_TIMEOUT_MS", 18000);
const CLIENT_START_TIMEOUT_MS = readEnvNumber("E2E_CLIENT_START_TIMEOUT_MS", 22000);
const CONNECT_TIMEOUT_MS = readEnvNumber("E2E_CONNECT_TIMEOUT_MS", 30000);
const MAIN_UI_TIMEOUT_MS = readEnvNumber("E2E_MAIN_UI_TIMEOUT_MS", 6000);
const ARTIFACTS_ON_PASS = process.env.E2E_ARTIFACTS_ON_PASS === "1";
const ARTIFACTS_ON_FAIL = process.env.E2E_ARTIFACTS_ON_FAIL !== "0";

async function waitForLoadoutPanelState(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readStateFromRenderText(page);
    if (state?.localAbility?.ui?.mainMenuOpen === true) {
      return state;
    }
    await delay(120);
  }
  throw new Error("Timed out waiting for main UI open state.");
}

async function waitForMainUiVisible(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const visible = await page.evaluate(() => {
      const overlay = document.querySelector("#main-ui-overlay.main-ui-visible");
      if (!(overlay instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(overlay);
      const rect = overlay.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0.5 &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    if (visible) {
      return;
    }
    await delay(120);
  }
  throw new Error("Timed out waiting for visible main UI overlay.");
}

async function openLoadoutPanel(page) {
  await page.evaluate(() => {
    const eventInit = { code: "Backquote", key: "`", bubbles: true };
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
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
    await openLoadoutPanel(page);
    finalState = await waitForLoadoutPanelState(page, 3000);
    await waitForMainUiVisible(page, MAIN_UI_TIMEOUT_MS);

    if (hasFatalConsoleErrors(logs)) {
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
          finalState = await readStateFromRenderText(page);
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