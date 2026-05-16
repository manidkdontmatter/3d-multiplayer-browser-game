// Canonical asset ids and build-time source catalog for runtime-manifest generation.
export type AssetKind = "gltf" | "vrma" | "texture" | "cubemap" | "audio" | "binary";
export type AssetPriorityHint = "critical" | "near" | "background";

export interface AssetCatalogDefinition {
  id: string;
  sourceUrl?: string;
  sourceUrls?: string[];
  kind: AssetKind;
  label?: string;
  groups: string[];
  deps?: string[];
  priorityHint?: AssetPriorityHint;
}

export interface RuntimeAssetDefinition {
  id: string;
  url: string;
  urls?: string[];
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
export const ASSET_GROUP_WORLD_SKYBOXES = "world:skyboxes";
export const ASSET_GROUP_SFX = "sfx";

export const CHARACTER_MALE_ASSET_ID = "character.male";
export const CHARACTER_ANIM_IDLE_ASSET_ID = "character.anim.idle";
export const CHARACTER_ANIM_WALK_ASSET_ID = "character.anim.walk";
export const CHARACTER_ANIM_RUN_ASSET_ID = "character.anim.run";
export const CHARACTER_ANIM_JUMP_ASSET_ID = "character.anim.jump";
export const CHARACTER_ANIM_PUNCH_ASSET_ID = "character.anim.punch";
export const SFX_HIT_ASSET_ID = "sfx.hit";
export const WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID = "world.foliage.grass.plain";
export const WORLD_SKYBOX_1_ASSET_ID = "world.skybox.1";
export const WORLD_SKYBOX_2_ASSET_ID = "world.skybox.2";
export const WORLD_SKYBOX_3_ASSET_ID = "world.skybox.3";
export const WORLD_SKYBOX_4_ASSET_ID = "world.skybox.4";
export const WORLD_SKYBOX_5_ASSET_ID = "world.skybox.5";

export let ASSET_CATALOG: AssetCatalogDefinition[] = [];

export function injectAssetCatalog(catalog: AssetCatalogDefinition[]): void {
  ASSET_CATALOG = catalog;
}

// ASSET_CATALOG is now provided by the game layer via injectAssetCatalog().
// See src/game/client/assetCatalog.ts for the game-specific definitions.
