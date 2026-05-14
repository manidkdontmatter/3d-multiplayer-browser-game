// Game server entry point — imports game data and engine, wires them together.
import "../shared/index"; // side-effect: initializes game data in engine catalogs
import { bootstrapServer } from "../../engine/server/main";

void bootstrapServer().catch((error) => {
  console.error("[game-server] failed to start", error);
  process.exit(1);
});
