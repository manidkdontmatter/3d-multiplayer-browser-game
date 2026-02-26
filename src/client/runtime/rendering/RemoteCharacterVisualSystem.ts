// Remote player visual/animation presenter used for replicated character rendering.
import { Group, Mesh, MeshStandardMaterial, BoxGeometry, CapsuleGeometry, type Object3D, type Scene } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type VRM, type VRMHumanoid } from "@pixiv/three-vrm";
import { MOVEMENT_MODE_GROUNDED, PLAYER_EYE_HEIGHT, PLAYER_SPRINT_SPEED } from "../../../shared/index";
import { CHARACTER_MALE_ASSET_ID } from "../../assets/assetManifest";
import { ensureAsset, getLoadedAsset } from "../../assets/assetLoader";
import {
  CharacterAnimationController
} from "../animation/CharacterAnimationController";
import {
  createCharacterAnimationClips,
  loadCharacterVRMAnimationAssets,
  requestCharacterAnimationAssets,
  type CharacterVRMAnimationAssets
} from "../animation/characterAnimationLibrary";
import type { RemotePlayerState } from "../types";
import {
  buildSourceRawBoneNames,
  buildVrmCoreForRoot,
  cloneVrmScene,
  createHumanoidForClonedModel,
  normalizeModelToGround,
  removeNormalizedHumanoidRigs,
  type SourceBoneBinding
} from "./CharacterVisualShared";

const REMOTE_ANIMATION_SPEED_CAP = PLAYER_SPRINT_SPEED * 2.2;
const REMOTE_CHARACTER_MODEL_YAW_OFFSET = 0;

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
  movementMode: RemotePlayerState["movementMode"];
  sprinting: boolean;
  initialized: boolean;
}

export class RemoteCharacterVisualSystem {
  private readonly remotePlayers = new Map<number, RemotePlayerVisual>();
  private characterAnimationAssets: CharacterVRMAnimationAssets | null;
  private readonly sourceRawBoneNames: SourceBoneBinding[] = [];
  private sourceVrmMetaVersion: "0" | "1" | null;
  private remotePlayerTemplate: Group | null;
  private templateRequestInFlight = false;

  public constructor(private readonly scene: Scene) {
    this.characterAnimationAssets = loadCharacterVRMAnimationAssets();
    this.sourceVrmMetaVersion = null;
    this.remotePlayerTemplate = null;
    this.tryBuildTemplate();
    this.requestTemplateAssets();
  }

  public syncRemotePlayers(players: RemotePlayerState[], frameDeltaSeconds: number): void {
    const dt = Math.max(1 / 240, Math.min(frameDeltaSeconds, 1 / 20));
    const activeNids = new Set<number>();
    for (const remotePlayer of players) {
      activeNids.add(remotePlayer.nid);
      let visual = this.remotePlayers.get(remotePlayer.nid);
      if (!visual) {
        this.tryBuildTemplate();
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
      visual.movementMode = remotePlayer.movementMode;
      visual.sprinting = visual.horizontalSpeed >= PLAYER_SPRINT_SPEED * 0.92;
      visual.root.position.set(remotePlayer.x, renderY, remotePlayer.z);
      visual.root.quaternion.set(
        remotePlayer.rotation.x,
        remotePlayer.rotation.y,
        remotePlayer.rotation.z,
        remotePlayer.rotation.w
      );
      visual.lastX = remotePlayer.x;
      visual.lastY = renderY;
      visual.lastZ = remotePlayer.z;
      visual.animator?.update(dt, {
        horizontalSpeed: visual.horizontalSpeed,
        verticalSpeed: visual.verticalSpeed,
        grounded: visual.grounded,
        sprinting: visual.sprinting,
        movementMode: visual.movementMode
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

  public triggerMeleeForOwner(ownerNid: number): void {
    this.remotePlayers.get(ownerNid)?.animator?.triggerPunch();
  }

  public getPlayerPosition(ownerNid: number): { x: number; y: number; z: number } | null {
    const visual = this.remotePlayers.get(ownerNid);
    if (!visual) {
      return null;
    }
    return {
      x: visual.root.position.x,
      y: visual.root.position.y,
      z: visual.root.position.z
    };
  }

  public dispose(): void {
    for (const visual of this.remotePlayers.values()) {
      visual.animator?.dispose();
      this.scene.remove(visual.root);
    }
    this.remotePlayers.clear();
  }

  private createRemotePlayerTemplate(): Group | null {
    const gltf = getLoadedAsset<GLTF>(CHARACTER_MALE_ASSET_ID);
    if (!gltf?.scene) {
      return null;
    }

    const root = new Group();
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;
    const sourceScene = vrm?.scene ?? gltf.scene;
    const model = cloneVrmScene(sourceScene) as Object3D;
    removeNormalizedHumanoidRigs(model);
    model.rotation.y = REMOTE_CHARACTER_MODEL_YAW_OFFSET;
    normalizeModelToGround(model);
    root.add(model);
    return root;
  }

  private tryBuildTemplate(): void {
    if (this.remotePlayerTemplate) {
      return;
    }
    const sourceVrm = this.getSourceVrm();
    if (!sourceVrm) {
      return;
    }
    this.characterAnimationAssets = loadCharacterVRMAnimationAssets();
    this.sourceVrmMetaVersion = sourceVrm.meta.metaVersion ?? null;
    if (this.sourceRawBoneNames.length === 0) {
      this.sourceRawBoneNames.push(...buildSourceRawBoneNames(sourceVrm));
    }
    this.remotePlayerTemplate = this.createRemotePlayerTemplate();
  }

  private requestTemplateAssets(): void {
    if (this.templateRequestInFlight) {
      return;
    }
    this.templateRequestInFlight = true;
    requestCharacterAnimationAssets();
    void ensureAsset(CHARACTER_MALE_ASSET_ID, "critical")
      .then(() => {
        this.tryBuildTemplate();
      })
      .finally(() => {
        this.templateRequestInFlight = false;
      });
  }

  private createRemotePlayerVisual(): RemotePlayerVisual {
    let root: Group;
    let animator: CharacterAnimationController | null = null;
    let humanoid: VRMHumanoid | null = null;
    if (this.remotePlayerTemplate) {
      root = cloneVrmScene(this.remotePlayerTemplate) as Group;
      humanoid = createHumanoidForClonedModel(root, this.sourceRawBoneNames);
      if (!humanoid) {
        console.warn("[animation] remote humanoid creation failed; avatar will be static");
      }
      if (humanoid && this.characterAnimationAssets && this.sourceVrmMetaVersion) {
        const clips = createCharacterAnimationClips(
          buildVrmCoreForRoot(root, humanoid, this.sourceVrmMetaVersion),
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
      const capsuleLength = 1;
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
      movementMode: MOVEMENT_MODE_GROUNDED,
      sprinting: false,
      initialized: false
    };
  }

  private getSourceVrm(): VRM | null {
    const gltf = getLoadedAsset<GLTF>(CHARACTER_MALE_ASSET_ID);
    return ((gltf?.userData as { vrm?: VRM } | undefined)?.vrm) ?? null;
  }
}
