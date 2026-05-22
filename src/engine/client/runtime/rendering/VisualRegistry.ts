/**
 * Purpose: This file maps gameplay/network state to renderable visual objects, and tracks known definitions and lookup mappings in one place.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
export interface EntityVisualDef {
  geometry: "box" | "cylinder" | "dodecahedron" | "sphere";
  geometryParams: number[];
  color: number;
  roughness: number;
  metalness: number;
  emissive?: number;
  emissiveIntensity?: number;
}

export interface RenderArchetypeNodeDef {
  geometry: "box" | "cylinder" | "dodecahedron" | "sphere";
  geometryParams: number[];
  color: number;
  roughness: number;
  metalness: number;
  emissive?: number;
  emissiveIntensity?: number;
  localPosition?: { x: number; y: number; z: number };
}

export interface RenderArchetypeDef {
  id: number;
  nodes: ReadonlyArray<RenderArchetypeNodeDef>;
}

export interface LocationVisualDef {
  kind: "terrainIsland" | "staticCastle" | "movingCastle" | "movingTestPlatform" | "testArena";
  castleBaseColor?: number;
  castleAccentColor?: number;
  slabColor?: number;
  stripeColor?: number;
  arenaColor?: number;
  arenaAccentColor?: number;
  terrainColor?: number;
  terrainRoughness?: number;
  bowlColor?: number;
}

export interface FallbackAvatarVisualDef {
  bodyColor: number;
  bodyRoughness: number;
  bodyMetalness: number;
  visorColor: number;
  visorRoughness: number;
  visorMetalness: number;
}

export interface PropColorDef {
  treeTrunk: number;
  treeCanopy: number;
  rock: number;
  bush: number;
}

export interface VisualPalette {
  entities: ReadonlyMap<number, EntityVisualDef>;
  renderArchetypes: ReadonlyMap<number, RenderArchetypeDef>;
  locations: ReadonlyMap<string, LocationVisualDef>;
  fallbackAvatar: FallbackAvatarVisualDef;
  propColors: PropColorDef;
}

const DEFAULT_FALLBACK_AVATAR: FallbackAvatarVisualDef = {
  bodyColor: 0x888888, bodyRoughness: 0.94, bodyMetalness: 0.01,
  visorColor: 0x444444, visorRoughness: 0.35, visorMetalness: 0.15
};

const DEFAULT_PROP_COLORS: PropColorDef = {
  treeTrunk: 0x6f4b2e, treeCanopy: 0x2f7838, rock: 0x73777f, bush: 0x3e8a45
};

let _palette: VisualPalette = {
  entities: new Map(),
  renderArchetypes: new Map(),
  locations: new Map(),
  fallbackAvatar: DEFAULT_FALLBACK_AVATAR,
  propColors: DEFAULT_PROP_COLORS
};

export function injectVisualPalette(palette: {
  entities?: ReadonlyMap<number, EntityVisualDef>;
  renderArchetypes?: ReadonlyMap<number, RenderArchetypeDef>;
  locations?: ReadonlyMap<string, LocationVisualDef>;
  fallbackAvatar?: Partial<FallbackAvatarVisualDef>;
  propColors?: Partial<PropColorDef>;
}): void {
  _palette = {
    entities: palette.entities ?? _palette.entities,
    renderArchetypes: palette.renderArchetypes ?? _palette.renderArchetypes,
    locations: palette.locations ?? _palette.locations,
    fallbackAvatar: palette.fallbackAvatar ? { ...DEFAULT_FALLBACK_AVATAR, ...palette.fallbackAvatar } : _palette.fallbackAvatar,
    propColors: palette.propColors ? { ...DEFAULT_PROP_COLORS, ...palette.propColors } : _palette.propColors
  };
}

export function getEntityVisual(modelId: number): EntityVisualDef | undefined {
  return _palette.entities.get(modelId);
}

export function getRenderArchetype(id: number): RenderArchetypeDef | undefined {
  return _palette.renderArchetypes.get(id);
}

export function getVisualPalette(): VisualPalette {
  return _palette;
}

export function getFallbackAvatarVisual(): FallbackAvatarVisualDef {
  return _palette.fallbackAvatar;
}

export function getPropColors(): PropColorDef {
  return _palette.propColors;
}

export function getLocationVisual(kind: string): LocationVisualDef | undefined {
  return _palette.locations.get(kind);
}
