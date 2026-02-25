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

  const shutdown = (): void => {
    console.log("[server] shutdown requested");
    server?.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
