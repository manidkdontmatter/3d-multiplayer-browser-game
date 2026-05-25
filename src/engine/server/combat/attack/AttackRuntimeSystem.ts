/**
 * Purpose: This file provides the canonical server-side attack execution runtime entrypoint.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and resolves attack intents into melee/projectile execution with deterministic shot seeds.
 */
import type { ProjectileAbilityProfile, RuntimeActivationSpec } from "../../../shared/index";
import { composeAttackSeed, type AttackIntent } from "../../../shared/index";
import { AttackSpecResolver } from "./AttackSpecResolver";

export interface AttackRuntimeSystemOptions {
  readonly worldSeed: number;
  readonly resolveCanonicalAttackerEid?: (attackerEid: number) => number | null;
  readonly executeProjectile: (request: {
    ownerEid: number;
    kind: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    radius: number;
    damage: number;
    lifetimeSeconds: number;
    maxRange: number;
    gravity: number;
    drag: number;
    maxSpeed: number;
    minSpeed: number;
    pierceCount: number;
    despawnOnDamageableHit: boolean;
    despawnOnWorldHit: boolean;
    targetPolicy: {
      allowSelf: boolean;
      allowPlayers: boolean;
      allowNpcs: boolean;
      allowDummies: boolean;
    };
    patternSeed: number;
    patternKind: number;
    patternSpiralFrequencyHz: number;
    patternSpiralStrength: number;
    baseDirX: number;
    baseDirY: number;
    baseDirZ: number;
  }) => void;
  readonly executeMeleeHit: (request: {
    attackerEid: number;
    damage: number;
    range: number;
    radius: number;
    arcDegrees: number;
    targetPolicy: {
      allowSelf: boolean;
      allowPlayers: boolean;
      allowNpcs: boolean;
      allowDummies: boolean;
    };
  }) => void;
}

interface ActiveAttackInstance {
  id: number;
  attackerEid: number;
  activationId: number;
  shotSequence: number;
  shotSeed: number;
  serverTick: number;
}

export class AttackRuntimeSystem {
  private readonly shotSequenceByAttacker = new Map<number, Map<number, number>>();
  private readonly specResolver = new AttackSpecResolver();
  private readonly pooledInstances: ActiveAttackInstance[] = [];
  private readonly activeInstances = new Map<number, ActiveAttackInstance>();
  private nextInstanceId = 1;
  private peakActiveInstances = 0;

  public constructor(private readonly options: AttackRuntimeSystemOptions) {}

  public executeActivationEffects(
    intent: AttackIntent,
    origin: { x: number; y: number; z: number },
    effects: RuntimeActivationSpec["effects"]
  ): boolean {
    const canonicalAttackerEid = this.options.resolveCanonicalAttackerEid?.(intent.attackerEid) ?? intent.attackerEid;
    if (!Number.isFinite(canonicalAttackerEid) || canonicalAttackerEid <= 0) {
      return false;
    }
    const normalizedIntent: AttackIntent = {
      ...intent,
      attackerEid: Math.floor(canonicalAttackerEid)
    };
    const shotSequence = this.allocateShotSequence(normalizedIntent.attackerEid, normalizedIntent.activationId);
    const shotSeed = composeAttackSeed({
      worldSeed: this.options.worldSeed,
      attackerEid: normalizedIntent.attackerEid,
      activationId: normalizedIntent.activationId,
      shotSequence,
      serverTick: normalizedIntent.serverTick
    });
    const instance = this.acquireInstance(
      normalizedIntent,
      shotSequence,
      shotSeed
    );

    let executedAny = false;
    try {
      let effectSequence = 0;
      for (const effect of effects) {
        if (effect.type === "spawn_projectile") {
          const effectSeed = this.deriveEffectSeed(shotSeed, effectSequence);
          this.executeProjectileEffect(
            normalizedIntent,
            origin,
            effect.projectile,
            effectSeed
          );
          executedAny = true;
          effectSequence += 1;
          continue;
        }
        if (effect.type === "apply_melee_hit") {
          this.options.executeMeleeHit({
            attackerEid: normalizedIntent.attackerEid,
            damage: effect.melee.damage,
            range: effect.melee.range,
            radius: effect.melee.radius,
            arcDegrees: effect.melee.arcDegrees,
            targetPolicy: this.specResolver.resolveMeleeTargetPolicy(effect.melee)
          });
          executedAny = true;
          effectSequence += 1;
        }
      }
    } finally {
      this.releaseInstance(instance);
    }
    return executedAny;
  }

  public getRuntimeStats(): { active: number; pooled: number; peakActive: number } {
    return {
      active: this.activeInstances.size,
      pooled: this.pooledInstances.length,
      peakActive: this.peakActiveInstances
    };
  }

  public clearAttackerState(attackerEid: number): void {
    this.shotSequenceByAttacker.delete(Math.floor(attackerEid));
  }

  private executeProjectileEffect(
    intent: AttackIntent,
    origin: { x: number; y: number; z: number },
    projectile: ProjectileAbilityProfile,
    shotSeed: number
  ): void {
    const spawn = this.specResolver.resolveProjectileSpawn(
      intent,
      origin,
      projectile,
      shotSeed
    );
    this.options.executeProjectile(spawn);
  }

  private allocateShotSequence(attackerEid: number, activationId: number): number {
    const normalizedAttackerEid = Math.floor(attackerEid);
    const normalizedActivationId = Math.floor(activationId);
    let perActivation = this.shotSequenceByAttacker.get(normalizedAttackerEid);
    if (!perActivation) {
      perActivation = new Map<number, number>();
      this.shotSequenceByAttacker.set(normalizedAttackerEid, perActivation);
    }
    const next = (perActivation.get(normalizedActivationId) ?? 0) + 1;
    perActivation.set(normalizedActivationId, next);
    return next;
  }

  private deriveEffectSeed(shotSeed: number, effectSequence: number): number {
    const normalizedSequence = Math.max(0, Math.floor(effectSequence)) >>> 0;
    const mixed = (shotSeed ^ Math.imul(normalizedSequence + 1, 0x9e3779b9)) >>> 0;
    return mixed === 0 ? 1 : mixed;
  }

  private acquireInstance(
    intent: AttackIntent,
    shotSequence: number,
    shotSeed: number
  ): ActiveAttackInstance {
    const instance = this.pooledInstances.pop() ?? {
      id: 0,
      attackerEid: 0,
      activationId: 0,
      shotSequence: 0,
      shotSeed: 0,
      serverTick: 0
    };
    instance.id = this.nextInstanceId;
    this.nextInstanceId += 1;
    instance.attackerEid = intent.attackerEid;
    instance.activationId = intent.activationId;
    instance.shotSequence = shotSequence;
    instance.shotSeed = shotSeed;
    instance.serverTick = intent.serverTick;
    this.activeInstances.set(instance.id, instance);
    if (this.activeInstances.size > this.peakActiveInstances) {
      this.peakActiveInstances = this.activeInstances.size;
    }
    return instance;
  }

  private releaseInstance(instance: ActiveAttackInstance): void {
    this.activeInstances.delete(instance.id);
    instance.id = 0;
    instance.attackerEid = 0;
    instance.activationId = 0;
    instance.shotSequence = 0;
    instance.shotSeed = 0;
    instance.serverTick = 0;
    this.pooledInstances.push(instance);
  }

}
