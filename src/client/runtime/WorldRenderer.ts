import {
  AdditiveBlending,
  AmbientLight,
  AnimationClip,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Fog,
  Group,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  SkinnedMesh,
  Vector3,
  WebGLRenderer
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton, retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  ANIMATION_MIXAMO_IDLE_ASSET_ID,
  ANIMATION_MIXAMO_JUMP_ASSET_ID,
  ANIMATION_MIXAMO_PUNCH_ASSET_ID,
  ANIMATION_MIXAMO_RUN_ASSET_ID,
  ANIMATION_MIXAMO_WALK_ASSET_ID,
  CHARACTER_MALE_ASSET_ID
} from "../assets/assetManifest";
import { getLoadedAsset } from "../assets/assetLoader";
import { PLAYER_EYE_HEIGHT, PLAYER_SPRINT_SPEED, STATIC_WORLD_BLOCKS } from "../../shared/index";
import type { PlayerPose, ProjectileState, RemotePlayerState, TrainingDummyState } from "./types";
import { CharacterAnimationController } from "./CharacterAnimationController";

const REMOTE_CHARACTER_TARGET_HEIGHT = PLAYER_EYE_HEIGHT + 0.08;
const MIN_MODEL_HEIGHT = 1e-4;
const REMOTE_CHARACTER_MODEL_YAW_OFFSET = Math.PI;
const REMOTE_ANIMATION_SPEED_CAP = PLAYER_SPRINT_SPEED * 2.2;
const PROJECTILE_VISUAL_POOL_PREWARM = 24;
const PROJECTILE_SPAWN_BURST_POOL_PREWARM = 12;
const PROJECTILE_SPAWN_BURST_POOL_MAX = 80;
const PROJECTILE_SPAWN_BURST_PARTICLE_COUNT = 8;
const PROJECTILE_SPAWN_BURST_DURATION_SECONDS = 0.16;
const LOCAL_FIRST_PERSON_BODY_BACK_OFFSET = 0.16;
const LOCAL_FIRST_PERSON_BODY_DOWN_OFFSET = -0.05;
const LOCAL_FIRST_PERSON_HEAD_SCALE = 0.001;
const MIXAMO_HIP_BONE = "mixamorig:Hips";

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

const MIXAMO_RETARGET_BONE_NAMES: Readonly<Record<string, string>> = {
  pelvis: MIXAMO_HIP_BONE,
  spine_01: "mixamorig:Spine",
  spine_02: "mixamorig:Spine1",
  spine_03: "mixamorig:Spine2",
  neck_01: "mixamorig:Neck",
  Head: "mixamorig:Head",
  clavicle_l: "mixamorig:LeftShoulder",
  upperarm_l: "mixamorig:LeftArm",
  lowerarm_l: "mixamorig:LeftForeArm",
  hand_l: "mixamorig:LeftHand",
  thumb_01_l: "mixamorig:LeftHandThumb1",
  thumb_02_l: "mixamorig:LeftHandThumb2",
  thumb_03_l: "mixamorig:LeftHandThumb3",
  thumb_04_leaf_l: "mixamorig:LeftHandThumb4",
  index_01_l: "mixamorig:LeftHandIndex1",
  index_02_l: "mixamorig:LeftHandIndex2",
  index_03_l: "mixamorig:LeftHandIndex3",
  index_04_leaf_l: "mixamorig:LeftHandIndex4",
  middle_01_l: "mixamorig:LeftHandMiddle1",
  middle_02_l: "mixamorig:LeftHandMiddle2",
  middle_03_l: "mixamorig:LeftHandMiddle3",
  middle_04_leaf_l: "mixamorig:LeftHandMiddle4",
  ring_01_l: "mixamorig:LeftHandRing1",
  ring_02_l: "mixamorig:LeftHandRing2",
  ring_03_l: "mixamorig:LeftHandRing3",
  ring_04_leaf_l: "mixamorig:LeftHandRing4",
  pinky_01_l: "mixamorig:LeftHandPinky1",
  pinky_02_l: "mixamorig:LeftHandPinky2",
  pinky_03_l: "mixamorig:LeftHandPinky3",
  pinky_04_leaf_l: "mixamorig:LeftHandPinky4",
  clavicle_r: "mixamorig:RightShoulder",
  upperarm_r: "mixamorig:RightArm",
  lowerarm_r: "mixamorig:RightForeArm",
  hand_r: "mixamorig:RightHand",
  thumb_01_r: "mixamorig:RightHandThumb1",
  thumb_02_r: "mixamorig:RightHandThumb2",
  thumb_03_r: "mixamorig:RightHandThumb3",
  thumb_04_leaf_r: "mixamorig:RightHandThumb4",
  index_01_r: "mixamorig:RightHandIndex1",
  index_02_r: "mixamorig:RightHandIndex2",
  index_03_r: "mixamorig:RightHandIndex3",
  index_04_leaf_r: "mixamorig:RightHandIndex4",
  middle_01_r: "mixamorig:RightHandMiddle1",
  middle_02_r: "mixamorig:RightHandMiddle2",
  middle_03_r: "mixamorig:RightHandMiddle3",
  middle_04_leaf_r: "mixamorig:RightHandMiddle4",
  ring_01_r: "mixamorig:RightHandRing1",
  ring_02_r: "mixamorig:RightHandRing2",
  ring_03_r: "mixamorig:RightHandRing3",
  ring_04_leaf_r: "mixamorig:RightHandRing4",
  pinky_01_r: "mixamorig:RightHandPinky1",
  pinky_02_r: "mixamorig:RightHandPinky2",
  pinky_03_r: "mixamorig:RightHandPinky3",
  pinky_04_leaf_r: "mixamorig:RightHandPinky4",
  thigh_l: "mixamorig:LeftUpLeg",
  calf_l: "mixamorig:LeftLeg",
  foot_l: "mixamorig:LeftFoot",
  ball_l: "mixamorig:LeftToeBase",
  ball_leaf_l: "mixamorig:LeftToe_End",
  thigh_r: "mixamorig:RightUpLeg",
  calf_r: "mixamorig:RightLeg",
  foot_r: "mixamorig:RightFoot",
  ball_r: "mixamorig:RightToeBase",
  ball_leaf_r: "mixamorig:RightToe_End"
};

const REMOTE_CHARACTER_ROOT_MOTION_POLICY = {
  // Root motion is disabled by default to keep movement physics/netcode authoritative.
  defaultEnabled: false,
  // Opt in per clip when/if a specific animation should apply root motion.
  perClip: {}
} as const;

interface RemotePlayerVisual {
  root: Group;
  animationController: CharacterAnimationController | null;
  lastX: number;
  lastY: number;
  lastZ: number;
  horizontalSpeed: number;
  verticalSpeed: number;
  initialized: boolean;
}

interface LocalPlayerVisual {
  root: Group;
  animationController: CharacterAnimationController | null;
  hiddenHeadBones: Object3D[];
  firstPersonBones: {
    spineUpper: Object3D | null;
    clavicleL: Object3D | null;
    clavicleR: Object3D | null;
    upperArmL: Object3D | null;
    upperArmR: Object3D | null;
    forearmL: Object3D | null;
    forearmR: Object3D | null;
  };
  lastX: number;
  lastY: number;
  lastZ: number;
  horizontalSpeed: number;
  verticalSpeed: number;
  initialized: boolean;
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

interface RetargetedAnimationSet {
  idle: AnimationClip;
  walk: AnimationClip;
  run: AnimationClip;
  jump: AnimationClip;
  upperCast: AnimationClip;
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
  private readonly remotePlayerTemplate: Group | null;
  private readonly remotePlayerRetargetedClips: RetargetedAnimationSet | null;
  private readonly localPlayerVisual: LocalPlayerVisual | null;
  private readonly projectileCoreGeometry = new IcosahedronGeometry(0.12, 1);
  private readonly projectileGlowGeometry = new SphereGeometry(0.24, 10, 8);
  private readonly projectileBurstParticleGeometry = new IcosahedronGeometry(0.045, 0);
  private readonly tempEuler = new Euler(0, 0, 0, "XYZ");
  private readonly tempQuat = new Quaternion();
  private readonly tempVecA = new Vector3();

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

    this.initializeScene();
    this.remotePlayerTemplate = this.createRemotePlayerTemplate();
    this.remotePlayerRetargetedClips = this.createRetargetedAnimationSet(this.remotePlayerTemplate);
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
      visual.root.position.set(remotePlayer.x, renderY, remotePlayer.z);
      visual.root.rotation.y = remotePlayer.yaw;
      visual.lastX = remotePlayer.x;
      visual.lastY = renderY;
      visual.lastZ = remotePlayer.z;

      visual.animationController?.update({
        deltaSeconds: dt,
        horizontalSpeed: visual.horizontalSpeed,
        verticalSpeed: visual.verticalSpeed,
        grounded: remotePlayer.grounded,
        upperBodyAction: remotePlayer.upperBodyAction,
        upperBodyActionNonce: remotePlayer.upperBodyActionNonce
      });
    }

    for (const [nid, visual] of this.remotePlayers) {
      if (!activeNids.has(nid)) {
        this.scene.remove(visual.root);
        this.remotePlayers.delete(nid);
      }
    }
  }

  public syncLocalPlayer(
    localPose: PlayerPose,
    frameDeltaSeconds: number,
    animationState: { grounded: boolean; upperBodyAction: number; upperBodyActionNonce: number }
  ): void {
    if (!this.localPlayerVisual) {
      return;
    }
    const dt = Math.max(1 / 240, Math.min(frameDeltaSeconds, 1 / 20));
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
    visual.root.position.set(localPose.x, renderY, localPose.z);
    visual.root.rotation.y = localPose.yaw;
    visual.lastX = localPose.x;
    visual.lastY = renderY;
    visual.lastZ = localPose.z;

    visual.animationController?.update({
      deltaSeconds: dt,
      horizontalSpeed: visual.horizontalSpeed,
      verticalSpeed: visual.verticalSpeed,
      grounded: animationState.grounded,
      upperBodyAction: animationState.upperBodyAction,
      upperBodyActionNonce: animationState.upperBodyActionNonce
    });
    this.applyLocalFirstPersonOffsets(localPose.pitch);
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
      this.scene.add(block);
    }
  }

  private createRemotePlayerVisual(): RemotePlayerVisual {
    let root: Group;
    let animationController: CharacterAnimationController | null = null;
    if (this.remotePlayerTemplate) {
      root = cloneSkeleton(this.remotePlayerTemplate) as Group;
      animationController = new CharacterAnimationController(root, {
        clips: this.remotePlayerRetargetedClips ?? undefined,
        rootMotion: REMOTE_CHARACTER_ROOT_MOTION_POLICY
      });
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
      animationController,
      lastX: 0,
      lastY: 0,
      lastZ: 0,
      horizontalSpeed: 0,
      verticalSpeed: 0,
      initialized: false
    };
  }

  private createLocalPlayerVisual(): LocalPlayerVisual | null {
    if (!this.remotePlayerTemplate) {
      return null;
    }

    const root = new Group();
    const model = cloneSkeleton(this.remotePlayerTemplate) as Group;
    model.position.y += LOCAL_FIRST_PERSON_BODY_DOWN_OFFSET;
    model.position.z += LOCAL_FIRST_PERSON_BODY_BACK_OFFSET;
    root.add(model);

    const animationController = new CharacterAnimationController(root, {
      clips: this.remotePlayerRetargetedClips ?? undefined,
      rootMotion: REMOTE_CHARACTER_ROOT_MOTION_POLICY
    });

    const hiddenHeadBones = this.collectNamedNodes(model, [
      "mixamorig:Head",
      "mixamorig:Neck",
      "Head",
      "Neck"
    ]);
    for (const bone of hiddenHeadBones) {
      bone.scale.setScalar(LOCAL_FIRST_PERSON_HEAD_SCALE);
    }

    return {
      root,
      animationController,
      hiddenHeadBones,
      firstPersonBones: {
        spineUpper: this.findFirstExistingNode(model, ["mixamorig:Spine2", "spine_03"]),
        clavicleL: this.findFirstExistingNode(model, ["mixamorig:LeftShoulder", "clavicle_l"]),
        clavicleR: this.findFirstExistingNode(model, ["mixamorig:RightShoulder", "clavicle_r"]),
        upperArmL: this.findFirstExistingNode(model, ["mixamorig:LeftArm", "upperarm_l"]),
        upperArmR: this.findFirstExistingNode(model, ["mixamorig:RightArm", "upperarm_r"]),
        forearmL: this.findFirstExistingNode(model, ["mixamorig:LeftForeArm", "lowerarm_l"]),
        forearmR: this.findFirstExistingNode(model, ["mixamorig:RightForeArm", "lowerarm_r"])
      },
      lastX: 0,
      lastY: 0,
      lastZ: 0,
      horizontalSpeed: 0,
      verticalSpeed: 0,
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
    const model = cloneSkeleton(gltf.scene) as Object3D;
    // GLTF forward axis is opposite this project's forward convention; rotate once here.
    model.rotation.y = REMOTE_CHARACTER_MODEL_YAW_OFFSET;
    this.normalizeModelToGround(model, REMOTE_CHARACTER_TARGET_HEIGHT);
    root.add(model);
    return root;
  }

  private createRetargetedAnimationSet(template: Group | null): RetargetedAnimationSet | null {
    if (!template) {
      return null;
    }

    const targetSkinnedMesh = this.findFirstSkinnedMesh(template);
    if (!targetSkinnedMesh) {
      return null;
    }

    const walk = this.retargetMixamoClip(
      targetSkinnedMesh,
      ANIMATION_MIXAMO_WALK_ASSET_ID,
      "walk"
    );
    const idle = this.retargetMixamoClip(
      targetSkinnedMesh,
      ANIMATION_MIXAMO_IDLE_ASSET_ID,
      "idle"
    );
    const run = this.retargetMixamoClip(
      targetSkinnedMesh,
      ANIMATION_MIXAMO_RUN_ASSET_ID,
      "run"
    );
    const jump = this.retargetMixamoClip(
      targetSkinnedMesh,
      ANIMATION_MIXAMO_JUMP_ASSET_ID,
      "jump"
    );
    const upperCast = this.retargetMixamoClip(
      targetSkinnedMesh,
      ANIMATION_MIXAMO_PUNCH_ASSET_ID,
      "upperCast"
    );

    if (!idle || !walk || !run || !jump || !upperCast) {
      return null;
    }

    return { idle, walk, run, jump, upperCast };
  }

  private retargetMixamoClip(
    targetSkinnedMesh: SkinnedMesh,
    sourceAssetId: string,
    clipName: string
  ): AnimationClip | null {
    const sourceRoot = getLoadedAsset<Group>(sourceAssetId);
    if (!sourceRoot) {
      return null;
    }
    const sourceSkinnedMesh = this.findFirstSkinnedMesh(sourceRoot);
    const sourceClip = sourceRoot.animations?.[0];
    if (!sourceSkinnedMesh || !sourceClip) {
      return null;
    }

    const retargeted = retargetClip(targetSkinnedMesh, sourceSkinnedMesh, sourceClip, {
      names: MIXAMO_RETARGET_BONE_NAMES,
      hip: MIXAMO_HIP_BONE,
      preserveBoneMatrix: true,
      preserveHipPosition: true,
      useFirstFramePosition: true
    });

    const normalizedTracks = retargeted.tracks.map((track) => {
      const clonedTrack = track.clone();
      const bonesPathMatch = /^\.bones\[([^\]]+)\]\.(.+)$/i.exec(clonedTrack.name);
      if (bonesPathMatch) {
        const [, boneName, property] = bonesPathMatch;
        clonedTrack.name = `${boneName}.${property}`;
      }
      return clonedTrack;
    });

    return new AnimationClip(clipName, retargeted.duration, normalizedTracks);
  }

  private findFirstSkinnedMesh(root: Object3D): SkinnedMesh | null {
    let found: SkinnedMesh | null = null;
    root.traverse((node) => {
      if (found) {
        return;
      }
      if ((node as SkinnedMesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) {
        found = node as SkinnedMesh;
      }
    });
    return found;
  }

  private findFirstExistingNode(root: Object3D, names: string[]): Object3D | null {
    for (const name of names) {
      const found = root.getObjectByName(name);
      if (found) {
        return found;
      }
    }
    return null;
  }

  private collectNamedNodes(root: Object3D, names: string[]): Object3D[] {
    const collected: Object3D[] = [];
    const seen = new Set<Object3D>();
    for (const name of names) {
      const node = root.getObjectByName(name);
      if (!node || seen.has(node)) {
        continue;
      }
      seen.add(node);
      collected.push(node);
    }
    return collected;
  }

  private applyLocalFirstPersonOffsets(pitch: number): void {
    if (!this.localPlayerVisual) {
      return;
    }
    const visual = this.localPlayerVisual;
    for (const headBone of visual.hiddenHeadBones) {
      headBone.scale.setScalar(LOCAL_FIRST_PERSON_HEAD_SCALE);
    }

    const lookFactor = this.clamp(Math.abs(pitch) / 1.35, 0, 1);
    this.rotateBoneOffset(visual.firstPersonBones.spineUpper, -0.28 - lookFactor * 0.08, 0, 0);
    this.rotateBoneOffset(visual.firstPersonBones.clavicleL, 0.05, 0.08, -0.24);
    this.rotateBoneOffset(visual.firstPersonBones.clavicleR, 0.05, -0.08, 0.24);
    this.rotateBoneOffset(visual.firstPersonBones.upperArmL, -0.26, 0.14, -0.55);
    this.rotateBoneOffset(visual.firstPersonBones.upperArmR, -0.26, -0.14, 0.55);
    this.rotateBoneOffset(visual.firstPersonBones.forearmL, -0.06, 0.07, -0.28);
    this.rotateBoneOffset(visual.firstPersonBones.forearmR, -0.06, -0.07, 0.28);
  }

  private rotateBoneOffset(
    bone: Object3D | null,
    offsetX: number,
    offsetY: number,
    offsetZ: number
  ): void {
    if (!bone) {
      return;
    }
    this.tempEuler.set(offsetX, offsetY, offsetZ, "XYZ");
    this.tempQuat.setFromEuler(this.tempEuler);
    bone.quaternion.multiply(this.tempQuat);
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
