/**
 * Purpose: This file manages item inventory state and inventory-related updates, and keeps module state organized and queryable in memory.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  INVENTORY_MAX_SLOTS,
  decodeInventoryStateSnapshot,
  type InventoryStateSnapshot
} from "../../../shared/index";

export class InventoryStateStore {
  private currentState: InventoryStateSnapshot = {
    maxSlots: INVENTORY_MAX_SLOTS,
    items: [],
    equipment: {}
  };
  private dirty = false;

  public reset(): void {
    this.currentState = {
      maxSlots: INVENTORY_MAX_SLOTS,
      items: [],
      equipment: {}
    };
    this.dirty = true;
  }

  public processInventoryJson(rawJson: string): void {
    const decoded = decodeInventoryStateSnapshot(rawJson);
    if (!decoded) {
      return;
    }
    this.currentState = decoded;
    this.dirty = true;
  }

  public consumeState(): InventoryStateSnapshot | null {
    if (!this.dirty) {
      return null;
    }
    this.dirty = false;
    return this.getState();
  }

  public getState(): InventoryStateSnapshot {
    return {
      maxSlots: this.currentState.maxSlots,
      items: this.currentState.items.map((item) => ({ ...item })),
      equipment: { ...this.currentState.equipment }
    };
  }
}
