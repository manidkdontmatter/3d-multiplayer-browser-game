/**
 * Purpose: This file assembles or manages rendering-facing data structures, and stores or assembles timeline snapshots for smooth network playback.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import type { RenderFrameSnapshot } from "./types";

export interface RenderSnapshotAssemblerSource {
  getRenderSnapshotState: (frameDeltaSeconds: number) => RenderFrameSnapshot;
}

export class RenderSnapshotAssembler {
  public constructor(private readonly source: RenderSnapshotAssemblerSource) {}

  public build(frameDeltaSeconds: number): RenderFrameSnapshot {
    return this.source.getRenderSnapshotState(frameDeltaSeconds);
  }
}
