/**
 * Purpose: This file starts this runtime entrypoint and wires the initial systems together.
 * Scope: It belongs to the game-specific client composition layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { initializeSharedGameData } from "../shared/index";
import { initClientAssetCatalog } from "./assetCatalog";
import { initVisuals } from "./visuals"; // registers game-specific visual properties
import "../../engine/client/style.css";
import { bootstrapClient } from "../../engine/client/bootstrap";

initializeSharedGameData();
initClientAssetCatalog();
initVisuals();
void bootstrapClient();
