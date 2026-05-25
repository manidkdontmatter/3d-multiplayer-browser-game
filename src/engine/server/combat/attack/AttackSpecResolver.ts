/**
 * Purpose: This file resolves canonical deterministic attack execution specs from shared profiles.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and translates attack intent/profile data into concrete runtime spawn requests.
 */
import {
  resolveCombatTargetPolicy,
  resolveProjectileProfile,
  seedToUnitFloat,
  type AttackIntent,
  type CombatTargetPolicyProfile,
  type ProjectileAbilityProfile
} from "../../../shared/index";

export interface ResolvedProjectileSpawnSpec {
  readonly ownerEid: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly radius: number;
  readonly damage: number;
  readonly lifetimeSeconds: number;
  readonly maxRange: number;
  readonly gravity: number;
  readonly drag: number;
  readonly maxSpeed: number;
  readonly minSpeed: number;
  readonly pierceCount: number;
  readonly despawnOnDamageableHit: boolean;
  readonly despawnOnWorldHit: boolean;
  readonly targetPolicy: CombatTargetPolicyProfile;
  readonly patternSeed: number;
  readonly patternKind: number;
  readonly patternSpiralFrequencyHz: number;
  readonly patternSpiralStrength: number;
  readonly baseDirX: number;
  readonly baseDirY: number;
  readonly baseDirZ: number;
}

export class AttackSpecResolver {
  public resolveProjectileSpawn(
    intent: AttackIntent,
    origin: { x: number; y: number; z: number },
    projectile: ProjectileAbilityProfile,
    shotSeed: number
  ): ResolvedProjectileSpawnSpec {
    const resolved = resolveProjectileProfile(projectile);
    const viewDirection = this.computeViewDirection(intent.aimYaw, intent.aimPitch);
    const direction = this.applyPatternSpread(
      resolved.patternType,
      viewDirection,
      resolved.spreadAngleDegrees,
      shotSeed
    );
    const spawnX = origin.x + direction.x * resolved.spawnForwardOffset;
    const spawnY = origin.y + resolved.spawnVerticalOffset + direction.y * resolved.spawnForwardOffset;
    const spawnZ = origin.z + direction.z * resolved.spawnForwardOffset;
    return {
      ownerEid: intent.attackerEid,
      kind: resolved.kind,
      x: spawnX,
      y: spawnY,
      z: spawnZ,
      vx: direction.x * resolved.speed,
      vy: direction.y * resolved.speed,
      vz: direction.z * resolved.speed,
      radius: resolved.radius,
      damage: resolved.damage,
      lifetimeSeconds: resolved.lifetimeSeconds,
      maxRange: resolved.maxRange,
      gravity: resolved.gravity,
      drag: resolved.drag,
      maxSpeed: resolved.maxSpeed,
      minSpeed: resolved.minSpeed,
      pierceCount: resolved.pierceCount,
      despawnOnDamageableHit: resolved.despawnOnDamageableHit,
      despawnOnWorldHit: resolved.despawnOnWorldHit,
      targetPolicy: resolved.targetPolicy,
      patternSeed: shotSeed >>> 0,
      patternKind: this.patternTypeToKind(resolved.patternType),
      patternSpiralFrequencyHz: resolved.spiralFrequencyHz,
      patternSpiralStrength: resolved.spiralStrength,
      baseDirX: direction.x,
      baseDirY: direction.y,
      baseDirZ: direction.z
    };
  }

  public resolveMeleeTargetPolicy(melee: { targetPolicy?: Partial<CombatTargetPolicyProfile> | null }): CombatTargetPolicyProfile {
    return resolveCombatTargetPolicy(melee.targetPolicy);
  }

  private patternTypeToKind(type: "straight" | "spiral" | "spread" | "spread_spiral"): number {
    if (type === "spiral") return 1;
    if (type === "spread") return 2;
    if (type === "spread_spiral") return 3;
    return 0;
  }

  private computeViewDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
    const cosPitch = Math.cos(pitch);
    const x = -Math.sin(yaw) * cosPitch;
    const y = Math.sin(pitch);
    const z = -Math.cos(yaw) * cosPitch;
    return this.normalize({ x, y, z }, { x: 0, y: 0, z: -1 });
  }

  private applyPatternSpread(
    patternType: "straight" | "spiral" | "spread" | "spread_spiral",
    baseDirection: { x: number; y: number; z: number },
    spreadAngleDegrees: number,
    seed: number
  ): { x: number; y: number; z: number } {
    if (patternType !== "spread" && patternType !== "spread_spiral") {
      return baseDirection;
    }
    const spreadRadians = (Math.max(0, spreadAngleDegrees) * Math.PI) / 180;
    if (spreadRadians <= 1e-6) {
      return baseDirection;
    }
    const right = this.computeRightVector(baseDirection);
    const up = this.cross(baseDirection, right);
    const theta = seedToUnitFloat(seed ^ 0x7f4a7c15) * Math.PI * 2;
    const radius = seedToUnitFloat(seed ^ 0x19f9f16f) * spreadRadians;
    const tangentX = Math.cos(theta) * radius;
    const tangentY = Math.sin(theta) * radius;
    const out = {
      x: baseDirection.x + right.x * tangentX + up.x * tangentY,
      y: baseDirection.y + right.y * tangentX + up.y * tangentY,
      z: baseDirection.z + right.z * tangentX + up.z * tangentY
    };
    return this.normalize(out, baseDirection);
  }

  private computeRightVector(direction: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const worldUp = Math.abs(direction.y) > 0.98 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const right = this.cross(worldUp, direction);
    return this.normalize(right, { x: 1, y: 0, z: 0 });
  }

  private cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  private normalize(
    value: { x: number; y: number; z: number },
    fallback: { x: number; y: number; z: number }
  ): { x: number; y: number; z: number } {
    const magnitude = Math.hypot(value.x, value.y, value.z);
    if (magnitude <= 1e-6) {
      return fallback;
    }
    const inv = 1 / magnitude;
    return {
      x: value.x * inv,
      y: value.y * inv,
      z: value.z * inv
    };
  }
}
