/**
 * Purpose: This file simulates projectile spawn, travel, and hit behavior.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { asBuffer, query } from "bitecs";
import type { WorldWithComponents } from "../../ecs/SimulationEcsTypes";
import type { CombatTarget } from "../damage/DamageSystem";

const PROJECTILE_MIN_RADIUS = 0.005;
const PROJECTILE_RADIUS_CACHE_SCALE = 1000;
const PROJECTILE_SPEED_EPSILON = 1e-6;
const PROJECTILE_DEFAULT_MAX_RANGE = 260;
const PROJECTILE_CONTACT_EPSILON = 0.002;

export interface ProjectileSystemOptions {
  readonly world: RAPIER.World;
  readonly ecsWorld: WorldWithComponents;
  readonly getOwnerColliderByNid: (ownerNid: number) => RAPIER.Collider | undefined;
  readonly resolveTargetByColliderHandle: (colliderHandle: number) => CombatTarget | null;
  readonly applyDamage: (target: CombatTarget, damage: number) => void;
  readonly despawnProjectile: (eid: number) => void;
}

export class ProjectileSystem {
  private readonly projectileCastShapeCache = new Map<number, RAPIER.Ball>();
  private readonly identityRotation: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };

  public constructor(private readonly options: ProjectileSystemOptions) {}

  public step(deltaSeconds: number): void {
    const w = this.options.ecsWorld;
    const c = w.components;
    const eids = query(w, [w.components.ProjectileTag], asBuffer);

    for (let i = 0; i < eids.length; i += 1) {
      const eid = eids[i]!;

      let ttlSeconds = c.ProjectileTtl.value[eid] ?? 0;
      ttlSeconds -= deltaSeconds;
      if (ttlSeconds <= 0) {
        this.options.despawnProjectile(eid);
        continue;
      }

      let x = c.Position.x[eid] ?? 0;
      let y = c.Position.y[eid] ?? 0;
      let z = c.Position.z[eid] ?? 0;
      let vx = c.Velocity.x[eid] ?? 0;
      let vy = c.Velocity.y[eid] ?? 0;
      let vz = c.Velocity.z[eid] ?? 0;
      let remainingRange = c.ProjectileRemainingRange.value[eid] ?? 0;
      let remainingPierces = c.ProjectileRemainingPierces.value[eid] ?? 0;

      const gravity = c.ProjectileGravity.value[eid] ?? 0;
      const drag = c.ProjectileDrag.value[eid] ?? 0;
      const maxSpeed = c.ProjectileMaxSpeed.value[eid] ?? Number.POSITIVE_INFINITY;
      const minSpeed = c.ProjectileMinSpeed.value[eid] ?? 0;

      // Integrate motion (velocity only; position is advanced after collision cast).
      if (gravity !== 0) {
        vy += gravity * deltaSeconds;
      }
      if (drag > 0) {
        const dragScale = Math.max(0, 1 - drag * deltaSeconds);
        vx *= dragScale;
        vy *= dragScale;
        vz *= dragScale;
      }
      if (Number.isFinite(maxSpeed) && maxSpeed > 0) {
        const speed = Math.hypot(vx, vy, vz);
        if (speed > maxSpeed && speed > PROJECTILE_SPEED_EPSILON) {
          const scale = maxSpeed / speed;
          vx *= scale;
          vy *= scale;
          vz *= scale;
        }
      }

      const speed = Math.hypot(vx, vy, vz);
      if (speed <= PROJECTILE_SPEED_EPSILON || speed < minSpeed) {
        this.options.despawnProjectile(eid);
        continue;
      }

      const maxTravelTime = this.resolveProjectileMaxTravelTime(deltaSeconds, remainingRange, speed);
      const collision = this.castProjectileCollision(eid, x, y, z, vx, vy, vz, maxTravelTime);
      const traveledTime = collision ? collision.timeOfImpact : maxTravelTime;
      const traveledDistance = speed * traveledTime;
      remainingRange -= traveledDistance;
      if (remainingRange <= 0) {
        this.options.despawnProjectile(eid);
        continue;
      }

      if (collision) {
        x += vx * traveledTime;
        y += vy * traveledTime;
        z += vz * traveledTime;

        if (collision.target) {
          const damage = c.ProjectileDamage.value[eid] ?? 0;
          this.options.applyDamage(collision.target, damage);

          const canPierceTarget = remainingPierces > 0;
          if (canPierceTarget) {
            remainingPierces -= 1;
            x += vx * PROJECTILE_CONTACT_EPSILON;
            y += vy * PROJECTILE_CONTACT_EPSILON;
            z += vz * PROJECTILE_CONTACT_EPSILON;
            this.writeProjectileState(eid, { x, y, z, vx, vy, vz, ttlSeconds, remainingRange, remainingPierces });
            continue;
          }

          const despawnOnDamageableHit = (c.ProjectileDespawnOnDamageableHit.value[eid] ?? 0) !== 0;
          if (!despawnOnDamageableHit) {
            x += vx * PROJECTILE_CONTACT_EPSILON;
            y += vy * PROJECTILE_CONTACT_EPSILON;
            z += vz * PROJECTILE_CONTACT_EPSILON;
            this.writeProjectileState(eid, { x, y, z, vx, vy, vz, ttlSeconds, remainingRange, remainingPierces });
            continue;
          }

          this.options.despawnProjectile(eid);
          continue;
        }

        const despawnOnWorldHit = (c.ProjectileDespawnOnWorldHit.value[eid] ?? 0) !== 0;
        if (despawnOnWorldHit) {
          this.options.despawnProjectile(eid);
          continue;
        }
      } else {
        x += vx * traveledTime;
        y += vy * traveledTime;
        z += vz * traveledTime;
      }

      this.writeProjectileState(eid, { x, y, z, vx, vy, vz, ttlSeconds, remainingRange, remainingPierces });
    }
  }

  public removeByOwner(ownerNid: number): void {
    const normalizedOwnerNid = Math.max(0, Math.floor(ownerNid));
    const w = this.options.ecsWorld;
    const c = w.components;
    const eids = query(w, [w.components.ProjectileTag], asBuffer);
    for (let i = 0; i < eids.length; i += 1) {
      const eid = eids[i]!;
      if ((c.ProjectileOwnerNid.value[eid] ?? 0) === normalizedOwnerNid) {
        this.options.despawnProjectile(eid);
      }
    }
  }

  public getActiveCount(): number {
    const w = this.options.ecsWorld;
    return query(w, [w.components.ProjectileTag]).length;
  }

  private writeProjectileState(
    eid: number,
    state: {
      x: number; y: number; z: number;
      vx: number; vy: number; vz: number;
      ttlSeconds: number;
      remainingRange: number;
      remainingPierces: number;
    }
  ): void {
    const c = this.options.ecsWorld.components;
    c.Position.x[eid] = state.x;
    c.Position.y[eid] = state.y;
    c.Position.z[eid] = state.z;
    c.Velocity.x[eid] = state.vx;
    c.Velocity.y[eid] = state.vy;
    c.Velocity.z[eid] = state.vz;
    c.ProjectileTtl.value[eid] = state.ttlSeconds;
    c.ProjectileRemainingRange.value[eid] = state.remainingRange;
    c.ProjectileRemainingPierces.value[eid] = Math.max(0, Math.floor(state.remainingPierces));
  }

  private resolveProjectileMaxTravelTime(tickDeltaSeconds: number, remainingRange: number, speed: number): number {
    if (speed <= PROJECTILE_SPEED_EPSILON || remainingRange <= 0) {
      return 0;
    }
    const rangeLimitedTime = remainingRange / speed;
    return Math.max(0, Math.min(tickDeltaSeconds, rangeLimitedTime));
  }

  private castProjectileCollision(
    projectileEid: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxTravelTime: number
  ): { timeOfImpact: number; target: CombatTarget | null } | null {
    if (maxTravelTime <= 0) {
      return null;
    }
    const c = this.options.ecsWorld.components;
    const ownerNid = c.ProjectileOwnerNid.value[projectileEid] ?? 0;
    const ownerCollider = this.options.getOwnerColliderByNid(ownerNid);
    const radius = c.ProjectileRadius.value[projectileEid] ?? 0;
    const shape = this.getProjectileCastShape(radius);
    const hit = this.options.world.castShape(
      { x, y, z },
      this.identityRotation,
      { x: vx, y: vy, z: vz },
      shape,
      0,
      maxTravelTime,
      true,
      undefined,
      undefined,
      ownerCollider
    );
    if (!hit) {
      return null;
    }
    const timeOfImpact = Math.max(0, Math.min(maxTravelTime, hit.time_of_impact));
    const hitTarget = this.options.resolveTargetByColliderHandle(hit.collider.handle);
    return { timeOfImpact, target: hitTarget };
  }

  private getProjectileCastShape(radius: number): RAPIER.Ball {
    const clampedRadius = Math.max(PROJECTILE_MIN_RADIUS, radius);
    const cacheKey = Math.max(1, Math.round(clampedRadius * PROJECTILE_RADIUS_CACHE_SCALE));
    let shape = this.projectileCastShapeCache.get(cacheKey);
    if (!shape) {
      shape = new RAPIER.Ball(cacheKey / PROJECTILE_RADIUS_CACHE_SCALE);
      this.projectileCastShapeCache.set(cacheKey, shape);
    }
    return shape;
  }

  public static resolveMaxRange(rawMaxRange: number | undefined): number {
    if (typeof rawMaxRange !== "number" || !Number.isFinite(rawMaxRange)) {
      return PROJECTILE_DEFAULT_MAX_RANGE;
    }
    return Math.max(0, rawMaxRange);
  }

  public static resolveOptionalNumber(rawValue: number | undefined, fallback: number): number {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      return fallback;
    }
    return rawValue;
  }
}

