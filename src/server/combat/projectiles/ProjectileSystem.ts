import RAPIER from "@dimforge/rapier3d-compat";
import type { CombatTarget } from "../damage/DamageSystem";

const PROJECTILE_MIN_RADIUS = 0.005;
const PROJECTILE_RADIUS_CACHE_SCALE = 1000;
const PROJECTILE_SPEED_EPSILON = 1e-6;
const PROJECTILE_DEFAULT_MAX_RANGE = 260;
const PROJECTILE_CONTACT_EPSILON = 0.002;

export interface ProjectileSpawnRequest {
  readonly ownerNid: number;
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
  readonly maxRange?: number;
  readonly gravity?: number;
  readonly drag?: number;
  readonly maxSpeed?: number;
  readonly minSpeed?: number;
  readonly pierceCount?: number;
  readonly despawnOnDamageableHit?: boolean;
  readonly despawnOnWorldHit?: boolean;
}

type ProjectileRuntimeState = {
  ownerNid: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  damage: number;
  ttlSeconds: number;
  remainingRange: number;
  gravity: number;
  drag: number;
  maxSpeed: number;
  minSpeed: number;
  remainingPierces: number;
  despawnOnDamageableHit: boolean;
  despawnOnWorldHit: boolean;
};

export interface ProjectileSystemOptions {
  readonly world: RAPIER.World;
  readonly getOwnerCollider: (ownerNid: number) => RAPIER.Collider | undefined;
  readonly resolveTargetByColliderHandle: (colliderHandle: number) => CombatTarget | null;
  readonly applyDamage: (target: CombatTarget, damage: number) => void;
  readonly createProjectile: (request: ProjectileSpawnRequest) => number | null;
  readonly getProjectileState: (eid: number) => ProjectileRuntimeState | null;
  readonly applyProjectileState: (eid: number, state: ProjectileRuntimeState) => void;
  readonly removeProjectile: (eid: number) => void;
}

export class ProjectileSystem {
  private readonly projectileEids = new Set<number>();
  private readonly projectileCastShapeCache = new Map<number, RAPIER.Ball>();
  private readonly identityRotation: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };

  public constructor(private readonly options: ProjectileSystemOptions) {}

  public spawn(request: ProjectileSpawnRequest): void {
    const eid = this.options.createProjectile(request);
    if (typeof eid !== "number") {
      return;
    }
    this.projectileEids.add(eid);
  }

  public step(deltaSeconds: number): void {
    for (const eid of Array.from(this.projectileEids)) {
      const projectile = this.options.getProjectileState(eid);
      if (!projectile) {
        this.projectileEids.delete(eid);
        continue;
      }
      projectile.ttlSeconds -= deltaSeconds;
      if (projectile.ttlSeconds <= 0) {
        this.removeProjectile(eid);
        continue;
      }

      this.integrateMotion(projectile, deltaSeconds);
      const speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
      if (speed <= PROJECTILE_SPEED_EPSILON || speed < projectile.minSpeed) {
        this.removeProjectile(eid);
        continue;
      }
      const maxTravelTime = this.resolveProjectileMaxTravelTime(
        deltaSeconds,
        projectile.remainingRange,
        speed
      );
      const collision = this.castProjectileCollision(projectile, maxTravelTime);
      const traveledTime = collision ? collision.timeOfImpact : maxTravelTime;
      const traveledDistance = speed * traveledTime;
      projectile.remainingRange -= traveledDistance;
      if (projectile.remainingRange <= 0) {
        this.removeProjectile(eid);
        continue;
      }
      if (collision) {
        projectile.x += projectile.vx * traveledTime;
        projectile.y += projectile.vy * traveledTime;
        projectile.z += projectile.vz * traveledTime;
        if (collision.target) {
          this.options.applyDamage(collision.target, projectile.damage);
          const canPierceTarget = projectile.remainingPierces > 0;
          if (canPierceTarget) {
            projectile.remainingPierces -= 1;
            projectile.x += projectile.vx * PROJECTILE_CONTACT_EPSILON;
            projectile.y += projectile.vy * PROJECTILE_CONTACT_EPSILON;
            projectile.z += projectile.vz * PROJECTILE_CONTACT_EPSILON;
            this.options.applyProjectileState(eid, projectile);
            continue;
          }
          if (!projectile.despawnOnDamageableHit) {
            projectile.x += projectile.vx * PROJECTILE_CONTACT_EPSILON;
            projectile.y += projectile.vy * PROJECTILE_CONTACT_EPSILON;
            projectile.z += projectile.vz * PROJECTILE_CONTACT_EPSILON;
            this.options.applyProjectileState(eid, projectile);
            continue;
          }
          this.removeProjectile(eid);
          continue;
        }
        if (projectile.despawnOnWorldHit) {
          this.removeProjectile(eid);
          continue;
        }
      }

      if (!collision) {
        projectile.x += projectile.vx * traveledTime;
        projectile.y += projectile.vy * traveledTime;
        projectile.z += projectile.vz * traveledTime;
      }
      this.options.applyProjectileState(eid, projectile);
    }
  }

  public removeByOwner(ownerNid: number): void {
    const normalizedOwnerNid = Math.max(0, Math.floor(ownerNid));
    for (const eid of Array.from(this.projectileEids)) {
      const projectile = this.options.getProjectileState(eid);
      if (!projectile) {
        this.projectileEids.delete(eid);
        continue;
      }
      if (projectile.ownerNid === normalizedOwnerNid) {
        this.removeProjectile(eid);
      }
    }
  }

  public getActiveCount(): number {
    return this.projectileEids.size;
  }

  private removeProjectile(eid: number): void {
    this.projectileEids.delete(eid);
    this.options.removeProjectile(eid);
  }

  private resolveProjectileMaxTravelTime(
    tickDeltaSeconds: number,
    remainingRange: number,
    speed: number
  ): number {
    if (speed <= PROJECTILE_SPEED_EPSILON || remainingRange <= 0) {
      return 0;
    }
    const rangeLimitedTime = remainingRange / speed;
    return Math.max(0, Math.min(tickDeltaSeconds, rangeLimitedTime));
  }

  private castProjectileCollision(
    projectile: ProjectileRuntimeState,
    maxTravelTime: number
  ): { timeOfImpact: number; target: CombatTarget | null } | null {
    if (maxTravelTime <= 0) {
      return null;
    }
    const ownerCollider = this.options.getOwnerCollider(projectile.ownerNid);
    const shape = this.getProjectileCastShape(projectile.radius);
    const hit = this.options.world.castShape(
      { x: projectile.x, y: projectile.y, z: projectile.z },
      this.identityRotation,
      { x: projectile.vx, y: projectile.vy, z: projectile.vz },
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
    return {
      timeOfImpact,
      target: hitTarget
    };
  }

  private integrateMotion(projectile: ProjectileRuntimeState, deltaSeconds: number): void {
    if (projectile.gravity !== 0) {
      projectile.vy += projectile.gravity * deltaSeconds;
    }
    if (projectile.drag > 0) {
      const dragScale = Math.max(0, 1 - projectile.drag * deltaSeconds);
      projectile.vx *= dragScale;
      projectile.vy *= dragScale;
      projectile.vz *= dragScale;
    }
    if (Number.isFinite(projectile.maxSpeed) && projectile.maxSpeed > 0) {
      const speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
      if (speed > projectile.maxSpeed && speed > PROJECTILE_SPEED_EPSILON) {
        const scale = projectile.maxSpeed / speed;
        projectile.vx *= scale;
        projectile.vy *= scale;
        projectile.vz *= scale;
      }
    }
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
