import RAPIER from "@dimforge/rapier3d-compat";
import type { MeleeAbilityProfile } from "../../../shared/index";
import type { CombatTarget } from "../damage/DamageSystem";

const MELEE_DIRECTION_EPSILON = 1e-6;

export interface MeleeAttacker {
  nid: number;
  yaw: number;
  pitch: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface MeleeCombatSystemOptions {
  readonly world: RAPIER.World;
  readonly playerCapsuleRadius: number;
  readonly playerCapsuleHalfHeight: number;
  readonly dummyRadius: number;
  readonly dummyHalfHeight: number;
  readonly getTargets: () => Iterable<CombatTarget>;
  readonly resolveTargetRuntime: (target: CombatTarget) => {
    nid: number;
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  } | null;
  readonly applyDamage: (target: CombatTarget, damage: number) => void;
}

export class MeleeCombatSystem {
  public constructor(private readonly options: MeleeCombatSystemOptions) {}

  public tryApplyMeleeHit(attacker: MeleeAttacker, meleeProfile: MeleeAbilityProfile): void {
    const hitTarget = this.findMeleeHitTarget(attacker, meleeProfile);
    if (!hitTarget) {
      return;
    }
    this.options.applyDamage(hitTarget, meleeProfile.damage);
  }

  private findMeleeHitTarget(
    attacker: MeleeAttacker,
    meleeProfile: MeleeAbilityProfile
  ): CombatTarget | null {
    const direction = this.computeViewDirection(attacker.yaw, attacker.pitch);
    const attackerBody = attacker.body.translation();
    const originX = attackerBody.x;
    const originY = attackerBody.y;
    const originZ = attackerBody.z;
    const range = Math.max(0.1, meleeProfile.range);
    const halfArcRadians = (Math.max(5, Math.min(175, meleeProfile.arcDegrees)) * Math.PI) / 360;
    const minFacingDot = Math.cos(halfArcRadians);
    const maxCenterDistance =
      range +
      this.options.playerCapsuleRadius * 2 +
      meleeProfile.radius +
      this.options.dummyRadius;
    const maxCenterDistanceSq = maxCenterDistance * maxCenterDistance;
    const attackEndX = originX + direction.x * range;
    const attackEndY = originY + direction.y * range;
    const attackEndZ = originZ + direction.z * range;
    let bestTarget: CombatTarget | null = null;
    let bestForwardDistance = Number.POSITIVE_INFINITY;

    for (const target of this.options.getTargets()) {
      const runtime = this.options.resolveTargetRuntime(target);
      if (!runtime) {
        continue;
      }
      if (target.kind === "player" && runtime.nid === attacker.nid) {
        continue;
      }

      const targetBody = runtime.body;
      const targetRadius = this.getCombatTargetRadius(target);
      const targetHalfHeight = this.getCombatTargetHalfHeight(target);
      const bodyPos = targetBody.translation();
      const centerDx = bodyPos.x - originX;
      const centerDy = bodyPos.y - originY;
      const centerDz = bodyPos.z - originZ;
      const centerDistanceSq = centerDx * centerDx + centerDy * centerDy + centerDz * centerDz;
      if (centerDistanceSq > maxCenterDistanceSq) {
        continue;
      }

      const centerDistance = Math.sqrt(Math.max(centerDistanceSq, 0));
      if (centerDistance > 1e-6) {
        const facingDot =
          (centerDx * direction.x + centerDy * direction.y + centerDz * direction.z) / centerDistance;
        if (facingDot < minFacingDot) {
          continue;
        }
      }

      const segmentMinY = bodyPos.y - targetHalfHeight;
      const segmentMaxY = bodyPos.y + targetHalfHeight;
      const combinedRadius = meleeProfile.radius + targetRadius;
      const combinedRadiusSq = combinedRadius * combinedRadius;
      const distanceSq = this.segmentSegmentDistanceSq(
        originX,
        originY,
        originZ,
        attackEndX,
        attackEndY,
        attackEndZ,
        bodyPos.x,
        segmentMinY,
        bodyPos.z,
        bodyPos.x,
        segmentMaxY,
        bodyPos.z
      );
      if (distanceSq > combinedRadiusSq) {
        continue;
      }

      const forwardDistance =
        centerDx * direction.x + centerDy * direction.y + centerDz * direction.z;
      if (forwardDistance < bestForwardDistance && this.hasMeleeLineOfSight(attacker, target, range)) {
        bestForwardDistance = forwardDistance;
        bestTarget = target;
      }
    }

    return bestTarget;
  }

  private hasMeleeLineOfSight(attacker: MeleeAttacker, target: CombatTarget, range: number): boolean {
    const runtime = this.options.resolveTargetRuntime(target);
    if (!runtime) {
      return false;
    }
    const targetBody = runtime.body;
    const start = attacker.body.translation();
    const end = targetBody.translation();
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const deltaZ = end.z - start.z;
    const distance = Math.hypot(deltaX, deltaY, deltaZ);
    if (distance <= 1e-6) {
      return true;
    }
    const dir = { x: deltaX / distance, y: deltaY / distance, z: deltaZ / distance };
    const castDistance = Math.min(range + this.getCombatTargetRadius(target), distance);
    const hit = this.options.world.castRay(
      new RAPIER.Ray({ x: start.x, y: start.y, z: start.z }, dir),
      castDistance,
      true,
      undefined,
      undefined,
      attacker.collider
    );
    if (!hit) {
      return true;
    }
    return hit.collider.handle === runtime.collider.handle;
  }

  private computeViewDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
    const cosPitch = Math.cos(pitch);
    const x = -Math.sin(yaw) * cosPitch;
    const y = Math.sin(pitch);
    const z = -Math.cos(yaw) * cosPitch;
    const magnitude = Math.hypot(x, y, z);
    if (magnitude <= MELEE_DIRECTION_EPSILON) {
      return { x: 0, y: 0, z: -1 };
    }
    const invMagnitude = 1 / magnitude;
    return {
      x: x * invMagnitude,
      y: y * invMagnitude,
      z: z * invMagnitude
    };
  }

  private getCombatTargetRadius(target: CombatTarget): number {
    return target.kind === "player" ? this.options.playerCapsuleRadius : this.options.dummyRadius;
  }

  private getCombatTargetHalfHeight(target: CombatTarget): number {
    return target.kind === "player"
      ? this.options.playerCapsuleHalfHeight
      : this.options.dummyHalfHeight;
  }

  private segmentSegmentDistanceSq(
    p1x: number,
    p1y: number,
    p1z: number,
    q1x: number,
    q1y: number,
    q1z: number,
    p2x: number,
    p2y: number,
    p2z: number,
    q2x: number,
    q2y: number,
    q2z: number
  ): number {
    const d1x = q1x - p1x;
    const d1y = q1y - p1y;
    const d1z = q1z - p1z;
    const d2x = q2x - p2x;
    const d2y = q2y - p2y;
    const d2z = q2z - p2z;
    const rx = p1x - p2x;
    const ry = p1y - p2y;
    const rz = p1z - p2z;
    const a = d1x * d1x + d1y * d1y + d1z * d1z;
    const e = d2x * d2x + d2y * d2y + d2z * d2z;
    const f = d2x * rx + d2y * ry + d2z * rz;
    const epsilon = 1e-6;

    let s = 0;
    let t = 0;

    if (a <= epsilon && e <= epsilon) {
      return rx * rx + ry * ry + rz * rz;
    }

    if (a <= epsilon) {
      s = 0;
      t = this.clamp01(f / e);
    } else {
      const c = d1x * rx + d1y * ry + d1z * rz;
      if (e <= epsilon) {
        t = 0;
        s = this.clamp01(-c / a);
      } else {
        const b = d1x * d2x + d1y * d2y + d1z * d2z;
        const denom = a * e - b * b;
        if (denom > epsilon) {
          s = this.clamp01((b * f - c * e) / denom);
        } else {
          s = 0;
        }
        t = (b * s + f) / e;

        if (t < 0) {
          t = 0;
          s = this.clamp01(-c / a);
        } else if (t > 1) {
          t = 1;
          s = this.clamp01((b - c) / a);
        }
      }
    }

    const c1x = p1x + d1x * s;
    const c1y = p1y + d1y * s;
    const c1z = p1z + d1z * s;
    const c2x = p2x + d2x * t;
    const c2y = p2y + d2y * t;
    const c2z = p2z + d2z * t;
    const dx = c1x - c2x;
    const dy = c1y - c2y;
    const dz = c1z - c2z;
    return dx * dx + dy * dy + dz * dz;
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(1, value));
  }
}
