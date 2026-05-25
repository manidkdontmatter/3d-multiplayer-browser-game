/**
 * Purpose: This file defines canonical policy-driven zero-health lifecycle handling.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and resolves what happens when an entity reaches zero health.
 */
export type DeathPolicyId =
  | "player_respawn_immediate"
  | "npc_respawn_delay"
  | "reset_health";

export interface DeathLifecycleContext {
  readonly eid: number;
  readonly accountId: number;
}

export interface DeathLifecycleSystemOptions {
  readonly resolvePolicyByEid: (eid: number) => DeathPolicyId;
  readonly handlePlayerRespawnImmediate: (eid: number, context: DeathLifecycleContext) => void;
  readonly handleNpcRespawnDelay: (eid: number, context: DeathLifecycleContext, delaySeconds: number) => void;
  readonly handleResetHealth: (eid: number, context: DeathLifecycleContext) => void;
  readonly npcRespawnDelaySeconds: number;
  readonly onPolicyStarted?: (context: DeathLifecycleContext, policyId: DeathPolicyId) => void;
  readonly onPolicyCompleted?: (context: DeathLifecycleContext, policyId: DeathPolicyId) => void;
}

export class DeathLifecycleSystem {
  private readonly pendingDelayedByEid = new Map<number, {
    context: DeathLifecycleContext;
    policyId: DeathPolicyId;
  }>();

  public constructor(private readonly options: DeathLifecycleSystemOptions) {}

  public handleZeroHealth(context: DeathLifecycleContext): void {
    const policy = this.options.resolvePolicyByEid(context.eid);
    this.options.onPolicyStarted?.(context, policy);
    if (policy === "player_respawn_immediate") {
      this.options.handlePlayerRespawnImmediate(context.eid, context);
      this.options.onPolicyCompleted?.(context, policy);
      return;
    }
    if (policy === "npc_respawn_delay") {
      this.pendingDelayedByEid.set(context.eid, { context, policyId: policy });
      this.options.handleNpcRespawnDelay(
        context.eid,
        context,
        Math.max(0, this.options.npcRespawnDelaySeconds)
      );
      return;
    }
    this.options.handleResetHealth(context.eid, context);
    this.options.onPolicyCompleted?.(context, policy);
  }

  public completeDelayedPolicyByEid(eid: number): boolean {
    const pending = this.pendingDelayedByEid.get(eid);
    if (!pending) {
      return false;
    }
    this.pendingDelayedByEid.delete(eid);
    this.options.onPolicyCompleted?.(pending.context, pending.policyId);
    return true;
  }
}
