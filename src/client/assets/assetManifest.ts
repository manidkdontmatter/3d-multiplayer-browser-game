export type AssetKind = "gltf" | "texture" | "audio" | "binary";

export interface AssetDefinition {
  id: string;
  url: string;
  kind: AssetKind;
  label?: string;
  preload?: boolean;
}

// Keep this list as the single source of truth for runtime-loaded assets.
// For now we preload everything in this manifest during boot.
export const ASSET_MANIFEST: AssetDefinition[] = [];
