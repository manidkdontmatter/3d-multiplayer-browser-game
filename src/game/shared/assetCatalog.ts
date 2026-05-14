// Game-specific asset catalog definitions.
// Provides the asset manifest data that the engine needs for runtime asset loading.

import {
  injectAssetCatalog,
  type AssetCatalogDefinition
} from "../../engine/client/assets/assetManifest";
import {
  ASSET_GROUP_CORE,
  ASSET_GROUP_WORLD_DEFAULT,
  ASSET_GROUP_WORLD_SKYBOXES,
  ASSET_GROUP_SFX,
  CHARACTER_MALE_ASSET_ID,
  CHARACTER_ANIM_IDLE_ASSET_ID,
  CHARACTER_ANIM_WALK_ASSET_ID,
  CHARACTER_ANIM_RUN_ASSET_ID,
  CHARACTER_ANIM_JUMP_ASSET_ID,
  CHARACTER_ANIM_PUNCH_ASSET_ID,
  SFX_HIT_ASSET_ID,
  WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID,
  WORLD_SKYBOX_1_ASSET_ID,
  WORLD_SKYBOX_2_ASSET_ID,
  WORLD_SKYBOX_3_ASSET_ID,
  WORLD_SKYBOX_4_ASSET_ID,
  WORLD_SKYBOX_5_ASSET_ID
} from "../../engine/client/assets/assetManifest";

function skyboxFaceUrls(folder: string): string[] {
  return ["px", "nx", "py", "ny", "pz", "nz"].map(
    (face) => `/assets/textures/skyboxes/${folder}/${face}.png`
  );
}

const ASSET_CATALOG_DEFINITIONS: AssetCatalogDefinition[] = [
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
    id: WORLD_SKYBOX_1_ASSET_ID,
    label: "Skybox 1 Cubemap",
    kind: "cubemap",
    sourceUrls: skyboxFaceUrls("skybox1"),
    groups: [ASSET_GROUP_WORLD_DEFAULT, ASSET_GROUP_WORLD_SKYBOXES],
    priorityHint: "near"
  },
  {
    id: WORLD_SKYBOX_2_ASSET_ID,
    label: "Skybox 2 Cubemap",
    kind: "cubemap",
    sourceUrls: skyboxFaceUrls("skybox2"),
    groups: [ASSET_GROUP_WORLD_DEFAULT, ASSET_GROUP_WORLD_SKYBOXES],
    priorityHint: "near"
  },
  {
    id: WORLD_SKYBOX_3_ASSET_ID,
    label: "Skybox 3 Cubemap",
    kind: "cubemap",
    sourceUrls: skyboxFaceUrls("skybox3"),
    groups: [ASSET_GROUP_WORLD_DEFAULT, ASSET_GROUP_WORLD_SKYBOXES],
    priorityHint: "near"
  },
  {
    id: WORLD_SKYBOX_4_ASSET_ID,
    label: "Skybox 4 Cubemap",
    kind: "cubemap",
    sourceUrls: skyboxFaceUrls("skybox4"),
    groups: [ASSET_GROUP_WORLD_DEFAULT, ASSET_GROUP_WORLD_SKYBOXES],
    priorityHint: "near"
  },
  {
    id: WORLD_SKYBOX_5_ASSET_ID,
    label: "Skybox 5 Cubemap",
    kind: "cubemap",
    sourceUrls: skyboxFaceUrls("skybox5"),
    groups: [ASSET_GROUP_WORLD_DEFAULT, ASSET_GROUP_WORLD_SKYBOXES],
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

export function initAssetCatalog(): void {
  injectAssetCatalog(ASSET_CATALOG_DEFINITIONS);
}
