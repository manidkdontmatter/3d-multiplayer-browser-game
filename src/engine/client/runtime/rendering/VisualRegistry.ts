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

export interface VisualPalette {
  platforms: ReadonlyMap<number, PlatformVisualDef>;
  npcs: ReadonlyMap<number, NpcVisualDef>;
  items: ReadonlyMap<number, ItemVisualDef>;
  locations: ReadonlyMap<string, LocationVisualDef>; // keyed by location kind string
  dummy: DummyVisualDef;
}

const DEFAULT_DUMMY: DummyVisualDef = {
  radius: 0.42, height: 1.9, segments: 12,
  color: 0xa6c9d8, roughness: 0.88, metalness: 0.08
};

let _palette: VisualPalette = {
  platforms: new Map(),
  npcs: new Map(),
  items: new Map(),
  locations: new Map(),
  dummy: DEFAULT_DUMMY
};

export function injectVisualPalette(palette: Partial<VisualPalette> & { dummy?: Partial<DummyVisualDef> }): void {
  _palette = {
    platforms: palette.platforms ?? new Map(),
    npcs: palette.npcs ?? new Map(),
    items: palette.items ?? new Map(),
    locations: palette.locations ?? new Map(),
    dummy: palette.dummy ? { ...DEFAULT_DUMMY, ...palette.dummy } : DEFAULT_DUMMY
  };
}

export function getVisualPalette(): VisualPalette {
  return _palette;
}

export function getPlatformVisual(modelId: number): PlatformVisualDef | undefined {
  return _palette.platforms.get(modelId);
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
