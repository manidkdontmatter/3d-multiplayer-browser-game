import RAPIER from "@dimforge/rapier3d-compat";
import type { ChannelAABB3D } from "nengi";
import {
  IDENTITY_QUATERNION,
  MODEL_ID_PROJECTILE_PRIMARY,
  NType
} from "../../../shared/index";
import type { CombatTarget } from "../damage/DamageSystem";

const PROJECTILE_POOL_PREWARM = 96;
const PROJECTILE_POOL_MAX = 4096;
const PROJECTILE_MIN_RADIUS = 0.005;
const PROJECTILE_RADIUS_CACHE_SCALE = 1000;
const PROJECTILE_SPEED_EPSILON = 1e-6;
const PROJECTILE_DEFAULT_MAX_RANGE = 260;
const PROJECTILE_CONTACT_EPSILON = 0.002;

type ProjectileEntity = {
  nid: number;
  ntype: NType.BaseEntity;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  health: number;
  maxHealth: number;
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

export interface ProjectileSystemOptions {
  readonly world: RAPIER.World;
  readonly spatialChannel: ChannelAABB3D;
  readonly getOwnerCollider: (ownerNid: number) => RAPIER.Collider | undefined;
  readonly resolveTargetByColliderHandle: (colliderHandle: number) => CombatTarget | null;
  readonly applyDamage: (target: CombatTarget, damage: number) => void;
  readonly onProjectileAdded?: (projectile: ProjectileEntity) => void;
  readonly onProjectileUpdated?: (projectile: ProjectileEntity) => void;
  readonly onProjectileRemoved?: (projectile: ProjectileEntity) => void;
}

export class ProjectileSystem {
  private readonly projectilesByNid = new Map<number, ProjectileEntity>();
  private readonly projectilePool: ProjectileEntity[] = [];
  private readonly projectileCastShapeCache = new Map<number, RAPIER.Ball>();
  private readonly identityRotation: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };

  public constructor(private readonly options: ProjectileSystemOptions) {
    this.prewarmProjectilePool(PROJECTILE_POOL_PREWARM);
  }

  public spawn(request: ProjectileSpawnRequest): void {
    const projectile = this.acquireProjectile();
    projectile.ownerNid = request.ownerNid;
    projectile.kind = request.kind;
    projectile.modelId = this.resolveModelId(request.kind);
    projectile.x = request.x;
    projectile.y = request.y;
    projectile.z = request.z;
    projectile.position.x = request.x;
    projectile.position.y = request.y;
    projectile.position.z = request.z;
    projectile.vx = request.vx;
    projectile.vy = request.vy;
    projectile.vz = request.vz;
    projectile.radius = request.radius;
    projectile.damage = request.damage;
    projectile.ttlSeconds = request.lifetimeSeconds;
    projectile.remainingRange = this.resolveMaxRange(request.maxRange);
    projectile.gravity = this.resolveOptionalNumber(request.gravity, 0);
    projectile.drag = Math.max(0, this.resolveOptionalNumber(request.drag, 0));
    projectile.maxSpeed = Math.max(0, this.resolveOptionalNumber(request.maxSpeed, Number.POSITIVE_INFINITY));
    projectile.minSpeed = Math.max(0, this.resolveOptionalNumber(request.minSpeed, 0));
    projectile.remainingPierces = Math.max(0, Math.floor(this.resolveOptionalNumber(request.pierceCount, 0)));
    projectile.despawnOnDamageableHit =
      typeof request.despawnOnDamageableHit === "boolean" ? request.despawnOnDamageableHit : true;
    projectile.despawnOnWorldHit =
      typeof request.despawnOnWorldHit === "boolean" ? request.despawnOnWorldHit : true;
    this.options.spatialChannel.addEntity(projectile);
    this.projectilesByNid.set(projectile.nid, projectile);
    this.options.onProjectileAdded?.(projectile);
  }

  public step(deltaSeconds: number): void {
    for (const [nid, projectile] of this.projectilesByNid) {
      projectile.ttlSeconds -= deltaSeconds;
      if (projectile.ttlSeconds <= 0) {
        this.removeProjectile(nid, projectile);
        continue;
      }

      this.integrateMotion(projectile, deltaSeconds);
      const speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
      if (speed <= PROJECTILE_SPEED_EPSILON || speed < projectile.minSpeed) {
        this.removeProjectile(nid, projectile);
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
        this.removeProjectile(nid, projectile);
        continue;
      }
      if (collision) {
        projectile.x += projectile.vx * traveledTime;
        projectile.y += projectile.vy * traveledTime;
        projectile.z += projectile.vz * traveledTime;
        projectile.position.x = projectile.x;
        projectile.position.y = projectile.y;
        projectile.position.z = projectile.z;
        if (collision.target) {
          this.options.applyDamage(collision.target, projectile.damage);
          const canPierceTarget = projectile.remainingPierces > 0;
          if (canPierceTarget) {
            projectile.remainingPierces -= 1;
            projectile.x += projectile.vx * PROJECTILE_CONTACT_EPSILON;
            projectile.y += projectile.vy * PROJECTILE_CONTACT_EPSILON;
            projectile.z += projectile.vz * PROJECTILE_CONTACT_EPSILON;
            projectile.position.x = projectile.x;
            projectile.position.y = projectile.y;
            projectile.position.z = projectile.z;
            this.options.onProjectileUpdated?.(projectile);
            continue;
          }
          if (!projectile.despawnOnDamageableHit) {
            projectile.x += projectile.vx * PROJECTILE_CONTACT_EPSILON;
            projectile.y += projectile.vy * PROJECTILE_CONTACT_EPSILON;
            projectile.z += projectile.vz * PROJECTILE_CONTACT_EPSILON;
            projectile.position.x = projectile.x;
            projectile.position.y = projectile.y;
            projectile.position.z = projectile.z;
            this.options.onProjectileUpdated?.(projectile);
            continue;
          }
          this.removeProjectile(nid, projectile);
          continue;
        }
        if (projectile.despawnOnWorldHit) {
          this.removeProjectile(nid, projectile);
          continue;
        }
      }

      if (!collision) {
        projectile.x += projectile.vx * traveledTime;
        projectile.y += projectile.vy * traveledTime;
        projectile.z += projectile.vz * traveledTime;
        projectile.position.x = projectile.x;
        projectile.position.y = projectile.y;
        projectile.position.z = projectile.z;
      }
      this.options.onProjectileUpdated?.(projectile);
    }
  }

  public removeByOwner(ownerNid: number): void {
    for (const [nid, projectile] of this.projectilesByNid) {
      if (projectile.ownerNid === ownerNid) {
        this.removeProjectile(nid, projectile);
      }
    }
  }

  public getActiveCount(): number {
    return this.projectilesByNid.size;
  }

  private resolveMaxRange(rawMaxRange: number | undefined): number {
    if (typeof rawMaxRange !== "number" || !Number.isFinite(rawMaxRange)) {
      return PROJECTILE_DEFAULT_MAX_RANGE;
    }
    return Math.max(0, rawMaxRange);
  }

  private resolveOptionalNumber(rawValue: number | undefined, fallback: number): number {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      return fallback;
    }
    return rawValue;
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
    projectile: ProjectileEntity,
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

  private integrateMotion(projectile: ProjectileEntity, deltaSeconds: number): void {
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

  private removeProjectile(nid: number, projectile: ProjectileEntity): void {
    this.options.spatialChannel.removeEntity(projectile);
    this.projectilesByNid.delete(nid);
    this.options.onProjectileRemoved?.(projectile);
    this.releaseProjectile(projectile);
  }

  private prewarmProjectilePool(count: number): void {
    for (let i = this.projectilePool.length; i < count; i += 1) {
      this.projectilePool.push(this.createPooledProjectile());
    }
  }

  private acquireProjectile(): ProjectileEntity {
    const projectile = this.projectilePool.pop() ?? this.createPooledProjectile();
    projectile.nid = 0;
    projectile.ntype = NType.BaseEntity;
    projectile.modelId = MODEL_ID_PROJECTILE_PRIMARY;
    projectile.position.x = 0;
    projectile.position.y = 0;
    projectile.position.z = 0;
    projectile.rotation.x = IDENTITY_QUATERNION.x;
    projectile.rotation.y = IDENTITY_QUATERNION.y;
    projectile.rotation.z = IDENTITY_QUATERNION.z;
    projectile.rotation.w = IDENTITY_QUATERNION.w;
    projectile.grounded = false;
    projectile.health = 0;
    projectile.maxHealth = 0;
    projectile.ownerNid = 0;
    projectile.kind = 0;
    projectile.x = 0;
    projectile.y = 0;
    projectile.z = 0;
    projectile.vx = 0;
    projectile.vy = 0;
    projectile.vz = 0;
    projectile.radius = 0;
    projectile.damage = 0;
    projectile.ttlSeconds = 0;
    projectile.remainingRange = 0;
    projectile.gravity = 0;
    projectile.drag = 0;
    projectile.maxSpeed = 0;
    projectile.minSpeed = 0;
    projectile.remainingPierces = 0;
    projectile.despawnOnDamageableHit = true;
    projectile.despawnOnWorldHit = true;
    return projectile;
  }

  private releaseProjectile(projectile: ProjectileEntity): void {
    if (this.projectilePool.length >= PROJECTILE_POOL_MAX) {
      return;
    }
    projectile.nid = 0;
    projectile.ownerNid = 0;
    projectile.kind = 0;
    projectile.x = 0;
    projectile.y = -1000;
    projectile.z = 0;
    projectile.position.x = 0;
    projectile.position.y = -1000;
    projectile.position.z = 0;
    projectile.vx = 0;
    projectile.vy = 0;
    projectile.vz = 0;
    projectile.radius = 0;
    projectile.damage = 0;
    projectile.ttlSeconds = 0;
    projectile.remainingRange = 0;
    projectile.gravity = 0;
    projectile.drag = 0;
    projectile.maxSpeed = 0;
    projectile.minSpeed = 0;
    projectile.remainingPierces = 0;
    projectile.despawnOnDamageableHit = true;
    projectile.despawnOnWorldHit = true;
    this.projectilePool.push(projectile);
  }

  private createPooledProjectile(): ProjectileEntity {
    return {
      nid: 0,
      ntype: NType.BaseEntity,
      modelId: MODEL_ID_PROJECTILE_PRIMARY,
      position: { x: 0, y: -1000, z: 0 },
      rotation: { ...IDENTITY_QUATERNION },
      grounded: false,
      health: 0,
      maxHealth: 0,
      ownerNid: 0,
      kind: 0,
      x: 0,
      y: -1000,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      radius: 0,
      damage: 0,
      ttlSeconds: 0,
      remainingRange: 0,
      gravity: 0,
      drag: 0,
      maxSpeed: 0,
      minSpeed: 0,
      remainingPierces: 0,
      despawnOnDamageableHit: true,
      despawnOnWorldHit: true
    };
  }

  private resolveModelId(kind: number): number {
    if (kind === 1) {
      return MODEL_ID_PROJECTILE_PRIMARY;
    }
    return MODEL_ID_PROJECTILE_PRIMARY;
  }
}
