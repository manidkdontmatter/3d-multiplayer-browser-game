import { Group, type Object3D, type Scene } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type VRM } from "@pixiv/three-vrm";
import { PLAYER_EYE_HEIGHT, PLAYER_SPRINT_SPEED } from "../../../shared/index";
import { CHARACTER_MALE_ASSET_ID } from "../../assets/assetManifest";
import { getLoadedAsset } from "../../assets/assetLoader";
import {
  CharacterAnimationController
} from "../animation/CharacterAnimationController";
import {
  createCharacterAnimationClips,
  loadCharacterVRMAnimationAssets
} from "../animation/characterAnimationLibrary";
import type { PlayerPose } from "../types";
import { normalizeModelToGround } from "./CharacterVisualShared";

const REMOTE_ANIMATION_SPEED_CAP = PLAYER_SPRINT_SPEED * 2.2;
const LOCAL_FIRST_PERSON_ONLY_LAYER = 11;
const LOCAL_THIRD_PERSON_ONLY_LAYER = 12;
const REMOTE_CHARACTER_MODEL_YAW_OFFSET = 0;

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

export class LocalCharacterVisualSystem {
  private readonly localPlayerVisual: LocalPlayerVisual | null;

  public constructor(private readonly scene: Scene) {
    this.localPlayerVisual = this.createLocalPlayerVisual();
    if (this.localPlayerVisual) {
      this.scene.add(this.localPlayerVisual.root);
    }
  }

  public syncLocalPlayer(localPose: PlayerPose, options: { frameDeltaSeconds: number; grounded: boolean }): void {
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

  public triggerLocalMeleePunch(): void {
    this.localPlayerVisual?.animator?.triggerPunch();
  }

  public getPlayerPosition(): { x: number; y: number; z: number } | null {
    if (!this.localPlayerVisual) {
      return null;
    }
    return {
      x: this.localPlayerVisual.root.position.x,
      y: this.localPlayerVisual.root.position.y,
      z: this.localPlayerVisual.root.position.z
    };
  }

  public dispose(): void {
    if (!this.localPlayerVisual) {
      return;
    }
    this.localPlayerVisual.animator?.dispose();
    this.scene.remove(this.localPlayerVisual.root);
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
    normalizeModelToGround(model);
    if (vrm?.firstPerson) {
      vrm.firstPerson.setup({
        firstPersonOnlyLayer: LOCAL_FIRST_PERSON_ONLY_LAYER,
        thirdPersonOnlyLayer: LOCAL_THIRD_PERSON_ONLY_LAYER
      });
    }
    root.add(model);

    const characterAnimationAssets = loadCharacterVRMAnimationAssets();
    const localClips = vrm && characterAnimationAssets
      ? createCharacterAnimationClips(vrm, characterAnimationAssets)
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
}
