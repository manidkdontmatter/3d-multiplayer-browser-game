// Resolves declarative EffectModifiers into runtime consequences via ECS + EventBus.
// This is the execution side of the creator pipeline: blueprints compile into
// EffectModifier[], and the EffectResolver applies them at runtime.
// Called by ability hits, projectile impacts, status ticks, trait triggers, etc.

import type RAPIER from "@dimforge/rapier3d-compat";
import type { EffectModifier } from "../../../shared/traits";
import type { WorldWithComponents } from "../../ecs/SimulationEcsTypes";
import type { EventBus } from "../../events/EventBus";
import { GameEvent, type HealthChangedPayload, type DamageDealtPayload, type EffectSpawnEntityPayload } from "../../events/GameEvents";
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
        // ── Passive stat/damage modifiers ──────────────────────────────────
        // These are stored as data on the entity (trait, item, ability) and
        // read by combat/movement systems at computation time. No runtime
        // action needed here — the modifier IS the data.
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

        // ── Deal raw damage ───────────────────────────────────────────────
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
            healAmount += Math.floor(maxHp * mod.percentMaxHealth);
          }
          hp.value[ctx.targetEid] = Math.min(maxHp, prevHp + healAmount);
          break;
        }

        // ── Modify stat (via temporary status) ────────────────────────────
        case "modify_stat": {
          // Dynamically register a temporary status carrying the stat modifier.
          const tempId = `__effect_stat_${mod.stat}_${ctx.sourceEid ?? 0}_${ctx.elapsedMs}`;
          this.statusEffects.registerDefinition({
            id: tempId, key: tempId, name: `Effect: ${mod.stat}`,
            description: `Temporary stat modifier from effect.`,
            durationMs: 0, tickIntervalMs: 0, maxStacks: 1, stackPolicy: "replace",
            statModifiers: {
              [mod.stat]: (mod.additive ?? 0) + (mod.multiplier ?? 1) - 1
            }
          });
          this.statusEffects.apply(ctx.targetEid, tempId, mod.durationMs, 1, ctx.sourceEid, ctx.elapsedMs);
          break;
        }

        // ── Modify speed (via temporary status) ───────────────────────────
        case "modify_speed": {
          const tempId = `__effect_speed_${ctx.sourceEid ?? 0}_${ctx.elapsedMs}`;
          this.statusEffects.registerDefinition({
            id: tempId, key: tempId, name: "Effect: Speed",
            description: `Temporary speed modifier from effect.`,
            durationMs: 0, tickIntervalMs: 0, maxStacks: 1, stackPolicy: "replace",
            speedMultiplier: mod.multiplier
          });
          this.statusEffects.apply(ctx.targetEid, tempId, mod.durationMs, 1, ctx.sourceEid, ctx.elapsedMs);
          break;
        }

        // ── Spawn entity ──────────────────────────────────────────────────
        case "spawn_entity":
          this.events.emit<EffectSpawnEntityPayload>(GameEvent.EFFECT_SPAWN_ENTITY, {
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
