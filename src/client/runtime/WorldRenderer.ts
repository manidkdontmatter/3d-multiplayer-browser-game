import {
  AmbientLight,
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
  Vector3,
  WebGLRenderer
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CHARACTER_SUPERHERO_MALE_ASSET_ID } from "../assets/assetManifest";
import { getLoadedAsset } from "../assets/assetLoader";
import { PLAYER_EYE_HEIGHT, STATIC_WORLD_BLOCKS } from "../../shared/index";
import type { PlayerPose, RemotePlayerState } from "./types";

const REMOTE_CHARACTER_TARGET_HEIGHT = PLAYER_EYE_HEIGHT + 0.08;
const MIN_MODEL_HEIGHT = 1e-4;
const REMOTE_CHARACTER_MODEL_YAW_OFFSET = Math.PI;

export class WorldRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly remotePlayers = new Map<number, Group>();
  private readonly platforms = new Map<number, Mesh>();
  private readonly cameraForward = new Vector3(0, 0, -1);
  private readonly remotePlayerTemplate: Group | null;

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
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public syncRemotePlayers(players: RemotePlayerState[]): void {
    const activeNids = new Set<number>();
    for (const remotePlayer of players) {
      activeNids.add(remotePlayer.nid);
      let root = this.remotePlayers.get(remotePlayer.nid);
      if (!root) {
        root = this.createRemotePlayerMesh();
        this.remotePlayers.set(remotePlayer.nid, root);
        this.scene.add(root);
      }

      root.position.set(remotePlayer.x, remotePlayer.y - PLAYER_EYE_HEIGHT, remotePlayer.z);
      root.rotation.y = remotePlayer.yaw;
    }

    for (const [nid, mesh] of this.remotePlayers) {
      if (!activeNids.has(nid)) {
        this.scene.remove(mesh);
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

  private createRemotePlayerMesh(): Group {
    if (this.remotePlayerTemplate) {
      return cloneSkeleton(this.remotePlayerTemplate) as Group;
    }

    const root = new Group();

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

    return root;
  }

  private createRemotePlayerTemplate(): Group | null {
    const gltf = getLoadedAsset<GLTF>(CHARACTER_SUPERHERO_MALE_ASSET_ID);
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
