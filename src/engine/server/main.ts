/**
 * Purpose: This file starts this runtime entrypoint and wires the initial systems together.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { resolve } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { init as initNavigation } from "recast-navigation";
import { ncontext } from "../shared/netcode";
import { SERVER_PORT } from "../shared/config";
import type { RuntimeMapConfig } from "../shared/world";
import { GameServer } from "./GameServer";
import { MapProcessIpcChannel } from "./ipc/MapProcessIpcChannel";
import { ServerDiagnostics } from "./ServerDiagnostics";

export interface BootstrapServerOptions {
  port?: number;
  runtimeMapConfig: RuntimeMapConfig;
}

export async function bootstrapServer(options: BootstrapServerOptions): Promise<void> {
  const diagnostics = new ServerDiagnostics({
    errorLogPath: resolve(process.env.SERVER_ERROR_LOG_PATH ?? "./data/server-errors.log"),
    maxLines: 20
  });
  diagnostics.installConsoleErrorCapture();
  console.log(`[server] error log path ${diagnostics.getErrorLogPath()}`);

  let server: GameServer | null = null;
  let fatalExitTriggered = false;
  const handleFatal = (source: "uncaughtException" | "unhandledRejection", error: unknown): void => {
    if (fatalExitTriggered) {
      return;
    }
    fatalExitTriggered = true;
    diagnostics.logFatal(source, error);
    try {
      server?.stop();
    } catch (stopError) {
      diagnostics.logFatal(source, stopError);
    }
    process.exit(1);
  };

  process.on("uncaughtException", (error) => handleFatal("uncaughtException", error));
  process.on("unhandledRejection", (reason) => handleFatal("unhandledRejection", reason));

  await RAPIER.init();
  await initNavigation();

  const ipcChannel = createMapProcessIpcChannel();
  server = new GameServer(ncontext, ipcChannel);
  if (server && ipcChannel?.isAvailable()) {
    ipcChannel.onRequest("ReserveIncomingTransfer", () => {
      server?.reserveIncomingTransfer();
      return { ok: true };
    });
    ipcChannel.onRequest("FinalizeSourceRelease", (payload) => {
      const ok = server?.finalizeSourceRelease(payload.accountId, payload.transferId) ?? false;
      return ok ? { ok: true } : { ok: false, error: "source_release_failed" };
    });
  }
  const runtimePort = Number(options.port ?? process.env.SERVER_PORT ?? SERVER_PORT);
  await server.start(runtimePort);
  notifyOrchestratorMapReady(runtimePort, options.runtimeMapConfig, ipcChannel);
  const heartbeatTimer = installOrchestratorHeartbeat(server, ipcChannel);

  const shutdown = (): void => {
    console.log("[server] shutdown requested");
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    server?.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function notifyOrchestratorMapReady(
  runtimePort: number,
  runtimeMapConfig: RuntimeMapConfig,
  ipcChannel: MapProcessIpcChannel | null
): void {
  if (!ipcChannel?.isAvailable()) {
    return;
  }
  const mapId = runtimeMapConfig.mapId;
  const instanceId = runtimeMapConfig.instanceId;
  ipcChannel.emit("MapProcessBooted", {
    instanceId,
    mapId,
    wsUrl: `ws://localhost:${runtimePort}`,
    pid: process.pid,
    mapConfig: {
      ...runtimeMapConfig
    }
  });
}

function installOrchestratorHeartbeat(server: GameServer, ipcChannel: MapProcessIpcChannel | null): NodeJS.Timeout | null {
  const instanceId = process.env.MAP_INSTANCE_ID;
  if (!ipcChannel?.isAvailable() || !instanceId) {
    return null;
  }
  const intervalMs = Math.max(500, Math.floor(Number(process.env.MAP_HEARTBEAT_MS ?? 5000)));
  const startedAtMs = Date.now();
  const sendHeartbeat = (): void => {
    try {
      const runtime = server.getRuntimeStats();
      ipcChannel.emit("MapHeartbeat", {
        instanceId,
        pid: process.pid,
        onlinePlayers: runtime.onlinePlayers,
        uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
        atMs: Date.now(),
        mapMetrics: server.getMapRuntimeMetricsSnapshot(Date.now())
      });
    } catch (error) {
      console.warn("[server] map-heartbeat failed", error);
    }
  };
  const timer = setInterval(() => {
    sendHeartbeat();
  }, intervalMs);
  sendHeartbeat();
  return timer;
}

function createMapProcessIpcChannel(): MapProcessIpcChannel | null {
  const instanceId = process.env.MAP_INSTANCE_ID ?? "map-process";
  const channel = new MapProcessIpcChannel(instanceId);
  if (!channel.isAvailable()) {
    return null;
  }
  channel.start();
  return channel;
}

// This module is a library — the game layer entry point calls bootstrapServer()
// after initializing game data. No auto-execute here.
