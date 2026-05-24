// Regression test: verifies creator UI renders ready/equipped/pickup and activation appearance targets in deterministic live runtime.
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

async function waitForCreatorState(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const creatorState = await page.evaluate(() => window.get_creator_state?.() ?? null);
    if (
      creatorState &&
      creatorState.profileId === "ability_creator" &&
      creatorState.availableBlueprintCount > 0
    ) {
      return creatorState;
    }
    await page.evaluate(() => window.trigger_test_interact?.(1, 0));
    await page.evaluate(() => window.advanceTime?.(120));
    await delay(80);
  }
  return null;
}

async function openCreationSection(page) {
  await page.evaluate(() => {
    window.toggle_main_ui?.(true);
  });
  await page.evaluate(() => {
    const navButtons = Array.from(document.querySelectorAll("button"));
    const creationButton = navButtons.find((button) => button.textContent?.trim() === "Creation");
    creationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function readAppearanceCaptions(page) {
  return await page.evaluate(() => {
    const captions = Array.from(document.querySelectorAll(".creator-appearance-preview-caption"));
    return captions.map((node) => (node.textContent ?? "").trim());
  });
}

async function validateAppearanceRollout(page) {
  return await page.evaluate(() => window.validate_creator_appearance_rollout?.() ?? null);
}

async function ensureCreatorTemplateSelected(page) {
  return await page.evaluate(() => {
    const state = window.get_creator_state?.();
    if (!state || state.profileId !== "ability_creator") {
      return false;
    }
    if (state.draft?.baseBlueprintId > 0) {
      return true;
    }
    const firstBlueprintId = Array.isArray(state.availableBlueprintIds) && state.availableBlueprintIds.length > 0
      ? Number(state.availableBlueprintIds[0] ?? 0)
      : 0;
    if (!Number.isFinite(firstBlueprintId) || firstBlueprintId <= 0) {
      return false;
    }
    window.send_creator_command?.({
      selectBaseBlueprint: true,
      baseBlueprintId: firstBlueprintId
    });
    return true;
  });
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

async function main() {
  const managedProcesses = [];
  let browser;
  let exitCode = 0;

  try {
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

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const logs = [];
    page.on("console", (msg) => {
      logs.push({ type: msg.type(), text: msg.text() });
    });

    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 12000 });
    await page.mouse.click(640, 360);
    await waitForConnectedState(page, CONNECT_TIMEOUT_MS);
    await page.evaluate(() => window.advanceTime?.(240));
    const creatorState = await waitForCreatorState(page, 4000);
    if (!creatorState) {
      throw new Error("Timed out waiting for ability creator state.");
    }
    const selectedTemplate = await ensureCreatorTemplateSelected(page);
    if (!selectedTemplate) {
      throw new Error("Failed to select a creator template for appearance preview validation.");
    }
    await page.evaluate(() => window.advanceTime?.(200));
    await delay(120);
    await openCreationSection(page);
    await page.evaluate(() => window.advanceTime?.(160));
    await delay(120);
    const captions = await readAppearanceCaptions(page);
    const creatorStateAfterOpen = await page.evaluate(() => window.get_creator_state?.() ?? null);
    console.log("[creator-appearance-ui-regression] captions", captions);
    console.log("[creator-appearance-ui-regression] creator-state", JSON.stringify(creatorStateAfterOpen));
    const rolloutValidation = await validateAppearanceRollout(page);
    console.log("[creator-appearance-ui-regression] rollout-validation", JSON.stringify(rolloutValidation));
    if (!rolloutValidation || !rolloutValidation.ok) {
      throw new Error(
        `Creator appearance rollout validation failed: ${JSON.stringify(rolloutValidation?.issues ?? ["missing validation result"])}`
      );
    }

    if (hasFatalConsoleErrors(logs)) {
      throw new Error("Console contained runtime errors.");
    }

    console.log("[creator-appearance-ui-regression] PASS");
  } catch (error) {
    console.error("[creator-appearance-ui-regression] FAIL", error);
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
