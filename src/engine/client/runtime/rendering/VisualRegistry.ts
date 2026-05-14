// Visual property registry — populated by the game layer at startup.
// The engine renderer queries this registry instead of hardcoding visual properties.

export interface PlatformVisualDef {
  halfX: number;
  halfY: number;
  halfZ: number;
  color: number;
  roughness?: number;
  metalness?: number;
}

export interface NpcVisualDef {
  color: number;
  capsuleRadius?: number;
  capsuleHeight?: number;
  roughness?: number;
  metalness?: number;
}

export interface ItemVisualDef {
  geometry: "box" | "dodecahedron" | "cylinder" | "sphere";
  geometryParams: number[];
  color: number;
  roughness: number;
  metalness: number;
  emissive?: number;
  emissiveIntensity?: number;
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

export interface DummyVisualDef {
  radius: number;
  height: number;
  segments: number;
  color: number;
  roughness: number;
  metalness: number;
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
  platforms: ReadonlyMap<number, PlatformVisualDef>;
  npcs: ReadonlyMap<number, NpcVisualDef>;
  items: ReadonlyMap<number, ItemVisualDef>;
  locations: ReadonlyMap<string, LocationVisualDef>;
  dummy: DummyVisualDef;
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

const DEFAULT_DUMMY: DummyVisualDef = {
  radius: 0.42, height: 1.9, segments: 12,
  color: 0xa6c9d8, roughness: 0.88, metalness: 0.08
};

let _palette: VisualPalette = {
  platforms: new Map(),
  npcs: new Map(),
  items: new Map(),
  locations: new Map(),
  dummy: DEFAULT_DUMMY,
  fallbackAvatar: DEFAULT_FALLBACK_AVATAR,
  propColors: DEFAULT_PROP_COLORS
};

export function injectVisualPalette(palette: Partial<VisualPalette> & {
  dummy?: Partial<DummyVisualDef>;
  fallbackAvatar?: Partial<FallbackAvatarVisualDef>;
  propColors?: Partial<PropColorDef>;
}): void {
  _palette = {
    platforms: palette.platforms ?? _palette.platforms,
    npcs: palette.npcs ?? _palette.npcs,
    items: palette.items ?? _palette.items,
    locations: palette.locations ?? _palette.locations,
    dummy: palette.dummy ? { ...DEFAULT_DUMMY, ...palette.dummy } : _palette.dummy,
    fallbackAvatar: palette.fallbackAvatar ? { ...DEFAULT_FALLBACK_AVATAR, ...palette.fallbackAvatar } : _palette.fallbackAvatar,
    propColors: palette.propColors ? { ...DEFAULT_PROP_COLORS, ...palette.propColors } : _palette.propColors
  };
}

export function getVisualPalette(): VisualPalette {
  return _palette;
}

export function getPlatformVisual(modelId: number): PlatformVisualDef | undefined {
  return _palette.platforms.get(modelId);
}

export function getFallbackAvatarVisual(): FallbackAvatarVisualDef {
  return _palette.fallbackAvatar;
}

export function getPropColors(): PropColorDef {
  return _palette.propColors;
}

export function getNpcVisual(modelId: number): NpcVisualDef | undefined {
  return _palette.npcs.get(modelId);
}

export function getItemVisual(modelId: number): ItemVisualDef | undefined {
  return _palette.items.get(modelId);
}

export function getLocationVisual(kind: string): LocationVisualDef | undefined {
  return _palette.locations.get(kind);
}

export function getDummyVisual(): DummyVisualDef {
  return _palette.dummy;
}
