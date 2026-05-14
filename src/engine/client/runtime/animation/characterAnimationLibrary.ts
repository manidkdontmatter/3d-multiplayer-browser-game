import { AnimationClip, AnimationUtils } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM, VRMCore } from "@pixiv/three-vrm";
import { type VRMAnimation, createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import { ensureAsset, getLoadedAsset } from "../../assets/assetLoader";
import {
  CHARACTER_ANIM_IDLE_ASSET_ID,
  CHARACTER_ANIM_JUMP_ASSET_ID,
  CHARACTER_ANIM_PUNCH_ASSET_ID,
  CHARACTER_ANIM_RUN_ASSET_ID,
  CHARACTER_ANIM_WALK_ASSET_ID
} from "../../assets/assetManifest";
import {
  type CharacterAnimationClips,
  filterClipToUpperBody
} from "./CharacterAnimationController";

export interface CharacterVRMAnimationAssets {
  idle: VRMAnimation;
  walk: VRMAnimation;
  run: VRMAnimation;
  jump: VRMAnimation;
  punch: VRMAnimation;
}

let requestIssued = false;

export function loadCharacterVRMAnimationAssets(): CharacterVRMAnimationAssets | null {
  const idle = getFirstVRMAnimation(CHARACTER_ANIM_IDLE_ASSET_ID);
  const walk = getFirstVRMAnimation(CHARACTER_ANIM_WALK_ASSET_ID);
  const run = getFirstVRMAnimation(CHARACTER_ANIM_RUN_ASSET_ID);
  const jump = getFirstVRMAnimation(CHARACTER_ANIM_JUMP_ASSET_ID);
  const punch = getFirstVRMAnimation(CHARACTER_ANIM_PUNCH_ASSET_ID);
  if (!idle || !walk || !run || !jump || !punch) {
    console.warn("[animation] failed to load one or more VRMA animation assets");
    return null;
  }
  return { idle, walk, run, jump, punch };
}

export function createCharacterAnimationClips(
  target: VRM | VRMCore,
  animations: CharacterVRMAnimationAssets
): CharacterAnimationClips | null {
  const idle = createNamedClip(target, animations.idle, "idle");
  const walk = createNamedClip(target, animations.walk, "walk");
  const run = createNamedClip(target, animations.run, "run");
  const jump = createNamedClip(target, animations.jump, "jump");
  const punch = createNamedClip(target, animations.punch, "punch");
  if (!idle || !walk || !run || !jump || !punch) {
    return null;
  }

  const punchUpperBody = filterClipToUpperBody(punch);
  AnimationUtils.makeClipAdditive(punchUpperBody);

  return {
    idle,
    walk,
    run,
    jump,
    punchUpperBodyAdditive: punchUpperBody
  };
}

export function requestCharacterAnimationAssets(): void {
  if (requestIssued) {
    return;
  }
  requestIssued = true;
  const assetIds = [
    CHARACTER_ANIM_IDLE_ASSET_ID,
    CHARACTER_ANIM_WALK_ASSET_ID,
    CHARACTER_ANIM_RUN_ASSET_ID,
    CHARACTER_ANIM_JUMP_ASSET_ID,
    CHARACTER_ANIM_PUNCH_ASSET_ID
  ];
  for (const assetId of assetIds) {
    void ensureAsset(assetId, "critical").catch(() => {
      requestIssued = false;
    });
  }
}

function createNamedClip(target: VRM | VRMCore, animation: VRMAnimation, name: string): AnimationClip | null {
  const clip = createVRMAnimationClip(animation, target);
  if (!clip || clip.tracks.length === 0) {
    console.warn(`[animation] VRMA clip "${name}" generated no tracks`);
    return null;
  }
  const noRootMotionTracks = stripRootMotionTracks(target, clip.tracks);
  return new AnimationClip(name, clip.duration, noRootMotionTracks);
}

function getFirstVRMAnimation(assetId: string): VRMAnimation | null {
  const gltf = getLoadedAsset<GLTF>(assetId);
  const animations = (gltf?.userData as { vrmAnimations?: VRMAnimation[] } | undefined)?.vrmAnimations;
  if (!animations || animations.length === 0) {
    console.warn(`[animation] missing VRMA animation for asset "${assetId}"`);
    return null;
  }
  return animations[0] ?? null;
}

function stripRootMotionTracks(target: VRM | VRMCore, tracks: AnimationClip["tracks"]): AnimationClip["tracks"] {
  const normalizedHipsNode = target.humanoid.getNormalizedBoneNode("hips");
  const rawHipsNode = target.humanoid.getRawBoneNode("hips");
  const blockedTrackNames = new Set<string>();
  const normalizedHipsName = normalizedHipsNode?.name?.trim();
  const rawHipsName = rawHipsNode?.name?.trim();
  if (normalizedHipsName) {
    blockedTrackNames.add(`${normalizedHipsName}.position`);
  }
  if (rawHipsName) {
    blockedTrackNames.add(`${rawHipsName}.position`);
  }

  if (blockedTrackNames.size === 0) {
    return tracks.slice();
  }

  return tracks.filter((track) => !blockedTrackNames.has(track.name));
}
