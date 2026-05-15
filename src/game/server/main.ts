// Game server entry point — imports game data and engine, wires them together.
import "../shared/index"; // side-effect: initializes game data in engine catalogs
import { bootstrapServer } from "../../engine/server/main";

interface MapRuntimeConfig {
  instanceId: string;
  mapId: string;
  wsPort: number;
  mapConfig: Record<string, unknown>;
}

const config = await resolveRuntimeConfig();

(globalThis as Record<string, unknown> & { __runtimeMapConfig?: Record<string, unknown> }).__runtimeMapConfig = config.mapConfig;
process.env.SERVER_PORT = String(config.wsPort);
process.env.MAP_INSTANCE_ID = config.instanceId;
process.env.MAP_ID = config.mapId;

void bootstrapServer().catch((error) => {
  console.error("[game-server] failed to start", error);
  process.exit(1);
});

async function resolveRuntimeConfig(): Promise<MapRuntimeConfig> {
  // IPC path: orchestrator spawns with ipc channel and sends mapRuntimeConfig
  if (process.send && typeof process.send === "function") {
    return new Promise((resolve) => {
      const onMessage = (message: unknown): void => {
        const msg = message as { type?: string; config?: MapRuntimeConfig };
        if (msg?.type === "mapRuntimeConfig" && msg.config) {
          process.off("message", onMessage);
          resolve(msg.config);
        }
      };
      process.on("message", onMessage);
      // process.send exists but TS narrows it poorly; assertion is safe here
      (process as unknown as { send: (msg: unknown) => void }).send({ type: "mapRuntimeWaiting" });
    });
  }

  // Standalone / env-var path
  return {
    instanceId: process.env.MAP_INSTANCE_ID ?? "standalone",
    mapId: process.env.MAP_ID ?? "sandbox-alpha",
    wsPort: Number(process.env.SERVER_PORT ?? 9001),
    mapConfig: {}
  };
}
