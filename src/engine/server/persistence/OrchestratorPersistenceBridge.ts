/**
 * Purpose: This file coordinates multi-process map/server management and IPC contracts, and loads/saves persistent data through the persistence pipeline.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type { PersistSnapshotBatchRequest, PersistSnapshotRequest } from "../orchestrator/OrchestratorProtocol";
import { MapProcessIpcChannel } from "../ipc/MapProcessIpcChannel";
import type { PlayerSnapshot } from "./PersistenceService";
import type { PlayerSettings } from "../../shared/playerSettings";

interface PendingSnapshot {
  snapshot: PlayerSnapshot;
  saveCharacter: boolean;
  saveAbilityState: boolean;
  saveSettings: boolean;
  settings: PlayerSettings | null;
}

export class OrchestratorPersistenceBridge {
  private readonly pendingByAccountId = new Map<number, PendingSnapshot>();
  private flushing = false;

  public constructor(private readonly ipcChannel: MapProcessIpcChannel) {}

  public enqueueSettings(accountId: number, settings: PlayerSettings): void {
    const key = Math.max(1, Math.floor(accountId));
    const existing = this.pendingByAccountId.get(key);
    if (existing) {
      existing.saveSettings = true;
      existing.settings = settings;
      return;
    }
    this.pendingByAccountId.set(key, {
      snapshot: {
        accountId: key,
        x: 0, y: 0, z: 0,
        yaw: 0, pitch: 0,
        vx: 0, vy: 0, vz: 0,
        health: 0,
        primaryMouseSlot: 0,
        secondaryMouseSlot: 1
      },
      saveCharacter: false,
      saveAbilityState: false,
      saveSettings: true,
      settings
    });
  }

  public enqueue(snapshot: PlayerSnapshot, options: {
    saveCharacter: boolean;
    saveAbilityState: boolean;
    saveSettings?: boolean;
    settings?: PlayerSettings | null;
  }): void {
    const key = Math.max(1, Math.floor(snapshot.accountId));
    const existing = this.pendingByAccountId.get(key);
    if (existing) {
      existing.snapshot = snapshot;
      existing.saveCharacter = existing.saveCharacter || options.saveCharacter;
      existing.saveAbilityState = existing.saveAbilityState || options.saveAbilityState;
      existing.saveSettings = existing.saveSettings || Boolean(options.saveSettings);
      if (options.settings) {
        existing.settings = options.settings;
      }
      return;
    }
    this.pendingByAccountId.set(key, {
      snapshot,
      saveCharacter: options.saveCharacter,
      saveAbilityState: options.saveAbilityState,
      saveSettings: Boolean(options.saveSettings),
      settings: options.settings ?? null
    });
  }

  public async flushPending(): Promise<void> {
    if (this.flushing || this.pendingByAccountId.size === 0) {
      return;
    }
    this.flushing = true;
    const entries = [...this.pendingByAccountId.values()];
    try {
      this.pendingByAccountId.clear();
      await this.sendSnapshotBatch(entries);
    } catch (error) {
      for (const entry of entries) {
        this.enqueue(entry.snapshot, {
          saveCharacter: entry.saveCharacter,
          saveAbilityState: entry.saveAbilityState,
          saveSettings: entry.saveSettings,
          settings: entry.settings
        });
      }
      throw error;
    } finally {
      this.flushing = false;
    }
  }

  private async sendSnapshotBatch(entries: readonly PendingSnapshot[]): Promise<void> {
    const payload: PersistSnapshotBatchRequest = {
      snapshots: entries.map<PersistSnapshotRequest>((entry) => ({
        accountId: entry.snapshot.accountId,
        snapshot: entry.snapshot,
        saveCharacter: entry.saveCharacter,
        saveAbilityState: entry.saveAbilityState,
        saveSettings: entry.saveSettings,
        settings: entry.settings
      }))
    };
    const response = await this.ipcChannel.request("PersistSnapshotBatch", payload);
    if (!response.ok) {
      throw new Error(`persist-snapshot-batch failed: ${response.error ?? "unknown"}`);
    }
  }
}
