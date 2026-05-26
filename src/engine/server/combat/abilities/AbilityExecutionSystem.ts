/**
 * Purpose: This file manages ability definitions, state, or execution flow.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type { AbilityDefinition } from "../../../shared/index";
import type { RuntimeActivationSpec } from "../../../shared/index";
import type { WorldWithComponents } from "../../ecs/SimulationEcsTypes";
import type { ActionEffectPipeline } from "../actions/ActionEffectPipeline";
import type { ActionEffect } from "../actions/ActionEffectPipeline";
import { AttackRuntimeSystem } from "../attack/AttackRuntimeSystem";

export interface AbilityExecutionSystemOptions {
  readonly getElapsedSeconds: () => number;
  readonly getServerTick: () => number;
  readonly resolveAbilityById: (unlockedAbilityIds: readonly number[], abilityId: number) => AbilityDefinition | null;
  readonly resolveKnownAbilityById?: (abilityId: number) => AbilityDefinition | null;
  readonly resolveAbilityActivationSpec?: (abilityId: number) => RuntimeActivationSpec | null;
  readonly resolveUserIdByEid?: (eid: number) => number | null;
  readonly ecsComponents: WorldWithComponents["components"];
  readonly effectPipeline: ActionEffectPipeline;
  readonly attackRuntime: AttackRuntimeSystem;
}

export class AbilityExecutionSystem {
  private readonly lastFiredByEidAndAbility = new Map<number, Map<number, number>>();

  public constructor(private readonly options: AbilityExecutionSystemOptions) {}

  public clearCooldownsForEid(eid: number): void {
    const normalizedEid = Math.floor(eid);
    this.lastFiredByEidAndAbility.delete(normalizedEid);
  }

  public tryUseAbilityByIdByEid(eid: number, abilityId: number): boolean {
    const c = this.options.ecsComponents;
    const unlocked = c.UnlockedAbilityIds.value[eid] ?? [];
    const ability = this.options.resolveAbilityById(unlocked, abilityId);
    if (!ability) return false;
    return this.executeAbilityByEid(eid, ability);
  }

  public tryUseKnownAbilityByIdByEid(eid: number, abilityId: number): boolean {
    const ability = this.options.resolveKnownAbilityById?.(abilityId) ?? null;
    if (!ability) return false;
    return this.executeAbilityByEid(eid, ability);
  }

  private executeAbilityByEid(eid: number, ability: AbilityDefinition): boolean {
    const c = this.options.ecsComponents;
    const runtimeSpec = this.resolveRuntimeActivationSpec(ability);
    if (!runtimeSpec) return false;
    const cooldown = runtimeSpec.cooldownSeconds;

    const elapsed = this.options.getElapsedSeconds();
    const lastFired = this.getLastFiredSeconds(eid, ability.id);
    if (elapsed - lastFired < cooldown) return false;

    const ownerNid = c.NetworkId.value[eid] ?? 0;
    const x = c.Position.x[eid] ?? 0;
    const y = c.Position.y[eid] ?? 0;
    const z = c.Position.z[eid] ?? 0;
    const userId = this.options.resolveUserIdByEid?.(eid) ?? null;
    let hasCombatEffect = false;
    let hasExecutableNonCombatEffect = false;
    let executedAnyEffect = false;
    for (const effect of runtimeSpec.effects) {
      if (effect.type === "spawn_projectile" || effect.type === "apply_melee_hit") {
        hasCombatEffect = true;
        continue;
      }
      const pipelineEffect = this.mapRuntimeEffectToActionEffect(effect, userId);
      if (!pipelineEffect) {
        continue;
      }
      hasExecutableNonCombatEffect = true;
      if (this.options.effectPipeline.execute(pipelineEffect)) {
        executedAnyEffect = true;
      }
    }

    if (!hasCombatEffect && !hasExecutableNonCombatEffect) {
      return false;
    }

    if (hasCombatEffect) {
      const executedCombatEffect = this.options.attackRuntime.executeActivationEffects(
        {
          attackerEid: eid,
          activationKind: "ability",
          activationId: ability.id,
          aimYaw: c.Yaw.value[eid] ?? 0,
          aimPitch: c.Pitch.value[eid] ?? 0,
          serverTick: this.options.getServerTick()
        },
        { x, y, z },
        runtimeSpec.effects
      );
      if (executedCombatEffect) {
        executedAnyEffect = true;
      }
    }

    if (!executedAnyEffect) {
      return false;
    }

    this.setLastFiredSeconds(eid, ability.id, elapsed);
    this.options.effectPipeline.execute({
      type: "broadcast_ability_use",
      ownerNid,
      abilityId: ability.id,
      x,
      y,
      z
    });

    return true;
  }

  private resolveRuntimeActivationSpec(ability: AbilityDefinition): RuntimeActivationSpec | null {
    const resolved = this.options.resolveAbilityActivationSpec?.(ability.id) ?? null;
    if (resolved) {
      return resolved;
    }
    const effects: RuntimeActivationSpec["effects"][number][] = [];
    let cooldownSeconds = 0;
    if (ability.projectile) {
      effects.push({ type: "spawn_projectile", projectile: ability.projectile });
      cooldownSeconds = Math.max(cooldownSeconds, Math.max(0, ability.projectile.cooldownSeconds));
    }
    if (ability.melee) {
      effects.push({ type: "apply_melee_hit", melee: ability.melee });
      cooldownSeconds = Math.max(cooldownSeconds, Math.max(0, ability.melee.cooldownSeconds));
    }
    if (effects.length === 0) {
      return null;
    }
    return {
      activationId: `ability:${Math.max(0, Math.floor(ability.id))}:fallback`,
      source: "ability",
      channel: 0,
      cooldownSeconds,
      consumeQuantity: 0,
      effects
    };
  }

  private getLastFiredSeconds(eid: number, abilityId: number): number {
    const normalizedEid = Math.floor(eid);
    const normalizedAbilityId = Math.floor(abilityId);
    const perAbility = this.lastFiredByEidAndAbility.get(normalizedEid);
    if (!perAbility) {
      return Number.NEGATIVE_INFINITY;
    }
    return perAbility.get(normalizedAbilityId) ?? Number.NEGATIVE_INFINITY;
  }

  private setLastFiredSeconds(eid: number, abilityId: number, elapsedSeconds: number): void {
    const normalizedEid = Math.floor(eid);
    const normalizedAbilityId = Math.floor(abilityId);
    let perAbility = this.lastFiredByEidAndAbility.get(normalizedEid);
    if (!perAbility) {
      perAbility = new Map<number, number>();
      this.lastFiredByEidAndAbility.set(normalizedEid, perAbility);
    }
    perAbility.set(normalizedAbilityId, elapsedSeconds);
  }

  private mapRuntimeEffectToActionEffect(
    effect: RuntimeActivationSpec["effects"][number],
    userId: number | null
  ): ActionEffect | null {
    if (effect.type === "restore_health") {
      if (typeof userId !== "number") {
        return null;
      }
      return {
        type: "restore_health",
        userId,
        amount: effect.amount
      };
    }
    if (effect.type === "set_player_render_appearance") {
      if (typeof userId !== "number") {
        return null;
      }
      return {
        type: "set_player_render_appearance",
        userId,
        patch: {
          renderArchetypeId: effect.renderArchetypeId,
          materialVariantId: effect.materialVariantId,
          tintColorRgb: effect.tintColorRgb,
          uniformScalePct: effect.uniformScalePct
        }
      };
    }
    if (effect.type === "set_equipped_slot_tint") {
      if (typeof userId !== "number") {
        return null;
      }
      return {
        type: "set_equipped_slot_tint",
        userId,
        slot: effect.slot,
        tintColorRgb: effect.tintColorRgb
      };
    }
    return null;
  }
}
