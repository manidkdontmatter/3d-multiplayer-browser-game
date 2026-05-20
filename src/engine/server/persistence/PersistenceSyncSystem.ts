/**
 * Purpose: This file loads/saves persistent data through the persistence pipeline.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type { PlayerSnapshot } from "./PersistenceService";
import { GUEST_ACCOUNT_ID_BASE } from "./PersistenceService";
import type { PlayerSettings } from "../../shared/playerSettings";

type PendingOfflineSnapshot = {
  snapshot: PlayerSnapshot;
  settings?: PlayerSettings;
};

export class PersistenceSyncSystem {
  private readonly dirtyCharacterAccountIds = new Set<number>();
  private readonly dirtyAbilityStateAccountIds = new Set<number>();
  private readonly dirtySettingsAccountIds = new Set<number>();
  private readonly pendingOfflineSnapshots = new Map<number, PendingOfflineSnapshot>();

  public markAccountDirty(
    accountId: number,
    options?: { dirtyCharacter?: boolean; dirtyAbilityState?: boolean; dirtySettings?: boolean }
  ): void {
    if (accountId >= GUEST_ACCOUNT_ID_BASE) {
      return;
    }
    const normalizedAccountId = Math.max(1, Math.floor(Number.isFinite(accountId) ? accountId : 1));
    const dirtyCharacter = options?.dirtyCharacter ?? true;
    const dirtyAbilityState = options?.dirtyAbilityState ?? true;
    const dirtySettings = options?.dirtySettings ?? false;
    if (dirtyCharacter) {
      this.dirtyCharacterAccountIds.add(normalizedAccountId);
    }
    if (dirtyAbilityState) {
      this.dirtyAbilityStateAccountIds.add(normalizedAccountId);
    }
    if (dirtySettings) {
      this.dirtySettingsAccountIds.add(normalizedAccountId);
    }
  }

  public queueOfflineSnapshot(accountId: number, snapshot: PlayerSnapshot): void {
    if (accountId >= GUEST_ACCOUNT_ID_BASE) {
      return;
    }
    this.pendingOfflineSnapshots.set(accountId, {
      snapshot
    });
    this.dirtyCharacterAccountIds.add(accountId);
    this.dirtyAbilityStateAccountIds.add(accountId);
  }

  public takePendingSnapshotForLogin(accountId: number): PlayerSnapshot | null {
    if (accountId >= GUEST_ACCOUNT_ID_BASE) {
      return null;
    }
    const pendingOfflineSnapshot = this.pendingOfflineSnapshots.get(accountId);
    if (!pendingOfflineSnapshot) {
      return null;
    }
    this.pendingOfflineSnapshots.delete(accountId);
    return pendingOfflineSnapshot.snapshot;
  }

  public flushDirtyPlayerState(
    resolveOnlineSnapshotByAccountId: (accountId: number) => PlayerSnapshot | null,
    saveCharacterSnapshot: (snapshot: PlayerSnapshot) => void,
    saveAbilityStateSnapshot: (snapshot: PlayerSnapshot) => void,
    resolveOnlineSettingsByAccountId: (accountId: number) => PlayerSettings | null,
    savePlayerSettings: (accountId: number, settings: PlayerSettings) => void
  ): void {
    const dirtyAccounts = new Set<number>([
      ...this.dirtyCharacterAccountIds,
      ...this.dirtyAbilityStateAccountIds,
      ...this.dirtySettingsAccountIds
    ]);

    for (const accountId of dirtyAccounts) {
      const pendingOfflineSnapshot = this.pendingOfflineSnapshots.get(accountId);
      const snapshot = resolveOnlineSnapshotByAccountId(accountId) ?? pendingOfflineSnapshot?.snapshot;
      if (!snapshot) {
        continue;
      }

      const shouldSaveCharacter =
        this.dirtyCharacterAccountIds.has(accountId);
      const shouldSaveAbilityState =
        this.dirtyAbilityStateAccountIds.has(accountId);
      const shouldSaveSettings =
        this.dirtySettingsAccountIds.has(accountId);

      if (shouldSaveCharacter) {
        saveCharacterSnapshot(snapshot);
      }
      if (shouldSaveAbilityState) {
        saveAbilityStateSnapshot(snapshot);
      }
      if (shouldSaveSettings) {
        const settings = resolveOnlineSettingsByAccountId(accountId) ?? pendingOfflineSnapshot?.settings;
        if (settings) {
          savePlayerSettings(accountId, settings);
        }
      }

      this.pendingOfflineSnapshots.delete(accountId);
    }
    this.dirtyCharacterAccountIds.clear();
    this.dirtyAbilityStateAccountIds.clear();
    this.dirtySettingsAccountIds.clear();
  }

  public getPendingOfflineSnapshotCount(): number {
    return this.pendingOfflineSnapshots.size;
  }
}
