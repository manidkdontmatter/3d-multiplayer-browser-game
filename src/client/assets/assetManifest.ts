export type AssetKind = "gltf" | "texture" | "audio" | "binary";

export interface AssetDefinition {
  id: string;
  url: string;
  kind: AssetKind;
  label?: string;
  preload?: boolean;
}

export const CHARACTER_SUPERHERO_MALE_ASSET_ID = "character.superhero.male";

// Keep this list as the single source of truth for runtime-loaded assets.
// For now we preload everything in this manifest during boot.
export const ASSET_MANIFEST: AssetDefinition[] = [
  {
    id: CHARACTER_SUPERHERO_MALE_ASSET_ID,
    label: "Superhero Male (rig)",
    kind: "gltf",
    url: "/assets/models/characters/superhero/Superhero_Male_FullBody.gltf",
    preload: true
  }
];
