/**
 * Purpose: This file orchestrates split-process network load profiling by running server and client drivers separately.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import { spawn, execFile } from "node:child_process";
import process from "node:process";
import net from "node:net";

const ROOT = process.cwd();
const requestedPort = Math.max(1025, Number(process.env.LOAD_SERVER_PORT ?? 9300));
const clients = Math.max(1, Number(process.env.LOAD_CLIENTS ?? 100));
const connectStaggerMs = Math.max(0, Number(process.env.LOAD_CONNECT_STAGGER_MS ?? 10));
const connectSettleMs = Math.max(0, Number(process.env.LOAD_CONNECT_SETTLE_MS ?? 900));
const warmupSeconds = Math.max(1, Number(process.env.LOAD_WARMUP_SECONDS ?? 5));
const durationSeconds = Math.max(1, Number(process.env.LOAD_DURATION_SECONDS ?? 20));
const estimatedConnectBudgetMs = Math.min(
  300_000,
  Math.floor(clients * (connectStaggerMs + connectSettleMs + 5))
);
const autoShutdownMs = Math.max(
  30_000,
  Math.floor((warmupSeconds + durationSeconds) * 1000) + estimatedConnectBudgetMs + 15_000
);
const profileCaptureMs = Math.max(5_000, Math.floor((warmupSeconds + durationSeconds + 10) * 1000));
const runLabel = String(process.env.LOAD_RUN_LABEL ?? `${process.env.LOAD_TOPOLOGY ?? "auto"}-${clients}c`)
  .replace(/[^a-zA-Z0-9_-]/g, "_");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startProcess(name: string, command: string, args: string[], envOverrides: Record<string, string> = {}) {
  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `${command} ${args.join(" ")}`], {
          cwd: ROOT,
          env: { ...process.env, ...envOverrides },
          stdio: ["ignore", "pipe", "pipe"],
          shell: false
        })
      : spawn(command, args, {
          cwd: ROOT,
          env: { ...process.env, ...envOverrides },
          stdio: ["ignore", "pipe", "pipe"],
          shell: false
        });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}:err] ${chunk}`));
  return child;
}

function stopProcessTree(child: ReturnType<typeof startProcess> | null): Promise<void> {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => resolve());
      return;
    }
    child.kill("SIGTERM");
    resolve();
  });
}

function requestGracefulStop(child: ReturnType<typeof startProcess> | null): void {
  if (!child || child.killed) {
    return;
  }
  if (process.platform === "win32") {
    // Windows taskkill does not trigger Node signal handlers, so let auto-shutdown run.
    return;
  }
  child.kill("SIGTERM");
}

async function main(): Promise<void> {
  let server = null as ReturnType<typeof startProcess> | null;
  let serverExitWait: Promise<void> | null = null;
  let exitCode = 0;
  const port = process.env.LOAD_SERVER_PORT ? requestedPort : await getFreePort();
  try {
    server = startProcess(
      "split-server",
      "node",
      ["--max-old-space-size=12288", "--import", "tsx", "scripts/network-load-server.ts"],
      {
        LOAD_SERVER_PORT: String(port),
        LOAD_PROFILE_CPU: process.env.LOAD_PROFILE_CPU ?? "1",
        LOAD_SERVER_AUTO_SHUTDOWN_MS: String(autoShutdownMs),
        LOAD_SERVER_PROFILE_CAPTURE_MS: String(profileCaptureMs),
        LOAD_RUN_LABEL: runLabel,
        SERVER_LOAD_TEST_SPAWN_MODE: process.env.SERVER_LOAD_TEST_SPAWN_MODE ?? "grid",
        SERVER_LOAD_TEST_GRID_COLUMNS: process.env.SERVER_LOAD_TEST_GRID_COLUMNS ?? "10",
        SERVER_LOAD_TEST_GRID_ROWS: process.env.SERVER_LOAD_TEST_GRID_ROWS ?? "10",
        SERVER_LOAD_TEST_GRID_SPACING: process.env.SERVER_LOAD_TEST_GRID_SPACING ?? "40"
      }
    );
    serverExitWait = new Promise<void>((resolve) => {
      server!.once("exit", () => resolve());
    });

    await delay(3000);
    await waitForPortOpen("127.0.0.1", port, 20_000, "split load server ws");

    const client = startProcess(
      "split-client",
      "node",
      ["--max-old-space-size=12288", "--experimental-websocket", "--import", "tsx", "scripts/network-load-test.ts"],
      {
        LOAD_USE_EXISTING_SERVER: "1",
        LOAD_SERVER_PORT: String(port),
        LOAD_SERVER_URL: `ws://127.0.0.1:${port}`,
        LOAD_CLIENTS: process.env.LOAD_CLIENTS ?? "100",
        LOAD_CLIENTS_ONLY: "1",
        LOAD_TOPOLOGY: process.env.LOAD_TOPOLOGY ?? "sparse",
        LOAD_WARMUP_SECONDS: process.env.LOAD_WARMUP_SECONDS ?? "5",
        LOAD_DURATION_SECONDS: process.env.LOAD_DURATION_SECONDS ?? "20",
        LOAD_CONNECT_STAGGER_MS: process.env.LOAD_CONNECT_STAGGER_MS ?? "10",
        LOAD_CONNECT_SETTLE_MS: process.env.LOAD_CONNECT_SETTLE_MS ?? "900",
        LOAD_PROFILE_CPU: "0"
      }
    );

    await new Promise<void>((resolve, reject) => {
      client.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`split client exited with code ${String(code)}`));
        }
      });
    });
    requestGracefulStop(server);
  } catch (error) {
    exitCode = 1;
    console.error("[split] FAIL", error);
  } finally {
    if (serverExitWait) {
      const graceful = await Promise.race([
        serverExitWait.then(() => true),
        delay(45_000).then(() => false)
      ]);
      if (!graceful) {
        await stopProcessTree(server);
      }
    } else {
      await stopProcessTree(server);
    }
    await delay(150);
    process.exit(exitCode);
  }
}

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to resolve free port."));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.once("error", reject);
  });
}

async function waitForPortOpen(host: string, port: number, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(host, port, 800)) {
      return;
    }
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${label} on ${host}:${port}`);
}

async function isPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

void main();
