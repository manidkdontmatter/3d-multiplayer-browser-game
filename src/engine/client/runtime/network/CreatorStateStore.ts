// Caches authoritative creator session snapshots from server owner-only messages.
// Generalized replacement for AbilityCreatorStateStore — handles all archetype kinds.

import { NType, type CreatorStateMessageWire, type CreatorStatePayload } from "../../../shared/netcode";
import type { CreatorDraft, CreatorCapacity, CreatorValidation } from "../../../shared/creator";

export interface CreatorClientState {
  sessionId: number;
  ackSequence: number;
  kind: string;
  draft: CreatorDraft;
  capacity: CreatorCapacity;
  validation: CreatorValidation;
  ownedCount: number;
}

export class CreatorStateStore {
  private currentState: CreatorClientState | null = null;
  private pendingState: CreatorClientState | null = null;

  public reset(): void {
    this.currentState = null;
    this.pendingState = null;
  }

  public processMessage(message: unknown): boolean {
    const typed = message as CreatorStateMessageWire | undefined;
    if (typed?.ntype !== NType.CreatorStateMessage) return false;

    try {
      const payload = JSON.parse(typed.stateJson) as CreatorStatePayload;
      const nextState = this.toState(payload);
      if (!nextState) return true;
      this.currentState = nextState;
      this.pendingState = nextState;
    } catch {
      // Malformed JSON — ignore
    }
    return true;
  }

  public consumeState(): CreatorClientState | null {
    const pending = this.pendingState;
    this.pendingState = null;
    return pending;
  }

  public getCurrentSessionId(): number {
    return this.currentState?.sessionId ?? 0;
  }

  public getLatestState(): CreatorClientState | null {
    return this.currentState;
  }

  private toState(payload: CreatorStatePayload): CreatorClientState | null {
    if (!payload || typeof payload !== "object") return null;
    try {
      const draft = JSON.parse(payload.draftJson) as CreatorDraft;
      const capacity = JSON.parse(payload.capacityJson) as CreatorCapacity;
      const validation = JSON.parse(payload.validationJson) as CreatorValidation;
      return {
        sessionId: this.clampInt(payload.sessionId, 0xffff),
        ackSequence: this.clampInt(payload.ackSequence, 0xffff),
        kind: typeof payload.kind === "string" ? payload.kind : "ability",
        draft,
        capacity,
        validation,
        ownedCount: this.clampInt(payload.ownedArchetypeCount, 0xff)
      };
    } catch {
      return null;
    }
  }

  private clampInt(raw: number, max: number): number {
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(max, Math.floor(raw)));
  }
}
