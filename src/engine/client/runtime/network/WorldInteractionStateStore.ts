/**
 * Purpose: This file keeps module state organized and queryable in memory.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import type { WorldInteractionPromptViewState } from "../../../shared/index";

export class WorldInteractionStateStore {
  private currentViewId = 0;
  private currentState: WorldInteractionPromptViewState = { kind: "world_interaction", target: null };
  private dirty = false;

  public reset(): void {
    this.currentViewId = 0;
    this.currentState = { kind: "world_interaction", target: null };
    this.dirty = true;
  }

  public processUiViewOpen(viewId: number, stateJson: string): boolean {
    const parsed = this.parseStateJson(stateJson);
    if (!parsed) {
      return false;
    }
    this.currentViewId = this.clampInt(viewId, 0xffff);
    this.currentState = parsed;
    this.dirty = true;
    return true;
  }

  public processUiViewPatch(viewId: number, patchJson: string): boolean {
    const normalizedViewId = this.clampInt(viewId, 0xffff);
    if (normalizedViewId <= 0 || normalizedViewId !== this.currentViewId) {
      return false;
    }
    let patch: unknown = null;
    try {
      patch = JSON.parse(patchJson);
    } catch {
      return false;
    }
    if (!patch || typeof patch !== "object") {
      return false;
    }
    const targetPatch = (patch as { target?: unknown }).target;
    const nextState: WorldInteractionPromptViewState = {
      kind: "world_interaction",
      target: targetPatch === undefined
        ? this.currentState.target
        : (targetPatch as WorldInteractionPromptViewState["target"])
    };
    this.currentState = nextState;
    this.dirty = true;
    return true;
  }

  public processUiViewClose(viewId: number): boolean {
    const normalizedViewId = this.clampInt(viewId, 0xffff);
    if (this.currentViewId <= 0 || this.currentViewId !== normalizedViewId) {
      return false;
    }
    this.currentViewId = 0;
    this.currentState = { kind: "world_interaction", target: null };
    this.dirty = true;
    return true;
  }

  public consumeState(): WorldInteractionPromptViewState | null {
    if (!this.dirty) {
      return null;
    }
    this.dirty = false;
    return {
      kind: this.currentState.kind,
      target: this.currentState.target ? { ...this.currentState.target, actions: [...this.currentState.target.actions] } : null
    };
  }

  public getCurrentViewId(): number {
    return this.currentViewId;
  }

  private parseStateJson(stateJson: string): WorldInteractionPromptViewState | null {
    try {
      const parsed = JSON.parse(stateJson) as WorldInteractionPromptViewState;
      if (!parsed || parsed.kind !== "world_interaction") {
        return null;
      }
      return {
        kind: "world_interaction",
        target: parsed.target ?? null
      };
    } catch {
      return null;
    }
  }

  private clampInt(raw: number, max: number): number {
    if (!Number.isFinite(raw)) {
      return 0;
    }
    return Math.max(0, Math.min(max, Math.floor(raw)));
  }
}
