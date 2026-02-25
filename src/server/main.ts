// Boots the authoritative server runtime and installs basic fatal/error diagnostics for hosts.
import { resolve } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { ncontext } from "../shared/netcode";
import { SERVER_PORT } from "../shared/config";
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

  const shutdown = (): void => {
    console.log("[server] shutdown requested");
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
  const mapId = process.env.MAP_ID ?? "sandbox-alpha";
  const instanceId = process.env.MAP_INSTANCE_ID ?? "default-1";
  const seed = Number(process.env.MAP_SEED ?? 1337);
  const groundHalfExtent = Number(process.env.MAP_GROUND_HALF_EXTENT ?? 192);
  const groundHalfThickness = Number(process.env.MAP_GROUND_HALF_THICKNESS ?? 0.5);
  const cubeCount = Number(process.env.MAP_CUBE_COUNT ?? 280);
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
        mapId,
        instanceId,
        seed,
        groundHalfExtent,
        groundHalfThickness,
        cubeCount
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Failed map-ready registration (${response.status})`);
  }
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
