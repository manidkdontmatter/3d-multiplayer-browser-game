import type { LoadoutCommand as LoadoutWireCommand } from "../../shared/netcode";
import { ABILITY_ID_NONE } from "../../shared/index";

export interface LoadoutStateSnapshot {
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: number[];
}

export interface LoadoutCommandUser {
  id: number;
}

export interface LoadoutCommandHandlerOptions<TUser extends LoadoutCommandUser> {
  readonly getLoadoutStateByUserId: (userId: number) => LoadoutStateSnapshot | null;
  readonly setPlayerActiveHotbarSlotByUserId: (userId: number, slot: number) => void;
  readonly setPlayerHotbarAbilityByUserId: (userId: number, slot: number, abilityId: number) => boolean;
  readonly getPlayerAccountIdByUserId: (userId: number) => number | null;
  readonly markAccountAbilityStateDirty: (accountId: number) => void;
  readonly queueLoadoutStateMessageFromSnapshot: (user: TUser, snapshot: LoadoutStateSnapshot) => void;
  readonly sanitizeHotbarSlot: (rawSlot: unknown, fallbackSlot: number) => number;
  readonly sanitizeSelectedAbilityId: (
    rawAbilityId: unknown,
    fallbackAbilityId: number,
    unlockedAbilityIds: Set<number>
  ) => number;
}

export class LoadoutCommandHandler<TUser extends LoadoutCommandUser> {
  public constructor(private readonly options: LoadoutCommandHandlerOptions<TUser>) {}

  public apply(user: TUser, command: Partial<LoadoutWireCommand>): void {
    const applySelectedHotbarSlot = Boolean(command.applySelectedHotbarSlot);
    const applyAssignment = Boolean(command.applyAssignment);
    if (!applySelectedHotbarSlot && !applyAssignment) {
      return;
    }

    const loadout = this.options.getLoadoutStateByUserId(user.id);
    if (!loadout) {
      return;
    }
    const previousActiveHotbarSlot = loadout.activeHotbarSlot;
    const activeSlot = this.options.sanitizeHotbarSlot(loadout.activeHotbarSlot, 0);
    const previousAssignedAbilityId = loadout.hotbarAbilityIds[activeSlot] ?? ABILITY_ID_NONE;
    let requiresLoadoutResync = false;
    let didAssignMutation = false;
    let nextActiveHotbarSlot = loadout.activeHotbarSlot;
    const unlockedAbilityIds = new Set<number>(loadout.unlockedAbilityIds);
    const accountId = this.options.getPlayerAccountIdByUserId(user.id);

    if (applySelectedHotbarSlot) {
      const requestedSlot =
        typeof command.selectedHotbarSlot === "number" && Number.isFinite(command.selectedHotbarSlot)
          ? Math.max(0, Math.floor(command.selectedHotbarSlot))
          : null;
      const sanitizedSlot = this.options.sanitizeHotbarSlot(command.selectedHotbarSlot, loadout.activeHotbarSlot);
      if (requestedSlot !== null && requestedSlot !== sanitizedSlot) {
        requiresLoadoutResync = true;
      }
      this.options.setPlayerActiveHotbarSlotByUserId(user.id, sanitizedSlot);
      nextActiveHotbarSlot = sanitizedSlot;
    }

    if (applyAssignment) {
      const targetSlot = this.options.sanitizeHotbarSlot(command.assignTargetSlot, nextActiveHotbarSlot);
      const fallbackAbilityId = loadout.hotbarAbilityIds[targetSlot] ?? ABILITY_ID_NONE;
      const requestedAbilityId =
        typeof command.assignAbilityId === "number" && Number.isFinite(command.assignAbilityId)
          ? Math.max(0, Math.floor(command.assignAbilityId))
          : null;
      const sanitizedAbilityId = this.options.sanitizeSelectedAbilityId(
        command.assignAbilityId,
        fallbackAbilityId,
        unlockedAbilityIds
      );
      if (requestedAbilityId !== null && requestedAbilityId !== sanitizedAbilityId) {
        requiresLoadoutResync = true;
      }
      didAssignMutation =
        this.options.setPlayerHotbarAbilityByUserId(user.id, targetSlot, sanitizedAbilityId) || didAssignMutation;
    }

    const nextLoadout = this.options.getLoadoutStateByUserId(user.id) ?? loadout;
    const nextActiveSlot = this.options.sanitizeHotbarSlot(nextLoadout.activeHotbarSlot, 0);
    const nextAssignedAbilityId = nextLoadout.hotbarAbilityIds[nextActiveSlot] ?? ABILITY_ID_NONE;
    const loadoutChanged =
      previousActiveHotbarSlot !== nextActiveSlot ||
      previousAssignedAbilityId !== nextAssignedAbilityId ||
      didAssignMutation;
    if (loadoutChanged || requiresLoadoutResync) {
      if (accountId !== null) {
        this.options.markAccountAbilityStateDirty(accountId);
      }
      const nextSnapshot = this.options.getLoadoutStateByUserId(user.id);
      if (nextSnapshot) {
        this.options.queueLoadoutStateMessageFromSnapshot(user, nextSnapshot);
      }
    }
  }
}
