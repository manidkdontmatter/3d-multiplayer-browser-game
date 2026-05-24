/**
 * Purpose: This file provides a canonical server-authoritative UI view replication runtime with open/patch/close semantics.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { NType } from "../../shared/netcode";

type UserLike = { id: number; queueMessage: (message: unknown) => void };

interface CachedViewState {
  viewId: number;
  revision: number;
  state: Record<string, unknown>;
}

export class UiViewReplicationRuntime {
  private nextViewId = 1;
  private readonly cacheByUserAndType = new Map<string, CachedViewState>();
  private readonly viewTypeByUserAndId = new Map<string, string>();

  public publish<TUser extends UserLike>(user: TUser, viewType: string, nextState: Record<string, unknown>): number {
    const cacheKey = this.buildCacheKey(user.id, viewType);
    const cached = this.cacheByUserAndType.get(cacheKey) ?? null;
    if (!cached) {
      const viewId = this.allocateViewId();
      const snapshot = this.cloneState(nextState);
      this.cacheByUserAndType.set(cacheKey, { viewId, revision: 1, state: snapshot });
      this.viewTypeByUserAndId.set(this.buildViewIdKey(user.id, viewId), viewType);
      user.queueMessage({
        ntype: NType.UiViewOpenMessage,
        viewId,
        viewType,
        revision: 1,
        stateJson: JSON.stringify(snapshot)
      });
      return viewId;
    }

    const patch = this.computePatch(cached.state, nextState);
    if (!patch) {
      return cached.viewId;
    }
    const nextRevision = Math.max(1, cached.revision + 1);
    const baseRevision = cached.revision;
    cached.revision = nextRevision;
    cached.state = this.cloneState(nextState);
    user.queueMessage({
      ntype: NType.UiViewPatchMessage,
      viewId: cached.viewId,
      baseRevision,
      revision: nextRevision,
      patchJson: JSON.stringify(patch)
    });
    return cached.viewId;
  }

  public close<TUser extends UserLike>(user: TUser, viewType: string, reason = "closed"): void {
    const cacheKey = this.buildCacheKey(user.id, viewType);
    const cached = this.cacheByUserAndType.get(cacheKey) ?? null;
    if (!cached) {
      return;
    }
    this.cacheByUserAndType.delete(cacheKey);
    this.viewTypeByUserAndId.delete(this.buildViewIdKey(user.id, cached.viewId));
    user.queueMessage({
      ntype: NType.UiViewCloseMessage,
      viewId: cached.viewId,
      reason
    });
  }

  public closeAllForUser<TUser extends UserLike>(user: TUser, reason = "disconnected"): void {
    const prefix = `${user.id}:`;
    for (const key of Array.from(this.cacheByUserAndType.keys())) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const viewType = key.slice(prefix.length);
      this.close(user, viewType, reason);
    }
  }

  public resolveViewTypeByUserAndId(userId: number, viewId: number): string | null {
    return this.viewTypeByUserAndId.get(this.buildViewIdKey(userId, viewId)) ?? null;
  }

  public resolveViewIdByUserAndType(userId: number, viewType: string): number {
    const key = this.buildCacheKey(userId, viewType);
    return this.cacheByUserAndType.get(key)?.viewId ?? 0;
  }

  private computePatch(
    previous: Record<string, unknown>,
    next: Record<string, unknown>
  ): Record<string, unknown> | null {
    const patch: Record<string, unknown> = {};
    let changed = false;
    const keys = new Set<string>([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      const previousValue = previous[key];
      const nextValue = next[key];
      if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) {
        continue;
      }
      patch[key] = nextValue === undefined ? null : nextValue;
      changed = true;
    }
    return changed ? patch : null;
  }

  private cloneState(source: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  }

  private allocateViewId(): number {
    const id = this.nextViewId;
    this.nextViewId = this.nextViewId >= 0xffff ? 1 : this.nextViewId + 1;
    return id;
  }

  private buildCacheKey(userId: number, viewType: string): string {
    return `${userId}:${viewType}`;
  }

  private buildViewIdKey(userId: number, viewId: number): string {
    return `${userId}:${viewId}`;
  }
}
