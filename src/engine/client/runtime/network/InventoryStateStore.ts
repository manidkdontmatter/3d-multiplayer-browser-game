/**
 * Purpose: This file manages item inventory state and inventory-related updates, and keeps module state organized and queryable in memory.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  INVENTORY_MAX_SLOTS,
  decodeInventorySnapshot,
  upsertItemDefinition,
  type ItemDefinition,
  type InventorySnapshot
} from "../../../shared/index";

export class InventoryStateStore {
  private currentState: InventorySnapshot = {
    maxSlots: INVENTORY_MAX_SLOTS,
    itemInstances: [],
    equipment: {},
    hotbarSlots: []
  };
  private dirty = false;
  private currentViewId = 0;

  public reset(): void {
    this.currentState = {
      maxSlots: INVENTORY_MAX_SLOTS,
      itemInstances: [],
      equipment: {},
      hotbarSlots: []
    };
    this.dirty = true;
    this.currentViewId = 0;
  }

  public processInventoryJson(rawJson: string): void {
    const decoded = decodeInventorySnapshot(rawJson);
    if (!decoded) {
      return;
    }
    this.currentState = decoded;
    this.dirty = true;
  }

  public processUiViewOpen(viewId: number, stateJson: string): boolean {
    const snapshot = this.parseViewSnapshot(stateJson);
    if (!snapshot) {
      return false;
    }
    this.currentViewId = this.clampInt(viewId, 0xffff);
    this.currentState = snapshot;
    this.dirty = true;
    return true;
  }

  public processUiViewPatch(viewId: number, patchJson: string): boolean {
    const normalizedViewId = this.clampInt(viewId, 0xffff);
    if (normalizedViewId <= 0 || this.currentViewId !== normalizedViewId) {
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
    const statePatch = (patch as { state?: unknown }).state;
    if (!statePatch || typeof statePatch !== "object") {
      return false;
    }
    const descriptorPatch = (patch as { itemDescriptors?: unknown }).itemDescriptors;
    if (Array.isArray(descriptorPatch)) {
      for (const descriptor of descriptorPatch as ItemDefinition[]) {
        upsertItemDefinition(descriptor);
      }
    }
    const merged = {
      ...this.currentState,
      ...(statePatch as Record<string, unknown>)
    };
    const normalized = decodeInventorySnapshot(JSON.stringify(merged));
    if (!normalized) {
      return false;
    }
    this.currentState = normalized;
    this.dirty = true;
    return true;
  }

  public processUiViewClose(viewId: number): boolean {
    const normalizedViewId = this.clampInt(viewId, 0xffff);
    if (this.currentViewId <= 0 || this.currentViewId !== normalizedViewId) {
      return false;
    }
    this.currentViewId = 0;
    this.currentState = {
      maxSlots: INVENTORY_MAX_SLOTS,
      itemInstances: [],
      equipment: {},
      hotbarSlots: []
    };
    this.dirty = true;
    return true;
  }

  public getCurrentViewId(): number {
    return this.currentViewId;
  }

  public consumeState(): InventorySnapshot | null {
    if (!this.dirty) {
      return null;
    }
    this.dirty = false;
    return this.getState();
  }

  public getState(): InventorySnapshot {
    return {
      maxSlots: this.currentState.maxSlots,
      itemInstances: this.currentState.itemInstances.map((item) => ({ ...item })),
      equipment: { ...this.currentState.equipment },
      hotbarSlots: this.currentState.hotbarSlots.map((entry) => (entry ? { ...entry } : null))
    };
  }

  private parseViewSnapshot(stateJson: string): InventorySnapshot | null {
    try {
      const parsed = JSON.parse(stateJson) as { kind?: unknown; state?: unknown; itemDescriptors?: unknown };
      if (!parsed || parsed.kind !== "inventory" || !parsed.state || typeof parsed.state !== "object") {
        return null;
      }
      if (Array.isArray(parsed.itemDescriptors)) {
        for (const descriptor of parsed.itemDescriptors as ItemDefinition[]) {
          upsertItemDefinition(descriptor);
        }
      }
      return decodeInventorySnapshot(JSON.stringify(parsed.state));
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


