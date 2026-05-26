/**
 * Purpose: This file manages ability definitions, state, or execution flow, and executes one focused command/event handling path.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type { AbilityCommand as AbilityWireCommand } from "../../shared/netcode";

export interface AbilityStateSnapshot {
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  unlockedAbilityIds: number[];
}

export interface AbilityCommandUser {
  id: number;
}

export interface AbilityCommandHandlerOptions<TUser extends AbilityCommandUser> {
  readonly getAbilityStateByUserId: (userId: number) => AbilityStateSnapshot | null;
  readonly setPlayerPrimaryMouseSlotByUserId: (userId: number, slot: number) => boolean;
  readonly setPlayerSecondaryMouseSlotByUserId: (userId: number, slot: number) => boolean;
  readonly getPlayerAccountIdByUserId: (userId: number) => number | null;
  readonly markAccountAbilityStateDirty: (accountId: number) => void;
  readonly queueAbilityStateMessageFromSnapshot: (user: TUser, snapshot: AbilityStateSnapshot) => void;
  readonly sanitizeHotbarSlot: (rawSlot: unknown, fallbackSlot: number) => number;
}

export class AbilityCommandHandler<TUser extends AbilityCommandUser> {
  public constructor(private readonly options: AbilityCommandHandlerOptions<TUser>) {}

  public apply(user: TUser, command: Partial<AbilityWireCommand>): void {
    const applyPrimaryMouseSlot = Boolean(command.applyPrimaryMouseSlot);
    const applySecondaryMouseSlot = Boolean(command.applySecondaryMouseSlot);
    if (!applyPrimaryMouseSlot && !applySecondaryMouseSlot) {
      return;
    }

    const state = this.options.getAbilityStateByUserId(user.id);
    if (!state) {
      return;
    }

    let stateChanged = false;
    let requiresResync = false;
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
