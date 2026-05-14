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
