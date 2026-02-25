// Caches authoritative ability-creator session snapshots from server owner-only messages.
import {
  abilityCategoryFromWireValue,
  abilityCategoryToCreatorType
} from "../../../shared/index";
import { NType, type AbilityCreatorStateMessage } from "../../../shared/netcode";
import type { AbilityCreatorState } from "./types";

export class AbilityCreatorStateStore {
  private currentState: AbilityCreatorState | null = null;
  private pendingState: AbilityCreatorState | null = null;

  public reset(): void {
    this.currentState = null;
    this.pendingState = null;
  }

  public processMessage(message: unknown): boolean {
    const typed = message as AbilityCreatorStateMessage | undefined;
    if (typed?.ntype !== NType.AbilityCreatorStateMessage) {
      return false;
    }
    const nextState = this.toState(typed);
    if (!nextState) {
      return true;
    }
    this.currentState = nextState;
    this.pendingState = nextState;
    return true;
  }

  public consumeState(): AbilityCreatorState | null {
    const pending = this.pendingState;
    this.pendingState = null;
    return pending;
  }

  public getCurrentSessionId(): number {
    return this.currentState?.sessionId ?? 0;
  }

  private toState(message: AbilityCreatorStateMessage): AbilityCreatorState | null {
    const category = abilityCategoryFromWireValue(message.selectedType);
    const selectedType = category ? abilityCategoryToCreatorType(category) : null;
    if (!selectedType) {
      return null;
    }
    return {
      sessionId: this.clampUnsignedInt(message.sessionId, 0xffff),
      ackSequence: this.clampUnsignedInt(message.ackSequence, 0xffff),
      maxCreatorTier: this.clampUnsignedInt(message.maxCreatorTier, 0xff),
      selectedTier: this.clampUnsignedInt(message.selectedTier, 0xff),
      selectedType,
      abilityName:
        typeof message.abilityName === "string" && message.abilityName.trim()
          ? message.abilityName.trim()
          : "New Ability",
      coreExampleStat: this.clampUnsignedInt(message.coreExampleStat, 0xff),
      exampleUpsideEnabled: Boolean(message.exampleUpsideEnabled),
      exampleDownsideEnabled: Boolean(message.exampleDownsideEnabled),
      usingTemplate: Boolean(message.usingTemplate),
      templateAbilityId: this.clampUnsignedInt(message.templateAbilityId, 0xffff),
      totalPointBudget: this.clampUnsignedInt(message.totalPointBudget, 0xff),
      spentPoints: this.clampUnsignedInt(message.spentPoints, 0xff),
      remainingPoints: this.clampUnsignedInt(message.remainingPoints, 0xff),
      upsideSlots: this.clampUnsignedInt(message.upsideSlots, 0xff),
      downsideMax: this.clampUnsignedInt(message.downsideMax, 0xff),
      usedUpsideSlots: this.clampUnsignedInt(message.usedUpsideSlots, 0xff),
      usedDownsideSlots: this.clampUnsignedInt(message.usedDownsideSlots, 0xff),
      derivedExamplePower: this.clampFiniteNumber(message.derivedExamplePower, 0, 999999),
      derivedExampleStability: this.clampFiniteNumber(message.derivedExampleStability, 0, 999999),
      derivedExampleComplexity: this.clampFiniteNumber(message.derivedExampleComplexity, 0, 999999),
      isValid: Boolean(message.isValid),
      validationMessage:
        typeof message.validationMessage === "string" && message.validationMessage.trim()
          ? message.validationMessage.trim()
          : "Waiting for server validation.",
      ownedAbilityCount: this.clampUnsignedInt(message.ownedAbilityCount, 0xff)
    };
  }

  private clampUnsignedInt(raw: number, max: number): number {
    if (!Number.isFinite(raw)) {
      return 0;
    }
    const integer = Math.floor(raw);
    return Math.max(0, Math.min(max, integer));
  }

  private clampFiniteNumber(raw: number, min: number, max: number): number {
    if (!Number.isFinite(raw)) {
      return min;
    }
    return Math.max(min, Math.min(max, raw));
  }
}
