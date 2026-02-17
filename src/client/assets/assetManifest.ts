export type AssetKind = "gltf" | "vrma" | "texture" | "audio" | "binary";

export interface AssetDefinition {
  id: string;
  url: string;
  kind: AssetKind;
  label?: string;
  preload?: boolean;
}

export const CHARACTER_MALE_ASSET_ID = "character.male";
export const CHARACTER_ANIM_IDLE_ASSET_ID = "character.anim.idle";
export const CHARACTER_ANIM_WALK_ASSET_ID = "character.anim.walk";
export const CHARACTER_ANIM_RUN_ASSET_ID = "character.anim.run";
export const CHARACTER_ANIM_JUMP_ASSET_ID = "character.anim.jump";
export const CHARACTER_ANIM_PUNCH_ASSET_ID = "character.anim.punch";
export const SFX_HIT_ASSET_ID = "sfx.hit";

// Keep this list as the single source of truth for runtime-loaded assets.
// For now we preload everything in this manifest during boot.
export const ASSET_MANIFEST: AssetDefinition[] = [
  {
    id: CHARACTER_MALE_ASSET_ID,
    label: "CoolAlien VRM Character",
    kind: "gltf",
    url: "/assets/models/characters/male/CoolAlien.vrm",
    preload: true
  },
  {
    id: CHARACTER_ANIM_IDLE_ASSET_ID,
    label: "Character Idle Animation",
    kind: "vrma",
    url: "/assets/animations/vrma/Idle.vrma",
    preload: true
  },
  {
    id: CHARACTER_ANIM_WALK_ASSET_ID,
    label: "Character Walk Animation",
    kind: "vrma",
    url: "/assets/animations/vrma/Walking.vrma",
    preload: true
  },
  {
    id: CHARACTER_ANIM_RUN_ASSET_ID,
    label: "Character Run Animation",
    kind: "vrma",
    url: "/assets/animations/vrma/Running.vrma",
    preload: true
  },
  {
    id: CHARACTER_ANIM_JUMP_ASSET_ID,
    label: "Character Jump Animation",
    kind: "vrma",
    url: "/assets/animations/vrma/Jump.vrma",
    preload: true
  },
  {
    id: CHARACTER_ANIM_PUNCH_ASSET_ID,
    label: "Character Punch Animation",
    kind: "vrma",
    url: "/assets/animations/vrma/Punching.vrma",
    preload: true
  },
  {
    id: SFX_HIT_ASSET_ID,
    label: "Melee Hit Sound",
    kind: "audio",
    url: "/assets/audio/hit.ogg",
    preload: true
  }
];
