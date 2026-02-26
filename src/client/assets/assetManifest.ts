// Canonical asset ids and build-time source catalog for runtime-manifest generation.
export type AssetKind = "gltf" | "vrma" | "texture" | "audio" | "binary";
export type AssetPriorityHint = "critical" | "near" | "background";

export interface AssetCatalogDefinition {
  id: string;
  sourceUrl: string;
  kind: AssetKind;
  label?: string;
  groups: string[];
  deps?: string[];
  priorityHint?: AssetPriorityHint;
}

export interface RuntimeAssetDefinition {
  id: string;
  url: string;
  kind: AssetKind;
  hash: string;
  bytes: number;
  label?: string;
  deps: string[];
  groups: string[];
  priorityHint: AssetPriorityHint;
}

export interface RuntimeAssetManifest {
  manifestVersion: 1;
  buildId: string;
  generatedAtIso: string;
  assets: RuntimeAssetDefinition[];
  groups: Record<string, string[]>;
}

export interface RuntimeManifestBootstrap {
  manifestVersion: 1;
  buildId: string;
  generatedAtIso: string;
  manifestUrl: string;
}

export const RUNTIME_ASSET_BOOTSTRAP_URL = "/runtime-manifests/runtime-bootstrap.json";
export const ASSET_GROUP_CORE = "core";
export const ASSET_GROUP_WORLD_DEFAULT = "world:default";
export const ASSET_GROUP_SFX = "sfx";

export const CHARACTER_MALE_ASSET_ID = "character.male";
export const CHARACTER_ANIM_IDLE_ASSET_ID = "character.anim.idle";
export const CHARACTER_ANIM_WALK_ASSET_ID = "character.anim.walk";
export const CHARACTER_ANIM_RUN_ASSET_ID = "character.anim.run";
export const CHARACTER_ANIM_JUMP_ASSET_ID = "character.anim.jump";
export const CHARACTER_ANIM_PUNCH_ASSET_ID = "character.anim.punch";
export const SFX_HIT_ASSET_ID = "sfx.hit";
export const WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID = "world.foliage.grass.plain";
export const WORLD_WATER_NORMALS_ASSET_ID = "world.water.normals";
export const WORLD_WATER_NORMALS_A_ASSET_ID = "world.water.normals.a";
export const WORLD_WATER_NORMALS_B_ASSET_ID = "world.water.normals.b";

export const ASSET_CATALOG: AssetCatalogDefinition[] = [
  {
    id: CHARACTER_MALE_ASSET_ID,
    label: "CoolAlien VRM Character",
    kind: "gltf",
    sourceUrl: "/assets/models/characters/male/CoolAlien.vrm",
    groups: [ASSET_GROUP_CORE],
    priorityHint: "critical"
  },
  {
    id: CHARACTER_ANIM_IDLE_ASSET_ID,
    label: "Character Idle Animation",
    kind: "vrma",
    sourceUrl: "/assets/animations/vrma/Idle.vrma",
    groups: [ASSET_GROUP_CORE],
    priorityHint: "critical"
  },
  {
    id: CHARACTER_ANIM_WALK_ASSET_ID,
    label: "Character Walk Animation",
    kind: "vrma",
    sourceUrl: "/assets/animations/vrma/Walking.vrma",
    groups: [ASSET_GROUP_CORE],
    priorityHint: "critical"
  },
  {
    id: CHARACTER_ANIM_RUN_ASSET_ID,
    label: "Character Run Animation",
    kind: "vrma",
    sourceUrl: "/assets/animations/vrma/Running.vrma",
    groups: [ASSET_GROUP_CORE],
    priorityHint: "critical"
  },
  {
    id: CHARACTER_ANIM_JUMP_ASSET_ID,
    label: "Character Jump Animation",
    kind: "vrma",
    sourceUrl: "/assets/animations/vrma/Jump.vrma",
    groups: [ASSET_GROUP_CORE],
    priorityHint: "critical"
  },
  {
    id: CHARACTER_ANIM_PUNCH_ASSET_ID,
    label: "Character Punch Animation",
    kind: "vrma",
    sourceUrl: "/assets/animations/vrma/Punching.vrma",
    groups: [ASSET_GROUP_CORE],
    priorityHint: "critical"
  },
  {
    id: WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID,
    label: "Grass Billboard Texture",
    kind: "texture",
    sourceUrl: "/assets/textures/foliage/grass.png",
    groups: [ASSET_GROUP_WORLD_DEFAULT],
    priorityHint: "near"
  },
  {
    id: WORLD_WATER_NORMALS_ASSET_ID,
    label: "Water Normal Texture",
    kind: "texture",
    sourceUrl: "/assets/textures/water/waternormals.jpg",
    groups: [ASSET_GROUP_WORLD_DEFAULT],
    priorityHint: "near"
  },
  {
    id: WORLD_WATER_NORMALS_A_ASSET_ID,
    label: "Water Normal Texture A",
    kind: "texture",
    sourceUrl: "/assets/textures/water/water-normal-a.jpg",
    groups: [ASSET_GROUP_WORLD_DEFAULT],
    priorityHint: "near"
  },
  {
    id: WORLD_WATER_NORMALS_B_ASSET_ID,
    label: "Water Normal Texture B",
    kind: "texture",
    sourceUrl: "/assets/textures/water/water-normal-b.jpg",
    groups: [ASSET_GROUP_WORLD_DEFAULT],
    priorityHint: "near"
  },
  {
    id: SFX_HIT_ASSET_ID,
    label: "Melee Hit Sound",
    kind: "audio",
    sourceUrl: "/assets/audio/hit.ogg",
    groups: [ASSET_GROUP_SFX],
    priorityHint: "background"
  }
];
