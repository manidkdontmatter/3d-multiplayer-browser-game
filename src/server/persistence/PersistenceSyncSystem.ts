import type { PlayerSnapshot } from "./PersistenceService";

type PendingOfflineSnapshot = {
  snapshot: PlayerSnapshot;
  dirtyCharacter: boolean;
  dirtyAbilityState: boolean;
};

export class PersistenceSyncSystem<TPlayer extends { accountId: number }> {
  private readonly dirtyCharacterAccountIds = new Set<number>();
  private readonly dirtyAbilityStateAccountIds = new Set<number>();
  private readonly pendingOfflineSnapshots = new Map<number, PendingOfflineSnapshot>();

  public markPlayerDirty(
    player: TPlayer,
    options?: { dirtyCharacter?: boolean; dirtyAbilityState?: boolean }
  ): void {
    this.markAccountDirty(player.accountId, options);
  }

  public markAccountDirty(
    accountId: number,
    options?: { dirtyCharacter?: boolean; dirtyAbilityState?: boolean }
  ): void {
    const normalizedAccountId = Math.max(1, Math.floor(Number.isFinite(accountId) ? accountId : 1));
    const dirtyCharacter = options?.dirtyCharacter ?? true;
    const dirtyAbilityState = options?.dirtyAbilityState ?? true;
    if (dirtyCharacter) {
      this.dirtyCharacterAccountIds.add(normalizedAccountId);
    }
    if (dirtyAbilityState) {
      this.dirtyAbilityStateAccountIds.add(normalizedAccountId);
    }
  }

  public queueOfflineSnapshot(accountId: number, snapshot: PlayerSnapshot): void {
    this.pendingOfflineSnapshots.set(accountId, {
      snapshot,
      dirtyCharacter: true,
      dirtyAbilityState: true
    });
    this.dirtyCharacterAccountIds.add(accountId);
    this.dirtyAbilityStateAccountIds.add(accountId);
  }

  public takePendingSnapshotForLogin(accountId: number): PlayerSnapshot | null {
    const pendingOfflineSnapshot = this.pendingOfflineSnapshots.get(accountId);
    if (!pendingOfflineSnapshot) {
      return null;
    }
    this.pendingOfflineSnapshots.delete(accountId);
    if (!pendingOfflineSnapshot.dirtyCharacter) {
      this.dirtyCharacterAccountIds.delete(accountId);
    }
    if (!pendingOfflineSnapshot.dirtyAbilityState) {
      this.dirtyAbilityStateAccountIds.delete(accountId);
    }
    return pendingOfflineSnapshot.snapshot;
  }

  public flushDirtyPlayerState(
    resolveOnlineSnapshotByAccountId: (accountId: number) => PlayerSnapshot | null,
    saveCharacterSnapshot: (snapshot: PlayerSnapshot) => void,
    saveAbilityStateSnapshot: (snapshot: PlayerSnapshot) => void
  ): void {
    const dirtyAccounts = new Set<number>([
      ...this.dirtyCharacterAccountIds,
      ...this.dirtyAbilityStateAccountIds
    ]);

    for (const accountId of dirtyAccounts) {
      const pendingOfflineSnapshot = this.pendingOfflineSnapshots.get(accountId);
      const snapshot = resolveOnlineSnapshotByAccountId(accountId) ?? pendingOfflineSnapshot?.snapshot;
      if (!snapshot) {
        continue;
      }

      const shouldSaveCharacter =
        this.dirtyCharacterAccountIds.has(accountId) || Boolean(pendingOfflineSnapshot?.dirtyCharacter);
      const shouldSaveAbilityState =
        this.dirtyAbilityStateAccountIds.has(accountId) || Boolean(pendingOfflineSnapshot?.dirtyAbilityState);

      if (shouldSaveCharacter) {
        saveCharacterSnapshot(snapshot);
      }
      if (shouldSaveAbilityState) {
        saveAbilityStateSnapshot(snapshot);
      }

      this.pendingOfflineSnapshots.delete(accountId);
    }
    this.dirtyCharacterAccountIds.clear();
    this.dirtyAbilityStateAccountIds.clear();
  }

  public getPendingOfflineSnapshotCount(): number {
    return this.pendingOfflineSnapshots.size;
  }
}
