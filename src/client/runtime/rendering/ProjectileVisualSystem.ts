import {
  AdditiveBlending,
  Group,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Scene
} from "three";
import type { ProjectileState } from "../types";

interface ProjectilePalette {
  coreColor: number;
  emissiveColor: number;
  glowColor: number;
  burstColor: number;
}

const DEFAULT_PROJECTILE_PALETTE: Readonly<ProjectilePalette> = Object.freeze({
  coreColor: 0xffdd91,
  emissiveColor: 0xb46a1d,
  glowColor: 0xffd06f,
  burstColor: 0xffd495
});

const PROJECTILE_PALETTES = new Map<number, Readonly<ProjectilePalette>>([
  [
    1,
    Object.freeze({
      coreColor: 0x78dfff,
      emissiveColor: 0x2d9cc5,
      glowColor: 0x67d4ff,
      burstColor: 0x9ce8ff
    })
  ]
]);

const PROJECTILE_VISUAL_POOL_PREWARM = 24;
const PROJECTILE_SPAWN_BURST_POOL_PREWARM = 12;
const PROJECTILE_SPAWN_BURST_POOL_MAX = 80;
const PROJECTILE_SPAWN_BURST_PARTICLE_COUNT = 8;
const PROJECTILE_SPAWN_BURST_DURATION_SECONDS = 0.16;

interface ProjectileFlightVisual {
  readonly root: Group;
  readonly coreMaterial: MeshStandardMaterial;
  readonly glowMaterial: MeshBasicMaterial;
  kind: number;
  pulseTime: number;
}

interface ProjectileBurstParticle {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  readonly velocity: Vector3;
  baseScale: number;
}

interface ProjectileSpawnBurst {
  readonly root: Group;
  readonly particles: ProjectileBurstParticle[];
  kind: number;
  ageSeconds: number;
  durationSeconds: number;
}

export class ProjectileVisualSystem {
  private readonly projectileVisuals = new Map<number, ProjectileFlightVisual>();
  private readonly pooledProjectileVisuals = new Map<number, ProjectileFlightVisual[]>();
  private readonly pooledSpawnBursts = new Map<number, ProjectileSpawnBurst[]>();
  private readonly activeSpawnBursts: ProjectileSpawnBurst[] = [];
  private readonly projectileCoreGeometry = new IcosahedronGeometry(0.12, 1);
  private readonly projectileGlowGeometry = new SphereGeometry(0.24, 10, 8);
  private readonly projectileBurstParticleGeometry = new IcosahedronGeometry(0.045, 0);
  private readonly tempVecA = new Vector3();

  public constructor(private readonly scene: Scene) {
    this.prewarmProjectileVisualPool(1, PROJECTILE_VISUAL_POOL_PREWARM);
    this.prewarmSpawnBurstPool(1, PROJECTILE_SPAWN_BURST_POOL_PREWARM);
  }

  public syncProjectiles(projectiles: ProjectileState[], frameDeltaSeconds = 1 / 60): void {
    const dt = Math.max(1 / 240, Math.min(frameDeltaSeconds, 1 / 20));
    this.updateSpawnBursts(dt);
    const activeNids = new Set<number>();
    for (const projectile of projectiles) {
      activeNids.add(projectile.nid);
      let visual = this.projectileVisuals.get(projectile.nid);
      if (!visual) {
        visual = this.acquireProjectileVisual(projectile.kind);
        this.projectileVisuals.set(projectile.nid, visual);
        visual.root.position.set(projectile.x, projectile.y, projectile.z);
        this.scene.add(visual.root);
        this.emitProjectileSpawnBurst(projectile.kind, projectile.x, projectile.y, projectile.z);
      } else if (visual.kind !== projectile.kind) {
        this.scene.remove(visual.root);
        this.releaseProjectileVisual(visual);
        visual = this.acquireProjectileVisual(projectile.kind);
        this.projectileVisuals.set(projectile.nid, visual);
        visual.root.position.set(projectile.x, projectile.y, projectile.z);
        this.scene.add(visual.root);
      }
      visual.root.position.set(projectile.x, projectile.y, projectile.z);
      this.updateProjectileVisualPulse(visual, dt);
    }

    for (const [nid, visual] of this.projectileVisuals) {
      if (!activeNids.has(nid)) {
        this.scene.remove(visual.root);
        this.releaseProjectileVisual(visual);
        this.projectileVisuals.delete(nid);
      }
    }
  }

  public dispose(): void {
    for (const visual of this.projectileVisuals.values()) {
      this.scene.remove(visual.root);
      visual.coreMaterial.dispose();
      visual.glowMaterial.dispose();
    }
    this.projectileVisuals.clear();

    for (const pool of this.pooledProjectileVisuals.values()) {
      for (const visual of pool) {
        visual.coreMaterial.dispose();
        visual.glowMaterial.dispose();
      }
    }
    this.pooledProjectileVisuals.clear();

    for (const burst of this.activeSpawnBursts) {
      this.scene.remove(burst.root);
      for (const particle of burst.particles) {
        particle.material.dispose();
      }
    }
    this.activeSpawnBursts.length = 0;

    for (const pool of this.pooledSpawnBursts.values()) {
      for (const burst of pool) {
        for (const particle of burst.particles) {
          particle.material.dispose();
        }
      }
    }
    this.pooledSpawnBursts.clear();

    this.projectileCoreGeometry.dispose();
    this.projectileGlowGeometry.dispose();
    this.projectileBurstParticleGeometry.dispose();
  }

  private prewarmProjectileVisualPool(kind: number, count: number): void {
    const pool = this.getProjectileVisualPool(kind);
    while (pool.length < count) {
      pool.push(this.createProjectileVisual(kind));
    }
  }

  private getProjectileVisualPool(kind: number): ProjectileFlightVisual[] {
    let pool = this.pooledProjectileVisuals.get(kind);
    if (!pool) {
      pool = [];
      this.pooledProjectileVisuals.set(kind, pool);
    }
    return pool;
  }

  private acquireProjectileVisual(kind: number): ProjectileFlightVisual {
    const pool = this.getProjectileVisualPool(kind);
    const visual = pool.pop() ?? this.createProjectileVisual(kind);
    visual.kind = kind;
    visual.root.visible = true;
    visual.pulseTime = Math.random() * Math.PI * 2;
    this.applyProjectilePalette(visual, kind);
    return visual;
  }

  private releaseProjectileVisual(visual: ProjectileFlightVisual): void {
    visual.root.visible = false;
    visual.root.position.set(0, -1000, 0);
    const pool = this.getProjectileVisualPool(visual.kind);
    pool.push(visual);
  }

  private createProjectileVisual(kind: number): ProjectileFlightVisual {
    const palette = this.resolveProjectilePalette(kind);
    const coreMaterial = new MeshStandardMaterial({
      color: palette.coreColor,
      emissive: palette.emissiveColor,
      emissiveIntensity: 0.95,
      roughness: 0.22,
      metalness: 0.04
    });
    const glowMaterial = new MeshBasicMaterial({
      color: palette.glowColor,
      transparent: true,
      opacity: 0.32,
      blending: AdditiveBlending,
      depthWrite: false
    });
    const core = new Mesh(this.projectileCoreGeometry, coreMaterial);
    const glow = new Mesh(this.projectileGlowGeometry, glowMaterial);
    glow.scale.setScalar(1.15);
    const root = new Group();
    root.visible = false;
    root.add(glow, core);
    return {
      root,
      coreMaterial,
      glowMaterial,
      kind,
      pulseTime: 0
    };
  }

  private updateProjectileVisualPulse(visual: ProjectileFlightVisual, dt: number): void {
    visual.pulseTime += dt * 7.5;
    const oscillation = Math.sin(visual.pulseTime);
    visual.coreMaterial.emissiveIntensity = 0.88 + oscillation * 0.14;
    visual.glowMaterial.opacity = 0.26 + (oscillation + 1) * 0.06;
    const glowScale = 1.1 + (oscillation + 1) * 0.06;
    visual.root.children[0]?.scale.setScalar(glowScale);
  }

  private applyProjectilePalette(visual: ProjectileFlightVisual, kind: number): void {
    const palette = this.resolveProjectilePalette(kind);
    visual.coreMaterial.color.setHex(palette.coreColor);
    visual.coreMaterial.emissive.setHex(palette.emissiveColor);
    visual.glowMaterial.color.setHex(palette.glowColor);
  }

  private resolveProjectilePalette(kind: number): Readonly<ProjectilePalette> {
    return PROJECTILE_PALETTES.get(kind) ?? DEFAULT_PROJECTILE_PALETTE;
  }

  private prewarmSpawnBurstPool(kind: number, count: number): void {
    const pool = this.getSpawnBurstPool(kind);
    while (pool.length < count) {
      pool.push(this.createSpawnBurst(kind));
    }
  }

  private getSpawnBurstPool(kind: number): ProjectileSpawnBurst[] {
    let pool = this.pooledSpawnBursts.get(kind);
    if (!pool) {
      pool = [];
      this.pooledSpawnBursts.set(kind, pool);
    }
    return pool;
  }

  private acquireSpawnBurst(kind: number): ProjectileSpawnBurst {
    const pool = this.getSpawnBurstPool(kind);
    const burst = pool.pop() ?? this.createSpawnBurst(kind);
    burst.kind = kind;
    burst.ageSeconds = 0;
    burst.durationSeconds = PROJECTILE_SPAWN_BURST_DURATION_SECONDS;
    burst.root.visible = true;
    this.applySpawnBurstPalette(burst, kind);
    return burst;
  }

  private releaseSpawnBurst(burst: ProjectileSpawnBurst): void {
    burst.root.visible = false;
    burst.root.position.set(0, -1000, 0);
    if (this.getSpawnBurstPool(burst.kind).length >= PROJECTILE_SPAWN_BURST_POOL_MAX) {
      return;
    }
    this.getSpawnBurstPool(burst.kind).push(burst);
  }

  private createSpawnBurst(kind: number): ProjectileSpawnBurst {
    const root = new Group();
    root.visible = false;
    const particles: ProjectileBurstParticle[] = [];
    for (let i = 0; i < PROJECTILE_SPAWN_BURST_PARTICLE_COUNT; i += 1) {
      const material = new MeshBasicMaterial({
        color: this.resolveProjectilePalette(kind).burstColor,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false
      });
      const mesh = new Mesh(this.projectileBurstParticleGeometry, material);
      root.add(mesh);
      particles.push({
        mesh,
        material,
        velocity: new Vector3(),
        baseScale: 1
      });
    }
    return {
      root,
      particles,
      kind,
      ageSeconds: 0,
      durationSeconds: PROJECTILE_SPAWN_BURST_DURATION_SECONDS
    };
  }

  private applySpawnBurstPalette(burst: ProjectileSpawnBurst, kind: number): void {
    const palette = this.resolveProjectilePalette(kind);
    for (const particle of burst.particles) {
      particle.material.color.setHex(palette.burstColor);
    }
  }

  private emitProjectileSpawnBurst(kind: number, x: number, y: number, z: number): void {
    const burst = this.acquireSpawnBurst(kind);
    burst.root.position.set(x, y, z);
    for (const particle of burst.particles) {
      this.randomUnitVector(this.tempVecA);
      const speed = MathUtils.lerp(0.7, 2.1, Math.random());
      particle.velocity.copy(this.tempVecA).multiplyScalar(speed);
      particle.baseScale = MathUtils.lerp(0.55, 1.1, Math.random());
      particle.mesh.position.set(0, 0, 0);
      particle.mesh.scale.setScalar(particle.baseScale);
      particle.material.opacity = 0.26;
    }
    this.scene.add(burst.root);
    this.activeSpawnBursts.push(burst);
  }

  private updateSpawnBursts(deltaSeconds: number): void {
    for (let i = this.activeSpawnBursts.length - 1; i >= 0; i -= 1) {
      const burst = this.activeSpawnBursts[i];
      if (!burst) {
        continue;
      }
      burst.ageSeconds += deltaSeconds;
      const normalizedAge = this.clamp(burst.ageSeconds / burst.durationSeconds, 0, 1);
      const alpha = (1 - normalizedAge) * (1 - normalizedAge) * 0.28;
      const driftDamping = 1 - normalizedAge * 0.2;

      for (const particle of burst.particles) {
        particle.mesh.position.addScaledVector(particle.velocity, deltaSeconds);
        particle.mesh.scale.setScalar(particle.baseScale * (1 + normalizedAge * 1.6));
        particle.material.opacity = alpha;
        particle.velocity.multiplyScalar(driftDamping);
      }

      if (normalizedAge < 1) {
        continue;
      }

      this.scene.remove(burst.root);
      this.releaseSpawnBurst(burst);
      this.activeSpawnBursts.splice(i, 1);
    }
  }

  private randomUnitVector(target: Vector3): Vector3 {
    let x1 = 0;
    let x2 = 0;
    let s = 2;
    while (s >= 1 || s <= 1e-6) {
      x1 = Math.random() * 2 - 1;
      x2 = Math.random() * 2 - 1;
      s = x1 * x1 + x2 * x2;
    }
    const factor = Math.sqrt(1 - s);
    target.set(2 * x1 * factor, 2 * x2 * factor, 1 - 2 * s);
    return target.normalize();
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
