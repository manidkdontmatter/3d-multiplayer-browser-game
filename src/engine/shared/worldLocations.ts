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
import type { ReferenceFrameVolumeDefinition } from "./movingReferenceFrames";
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

export interface WorldAnchorDefinition {
  id: string;
  mapInstanceIds?: readonly string[];
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
  referenceFrameVolumes?: readonly ReferenceFrameVolumeDefinition[];
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
  staticCollisionVolumes?: readonly LocationCollisionVolumeDefinition[];
  staticNavigationSurfaces?: readonly LocationNavigationSurfaceDefinition[];
  movingNavigationSurfaces?: readonly LocationNavigationSurfaceDefinition[];
  pilotConsoleSockets?: readonly PilotConsoleSocketDefinition[];
  craftBenchSockets?: readonly CraftBenchSocketDefinition[];
  movingCollisionHalfExtents?: {
    halfX: number;
    halfY: number;
    halfZ: number;
  };
  renderArchetypeScalePct?: number;
}

export interface PilotConsoleSocketDefinition {
  readonly id: string;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly interactRadius: number;
  readonly preferredReferenceFrameVolumeId?: string;
  readonly visualMarker?: SocketVisualMarkerDefinition;
}

export interface CraftBenchSocketDefinition {
  readonly id: string;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly interactRadius: number;
  readonly visualMarker?: SocketVisualMarkerDefinition;
}

export interface SocketVisualMarkerDefinition {
  readonly geometry: "box";
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly color: number;
  readonly roughness?: number;
  readonly metalness?: number;
}

export interface WorldAnchorCollisionVolumeDefinition {
  readonly localCenterX: number;
  readonly localCenterY: number;
  readonly localCenterZ: number;
  readonly halfX: number;
  readonly halfY: number;
  readonly halfZ: number;
}

export interface WorldAnchorNavigationSurfaceDefinition {
  readonly localCenterX: number;
  readonly localTopY: number;
  readonly localCenterZ: number;
  readonly halfX: number;
  readonly halfZ: number;
}

export interface WorldAnchorEnvironmentVolumeDefinition {
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

export interface WorldAnchorTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function resolveWorldAnchorAttachmentPoint(
  root: WorldAnchorTransform,
  local: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  const cosYaw = Math.cos(root.yaw);
  const sinYaw = Math.sin(root.yaw);
  return {
    x: root.x + local.x * cosYaw - local.z * sinYaw,
    y: root.y + local.y,
    z: root.z + local.x * sinYaw + local.z * cosYaw
  };
}

export interface SpawnAnchor {
  id: string;
  locationId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export let WORLD_ANCHOR_DEFINITIONS: readonly WorldAnchorDefinition[] = Object.freeze([]);
export let VOID_LOCATION_DEFINITIONS: readonly WorldAnchorDefinition[] = Object.freeze([]);

export let DEFAULT_VOID_SPAWN_ANCHOR: SpawnAnchor = {
  id: "",
  locationId: "",
  x: 0,
  y: 0,
  z: 0,
  yaw: 0
};

export function injectLocationDefinitions(
  definitions: readonly WorldAnchorDefinition[],
  defaultSpawnAnchor: SpawnAnchor
): void {
  WORLD_ANCHOR_DEFINITIONS = Object.freeze(definitions);
  VOID_LOCATION_DEFINITIONS = WORLD_ANCHOR_DEFINITIONS;
  DEFAULT_VOID_SPAWN_ANCHOR = defaultSpawnAnchor;
}

export function sampleWorldAnchorTransform(definition: WorldAnchorDefinition, seconds: number): WorldAnchorTransform {
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

export function buildWorldAnchorTerrainConfig(definition: WorldAnchorDefinition): RuntimeMapConfig | null {
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

export function getWorldAnchorDefinitionByModelId(modelId: number): WorldAnchorDefinition | null {
  return WORLD_ANCHOR_DEFINITIONS.find((definition) => definition.modelId === modelId) ?? null;
}

export function getWorldAnchorDefinitionByArchetypeId(archetypeId: number): WorldAnchorDefinition | null {
  return WORLD_ANCHOR_DEFINITIONS.find((definition) => definition.archetypeId === archetypeId) ?? null;
}

export function getWorldAnchorDefinitionByPid(pid: number): WorldAnchorDefinition | null {
  return WORLD_ANCHOR_DEFINITIONS.find((definition) => definition.pid === pid) ?? null;
}

export function getWorldAnchorReferenceFrameVolumes(
  definition: Pick<WorldAnchorDefinition, "referenceFrameVolumes">
): readonly ReferenceFrameVolumeDefinition[] {
  return definition.referenceFrameVolumes ?? [];
}

export function getWorldAnchorPilotConsoleSockets(
  definition: Pick<WorldAnchorDefinition, "pilotConsoleSockets">
): readonly PilotConsoleSocketDefinition[] {
  return definition.pilotConsoleSockets ?? [];
}

export function getWorldAnchorCraftBenchSockets(
  definition: Pick<WorldAnchorDefinition, "craftBenchSockets">
): readonly CraftBenchSocketDefinition[] {
  return definition.craftBenchSockets ?? [];
}

// Backward compatibility aliases during terminology migration.
export type LocationRootDefinition = WorldAnchorDefinition;
export type LocationCollisionVolumeDefinition = WorldAnchorCollisionVolumeDefinition;
export type LocationNavigationSurfaceDefinition = WorldAnchorNavigationSurfaceDefinition;
export type LocationEnvironmentVolumeDefinition = WorldAnchorEnvironmentVolumeDefinition;
export type LocationTransform = WorldAnchorTransform;
export const sampleLocationTransform = sampleWorldAnchorTransform;
export const buildLocationTerrainConfig = buildWorldAnchorTerrainConfig;
export const getLocationDefinitionByModelId = getWorldAnchorDefinitionByModelId;
export const getLocationDefinitionByArchetypeId = getWorldAnchorDefinitionByArchetypeId;
export const getLocationDefinitionByPid = getWorldAnchorDefinitionByPid;
export const getLocationReferenceFrameVolumes = getWorldAnchorReferenceFrameVolumes;
export const getLocationPilotConsoleSockets = getWorldAnchorPilotConsoleSockets;
export const getLocationCraftBenchSockets = getWorldAnchorCraftBenchSockets;
