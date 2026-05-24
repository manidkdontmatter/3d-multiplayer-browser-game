/**
 * Purpose: This file lists reusable definitions used by runtime systems, and defines or loads runtime asset metadata for reliable asset access.
 * Scope: It belongs to the game-specific client composition layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  ASSET_GROUP_CORE,
  ASSET_GROUP_CREATOR_APPEARANCE,
  ASSET_GROUP_SFX,
  ASSET_GROUP_WORLD_DEFAULT,
  ASSET_GROUP_WORLD_SKYBOXES,
  CHARACTER_ANIM_IDLE_ASSET_ID,
  CHARACTER_ANIM_JUMP_ASSET_ID,
  CHARACTER_ANIM_PUNCH_ASSET_ID,
  CHARACTER_ANIM_RUN_ASSET_ID,
  CHARACTER_ANIM_WALK_ASSET_ID,
  CHARACTER_MALE_ASSET_ID,
  SFX_HIT_ASSET_ID,
  WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID,
  WORLD_SKYBOX_1_ASSET_ID,
  WORLD_SKYBOX_2_ASSET_ID,
  WORLD_SKYBOX_3_ASSET_ID,
  WORLD_SKYBOX_4_ASSET_ID,
  WORLD_SKYBOX_5_ASSET_ID,
  injectAssetCatalog,
  type AssetCatalogDefinition
} from "../../engine/client/assets/assetManifest";

function skyboxFaceUrls(folder: string): string[] {
  return ["px", "nx", "py", "ny", "pz", "nz"].map(
    (face) => `/assets/textures/skyboxes/${folder}/${face}.png`
  );
}

export const ASSET_CATALOG_DEFINITIONS: AssetCatalogDefinition[] = [
  {
    id: "creator.appearance.ready.red.equipped",
    label: "Creator Ready Red Equipped Production Asset",
    kind: "texture",
    sourceUrl: "/assets/textures/creator/ready-equipped-red-v1.svg",
    groups: [ASSET_GROUP_CORE, ASSET_GROUP_CREATOR_APPEARANCE],
    priorityHint: "background"
  },
  {
    id: "creator.appearance.ready.red.pickup",
    label: "Creator Ready Red Pickup Production Asset",
    kind: "texture",
    sourceUrl: "/assets/textures/creator/ready-pickup-red-v1.svg",
    groups: [ASSET_GROUP_CORE, ASSET_GROUP_CREATOR_APPEARANCE],
    priorityHint: "background"
  },
  {
    id: "creator.appearance.ready.green.equipped",
    label: "Creator Ready Green Equipped Production Asset",
    kind: "texture",
    sourceUrl: "/assets/textures/creator/ready-equipped-green-v1.svg",
    groups: [ASSET_GROUP_CORE, ASSET_GROUP_CREATOR_APPEARANCE],
    priorityHint: "background"
  },
  {
    id: "creator.appearance.ready.green.pickup",
    label: "Creator Ready Green Pickup Production Asset",
    kind: "texture",
    sourceUrl: "/assets/textures/creator/ready-pickup-green-v1.svg",
    groups: [ASSET_GROUP_CORE, ASSET_GROUP_CREATOR_APPEARANCE],
    priorityHint: "background"
  },
  {
    id: "creator.appearance.ready.blue.equipped",
    label: "Creator Ready Blue Equipped Production Asset",
    kind: "texture",
    sourceUrl: "/assets/textures/creator/ready-equipped-blue-v1.svg",
    groups: [ASSET_GROUP_CORE, ASSET_GROUP_CREATOR_APPEARANCE],
    priorityHint: "background"
  },
  {
    id: "creator.appearance.ready.blue.pickup",
    label: "Creator Ready Blue Pickup Production Asset",
    kind: "texture",
    sourceUrl: "/assets/textures/creator/ready-pickup-blue-v1.svg",
    groups: [ASSET_GROUP_CORE, ASSET_GROUP_CREATOR_APPEARANCE],
    priorityHint: "background"
  },
  {
    id: "creator.appearance.activation.red",
    label: "Creator Activation Red Production Asset",
    kind: "texture",
    sourceUrl: "/assets/textures/creator/activation-projectile-red-v1.svg",
    groups: [ASSET_GROUP_CORE, ASSET_GROUP_CREATOR_APPEARANCE],
    priorityHint: "background"
  },
  {
    id: "creator.appearance.activation.green",
    label: "Creator Activation Green Production Asset",
    kind: "texture",
    sourceUrl: "/assets/textures/creator/activation-projectile-green-v1.svg",
    groups: [ASSET_GROUP_CORE, ASSET_GROUP_CREATOR_APPEARANCE],
    priorityHint: "background"
  },
  {
    id: "creator.appearance.activation.blue",
    label: "Creator Activation Blue Production Asset",
    kind: "texture",
    sourceUrl: "/assets/textures/creator/activation-projectile-blue-v1.svg",
    groups: [ASSET_GROUP_CORE, ASSET_GROUP_CREATOR_APPEARANCE],
    priorityHint: "background"
  },
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

export function initClientAssetCatalog(): void {
  injectAssetCatalog(ASSET_CATALOG_DEFINITIONS);
}


