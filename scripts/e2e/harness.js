// Shared helpers for browser E2E scripts: process lifecycle, local port readiness, and render-state polling.
import fs from "node:fs";
import process from "node:process";
import net from "node:net";
import { spawn, execFile } from "node:child_process";

export const ROOT = process.cwd();

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isPortOpen(host, port, timeoutMs = 700) {
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

export async function waitForPortOpen(host, port, timeoutMs, label, pollMs = 150) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(host, port, 500)) {
      return;
    }
    await delay(pollMs);
  }
  throw new Error(`Timed out waiting for ${label} on ${host}:${port}`);
}

export function startProcess(name, command, args, options = {}) {
  const envOverrides = options.envOverrides ?? {};
  const cwd = options.cwd ?? ROOT;
  const spawnConfig = {
    cwd,
    env: { ...process.env, ...envOverrides },
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

export function stopProcessTree(child) {
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

export async function readStateFromRenderText(page, options = {}) {
  const suppressEvalErrors = options.suppressEvalErrors === true;
  try {
    return await page.evaluate(() => {
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
  } catch (error) {
    if (suppressEvalErrors) {
      return null;
    }
    throw error;
  }
}

export async function waitForConnectedState(page, timeoutMs, options = {}) {
  const pollMs = options.pollMs ?? 120;
  const suppressEvalErrors = options.suppressEvalErrors === true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readStateFromRenderText(page, { suppressEvalErrors });
    if (state?.mode === "connected") {
      return state;
    }
    await delay(pollMs);
  }
  throw new Error("Timed out waiting for connected state.");
}

export function hasFatalConsoleErrors(logs) {
  return logs.some(
    (entry) =>
      entry.type === "error" &&
      !entry.text.includes("ERR_CONNECTION_REFUSED") &&
      !entry.text.includes("WebSocket connection")
  );
}