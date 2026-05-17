/**
 * Purpose: This file applies timed status effects and their ongoing impact.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type { WorldWithComponents } from "../../ecs/SimulationEcsTypes";
import type { EventBus } from "../../events/EventBus";
import { GameEvent, type HealthChangedPayload } from "../../events/GameEvents";

export type StackPolicy = "replace" | "refresh" | "stack_add" | "max";

export interface StatusEffectDefinition {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly durationMs: number;          // 0 = permanent (until removed)
  readonly tickIntervalMs: number;      // 0 = no periodic tick
  readonly maxStacks: number;
  readonly stackPolicy: StackPolicy;
  readonly damagePerTick?: number;      // damage dealt each tick
  readonly healPerTick?: number;        // healing applied each tick
  readonly speedMultiplier?: number;    // movement speed modifier while active
  readonly damageMultiplier?: number;   // outgoing damage modifier
  readonly damageTakenMultiplier?: number; // incoming damage modifier
  readonly statModifiers?: Record<string, number>; // stat → additive modifier
}

interface ActiveStatus {
  statusId: string;
  appliedAtMs: number;
  expiresAtMs: number;  // 0 = permanent
  stacks: number;
  nextTickAtMs: number;
  sourceEid: number | null;
}

export class StatusEffectSystem {
  private readonly definitions = new Map<string, StatusEffectDefinition>();
  private readonly active = new Map<number, ActiveStatus[]>(); // eid -> statuses

  public constructor(
    private readonly components: WorldWithComponents["components"],
    private readonly events: EventBus
  ) {
    this.subscribeEvents();
  }

  // ── Definition registration ───────────────────────────────────────────────

  public registerDefinition(def: StatusEffectDefinition): void {
    this.definitions.set(def.id, def);
  }

  public getDefinition(id: string): StatusEffectDefinition | null {
    return this.definitions.get(id) ?? null;
  }

  // ── Apply / remove ────────────────────────────────────────────────────────

  public apply(
    targetEid: number,
    statusId: string,
    durationMs: number,
    stacks: number,
    sourceEid: number | null,
    elapsedMs: number
  ): void {
    const def = this.definitions.get(statusId);
    if (!def) return;

    const activeList = this.active.get(targetEid) ?? [];
    const existing = activeList.find((s) => s.statusId === statusId);

    const resolvedStacks = Math.min(stacks, def.maxStacks);

    if (existing) {
      switch (def.stackPolicy) {
        case "replace":
          existing.stacks = resolvedStacks;
          existing.appliedAtMs = elapsedMs;
          existing.expiresAtMs = durationMs > 0 ? elapsedMs + durationMs : 0;
          existing.sourceEid = sourceEid;
          existing.nextTickAtMs = def.tickIntervalMs > 0 ? elapsedMs + def.tickIntervalMs : 0;
          break;
        case "refresh":
          existing.expiresAtMs = durationMs > 0 ? elapsedMs + durationMs : existing.expiresAtMs;
          existing.sourceEid = sourceEid;
          break;
        case "stack_add":
          existing.stacks = Math.min(existing.stacks + resolvedStacks, def.maxStacks);
          existing.expiresAtMs = durationMs > 0 ? elapsedMs + durationMs : existing.expiresAtMs;
          break;
        case "max":
          existing.stacks = Math.max(existing.stacks, resolvedStacks);
          existing.expiresAtMs = durationMs > 0 ? Math.max(existing.expiresAtMs, elapsedMs + durationMs) : existing.expiresAtMs;
          break;
      }
    } else {
      activeList.push({
        statusId,
        appliedAtMs: elapsedMs,
        expiresAtMs: durationMs > 0 ? elapsedMs + durationMs : 0,
        stacks: resolvedStacks,
        nextTickAtMs: def.tickIntervalMs > 0 ? elapsedMs + def.tickIntervalMs : 0,
        sourceEid
      });
      this.active.set(targetEid, activeList);
    }

    this.events.emit(GameEvent.STATUS_APPLIED, {
      targetEid, statusId, durationMs, stacks: resolvedStacks, sourceEid
    });
  }

  public remove(targetEid: number, statusId: string, reason: "expired" | "dispelled" | "death"): void {
    const activeList = this.active.get(targetEid);
    if (!activeList) return;
    const idx = activeList.findIndex((s) => s.statusId === statusId);
    if (idx < 0) return;
    activeList.splice(idx, 1);
    if (activeList.length === 0) this.active.delete(targetEid);
    this.events.emit(GameEvent.STATUS_REMOVED, { targetEid, statusId, reason });
  }

  public removeAll(targetEid: number, reason: "dispelled" | "death"): void {
    const activeList = this.active.get(targetEid);
    if (!activeList) return;
    const removed = [...activeList];
    this.active.delete(targetEid);
    for (const status of removed) {
      this.events.emit(GameEvent.STATUS_REMOVED, { targetEid, statusId: status.statusId, reason });
    }
  }

  public hasStatus(targetEid: number, statusId: string): boolean {
    const activeList = this.active.get(targetEid);
    if (!activeList) return false;
    return activeList.some((s) => s.statusId === statusId);
  }

  public getActiveStatuses(targetEid: number): readonly ActiveStatus[] {
    return this.active.get(targetEid) ?? [];
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  public step(elapsedMs: number): void {
    for (const [eid, statuses] of this.active) {
      for (let i = statuses.length - 1; i >= 0; i--) {
        const status = statuses[i];
        if (!status) continue;

        // Check expiration
        if (status.expiresAtMs > 0 && elapsedMs >= status.expiresAtMs) {
          statuses.splice(i, 1);
          this.events.emit(GameEvent.STATUS_REMOVED, { targetEid: eid, statusId: status.statusId, reason: "expired" });
          continue;
        }

        // Check tick
        const def = this.definitions.get(status.statusId);
        if (!def || def.tickIntervalMs <= 0 || status.nextTickAtMs <= 0) continue;
        if (elapsedMs < status.nextTickAtMs) continue;

        status.nextTickAtMs = elapsedMs + def.tickIntervalMs;

        // Apply tick effects via ECS components
        const hp = this.components.Health;
        if (def.damagePerTick !== undefined) {
          const damage = def.damagePerTick * status.stacks;
          const currentHp = hp.value[eid] ?? 0;
          hp.value[eid] = Math.max(0, currentHp - damage);
          this.events.emit(GameEvent.HEALTH_CHANGED, {
            eid, previous: currentHp, current: hp.value[eid]!, max: hp.max[eid] ?? 0
          });
        }
        if (def.healPerTick !== undefined) {
          const heal = def.healPerTick * status.stacks;
          const currentHp = hp.value[eid] ?? 0;
          const maxHp = hp.max[eid] ?? 0;
          hp.value[eid] = Math.min(maxHp, currentHp + heal);
        }
      }

      // Cleanup empty lists
      if (statuses.length === 0) {
        this.active.delete(eid);
      }
    }
  }

  // ── Query helpers (for other systems) ──────────────────────────────────────

  public getDamageMultiplier(targetEid: number): number {
    let mult = 1;
    const statuses = this.active.get(targetEid);
    if (!statuses) return mult;
    for (const s of statuses) {
      const def = this.definitions.get(s.statusId);
      if (def?.damageTakenMultiplier !== undefined) {
        mult *= def.damageTakenMultiplier;
      }
    }
    return mult;
  }

  public getSpeedMultiplier(targetEid: number): number {
    let mult = 1;
    const statuses = this.active.get(targetEid);
    if (!statuses) return mult;
    for (const s of statuses) {
      const def = this.definitions.get(s.statusId);
      if (def?.speedMultiplier !== undefined) {
        mult *= def.speedMultiplier;
      }
    }
    return mult;
  }

  public getStatModifiers(targetEid: number): Record<string, number> {
    const mods: Record<string, number> = {};
    const statuses = this.active.get(targetEid);
    if (!statuses) return mods;
    for (const s of statuses) {
      const def = this.definitions.get(s.statusId);
      if (!def?.statModifiers) continue;
      for (const [stat, val] of Object.entries(def.statModifiers)) {
        mods[stat] = (mods[stat] ?? 0) + val * s.stacks;
      }
    }
    return mods;
  }

  // ── Event subscriptions ────────────────────────────────────────────────────

  private subscribeEvents(): void {
    // Remove all statuses on death
    this.events.on<HealthChangedPayload>(GameEvent.HEALTH_CHANGED, (payload) => {
      if (payload.current <= 0) {
        this.removeAll(payload.eid, "death");
      }
    });
  }
}
