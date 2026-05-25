/**
 * Purpose: This file applies damage rules and health impact resolution.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type { EventBus } from "../../events/EventBus";
import {
  GameEvent,
  type DamageDealtPayload,
  type DamagePacketAppliedPayload,
  type HealthChangedPayload
} from "../../events/GameEvents";

export interface DamageableEntityState {
  health: number;
  maxHealth: number;
  accountId: number;
}

export type DamageKind = "melee" | "projectile" | "status" | "fall" | "environment";

export interface DamageSystemOptions {
  readonly markCharacterDirtyByAccountId: (
    accountId: number,
    options: { dirtyCharacter: boolean; dirtyAbilityState: boolean }
  ) => void;
  readonly getDamageableStateByEid: (eid: number) => DamageableEntityState | null;
  readonly applyDamageableStateByEid: (eid: number, next: DamageableEntityState) => void;
  readonly onZeroHealth: (eid: number, accountId: number) => void;
  readonly events: EventBus;
}

export class DamageSystem {
  private readonly targetEidByColliderHandle = new Map<number, number>();

  public constructor(private readonly options: DamageSystemOptions) {}

  public registerCollider(colliderHandle: number, eid: number): void {
    this.targetEidByColliderHandle.set(colliderHandle, eid);
  }

  public unregisterCollider(colliderHandle: number): void {
    this.targetEidByColliderHandle.delete(colliderHandle);
  }

  public resolveTargetEidByColliderHandle(colliderHandle: number): number | null {
    const eid = this.targetEidByColliderHandle.get(colliderHandle);
    return typeof eid === "number" ? eid : null;
  }

  public forEachTarget(visitor: (targetEid: number) => void): void {
    for (const eid of this.targetEidByColliderHandle.values()) {
      visitor(eid);
    }
  }

  public applyMeleeDamageByEid(targetEid: number, damage: number, sourceEid: number): void {
    this.applyDamageByEidWithKind(targetEid, damage, sourceEid, "melee");
  }

  public applyProjectileDamageByEid(targetEid: number, damage: number, sourceEid: number | null): void {
    this.applyDamageByEidWithKind(targetEid, damage, sourceEid, "projectile");
  }

  public applyStatusDamageByEid(targetEid: number, damage: number, sourceEid: number | null): void {
    this.applyDamageByEidWithKind(targetEid, damage, sourceEid, "status");
  }

  public applyHealingByEid(targetEid: number, healing: number): boolean {
    const appliedHealing = Math.max(0, Math.floor(healing));
    if (appliedHealing <= 0) return false;
    const state = this.options.getDamageableStateByEid(targetEid);
    if (!state) return false;
    if (state.health <= 0) {
      return false;
    }
    const previousHealth = state.health;
    const nextHealth = Math.min(state.maxHealth, previousHealth + appliedHealing);
    if (nextHealth === previousHealth) {
      return false;
    }
    state.health = nextHealth;
    if (state.accountId > 0) {
      this.options.markCharacterDirtyByAccountId(state.accountId, {
        dirtyCharacter: true,
        dirtyAbilityState: false
      });
    }
    this.options.applyDamageableStateByEid(targetEid, state);
    this.options.events.emit<HealthChangedPayload>(GameEvent.HEALTH_CHANGED, {
      eid: targetEid,
      previous: previousHealth,
      current: nextHealth,
      max: state.maxHealth
    });
    return true;
  }

  public restoreHealthToMaxByEid(targetEid: number): boolean {
    const state = this.options.getDamageableStateByEid(targetEid);
    if (!state) {
      return false;
    }
    const previousHealth = state.health;
    const nextHealth = Math.max(0, Math.floor(state.maxHealth));
    if (previousHealth === nextHealth) {
      return false;
    }
    state.health = nextHealth;
    if (state.accountId > 0) {
      this.options.markCharacterDirtyByAccountId(state.accountId, {
        dirtyCharacter: true,
        dirtyAbilityState: false
      });
    }
    this.options.applyDamageableStateByEid(targetEid, state);
    this.options.events.emit<HealthChangedPayload>(GameEvent.HEALTH_CHANGED, {
      eid: targetEid,
      previous: previousHealth,
      current: nextHealth,
      max: state.maxHealth
    });
    return true;
  }

  public applyFallDamageByEid(eid: number, damage: number): void {
    this.applyDamageByEidWithKind(eid, damage, null, "fall");
  }

  private applyDamageByEidWithKind(
    targetEid: number,
    damage: number,
    sourceEid: number | null,
    damageKind: DamageKind
  ): void {
    const appliedDamage = Math.max(0, Math.floor(damage));
    if (appliedDamage <= 0) return;

    const state = this.options.getDamageableStateByEid(targetEid);
    if (!state) return;
    if (state.health <= 0) {
      return;
    }
    const previousHealth = state.health;
    state.health = Math.max(0, state.health - appliedDamage);
    if (state.accountId > 0) {
      this.options.markCharacterDirtyByAccountId(state.accountId, {
        dirtyCharacter: true, dirtyAbilityState: false
      });
    }
    this.options.applyDamageableStateByEid(targetEid, state);
    this.options.events.emit<DamagePacketAppliedPayload>(GameEvent.DAMAGE_PACKET_APPLIED, {
      sourceEid,
      targetEid,
      amount: appliedDamage,
      kind: damageKind
    });
    this.options.events.emit<DamageDealtPayload>(GameEvent.DAMAGE_DEALT, {
      sourceEid, targetEid, amount: appliedDamage,
      kind: damageKind
    });
    this.options.events.emit<HealthChangedPayload>(GameEvent.HEALTH_CHANGED, {
      eid: targetEid, previous: previousHealth, current: state.health, max: state.maxHealth
    });
    if (state.health <= 0) {
      this.options.onZeroHealth(targetEid, state.accountId);
    }
  }
}
