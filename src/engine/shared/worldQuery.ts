// Shared world-query helpers that unify terrain/biome sampling for gameplay systems.
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
