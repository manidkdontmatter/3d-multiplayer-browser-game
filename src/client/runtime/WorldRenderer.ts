import {
  AmbientLight,
  AnimationClip,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
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
import type { PlayerPose, ProjectileState, RemotePlayerState } from "./types";
import { CharacterAnimationController } from "./CharacterAnimationController";

const REMOTE_CHARACTER_TARGET_HEIGHT = PLAYER_EYE_HEIGHT + 0.08;
const MIN_MODEL_HEIGHT = 1e-4;
const REMOTE_CHARACTER_MODEL_YAW_OFFSET = Math.PI;
const REMOTE_ANIMATION_SPEED_CAP = PLAYER_SPRINT_SPEED * 2.2;
const MIXAMO_HIP_BONE = "mixamorig:Hips";

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
  private readonly projectiles = new Map<number, Mesh>();
  private readonly cameraForward = new Vector3(0, 0, -1);
  private readonly remotePlayerTemplate: Group | null;
  private readonly remotePlayerRetargetedClips: RetargetedAnimationSet | null;

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

  public syncProjectiles(projectiles: ProjectileState[]): void {
    const activeNids = new Set<number>();
    for (const projectile of projectiles) {
      activeNids.add(projectile.nid);
      let mesh = this.projectiles.get(projectile.nid);
      if (!mesh) {
        mesh = new Mesh(
          new SphereGeometry(0.2, 10, 8),
          new MeshStandardMaterial({
            color: projectile.kind === 1 ? 0x74e0ff : 0xffdc8f,
            emissive: projectile.kind === 1 ? 0x3aa3cf : 0xa76f1f,
            emissiveIntensity: 0.42,
            roughness: 0.28,
            metalness: 0.02
          })
        );
        this.projectiles.set(projectile.nid, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(projectile.x, projectile.y, projectile.z);
    }

    for (const [nid, mesh] of this.projectiles) {
      if (!activeNids.has(nid)) {
        this.scene.remove(mesh);
        this.projectiles.delete(nid);
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
