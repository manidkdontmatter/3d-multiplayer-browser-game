export type AssetKind = "gltf" | "fbx" | "texture" | "audio" | "binary";

export interface AssetDefinition {
  id: string;
  url: string;
  kind: AssetKind;
  label?: string;
  preload?: boolean;
}

export const CHARACTER_MALE_ASSET_ID = "character.male";
export const ANIMATION_MIXAMO_IDLE_ASSET_ID = "animation.mixamo.idle";
export const ANIMATION_MIXAMO_WALK_ASSET_ID = "animation.mixamo.walk";
export const ANIMATION_MIXAMO_RUN_ASSET_ID = "animation.mixamo.run";
export const ANIMATION_MIXAMO_JUMP_ASSET_ID = "animation.mixamo.jump";
export const ANIMATION_MIXAMO_PUNCH_ASSET_ID = "animation.mixamo.punch";

// Keep this list as the single source of truth for runtime-loaded assets.
// For now we preload everything in this manifest during boot.
export const ASSET_MANIFEST: AssetDefinition[] = [
  {
    id: CHARACTER_MALE_ASSET_ID,
    label: "Male Character (rig)",
    kind: "gltf",
    url: "/assets/models/characters/male/Male_FullBody.gltf",
    preload: true
  },
  {
    id: ANIMATION_MIXAMO_IDLE_ASSET_ID,
    label: "Mixamo Idle",
    kind: "fbx",
    url: "/assets/animations/mixamo/Idle.fbx",
    preload: true
  },
  {
    id: ANIMATION_MIXAMO_WALK_ASSET_ID,
    label: "Mixamo Walk",
    kind: "fbx",
    url: "/assets/animations/mixamo/Walking.fbx",
    preload: true
  },
  {
    id: ANIMATION_MIXAMO_RUN_ASSET_ID,
    label: "Mixamo Run",
    kind: "fbx",
    url: "/assets/animations/mixamo/Running.fbx",
    preload: true
  },
  {
    id: ANIMATION_MIXAMO_JUMP_ASSET_ID,
    label: "Mixamo Jump",
    kind: "fbx",
    url: "/assets/animations/mixamo/Jump.fbx",
    preload: true
  },
  {
    id: ANIMATION_MIXAMO_PUNCH_ASSET_ID,
    label: "Mixamo Punch",
    kind: "fbx",
    url: "/assets/animations/mixamo/Punching.fbx",
    preload: true
  }
];
