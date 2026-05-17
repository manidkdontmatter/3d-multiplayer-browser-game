/**
 * Purpose: This file defines world state, world helpers, or world orchestration behavior, and manages large world location roots and their replicated identity.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import {
  MODEL_ID_LOCATION_MOVING_CASTLE,
  MODEL_ID_LOCATION_MOVING_TEST_PLATFORM,
  MODEL_ID_LOCATION_STATIC_CASTLE,
  MODEL_ID_LOCATION_TERRAIN_ISLAND,
  MODEL_ID_LOCATION_TEST_ARENA
} from "./config";
import type { CarrierVolumeDefinition } from "./movingReferenceFrames";
import type { RuntimeMapConfig } from "./world";

export type LocationKind =
  | "terrainIsland"
  | "staticCastle"
  | "movingCastle"
  | "movingTestPlatform"
  | "testArena";
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
export const LOCATION_KIND_MOVING_TEST_PLATFORM = 5;

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
  carrierVolumes?: readonly CarrierVolumeDefinition[];
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

export let VOID_LOCATION_DEFINITIONS: readonly LocationRootDefinition[] = Object.freeze([]);

export let DEFAULT_VOID_SPAWN_ANCHOR: SpawnAnchor = {
  id: "",
  locationId: "",
  x: 0,
  y: 0,
  z: 0,
  yaw: 0
};

export function injectLocationDefinitions(
  definitions: readonly LocationRootDefinition[],
  defaultSpawnAnchor: SpawnAnchor
): void {
  VOID_LOCATION_DEFINITIONS = Object.freeze(definitions);
  DEFAULT_VOID_SPAWN_ANCHOR = defaultSpawnAnchor;
}

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
    modelId === MODEL_ID_LOCATION_MOVING_TEST_PLATFORM ||
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
