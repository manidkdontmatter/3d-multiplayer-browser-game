// Defines the authored void-location roots and local child content used by the prototype world.
import {
  MODEL_ID_LOCATION_MOVING_CASTLE,
  MODEL_ID_LOCATION_STATIC_CASTLE,
  MODEL_ID_LOCATION_TERRAIN_ISLAND,
  MODEL_ID_LOCATION_TEST_ARENA
} from "./config";
import type { RuntimeMapConfig } from "./world";

export type LocationKind = "terrainIsland" | "staticCastle" | "movingCastle" | "testArena";
export type LocationMotionKind = "static" | "drift";
export type EnvironmentPresetId =
  | "void.neutral"
  | "sky.blue_day"
  | "void.infernal"
  | "void.arcane"
  | "void.deep";

export const LOCATION_KIND_NONE = 0;
export const LOCATION_KIND_TERRAIN_ISLAND = 1;
export const LOCATION_KIND_STATIC_CASTLE = 2;
export const LOCATION_KIND_MOVING_CASTLE = 3;
export const LOCATION_KIND_TEST_ARENA = 4;

export const ENVIRONMENT_PRESET_NONE = 0;
export const ENVIRONMENT_PRESET_VOID_NEUTRAL = 1;
export const ENVIRONMENT_PRESET_SKY_BLUE_DAY = 2;
export const ENVIRONMENT_PRESET_VOID_INFERNAL = 3;
export const ENVIRONMENT_PRESET_VOID_ARCANE = 4;
export const ENVIRONMENT_PRESET_VOID_DEEP = 5;

export interface LocationRootDefinition {
  id: string;
  pid: number;
  archetypeId: number;
  kind: LocationKind;
  kindId: number;
  modelId: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  baseYaw: number;
  streamingRadius: number;
  influenceRadius: number;
  environmentId: EnvironmentPresetId;
  environmentPresetId: number;
  environmentVolumes?: readonly LocationEnvironmentVolumeDefinition[];
  motion: LocationMotionKind;
  driftX?: number;
  driftY?: number;
  driftZ?: number;
  driftFrequency?: number;
  seed?: number;
  terrain?: {
    halfExtent: number;
    halfThickness: number;
    biome: "grass" | "rock" | "snow" | "desert";
  };
}

export interface LocationEnvironmentVolumeDefinition {
  readonly id: string;
  readonly environmentId: EnvironmentPresetId;
  readonly environmentPresetId: number;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly halfX: number;
  readonly halfY: number;
  readonly halfZ: number;
  readonly blendDistance: number;
}

export interface LocationTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface SpawnAnchor {
  id: string;
  locationId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export const VOID_LOCATION_DEFINITIONS: readonly LocationRootDefinition[] = Object.freeze([
  {
    id: "verdant-test-island",
    pid: 10_001,
    archetypeId: 1,
    kind: "terrainIsland",
    kindId: LOCATION_KIND_TERRAIN_ISLAND,
    modelId: MODEL_ID_LOCATION_TERRAIN_ISLAND,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseYaw: 0,
    streamingRadius: 850,
    influenceRadius: 420,
    environmentId: "sky.blue_day",
    environmentPresetId: ENVIRONMENT_PRESET_SKY_BLUE_DAY,
    environmentVolumes: [
      {
        id: "verdant-island.open-sky",
        environmentId: "sky.blue_day",
        environmentPresetId: ENVIRONMENT_PRESET_SKY_BLUE_DAY,
        localX: 0,
        localY: 58,
        localZ: 0,
        halfX: 390,
        halfY: 260,
        halfZ: 390,
        blendDistance: 160
      }
    ],
    motion: "static",
    seed: 2001,
    terrain: {
      halfExtent: 128,
      halfThickness: 0.5,
      biome: "grass"
    }
  },
  {
    id: "blackstone-test-castle",
    pid: 10_002,
    archetypeId: 2,
    kind: "staticCastle",
    kindId: LOCATION_KIND_STATIC_CASTLE,
    modelId: MODEL_ID_LOCATION_STATIC_CASTLE,
    baseX: 620,
    baseY: 135,
    baseZ: -260,
    baseYaw: 0.35,
    streamingRadius: 950,
    influenceRadius: 360,
    environmentId: "void.infernal",
    environmentPresetId: ENVIRONMENT_PRESET_VOID_INFERNAL,
    environmentVolumes: [
      {
        id: "blackstone-castle.keep",
        environmentId: "void.infernal",
        environmentPresetId: ENVIRONMENT_PRESET_VOID_INFERNAL,
        localX: 0,
        localY: 44,
        localZ: 0,
        halfX: 210,
        halfY: 170,
        halfZ: 155,
        blendDistance: 95
      },
      {
        id: "blackstone-castle.outer-grounds",
        environmentId: "void.infernal",
        environmentPresetId: ENVIRONMENT_PRESET_VOID_INFERNAL,
        localX: 12,
        localY: 34,
        localZ: -18,
        halfX: 360,
        halfY: 220,
        halfZ: 360,
        blendDistance: 125
      }
    ],
    motion: "static"
  },
  {
    id: "drifting-test-citadel",
    pid: 10_003,
    archetypeId: 3,
    kind: "movingCastle",
    kindId: LOCATION_KIND_MOVING_CASTLE,
    modelId: MODEL_ID_LOCATION_MOVING_CASTLE,
    baseX: -520,
    baseY: 170,
    baseZ: -420,
    baseYaw: -0.45,
    streamingRadius: 1050,
    influenceRadius: 420,
    environmentId: "void.arcane",
    environmentPresetId: ENVIRONMENT_PRESET_VOID_ARCANE,
    motion: "drift",
    driftX: 55,
    driftY: 16,
    driftZ: 34,
    driftFrequency: 0.035
  },
  {
    id: "combat-test-ring",
    pid: 10_004,
    archetypeId: 4,
    kind: "testArena",
    kindId: LOCATION_KIND_TEST_ARENA,
    modelId: MODEL_ID_LOCATION_TEST_ARENA,
    baseX: 260,
    baseY: 82,
    baseZ: 440,
    baseYaw: 0,
    streamingRadius: 700,
    influenceRadius: 260,
    environmentId: "void.neutral",
    environmentPresetId: ENVIRONMENT_PRESET_VOID_NEUTRAL,
    environmentVolumes: [
      {
        id: "combat-ring.neutral-box",
        environmentId: "void.neutral",
        environmentPresetId: ENVIRONMENT_PRESET_VOID_NEUTRAL,
        localX: 0,
        localY: 38,
        localZ: 0,
        halfX: 180,
        halfY: 95,
        halfZ: 180,
        blendDistance: 80
      }
    ],
    motion: "static"
  }
]);

export const DEFAULT_VOID_SPAWN_ANCHOR: SpawnAnchor = {
  id: "spawn.verdant-island.center",
  locationId: "verdant-test-island",
  x: 0,
  y: 34,
  z: 0,
  yaw: 0
};

export function sampleLocationTransform(definition: LocationRootDefinition, seconds: number): LocationTransform {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (definition.motion !== "drift") {
    return {
      x: definition.baseX,
      y: definition.baseY,
      z: definition.baseZ,
      yaw: definition.baseYaw
    };
  }

  const frequency = Math.max(0, definition.driftFrequency ?? 0);
  const wave = time * frequency;
  return {
    x: definition.baseX + Math.sin(wave) * (definition.driftX ?? 0),
    y: definition.baseY + Math.sin(wave * 1.37 + 0.4) * (definition.driftY ?? 0),
    z: definition.baseZ + Math.cos(wave * 0.82 + 0.7) * (definition.driftZ ?? 0),
    yaw: definition.baseYaw + Math.sin(wave * 0.54) * 0.28
  };
}

export function buildLocationTerrainConfig(definition: LocationRootDefinition): RuntimeMapConfig | null {
  if (!definition.terrain) {
    return null;
  }
  return {
    mapId: definition.id,
    instanceId: definition.id,
    seed: definition.seed ?? 1,
    groundHalfExtent: definition.terrain.halfExtent,
    groundHalfThickness: definition.terrain.halfThickness,
    cubeCount: 0
  };
}

export function isLocationModelId(modelId: number): boolean {
  return (
    modelId === MODEL_ID_LOCATION_TERRAIN_ISLAND ||
    modelId === MODEL_ID_LOCATION_STATIC_CASTLE ||
    modelId === MODEL_ID_LOCATION_MOVING_CASTLE ||
    modelId === MODEL_ID_LOCATION_TEST_ARENA
  );
}

export function getLocationDefinitionByModelId(modelId: number): LocationRootDefinition | null {
  return VOID_LOCATION_DEFINITIONS.find((definition) => definition.modelId === modelId) ?? null;
}

export function getLocationDefinitionByArchetypeId(archetypeId: number): LocationRootDefinition | null {
  return VOID_LOCATION_DEFINITIONS.find((definition) => definition.archetypeId === archetypeId) ?? null;
}

export function getLocationDefinitionByPid(pid: number): LocationRootDefinition | null {
  return VOID_LOCATION_DEFINITIONS.find((definition) => definition.pid === pid) ?? null;
}
