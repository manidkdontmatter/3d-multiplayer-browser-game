// Game client entry point — initializes shared game data, client assets, and engine runtime.
import { initializeSharedGameData } from "../shared/index";
import { initClientAssetCatalog } from "./assetCatalog";
import { initVisuals } from "./visuals"; // registers game-specific visual properties
import "../../engine/client/style.css";
import { bootstrapClient } from "../../engine/client/bootstrap";

initializeSharedGameData();
initClientAssetCatalog();
initVisuals();
void bootstrapClient();
