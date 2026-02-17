import {
  AdditiveBlending,
  AmbientLight,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { VRMHumanoid, type VRM, type VRMCore, type VRMHumanBoneName, type VRMHumanBones } from "@pixiv/three-vrm";
import { CHARACTER_MALE_ASSET_ID } from "../assets/assetManifest";
import { getLoadedAsset } from "../assets/assetLoader";
import { PLAYER_EYE_HEIGHT, PLAYER_SPRINT_SPEED, STATIC_WORLD_BLOCKS } from "../../shared/index";
import {
  CharacterAnimationController
} from "./animation/CharacterAnimationController";
import {
  createCharacterAnimationClips,
  loadCharacterVRMAnimationAssets,
  type CharacterVRMAnimationAssets
} from "./animation/characterAnimationLibrary";
import { AudioEngine } from "./audio/AudioEngine";
import type {
  AbilityUseEvent,
  PlayerPose,
  ProjectileState,
  RemotePlayerState,
  TrainingDummyState
} from "./types";

const REMOTE_CHARACTER_TARGET_HEIGHT = PLAYER_EYE_HEIGHT + 0.08;
const MIN_MODEL_HEIGHT = 1e-4;
const REMOTE_CHARACTER_MODEL_YAW_OFFSET = 0;
const REMOTE_ANIMATION_SPEED_CAP = PLAYER_SPRINT_SPEED * 2.2;
const PROJECTILE_VISUAL_POOL_PREWARM = 24;
const PROJECTILE_SPAWN_BURST_POOL_PREWARM = 12;
const PROJECTILE_SPAWN_BURST_POOL_MAX = 80;
const PROJECTILE_SPAWN_BURST_PARTICLE_COUNT = 8;
const PROJECTILE_SPAWN_BURST_DURATION_SECONDS = 0.16;
const LOCAL_FIRST_PERSON_ONLY_LAYER = 11;
const LOCAL_THIRD_PERSON_ONLY_LAYER = 12;

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


interface RemotePlayerVisual {
  root: Group;
  animator: CharacterAnimationController | null;
  humanoid: VRMHumanoid | null;
  lastX: number;
  lastY: number;
  lastZ: number;
  horizontalSpeed: number;
  verticalSpeed: number;
  grounded: boolean;
  sprinting: boolean;
  initialized: boolean;
}

interface LocalPlayerVisual {
  root: Group;
  animator: CharacterAnimationController | null;
  vrm: VRM | null;
  lastX: number;
  lastY: number;
  lastZ: number;
  horizontalSpeed: number;
  verticalSpeed: number;
  grounded: boolean;
  sprinting: boolean;
  initialized: boolean;
}

interface LocalPlayerSyncOptions {
  frameDeltaSeconds: number;
  grounded: boolean;
}

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


export class WorldRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly remotePlayers = new Map<number, RemotePlayerVisual>();
  private readonly platforms = new Map<number, Mesh>();
  private readonly trainingDummies = new Map<number, Mesh>();
  private readonly projectileVisuals = new Map<number, ProjectileFlightVisual>();
  private readonly pooledProjectileVisuals = new Map<number, ProjectileFlightVisual[]>();
  private readonly pooledSpawnBursts = new Map<number, ProjectileSpawnBurst[]>();
  private readonly activeSpawnBursts: ProjectileSpawnBurst[] = [];
  private readonly cameraForward = new Vector3(0, 0, -1);
  private readonly characterAnimationAssets: CharacterVRMAnimationAssets | null;
  private readonly sourceRawBoneNames: Array<{ boneName: VRMHumanBoneName; nodeName: string }> = [];
  private readonly sourceVrmMetaVersion: "0" | "1" | null;
  private readonly remotePlayerTemplate: Group | null;
  private readonly localPlayerVisual: LocalPlayerVisual | null;
  private readonly projectileCoreGeometry = new IcosahedronGeometry(0.12, 1);
  private readonly projectileGlowGeometry = new SphereGeometry(0.24, 10, 8);
  private readonly projectileBurstParticleGeometry = new IcosahedronGeometry(0.045, 0);
  private readonly tempVecA = new Vector3();
  private readonly audio: AudioEngine;
  private disposed = false;
  private localPlayerNid: number | null = null;

  public constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new Scene();
    this.scene.background = new Color(0xb8e4ff);
    this.scene.fog = new Fog(0xb8e4ff, 45, 220);

    this.camera = new PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.01, 600);
    this.camera.layers.enable(LOCAL_FIRST_PERSON_ONLY_LAYER);
    this.camera.layers.disable(LOCAL_THIRD_PERSON_ONLY_LAYER);

    this.initializeScene();
    this.audio = new AudioEngine(this.camera, this.scene);
    this.remotePlayerTemplate = this.createRemotePlayerTemplate();
    this.characterAnimationAssets = loadCharacterVRMAnimationAssets();
    const sourceVrm = this.getSourceVrm();
    this.sourceVrmMetaVersion = sourceVrm?.meta.metaVersion ?? null;
    if (sourceVrm) {
      this.sourceRawBoneNames.push(...this.buildSourceRawBoneNames(sourceVrm));
    }
    this.localPlayerVisual = this.createLocalPlayerVisual();
    if (this.localPlayerVisual) {
      this.scene.add(this.localPlayerVisual.root);
    }
    this.prewarmProjectileVisualPool(1, PROJECTILE_VISUAL_POOL_PREWARM);
    this.prewarmSpawnBurstPool(1, PROJECTILE_SPAWN_BURST_POOL_PREWARM);
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public syncRemotePlayers(players: RemotePlayerState[], frameDeltaSeconds: number): void {
    const dt = Math.max(1 / 240, Math.min(frameDeltaSeconds, 1 / 20));
    const activeNids = new Set<number>();
    for (const remotePlayer of players) {
      activeNids.add(remotePlayer.nid);
      let visual = this.remotePlayers.get(remotePlayer.nid);
      if (!visual) {
        visual = this.createRemotePlayerVisual();
        this.remotePlayers.set(remotePlayer.nid, visual);
        this.scene.add(visual.root);
      }

      const renderY = remotePlayer.y - PLAYER_EYE_HEIGHT;
      if (visual.initialized) {
        const deltaX = remotePlayer.x - visual.lastX;
        const deltaY = renderY - visual.lastY;
        const deltaZ = remotePlayer.z - visual.lastZ;
        const sampleHorizontalSpeed = Math.hypot(deltaX, deltaZ) / dt;
        const sampleVerticalSpeed = deltaY / dt;
        const smoothing = 1 - Math.exp(-12 * dt);
        visual.horizontalSpeed += (sampleHorizontalSpeed - visual.horizontalSpeed) * smoothing;
        visual.verticalSpeed += (sampleVerticalSpeed - visual.verticalSpeed) * smoothing;
      } else {
        visual.horizontalSpeed = 0;
        visual.verticalSpeed = 0;
        visual.initialized = true;
      }

      visual.horizontalSpeed = Math.min(Math.max(0, visual.horizontalSpeed), REMOTE_ANIMATION_SPEED_CAP);
      visual.grounded = remotePlayer.grounded;
      visual.sprinting = visual.horizontalSpeed >= PLAYER_SPRINT_SPEED * 0.92;
      visual.root.position.set(remotePlayer.x, renderY, remotePlayer.z);
      visual.root.rotation.y = remotePlayer.yaw;
      visual.lastX = remotePlayer.x;
      visual.lastY = renderY;
      visual.lastZ = remotePlayer.z;
      visual.animator?.update(dt, {
        horizontalSpeed: visual.horizontalSpeed,
        verticalSpeed: visual.verticalSpeed,
        grounded: visual.grounded,
        sprinting: visual.sprinting
      });
      visual.humanoid?.update();
    }

    for (const [nid, visual] of this.remotePlayers) {
      if (!activeNids.has(nid)) {
        visual.animator?.dispose();
        this.scene.remove(visual.root);
        this.remotePlayers.delete(nid);
      }
    }
  }

  public syncLocalPlayer(localPose: PlayerPose, options: LocalPlayerSyncOptions): void {
    if (!this.localPlayerVisual) {
      return;
    }
    const dt = Math.max(1 / 240, Math.min(options.frameDeltaSeconds, 1 / 20));
    const visual = this.localPlayerVisual;
    const renderY = localPose.y - PLAYER_EYE_HEIGHT;
    if (visual.initialized) {
      const deltaX = localPose.x - visual.lastX;
      const deltaY = renderY - visual.lastY;
      const deltaZ = localPose.z - visual.lastZ;
      const sampleHorizontalSpeed = Math.hypot(deltaX, deltaZ) / dt;
      const sampleVerticalSpeed = deltaY / dt;
      const smoothing = 1 - Math.exp(-14 * dt);
      visual.horizontalSpeed += (sampleHorizontalSpeed - visual.horizontalSpeed) * smoothing;
      visual.verticalSpeed += (sampleVerticalSpeed - visual.verticalSpeed) * smoothing;
    } else {
      visual.horizontalSpeed = 0;
      visual.verticalSpeed = 0;
      visual.initialized = true;
    }

    visual.horizontalSpeed = Math.min(Math.max(0, visual.horizontalSpeed), REMOTE_ANIMATION_SPEED_CAP);
    visual.grounded = options.grounded;
    visual.sprinting = visual.horizontalSpeed >= PLAYER_SPRINT_SPEED * 0.92;
    visual.root.position.set(localPose.x, renderY, localPose.z);
    visual.root.rotation.y = localPose.yaw;
    visual.lastX = localPose.x;
    visual.lastY = renderY;
    visual.lastZ = localPose.z;
    visual.animator?.update(dt, {
      horizontalSpeed: visual.horizontalSpeed,
      verticalSpeed: visual.verticalSpeed,
      grounded: visual.grounded,
      sprinting: visual.sprinting
    });
    visual.vrm?.update(dt);
  }

  public setLocalPlayerNid(nid: number | null): void {
    this.localPlayerNid = typeof nid === "number" ? nid : null;
  }

  public triggerLocalMeleePunch(): void {
    this.localPlayerVisual?.animator?.triggerPunch();
  }

  public applyAbilityUseEvents(events: AbilityUseEvent[]): void {
    // These network events are cosmetic-only; damage/hit outcomes are always server authoritative.
    for (const event of events) {
      if (event.category !== "melee") {
        continue;
      }
      const isLocalOwner = this.localPlayerNid !== null && event.ownerNid === this.localPlayerNid;
      const remoteVisual = this.remotePlayers.get(event.ownerNid);
      if (!isLocalOwner) {
        remoteVisual?.animator?.triggerPunch();
      }
      const sourceRoot = isLocalOwner ? this.localPlayerVisual?.root : remoteVisual?.root;
      if (!sourceRoot) {
        continue;
      }
      this.audio.play3D(
        "melee.punch.hit",
        {
          x: sourceRoot.position.x,
          y: sourceRoot.position.y + PLAYER_EYE_HEIGHT * 0.55,
          z: sourceRoot.position.z
        },
        `${event.category}:${event.ownerNid}:${event.abilityId}:${event.serverTick}`
      );
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.audio.dispose();
  }

  public syncPlatforms(platformStates: Array<{
    nid: number;
    kind: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    halfX: number;
    halfY: number;
    halfZ: number;
  }>): void {
    const activeNids = new Set<number>();
    for (const platform of platformStates) {
      activeNids.add(platform.nid);
      let mesh = this.platforms.get(platform.nid);
      if (!mesh) {
        mesh = new Mesh(
          new BoxGeometry(platform.halfX * 2, platform.halfY * 2, platform.halfZ * 2),
          new MeshStandardMaterial({
            color: platform.kind === 2 ? 0x9ea7d8 : 0xd8b691,
            roughness: 0.88,
            metalness: 0.06
          })
        );
        this.platforms.set(platform.nid, mesh);
        this.scene.add(mesh);
      }

      mesh.position.set(platform.x, platform.y, platform.z);
      mesh.rotation.y = platform.yaw;
    }

    for (const [nid, mesh] of this.platforms) {
      if (!activeNids.has(nid)) {
        this.scene.remove(mesh);
        this.platforms.delete(nid);
      }
    }
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

  public syncTrainingDummies(dummies: TrainingDummyState[]): void {
    const activeNids = new Set<number>();
    for (const dummy of dummies) {
      activeNids.add(dummy.nid);
      let mesh = this.trainingDummies.get(dummy.nid);
      if (!mesh) {
        mesh = new Mesh(
          new CylinderGeometry(0.42, 0.42, 1.9, 12, 1),
          new MeshStandardMaterial({
            color: 0xa6c9d8,
            roughness: 0.88,
            metalness: 0.08
          })
        );
        this.trainingDummies.set(dummy.nid, mesh);
        this.scene.add(mesh);
      }
      const healthRatio =
        dummy.maxHealth > 0 ? Math.max(0, Math.min(1, dummy.health / dummy.maxHealth)) : 1;
      const material = mesh.material as MeshStandardMaterial;
      material.color.setHSL(0.06 + healthRatio * 0.38, 0.42, 0.52);
      mesh.position.set(dummy.x, dummy.y, dummy.z);
      mesh.rotation.y = dummy.yaw;
    }

    for (const [nid, mesh] of this.trainingDummies) {
      if (!activeNids.has(nid)) {
        this.scene.remove(mesh);
        this.trainingDummies.delete(nid);
      }
    }
  }

  public render(localPose: PlayerPose): void {
    this.camera.position.set(localPose.x, localPose.y, localPose.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = localPose.yaw;
    this.camera.rotation.x = localPose.pitch;

    this.renderer.render(this.scene, this.camera);
  }

  public getForwardDirection(): Vector3 {
    return this.cameraForward.set(0, 0, -1).applyEuler(this.camera.rotation).normalize();
  }

  private initializeScene(): void {
    const ambient = new AmbientLight(0xffffff, 0.52);
    this.scene.add(ambient);

    const sun = new DirectionalLight(0xfff6d0, 1.15);
    sun.position.set(80, 120, 40);
    this.scene.add(sun);

    const groundMaterial = new MeshStandardMaterial({
      color: 0x6ea768,
      roughness: 0.95,
      metalness: 0.02
    });
    const ground = new Mesh(new BoxGeometry(256, 1, 256), groundMaterial);
    ground.position.y = -0.5;
    ground.receiveShadow = false;
    this.scene.add(ground);

    const propMaterial = new MeshStandardMaterial({
      color: 0x8ea8ba,
      roughness: 0.82,
      metalness: 0.05
    });
    for (const worldBlock of STATIC_WORLD_BLOCKS) {
      const block = new Mesh(
        new BoxGeometry(worldBlock.halfX * 2, worldBlock.halfY * 2, worldBlock.halfZ * 2),
        propMaterial
      );
      block.position.set(worldBlock.x, worldBlock.y, worldBlock.z);
      block.rotation.z = worldBlock.rotationZ ?? 0;
      this.scene.add(block);
    }
  }

  private createRemotePlayerVisual(): RemotePlayerVisual {
    let root: Group;
    let animator: CharacterAnimationController | null = null;
    let humanoid: VRMHumanoid | null = null;
    if (this.remotePlayerTemplate) {
      root = cloneSkeleton(this.remotePlayerTemplate) as Group;
      humanoid = this.createHumanoidForClonedModel(root);
      if (!humanoid) {
        console.warn("[animation] remote humanoid creation failed; avatar will be static");
      }
      if (humanoid && this.characterAnimationAssets && this.sourceVrmMetaVersion) {
        const clips = createCharacterAnimationClips(
          {
            scene: root,
            humanoid,
            meta: { metaVersion: this.sourceVrmMetaVersion } as VRMCore["meta"]
          } as VRMCore,
          this.characterAnimationAssets
        );
        if (clips) {
          animator = new CharacterAnimationController(root, clips);
        } else {
          console.warn("[animation] remote clip creation failed; avatar will be static");
        }
      }
    } else {
      root = new Group();

      const capsuleRadius = 0.38;
      const capsuleLength = 1.0;
      const capsuleHeight = capsuleLength + capsuleRadius * 2;
      const body = new Mesh(
        new CapsuleGeometry(capsuleRadius, capsuleLength, 3, 6),
        new MeshStandardMaterial({
          color: 0xf4d8b5,
          roughness: 0.94,
          metalness: 0.01
        })
      );
      body.position.y = capsuleHeight * 0.5;
      root.add(body);

      const visorSize = capsuleHeight * 0.2;
      const visor = new Mesh(
        new BoxGeometry(visorSize, visorSize, visorSize),
        new MeshStandardMaterial({
          color: 0x1b1e2e,
          roughness: 0.35,
          metalness: 0.15
        })
      );
      visor.position.set(0, capsuleHeight * 0.75, -(capsuleRadius + visorSize * 0.5));
      root.add(visor);
    }
    return {
      root,
      animator,
      humanoid,
      lastX: 0,
      lastY: 0,
      lastZ: 0,
      horizontalSpeed: 0,
      verticalSpeed: 0,
      grounded: true,
      sprinting: false,
      initialized: false
    };
  }

  private createLocalPlayerVisual(): LocalPlayerVisual | null {
    const gltf = getLoadedAsset<GLTF>(CHARACTER_MALE_ASSET_ID);
    if (!gltf?.scene) {
      return null;
    }

    const root = new Group();
    const vrm = (gltf.userData as { vrm?: VRM }).vrm ?? null;
    const sourceScene = vrm?.scene ?? gltf.scene;
    const model = sourceScene as Object3D;
    model.rotation.y = REMOTE_CHARACTER_MODEL_YAW_OFFSET;
    this.normalizeModelToGround(model, REMOTE_CHARACTER_TARGET_HEIGHT);
    if (vrm?.firstPerson) {
      vrm.firstPerson.setup({
        firstPersonOnlyLayer: LOCAL_FIRST_PERSON_ONLY_LAYER,
        thirdPersonOnlyLayer: LOCAL_THIRD_PERSON_ONLY_LAYER
      });
    }
    root.add(model);
    const localClips =
      vrm && this.characterAnimationAssets
        ? createCharacterAnimationClips(vrm, this.characterAnimationAssets)
        : null;
    if (!localClips) {
      console.warn("[animation] local clip creation failed; local avatar will be static");
    }
    const animator = localClips ? new CharacterAnimationController(root, localClips) : null;

    return {
      root,
      animator,
      vrm,
      lastX: 0,
      lastY: 0,
      lastZ: 0,
      horizontalSpeed: 0,
      verticalSpeed: 0,
      grounded: true,
      sprinting: false,
      initialized: false
    };
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
        opacity: 0.0,
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
    // Marsaglia method for uniformly sampling a sphere.
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

  private createRemotePlayerTemplate(): Group | null {
    const gltf = getLoadedAsset<GLTF>(CHARACTER_MALE_ASSET_ID);
    if (!gltf?.scene) {
      return null;
    }

    const root = new Group();
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;
    const sourceScene = vrm?.scene ?? gltf.scene;
    const model = cloneSkeleton(sourceScene) as Object3D;
    this.removeNormalizedHumanoidRigs(model);
    // Canonical VRM assets in this project are authored facing the gameplay forward convention.
    model.rotation.y = REMOTE_CHARACTER_MODEL_YAW_OFFSET;
    this.normalizeModelToGround(model, REMOTE_CHARACTER_TARGET_HEIGHT);
    root.add(model);
    return root;
  }

  private removeNormalizedHumanoidRigs(root: Object3D): void {
    const toRemove: Object3D[] = [];
    root.traverse((node) => {
      if (node.name === "VRMHumanoidRig" && node.parent) {
        toRemove.push(node);
      }
    });
    for (const node of toRemove) {
      node.parent?.remove(node);
    }
  }

  private getSourceVrm(): VRM | null {
    const gltf = getLoadedAsset<GLTF>(CHARACTER_MALE_ASSET_ID);
    return ((gltf?.userData as { vrm?: VRM } | undefined)?.vrm) ?? null;
  }

  private buildSourceRawBoneNames(vrm: VRM): Array<{ boneName: VRMHumanBoneName; nodeName: string }> {
    const bindings: Array<{ boneName: VRMHumanBoneName; nodeName: string }> = [];
    for (const [boneName, bone] of Object.entries(vrm.humanoid.humanBones) as Array<
      [VRMHumanBoneName, { node: Object3D } | undefined]
    >) {
      const nodeName = bone?.node?.name?.trim();
      if (!nodeName) {
        continue;
      }
      bindings.push({ boneName, nodeName });
    }
    return bindings;
  }

  private createHumanoidForClonedModel(root: Object3D): VRMHumanoid | null {
    if (this.sourceRawBoneNames.length === 0) {
      return null;
    }
    const humanBones = {} as VRMHumanBones;
    for (const binding of this.sourceRawBoneNames) {
      const node = root.getObjectByName(binding.nodeName);
      if (!node) {
        continue;
      }
      (humanBones as Record<string, { node: Object3D }>)[binding.boneName] = { node };
    }
    if (
      !(humanBones as Record<string, unknown>).hips ||
      !(humanBones as Record<string, unknown>).head
    ) {
      return null;
    }
    const humanoid = new VRMHumanoid(humanBones, {
      autoUpdateHumanBones: true
    });
    root.add(humanoid.normalizedHumanBonesRoot);
    return humanoid;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private normalizeModelToGround(model: Object3D, targetHeight: number): void {
    const initialBounds = new Box3().setFromObject(model);
    const initialHeight = Math.max(
      initialBounds.max.y - initialBounds.min.y,
      MIN_MODEL_HEIGHT
    );
    const uniformScale = targetHeight / initialHeight;
    model.scale.multiplyScalar(uniformScale);

    const scaledBounds = new Box3().setFromObject(model);
    const centerX = (scaledBounds.min.x + scaledBounds.max.x) * 0.5;
    const centerZ = (scaledBounds.min.z + scaledBounds.max.z) * 0.5;
    model.position.x -= centerX;
    model.position.y -= scaledBounds.min.y;
    model.position.z -= centerZ;
  }
}
