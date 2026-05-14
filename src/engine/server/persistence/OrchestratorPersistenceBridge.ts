// Sends authoritative snapshot persistence events from map process to orchestrator single-writer endpoint.
import type { PersistSnapshotRequest } from "../../shared/orchestrator";
import type { PlayerSnapshot } from "./PersistenceService";

interface PendingSnapshot {
  snapshot: PlayerSnapshot;
  saveCharacter: boolean;
  saveAbilityState: boolean;
}

export class OrchestratorPersistenceBridge {
  private readonly pendingByAccountId = new Map<number, PendingSnapshot>();
  private flushing = false;

  public constructor(
    private readonly orchestratorUrl: string,
    private readonly orchestratorSecret: string
  ) {}

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
    try {
      const entries = [...this.pendingByAccountId.values()];
      this.pendingByAccountId.clear();
      for (const entry of entries) {
        await this.sendSnapshot(entry);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async sendSnapshot(entry: PendingSnapshot): Promise<void> {
    const payload: PersistSnapshotRequest = {
      accountId: entry.snapshot.accountId,
      snapshot: entry.snapshot,
      saveCharacter: entry.saveCharacter,
      saveAbilityState: entry.saveAbilityState
    };
    const response = await fetch(`${this.orchestratorUrl}/orch/persist-snapshot`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orch-secret": this.orchestratorSecret
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`persist-snapshot failed (${response.status})`);
    }
  }
}
