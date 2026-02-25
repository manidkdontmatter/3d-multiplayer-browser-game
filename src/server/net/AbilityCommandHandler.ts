// Applies server-authoritative ability bar mutation intents (slot assignment + mouse-slot bindings).
import type { AbilityCommand as AbilityWireCommand } from "../../shared/netcode";
import { ABILITY_ID_NONE } from "../../shared/index";

export interface AbilityStateSnapshot {
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: number[];
}

export interface AbilityCommandUser {
  id: number;
}

export interface AbilityCommandHandlerOptions<TUser extends AbilityCommandUser> {
  readonly getAbilityStateByUserId: (userId: number) => AbilityStateSnapshot | null;
  readonly setPlayerHotbarAbilityByUserId: (userId: number, slot: number, abilityId: number) => boolean;
  readonly setPlayerPrimaryMouseSlotByUserId: (userId: number, slot: number) => boolean;
  readonly setPlayerSecondaryMouseSlotByUserId: (userId: number, slot: number) => boolean;
  readonly getPlayerAccountIdByUserId: (userId: number) => number | null;
  readonly markAccountAbilityStateDirty: (accountId: number) => void;
  readonly queueAbilityStateMessageFromSnapshot: (user: TUser, snapshot: AbilityStateSnapshot) => void;
  readonly sanitizeHotbarSlot: (rawSlot: unknown, fallbackSlot: number) => number;
  readonly sanitizeSelectedAbilityId: (
    rawAbilityId: unknown,
    fallbackAbilityId: number,
    unlockedAbilityIds: Set<number>
  ) => number;
}

export class AbilityCommandHandler<TUser extends AbilityCommandUser> {
  public constructor(private readonly options: AbilityCommandHandlerOptions<TUser>) {}

  public apply(user: TUser, command: Partial<AbilityWireCommand>): void {
    const applyAssignment = Boolean(command.applyAssignment);
    const applyPrimaryMouseSlot = Boolean(command.applyPrimaryMouseSlot);
    const applySecondaryMouseSlot = Boolean(command.applySecondaryMouseSlot);
    if (!applyAssignment && !applyPrimaryMouseSlot && !applySecondaryMouseSlot) {
      return;
    }

    const state = this.options.getAbilityStateByUserId(user.id);
    if (!state) {
      return;
    }

    let stateChanged = false;
    let requiresResync = false;
    const unlockedAbilityIds = new Set<number>(state.unlockedAbilityIds);

    if (applyAssignment) {
      const targetSlot = this.options.sanitizeHotbarSlot(command.assignTargetSlot, 0);
      const fallbackAbilityId = state.hotbarAbilityIds[targetSlot] ?? ABILITY_ID_NONE;
      const sanitizedAbilityId = this.options.sanitizeSelectedAbilityId(
        command.assignAbilityId,
        fallbackAbilityId,
        unlockedAbilityIds
      );
      const requestedAbilityId =
        typeof command.assignAbilityId === "number" && Number.isFinite(command.assignAbilityId)
          ? Math.max(0, Math.floor(command.assignAbilityId))
          : null;
      if (requestedAbilityId !== null && requestedAbilityId !== sanitizedAbilityId) {
        requiresResync = true;
      }
      if (sanitizedAbilityId === ABILITY_ID_NONE) {
        stateChanged =
          this.options.setPlayerHotbarAbilityByUserId(user.id, targetSlot, ABILITY_ID_NONE) || stateChanged;
      } else {
        const targetAbilityId = state.hotbarAbilityIds[targetSlot] ?? ABILITY_ID_NONE;
        const matchingSourceSlots: number[] = [];
        for (let slot = 0; slot < state.hotbarAbilityIds.length; slot += 1) {
          if (slot === targetSlot) {
            continue;
          }
          if ((state.hotbarAbilityIds[slot] ?? ABILITY_ID_NONE) === sanitizedAbilityId) {
            matchingSourceSlots.push(slot);
          }
        }

        if (targetAbilityId === sanitizedAbilityId) {
          for (const duplicateSlot of matchingSourceSlots) {
            stateChanged =
              this.options.setPlayerHotbarAbilityByUserId(user.id, duplicateSlot, ABILITY_ID_NONE) || stateChanged;
          }
        } else if (matchingSourceSlots.length > 0) {
          const swapSourceSlot = matchingSourceSlots[0];
          if (typeof swapSourceSlot === "number") {
            stateChanged =
              this.options.setPlayerHotbarAbilityByUserId(user.id, targetSlot, sanitizedAbilityId) || stateChanged;
            stateChanged =
              this.options.setPlayerHotbarAbilityByUserId(user.id, swapSourceSlot, targetAbilityId) || stateChanged;
            for (let i = 1; i < matchingSourceSlots.length; i += 1) {
              const duplicateSlot = matchingSourceSlots[i];
              if (typeof duplicateSlot !== "number") {
                continue;
              }
              stateChanged =
                this.options.setPlayerHotbarAbilityByUserId(user.id, duplicateSlot, ABILITY_ID_NONE) || stateChanged;
            }
          }
        } else {
          stateChanged =
            this.options.setPlayerHotbarAbilityByUserId(user.id, targetSlot, sanitizedAbilityId) || stateChanged;
        }
      }
    }

    if (applyPrimaryMouseSlot) {
      const sanitized = this.options.sanitizeHotbarSlot(command.primaryMouseSlot, state.primaryMouseSlot);
      const requested =
        typeof command.primaryMouseSlot === "number" && Number.isFinite(command.primaryMouseSlot)
          ? Math.max(0, Math.floor(command.primaryMouseSlot))
          : null;
      if (requested !== null && requested !== sanitized) {
        requiresResync = true;
      }
      stateChanged = this.options.setPlayerPrimaryMouseSlotByUserId(user.id, sanitized) || stateChanged;
    }

    if (applySecondaryMouseSlot) {
      const sanitized = this.options.sanitizeHotbarSlot(command.secondaryMouseSlot, state.secondaryMouseSlot);
      const requested =
        typeof command.secondaryMouseSlot === "number" && Number.isFinite(command.secondaryMouseSlot)
          ? Math.max(0, Math.floor(command.secondaryMouseSlot))
          : null;
      if (requested !== null && requested !== sanitized) {
        requiresResync = true;
      }
      stateChanged = this.options.setPlayerSecondaryMouseSlotByUserId(user.id, sanitized) || stateChanged;
    }

    if (!stateChanged && !requiresResync) {
      return;
    }

    const accountId = this.options.getPlayerAccountIdByUserId(user.id);
    if (accountId !== null) {
      this.options.markAccountAbilityStateDirty(accountId);
    }

    const nextSnapshot = this.options.getAbilityStateByUserId(user.id);
    if (nextSnapshot) {
      this.options.queueAbilityStateMessageFromSnapshot(user, nextSnapshot);
    }
  }
}
