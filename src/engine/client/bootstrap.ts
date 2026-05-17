/**
 * Purpose: This file runs ordered startup steps so dependencies initialize correctly.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { preloadCoreAssets } from "./assets/assetLoader";
import { GameClientApp } from "./runtime/GameClientApp";
import type { ClientCreatePhase } from "./runtime/GameClientApp";
import { BootOverlay } from "./ui/BootOverlay";
import { UiRuntime } from "./ui/UiRuntime";

const ASSET_PROGRESS_START = 0.05;
const ASSET_PROGRESS_END = 0.74;
const SYSTEM_PROGRESS_START = ASSET_PROGRESS_END;
const SYSTEM_PROGRESS_END = 0.97;

export async function bootstrapClient(): Promise<void> {
  UiRuntime.ensureDocumentRoot(document).adoptElementById(document, "boot-overlay", "boot");

  const canvas = document.getElementById("game-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Missing #game-canvas");
  }

  const overlay = BootOverlay.fromDocument(document);

  overlay.setStage("Preparing startup");
  overlay.setDetail("Loading runtime manifest and preload plan...");
  overlay.setProgress(0.02);

  try {
    overlay.setStage("Loading core assets");
    await preloadCoreAssets({
      onProgress: (progress) => {
        const assetPortion = ASSET_PROGRESS_END - ASSET_PROGRESS_START;
        const ratio = ASSET_PROGRESS_START + progress.ratio * assetPortion;
        const loaded = `${progress.loadedCount}/${progress.totalCount}`;
        const label = progress.activeAssetLabel ?? "asset";
        overlay.setDetail(`Loaded ${loaded} (${label})`);
        overlay.setProgress(ratio);
      }
    });

    const app = await GameClientApp.create(canvas, (phase) => {
      const phaseProgress = resolveCreatePhaseProgress(phase);
      const phaseLabel = resolveCreatePhaseLabel(phase);
      overlay.setStage(phaseLabel);
      overlay.setDetail(`Initializing ${phaseLabel.toLowerCase()}...`);
      overlay.setProgress(phaseProgress);
    });

    overlay.setStage("Entering world");
    overlay.setDetail("Boot complete.");
    overlay.setProgress(1);

    app.start();
    overlay.complete();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    overlay.fail(message);
    throw error;
  }
}

function resolveCreatePhaseProgress(phase: ClientCreatePhase): number {
  const span = SYSTEM_PROGRESS_END - SYSTEM_PROGRESS_START;
  switch (phase) {
    case "physics":
      return SYSTEM_PROGRESS_START + span * 0.2;
    case "network":
      return SYSTEM_PROGRESS_START + span * 0.75;
    case "ready":
      return SYSTEM_PROGRESS_END;
    default:
      return SYSTEM_PROGRESS_START;
  }
}

function resolveCreatePhaseLabel(phase: ClientCreatePhase): string {
  switch (phase) {
    case "physics":
      return "Starting physics";
    case "network":
      return "Connecting to server";
    case "ready":
      return "Finalizing startup";
    default:
      return "Initializing";
  }
}
