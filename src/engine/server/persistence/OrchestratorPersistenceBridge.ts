// Sends authoritative snapshot persistence events from map process to orchestrator single-writer endpoint.
import type { PersistSnapshotBatchRequest, PersistSnapshotRequest } from "../orchestrator/OrchestratorProtocol";
import { MapProcessIpcChannel } from "../ipc/MapProcessIpcChannel";
import type { PlayerSnapshot } from "./PersistenceService";

interface PendingSnapshot {
  snapshot: PlayerSnapshot;
  saveCharacter: boolean;
  saveAbilityState: boolean;
}

export class OrchestratorPersistenceBridge {
  private readonly pendingByAccountId = new Map<number, PendingSnapshot>();
  private flushing = false;

  public constructor(private readonly ipcChannel: MapProcessIpcChannel) {}

  public enqueue(snapshot: PlayerSnapshot, options: { saveCharacter: boolean; saveAbilityState: boolean }): void {
    const key = Math.max(1, Math.floor(snapshot.accountId));
    const existing = this.pendingByAccountId.get(key);
    if (existing) {
      existing.snapshot = snapshot;
      existing.saveCharacter = existing.saveCharacter || options.saveCharacter;
      existing.saveAbilityState = existing.saveAbilityState || options.saveAbilityState;
      return;
    }
    this.pendingByAccountId.set(key, {
      snapshot,
      saveCharacter: options.saveCharacter,
      saveAbilityState: options.saveAbilityState
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
          saveAbilityState: entry.saveAbilityState
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
        saveAbilityState: entry.saveAbilityState
      }))
    };
    const response = await this.ipcChannel.request("PersistSnapshotBatch", payload);
    if (!response.ok) {
      throw new Error(`persist-snapshot-batch failed: ${response.error ?? "unknown"}`);
    }
  }
}
