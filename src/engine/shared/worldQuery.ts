/**
 * Purpose: This file defines world state, world helpers, or world orchestration behavior, and provides filtered lookup/query helpers over world or ECS data.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import {
  sampleBiomeWeightsAt,
  sampleDominantBiomeAt,
  sampleTerrainHeightAt,
  sampleTerrainSlopeDegreesAt,
  type RuntimeMapConfig
} from "./world";

export function sampleWorldHeight(
  mapConfig: RuntimeMapConfig,
  x: number,
  z: number
): number {
  return sampleTerrainHeightAt(mapConfig, x, z);
}

export function sampleWorldSlopeDegrees(
  mapConfig: RuntimeMapConfig,
  x: number,
  z: number,
  sampleStep = 1.5
): number {
  return sampleTerrainSlopeDegreesAt(mapConfig, x, z, sampleStep);
}

export function sampleWorldBiomeWeights(
  mapConfig: RuntimeMapConfig,
  x: number,
  z: number,
  height?: number
) {
  return sampleBiomeWeightsAt(mapConfig, x, z, height);
}

export function sampleWorldDominantBiome(
  mapConfig: RuntimeMapConfig,
  x: number,
  z: number,
  height?: number
) {
  return sampleDominantBiomeAt(mapConfig, x, z, height);
}
