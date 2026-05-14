// Game client entry point — imports game data and engine, wires them together.
import "../shared/index"; // side-effect: initializes game data in engine catalogs
import { initVisuals } from "./visuals"; // registers game-specific visual properties
import "../../engine/client/style.css";
import { bootstrapClient } from "../../engine/client/bootstrap";

initVisuals();
void bootstrapClient();
