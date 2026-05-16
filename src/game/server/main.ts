// Game server entry point — initializes shared/server game data and boots the authoritative runtime.
import { coerceRuntimeMapConfig } from "../../engine/shared/world";
import { bootstrapServer } from "../../engine/server/main";
import { initializeSharedGameData } from "../shared/index";
import { initServerArchetypes } from "./serverArchetypes";

interface MapRuntimeConfig {
  instanceId: string;
  mapId: string;
  wsPort: number;
  mapConfig: Record<string, unknown>;
}

const config = await resolveRuntimeConfig();

process.env.SERVER_PORT = String(config.wsPort);
process.env.MAP_INSTANCE_ID = config.instanceId;
process.env.MAP_ID = config.mapId;

initializeSharedGameData();
initServerArchetypes();

void bootstrapServer({
  port: config.wsPort,
  runtimeMapConfig: coerceRuntimeMapConfig({
    ...config.mapConfig,
    instanceId: config.instanceId,
    mapId: config.mapId
  })
}).catch((error) => {
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
