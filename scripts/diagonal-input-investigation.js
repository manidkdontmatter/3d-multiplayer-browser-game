// Automated investigation for cardinal vs diagonal input command volume per server tick.
import process from "node:process";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { delay, waitForPortOpen, waitForConnectedState, stopProcessTree } from "./e2e/harness.js";

const CLIENT_URL = "http://127.0.0.1:5173";
const SERVER_PORT = 9001;
const CLIENT_PORT = 5173;
const SERVER_START_TIMEOUT_MS = 18000;
const CLIENT_START_TIMEOUT_MS = 22000;
const CONNECT_TIMEOUT_MS = 10000;

function startTrackedProcess(name, command, args, envOverrides = {}) {
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `${command} ${args.join(" ")}`], {
          cwd: process.cwd(),
          env: { ...process.env, ...envOverrides },
          stdio: ["ignore", "pipe", "pipe"]
        })
      : spawn(command, args, {
          cwd: process.cwd(),
          env: { ...process.env, ...envOverrides },
          stdio: ["ignore", "pipe", "pipe"]
        });

  const lines = [];
  const capture = (chunk) => {
    const text = String(chunk);
    process.stdout.write(`[${name}] ${text}`);
    const split = text.split(/\r?\n/);
    for (const line of split) {
      if (line.trim().length > 0) {
        lines.push({ ts: Date.now(), line: line.trim() });
      }
    }
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  return { child, lines };
}

function parseInputDiag(lines, startTs, endTs) {
  const selected = lines.filter((entry) => entry.ts >= startTs && entry.ts <= endTs && entry.line.includes("[input-diag]"));
  let tickLines = 0;
  let commandSets = 0;
  let inputCommands = 0;
  for (const entry of selected) {
    const setMatch = entry.line.match(/commandSets=(\d+)/);
    const inputMatch = entry.line.match(/inputCommands=(\d+)/);
    if (setMatch && inputMatch) {
      tickLines += 1;
      commandSets += Number(setMatch[1]);
      inputCommands += Number(inputMatch[1]);
    }
  }
  return {
    tickLines,
    commandSets,
    inputCommands,
    avgCommandSetsPerTickLine: tickLines > 0 ? commandSets / tickLines : 0,
    avgInputCommandsPerTickLine: tickLines > 0 ? inputCommands / tickLines : 0
  };
}

async function driveMovementPhase(page, movement, totalMs, stepMs) {
  await page.evaluate((m) => {
    window.set_test_movement?.(m);
  }, movement);

  const steps = Math.max(1, Math.floor(totalMs / stepMs));
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((ms) => {
      window.advanceTime?.(ms);
    }, stepMs);
  }

  const snapshot = await page.evaluate(() => window.render_game_state?.("minimal") ?? null);
  return snapshot;
}

async function main() {
  const server = startTrackedProcess("server", "npm", ["run", "dev:server"], {
    SERVER_INPUT_DIAGNOSTICS: "1"
  });
  const client = startTrackedProcess("client", "npm", [
    "run",
    "dev:client",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    String(CLIENT_PORT)
  ]);
  let browser;
  let exitCode = 0;

  try {
    await waitForPortOpen("127.0.0.1", SERVER_PORT, SERVER_START_TIMEOUT_MS, "server");
    await waitForPortOpen("127.0.0.1", CLIENT_PORT, CLIENT_START_TIMEOUT_MS, "client");

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 12000 });
    await page.mouse.click(640, 360);
    await waitForConnectedState(page, CONNECT_TIMEOUT_MS);
    await delay(400);

    const phaseDurationMs = 2400;
    const stepMs = 50;

    const cardinalStart = Date.now();
    const cardinalState = await driveMovementPhase(
      page,
      { forward: 1, strafe: 0, jump: false, sprint: false },
      phaseDurationMs,
      stepMs
    );
    const cardinalEnd = Date.now();
    await page.evaluate(() => window.set_test_movement?.(null));
    await delay(300);

    const diagonalStart = Date.now();
    const diagonalState = await driveMovementPhase(
      page,
      { forward: 1, strafe: 1, jump: false, sprint: false },
      phaseDurationMs,
      stepMs
    );
    const diagonalEnd = Date.now();
    await page.evaluate(() => window.set_test_movement?.(null));
    await delay(300);

    const cardinalStats = parseInputDiag(server.lines, cardinalStart, cardinalEnd);
    const diagonalStats = parseInputDiag(server.lines, diagonalStart, diagonalEnd);

    console.log("[diag-investigation] SUMMARY");
    console.log(
      JSON.stringify(
        {
          cardinal: {
            inputStats: cardinalStats,
            playerPose: cardinalState?.player ?? null
          },
          diagonal: {
            inputStats: diagonalStats,
            playerPose: diagonalState?.player ?? null
          }
        },
        null,
        2
      )
    );
  } catch (error) {
    exitCode = 1;
    console.error("[diag-investigation] FAIL", error);
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopProcessTree(client.child);
    await stopProcessTree(server.child);
    process.exit(exitCode);
  }
}

void main();
