import RAPIER from "@dimforge/rapier3d-compat";
import { ncontext } from "../shared/netcode";
import { SERVER_PORT } from "../shared/config";
import { GameServer } from "./GameServer";

async function bootstrapServer(): Promise<void> {
  await RAPIER.init();

  const server = new GameServer(ncontext);
  const runtimePort = Number(process.env.SERVER_PORT ?? SERVER_PORT);
  await server.start(runtimePort);

  const shutdown = (): void => {
    console.log("[server] shutdown requested");
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void bootstrapServer().catch((error) => {
  console.error("[server] failed to start", error);
  process.exit(1);
});
