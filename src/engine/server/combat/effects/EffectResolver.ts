// Resolves declarative effect modifiers into runtime consequences.
// Called when an ability hits, a status ticks, or a trait triggers.
// Uses ECS components + EventBus to apply results.

import type RAPIER from "@dimforge/rapier3d-compat";
import type { EffectModifier } from "../../../shared/traits";
import type { WorldWithComponents } from "../../ecs/SimulationEcsTypes";
import type { EventBus } from "../../events/EventBus";
import { GameEvent, type HealthChangedPayload, type DamageDealtPayload } from "../../events/GameEvents";
import type { StatusEffectSystem } from "../status/StatusEffectSystem";

export interface EffectContext {
  sourceEid: number | null;
  targetEid: number;
  sourcePosition?: { x: number; y: number; z: number };
  sourceYaw?: number;
  targetBody?: RAPIER.RigidBody;
  elapsedMs: number;
  getBody: (eid: number) => RAPIER.RigidBody | undefined;
}

export class EffectResolver {
  public constructor(
    private readonly components: WorldWithComponents["components"],
    private readonly events: EventBus,
    private readonly statusEffects: StatusEffectSystem
  ) {}

  public apply(modifiers: readonly EffectModifier[], ctx: EffectContext): void {
    const c = this.components;

    for (const mod of modifiers) {
      switch (mod.type) {
        // ── Stat / damage modifiers (passthrough — these are read by DamageSystem) ─
        case "block_damage":
        case "damage_multiplier":
        case "flat_damage_delta":
        case "min_damage":
        case "max_damage":
        case "immunity_tag":
          break;

        // ── Apply status ──────────────────────────────────────────────────
        case "apply_status":
          this.statusEffects.apply(
            ctx.targetEid, mod.statusId, mod.durationMs, mod.stacks,
            ctx.sourceEid, ctx.elapsedMs
          );
          break;

        // ── Deal damage ───────────────────────────────────────────────────
        case "deal_damage": {
          const hp = c.Health;
          const prevHp = hp.value[ctx.targetEid] ?? 0;
          hp.value[ctx.targetEid] = Math.max(0, prevHp - mod.amount);

          this.events.emit<HealthChangedPayload>(GameEvent.HEALTH_CHANGED, {
            eid: ctx.targetEid, previous: prevHp,
            current: hp.value[ctx.targetEid]!, max: hp.max[ctx.targetEid] ?? 0
          });
          this.events.emit<DamageDealtPayload>(GameEvent.DAMAGE_DEALT, {
            sourceEid: ctx.sourceEid, targetEid: ctx.targetEid,
            amount: mod.amount, kind: "status"
          });
          break;
        }

        // ── Heal ──────────────────────────────────────────────────────────
        case "heal": {
          const hp = c.Health;
          const prevHp = hp.value[ctx.targetEid] ?? 0;
          const maxHp = hp.max[ctx.targetEid] ?? 0;
          let healAmount = mod.amount;
          if (mod.percentMaxHealth !== undefined) {
            healAmount += maxHp * mod.percentMaxHealth;
          }
          hp.value[ctx.targetEid] = Math.min(maxHp, prevHp + healAmount);
          break;
        }

        // ── Modify stat (via status) ──────────────────────────────────────
        case "modify_stat":
          this.statusEffects.apply(
            ctx.targetEid, `stat_mod_${mod.stat}`, mod.durationMs, 1,
            ctx.sourceEid, ctx.elapsedMs
          );
          // Register a temporary status that carries the stat modifier
          // Note: stat_mod_* statuses are auto-generated and carry statModifiers
          break;

        // ── Modify speed (via status) ─────────────────────────────────────
        case "modify_speed":
          this.statusEffects.apply(
            ctx.targetEid, `speed_mod_${ctx.sourceEid ?? 0}_${ctx.elapsedMs}`,
            mod.durationMs, 1, ctx.sourceEid, ctx.elapsedMs
          );
          break;

        // ── Spawn entity ──────────────────────────────────────────────────
        case "spawn_entity":
          // Entity spawning is handled by GameSimulation callbacks.
          // Emit an event so GameSimulation can create the entity.
          this.events.emit("effect.spawnEntity", {
            archetypeId: mod.archetypeId,
            sourceEid: ctx.sourceEid,
            position: ctx.sourcePosition ?? { x: 0, y: 0, z: 0 }
          });
          break;

        // ── Teleport ──────────────────────────────────────────────────────
        case "teleport": {
          const pos = c.Position;
          const body = ctx.targetBody ?? ctx.getBody(ctx.targetEid);
          if (!body) break;

          let dx = 0, dz = 0;
          if (mod.direction === "forward" && ctx.sourceYaw !== undefined) {
            dx = -Math.sin(ctx.sourceYaw) * mod.range;
            dz = -Math.cos(ctx.sourceYaw) * mod.range;
          } else if (mod.direction === "random") {
            const angle = Math.random() * Math.PI * 2;
            dx = Math.cos(angle) * mod.range;
            dz = Math.sin(angle) * mod.range;
          }
          // "target" direction requires target position, handled by caller

          const newX = (pos.x[ctx.targetEid] ?? 0) + dx;
          const newZ = (pos.z[ctx.targetEid] ?? 0) + dz;
          pos.x[ctx.targetEid] = newX;
          pos.z[ctx.targetEid] = newZ;
          body.setTranslation({ x: newX, y: pos.y[ctx.targetEid] ?? 0, z: newZ }, true);
          break;
        }
      }
    }
  }
}
