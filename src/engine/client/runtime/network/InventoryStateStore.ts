/**
 * Purpose: This file manages item inventory state and inventory-related updates, and keeps module state organized and queryable in memory.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  INVENTORY_MAX_SLOTS,
  decodeInventorySnapshot,
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

  public reset(): void {
    this.currentState = {
      maxSlots: INVENTORY_MAX_SLOTS,
      itemInstances: [],
      equipment: {},
      hotbarSlots: []
    };
    this.dirty = true;
  }

  public processInventoryJson(rawJson: string): void {
    const decoded = decodeInventorySnapshot(rawJson);
    if (!decoded) {
      return;
    }
    this.currentState = decoded;
    this.dirty = true;
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
}


