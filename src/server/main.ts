// Boots the authoritative server runtime and installs basic fatal/error diagnostics for hosts.
import { resolve } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { ncontext } from "../shared/netcode";
import { SERVER_PORT } from "../shared/config";
import { resolveRuntimeMapConfig } from "../shared/world";
import { GameServer } from "./GameServer";
import { ServerDiagnostics } from "./ServerDiagnostics";

async function bootstrapServer(): Promise<void> {
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

  server = new GameServer(ncontext);
  const runtimePort = Number(process.env.SERVER_PORT ?? SERVER_PORT);
  await server.start(runtimePort);
  await notifyOrchestratorMapReady(runtimePort);
  const heartbeatTimer = installOrchestratorHeartbeat(runtimePort, server);

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

async function notifyOrchestratorMapReady(runtimePort: number): Promise<void> {
  const orchestratorUrl = process.env.ORCHESTRATOR_INTERNAL_URL;
  const secret = process.env.ORCH_INTERNAL_RPC_SECRET;
  if (!orchestratorUrl || !secret) {
    return;
  }
  const mapConfig = resolveRuntimeMapConfig();
  const mapId = mapConfig.mapId;
  const instanceId = mapConfig.instanceId;
  const response = await fetch(`${orchestratorUrl}/orch/map-ready`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-orch-secret": secret
    },
    body: JSON.stringify({
      instanceId,
      mapId,
      wsUrl: `ws://localhost:${runtimePort}`,
      pid: process.pid,
      mapConfig: {
        ...mapConfig
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Failed map-ready registration (${response.status})`);
  }
}

function installOrchestratorHeartbeat(runtimePort: number, server: GameServer): NodeJS.Timeout | null {
  const orchestratorUrl = process.env.ORCHESTRATOR_INTERNAL_URL;
  const secret = process.env.ORCH_INTERNAL_RPC_SECRET;
  const instanceId = process.env.MAP_INSTANCE_ID;
  if (!orchestratorUrl || !secret || !instanceId) {
    return null;
  }
  const intervalMs = Math.max(500, Math.floor(Number(process.env.MAP_HEARTBEAT_MS ?? 5000)));
  const startedAtMs = Date.now();
  const sendHeartbeat = async (): Promise<void> => {
    try {
      const runtime = server.getRuntimeStats();
      await fetch(`${orchestratorUrl}/orch/map-heartbeat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orch-secret": secret
        },
        body: JSON.stringify({
          instanceId,
          pid: process.pid,
          onlinePlayers: runtime.onlinePlayers,
          uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
          atMs: Date.now()
        })
      });
    } catch (error) {
      console.warn("[server] map-heartbeat failed", error);
    }
  };
  const timer = setInterval(() => {
    void sendHeartbeat();
  }, intervalMs);
  void sendHeartbeat();
  return timer;
}

void bootstrapServer().catch((error) => {
  const diagnostics = new ServerDiagnostics({
    errorLogPath: resolve(process.env.SERVER_ERROR_LOG_PATH ?? "./data/server-errors.log"),
    maxLines: 20
  });
  diagnostics.logFatal("startup", error);
  console.error("[server] failed to start", error);
  process.exit(1);
});
