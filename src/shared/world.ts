// Deterministic procedural static-world generation shared by server and client.
import { createNoise2D } from "simplex-noise";

export interface StaticWorldBlock {
  x: number;
  y: number;
  z: number;
  halfX: number;
  halfY: number;
  halfZ: number;
  rotationY?: number;
}

export type BiomeKind = "desert" | "grass" | "rock" | "snow";

export interface BiomeWeights {
  desert: number;
  grass: number;
  rock: number;
  snow: number;
}

export interface StaticWorldProp {
  kind: "tree" | "rock";
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}

export interface RuntimeMapConfig {
  mapId: string;
  instanceId: string;
  seed: number;
  groundHalfExtent: number;
  groundHalfThickness: number;
  cubeCount: number;
  oceanBaseHeight: number;
  oceanEdgeDepth: number;
  oceanWaveAmplitude: number;
  oceanWaveSpeed: number;
  oceanWaveLength: number;
}

export interface RuntimeTerrainMeshData {
  vertices: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  quadsPerAxis: number;
}

export interface RuntimeMapLayout {
  config: RuntimeMapConfig;
  staticBlocks: StaticWorldBlock[];
  staticProps: StaticWorldProp[];
}

export interface RuntimeMapLayoutOptions {
  includeStaticBlocks?: boolean;
  includeStaticProps?: boolean;
}

export interface VisualBushProp {
  kind: "bush";
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}

export interface VisualGrassVariantDefinition {
  id: string;
  biomes: readonly BiomeKind[];
  densityScale: number;
  minScale: number;
  maxScale: number;
  weight: number;
}

export interface VisualGrassInstance {
  kind: "grass";
  variantId: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}

export const RUNTIME_MAP_CONFIG_DEFAULTS = {
  mapId: "sandbox-alpha",
  instanceId: "default-1",
  seed: 1337,
  groundHalfExtent: 384,
  groundHalfThickness: 0.5,
  cubeCount: 0,
  oceanBaseHeight: 2,
  oceanEdgeDepth: 10,
  oceanWaveAmplitude: 3.6,
  oceanWaveSpeed: 5.4,
  oceanWaveLength: 96
} as const;

const DEFAULT_TERRAIN_QUADS_PER_AXIS = 160;
const TERRAIN_MIN_HEIGHT = -7.5;
const TERRAIN_MAX_HEIGHT = 42;
const TERRAIN_BASE_FREQUENCY = 0.0038;
const TERRAIN_OCTAVES = 4;
const TERRAIN_PERSISTENCE = 0.5;
const TERRAIN_LACUNARITY = 2.0;
const TERRAIN_MAX_WORLD_RADIUS = 2000;
const BIOME_TEMPERATURE_FREQUENCY = 0.00135;
const BIOME_MOISTURE_FREQUENCY = 0.00165;
const BIOME_DESERT_COLOR = { r: 0.73, g: 0.62, b: 0.39 };
const BIOME_GRASS_COLOR = { r: 0.24, g: 0.52, b: 0.26 };
const BIOME_ROCK_COLOR = { r: 0.45, g: 0.46, b: 0.45 };
const BIOME_SNOW_COLOR = { r: 0.86, g: 0.89, b: 0.92 };
const BIOME_ROCK_DRY_BONUS = 0.18;
const BIOME_BLEND_SHARPNESS = 5;
const PROP_TREE_DENSITY = 0.00125;
const PROP_ROCK_DENSITY = 0.001;
const TREE_MIN_SCALE = 0.85;
const TREE_MAX_SCALE = 1.8;
const ROCK_MIN_SCALE = 0.7;
const ROCK_MAX_SCALE = 1.9;
const VISUAL_BUSH_DENSITY = 0.0024;
const VISUAL_BUSH_MIN_SCALE = 0.55;
const VISUAL_BUSH_MAX_SCALE = 1.35;
const VISUAL_BUSH_MAX_ATTEMPTS = 6000;
const VISUAL_BUSH_MIN_SPACING_SQ = 1.35 * 1.35;
const VISUAL_GRASS_DENSITY = 0.08;
const VISUAL_GRASS_PATCH_FREQUENCY = 0.0375;
const VISUAL_GRASS_PATCH_THRESHOLD = 0.52;
const VISUAL_GRASS_MAX_ATTEMPTS = 500_000;
const VISUAL_GRASS_MIN_SPACING_SQ = 0.9 * 0.9;
const MAX_PROP_ATTEMPTS = 6000;
const terrainNoiseCache = new Map<number, (x: number, y: number) => number>();
const temperatureNoiseCache = new Map<number, (x: number, y: number) => number>();
const moistureNoiseCache = new Map<number, (x: number, y: number) => number>();
const visualGrassPatchNoiseCache = new Map<number, (x: number, y: number) => number>();

export const DEFAULT_VISUAL_GRASS_VARIANTS: readonly VisualGrassVariantDefinition[] = [
  {
    id: "grass.plain",
    biomes: ["grass"],
    densityScale: 1,
    minScale: 0.85,
    maxScale: 1.3,
    weight: 1
  }
] as const;

export function resolveRuntimeMapConfig(): RuntimeMapConfig {
  const runtime = getRuntimeMapSource();
  return coerceRuntimeMapConfig(runtime);
}

export function coerceRuntimeMapConfig(source: Record<string, unknown> | Partial<RuntimeMapConfig>): RuntimeMapConfig {
  return {
    mapId: normalizeString(source.mapId, RUNTIME_MAP_CONFIG_DEFAULTS.mapId),
    instanceId: normalizeString(source.instanceId, RUNTIME_MAP_CONFIG_DEFAULTS.instanceId),
    seed: normalizeInteger(source.seed, RUNTIME_MAP_CONFIG_DEFAULTS.seed, 0, 2_147_483_647),
    groundHalfExtent: normalizeNumber(source.groundHalfExtent, RUNTIME_MAP_CONFIG_DEFAULTS.groundHalfExtent, 32, 4096),
    groundHalfThickness: normalizeNumber(
      source.groundHalfThickness,
      RUNTIME_MAP_CONFIG_DEFAULTS.groundHalfThickness,
      0.1,
      10
    ),
    cubeCount: normalizeInteger(source.cubeCount, RUNTIME_MAP_CONFIG_DEFAULTS.cubeCount, 0, 10_000),
    oceanBaseHeight: normalizeNumber(source.oceanBaseHeight, RUNTIME_MAP_CONFIG_DEFAULTS.oceanBaseHeight, -256, 256),
    oceanEdgeDepth: normalizeNumber(source.oceanEdgeDepth, RUNTIME_MAP_CONFIG_DEFAULTS.oceanEdgeDepth, 1, 64),
    oceanWaveAmplitude: normalizeNumber(
      source.oceanWaveAmplitude,
      RUNTIME_MAP_CONFIG_DEFAULTS.oceanWaveAmplitude,
      0,
      12
    ),
    oceanWaveSpeed: normalizeNumber(source.oceanWaveSpeed, RUNTIME_MAP_CONFIG_DEFAULTS.oceanWaveSpeed, 0, 8),
    oceanWaveLength: normalizeNumber(source.oceanWaveLength, RUNTIME_MAP_CONFIG_DEFAULTS.oceanWaveLength, 2, 256)
  };
}

export function generateDeterministicVisualBushes(config: RuntimeMapConfig): VisualBushProp[] {
  const area = (config.groundHalfExtent * 2) * (config.groundHalfExtent * 2);
  const targetBushes = Math.max(0, Math.floor(area * VISUAL_BUSH_DENSITY));
  const output: VisualBushProp[] = [];
  const rng = mulberry32((config.seed ^ 0x6b99e6c5) >>> 0);
  let attempts = 0;
  while (attempts < VISUAL_BUSH_MAX_ATTEMPTS && output.length < targetBushes) {
    attempts += 1;
    const x = (rng() * 2 - 1) * config.groundHalfExtent * 0.98;
    const z = (rng() * 2 - 1) * config.groundHalfExtent * 0.98;
    const y = sampleTerrainHeightAt(config, x, z);
    if (y < config.oceanBaseHeight - 0.25) {
      continue;
    }
    const biome = sampleDominantBiomeAt(config, x, z, y);
    const slope = sampleTerrainSlopeDegreesAt(config, x, z);
    if (biome !== "grass" || slope > 28 || rng() <= 0.2) {
      continue;
    }
    if (isTooCloseToVisualBush(output, x, z, VISUAL_BUSH_MIN_SPACING_SQ)) {
      continue;
    }
    output.push({
      kind: "bush",
      x,
      y,
      z,
      rotationY: (rng() - 0.5) * Math.PI * 2,
      scale: lerp(VISUAL_BUSH_MIN_SCALE, VISUAL_BUSH_MAX_SCALE, rng())
    });
  }
  return output;
}

export function generateDeterministicVisualGrass(
  config: RuntimeMapConfig,
  variants: readonly VisualGrassVariantDefinition[] = DEFAULT_VISUAL_GRASS_VARIANTS
): VisualGrassInstance[] {
  const validVariants = variants.filter((variant) => variant.biomes.length > 0 && variant.weight > 0);
  if (validVariants.length === 0) {
    return [];
  }

  const area = (config.groundHalfExtent * 2) * (config.groundHalfExtent * 2);
  const targetGrass = Math.max(0, Math.floor(area * VISUAL_GRASS_DENSITY));
  const output: VisualGrassInstance[] = [];
  const rng = mulberry32((config.seed ^ 0x14bd3721) >>> 0);
  const patchNoise = createCachedNoise2D(config.seed | 0, visualGrassPatchNoiseCache, 0x41f2d39b);
  let attempts = 0;

  while (attempts < VISUAL_GRASS_MAX_ATTEMPTS && output.length < targetGrass) {
    attempts += 1;
    const x = (rng() * 2 - 1) * config.groundHalfExtent * 0.98;
    const z = (rng() * 2 - 1) * config.groundHalfExtent * 0.98;
    const y = sampleTerrainHeightAt(config, x, z);
    if (y < config.oceanBaseHeight - 0.1) {
      continue;
    }
    const biome = sampleDominantBiomeAt(config, x, z, y);
    const slope = sampleTerrainSlopeDegreesAt(config, x, z);
    if (slope > 30) {
      continue;
    }
    const patch = patchNoise(x * VISUAL_GRASS_PATCH_FREQUENCY, z * VISUAL_GRASS_PATCH_FREQUENCY) * 0.5 + 0.5;
    if (patch < VISUAL_GRASS_PATCH_THRESHOLD) {
      continue;
    }
    if (isTooCloseToVisualGrass(output, x, z, VISUAL_GRASS_MIN_SPACING_SQ)) {
      continue;
    }

    const eligibleVariants = validVariants.filter((variant) => variant.biomes.includes(biome));
    if (eligibleVariants.length === 0) {
      continue;
    }

    const variant = pickWeightedGrassVariant(eligibleVariants, rng);
    if (!variant) {
      continue;
    }
    const patchFactor = clamp01((patch - VISUAL_GRASS_PATCH_THRESHOLD) / (1 - VISUAL_GRASS_PATCH_THRESHOLD));
    if (rng() > 0.25 + patchFactor * 0.75) {
      continue;
    }

    output.push({
      kind: "grass",
      variantId: variant.id,
      x,
      y,
      z,
      rotationY: rng() * Math.PI * 2,
      scale: lerp(variant.minScale, variant.maxScale, rng())
    });
  }

  return output;
}

export function generateRuntimeMapLayout(
  config: RuntimeMapConfig,
  options?: RuntimeMapLayoutOptions
): RuntimeMapLayout {
  const includeStaticBlocks = options?.includeStaticBlocks !== false;
  const includeStaticProps = options?.includeStaticProps !== false;
  const rng = mulberry32(config.seed ^ 0x9e3779b9);
  const blocks: StaticWorldBlock[] = [];
  const props: StaticWorldProp[] = [];

  if (includeStaticBlocks) {
    const edgePadding = 10;
    const usableHalf = Math.max(8, config.groundHalfExtent - edgePadding);
    const minSpawnClearRadius = Math.min(usableHalf * 0.75, 34);

    for (let i = 0; i < config.cubeCount; i += 1) {
      const t = i / Math.max(1, config.cubeCount - 1);
      const ringBias = Math.pow(rng(), 0.75);
      const radius = minSpawnClearRadius + ringBias * Math.max(0, usableHalf - minSpawnClearRadius);
      const angle = t * Math.PI * 16 + rng() * Math.PI * 2;
      const halfX = 0.5 + rng() * 2.4;
      const halfZ = 0.5 + rng() * 2.4;
      const halfY = 0.4 + rng() * 2.6;
      const x = Math.cos(angle) * radius + (rng() - 0.5) * 7;
      const z = Math.sin(angle) * radius + (rng() - 0.5) * 7;
      const y = sampleTerrainHeightAt(config, x, z) + halfY;
      blocks.push({
        x,
        y,
        z,
        halfX,
        halfY,
        halfZ,
        rotationY: (rng() - 0.5) * Math.PI
      });
    }
  }

  if (includeStaticProps) {
    generateDeterministicProps(config, rng, props);
  }

  return {
    config,
    staticBlocks: blocks,
    staticProps: props
  };
}

export function getRuntimeMapLayout(options?: RuntimeMapLayoutOptions): RuntimeMapLayout {
  return generateRuntimeMapLayout(resolveRuntimeMapConfig(), options);
}

export function sampleTerrainHeightAt(config: RuntimeMapConfig, x: number, z: number): number {
  const clampedX = clampNumber(x, -TERRAIN_MAX_WORLD_RADIUS, TERRAIN_MAX_WORLD_RADIUS);
  const clampedZ = clampNumber(z, -TERRAIN_MAX_WORLD_RADIUS, TERRAIN_MAX_WORLD_RADIUS);
  const noise2D = createRuntimeTerrainNoise(config.seed);
  const noiseValue = sampleFractalNoise(noise2D, clampedX, clampedZ);
  const radialFalloff = computeRadialFalloff(config.groundHalfExtent, clampedX, clampedZ);
  const flattened = noiseValue * radialFalloff;
  const rawHeight = remapSymmetricNoise(flattened, TERRAIN_MIN_HEIGHT, TERRAIN_MAX_HEIGHT);
  return applyCoastalEdgeShaping(config, clampedX, clampedZ, rawHeight);
}

export function sampleBiomeWeightsAt(config: RuntimeMapConfig, x: number, z: number, height?: number): BiomeWeights {
  const resolvedHeight = Number.isFinite(height) ? (height as number) : sampleTerrainHeightAt(config, x, z);
  return sampleBiomeWeights(config, x, z, resolvedHeight);
}

export function sampleDominantBiomeAt(config: RuntimeMapConfig, x: number, z: number, height?: number): BiomeKind {
  const weights = sampleBiomeWeightsAt(config, x, z, height);
  let best: BiomeKind = "grass";
  let bestValue = weights.grass;
  if (weights.desert > bestValue) {
    best = "desert";
    bestValue = weights.desert;
  }
  if (weights.rock > bestValue) {
    best = "rock";
    bestValue = weights.rock;
  }
  if (weights.snow > bestValue) {
    best = "snow";
  }
  return best;
}

export function sampleTerrainSlopeDegreesAt(
  config: RuntimeMapConfig,
  x: number,
  z: number,
  sampleStep = 1.5
): number {
  const hL = sampleTerrainHeightAt(config, x - sampleStep, z);
  const hR = sampleTerrainHeightAt(config, x + sampleStep, z);
  const hD = sampleTerrainHeightAt(config, x, z - sampleStep);
  const hU = sampleTerrainHeightAt(config, x, z + sampleStep);
  const dx = (hR - hL) / (sampleStep * 2);
  const dz = (hU - hD) / (sampleStep * 2);
  const slope = Math.atan(Math.hypot(dx, dz));
  return (slope * 180) / Math.PI;
}

export function buildTerrainMeshData(config: RuntimeMapConfig): RuntimeTerrainMeshData {
  const quadsPerAxis = DEFAULT_TERRAIN_QUADS_PER_AXIS;
  const verticesPerAxis = quadsPerAxis + 1;
  const vertexCount = verticesPerAxis * verticesPerAxis;
  const triangleCount = quadsPerAxis * quadsPerAxis * 2;
  const vertices = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triangleCount * 3);
  const span = config.groundHalfExtent * 2;

  let vertexWrite = 0;
  let colorWrite = 0;
  for (let row = 0; row < verticesPerAxis; row += 1) {
    const v = row / quadsPerAxis;
    const z = -config.groundHalfExtent + span * v;
    for (let col = 0; col < verticesPerAxis; col += 1) {
      const u = col / quadsPerAxis;
      const x = -config.groundHalfExtent + span * u;
      const y = sampleTerrainHeightAt(config, x, z);
      vertices[vertexWrite] = x;
      vertices[vertexWrite + 1] = y;
      vertices[vertexWrite + 2] = z;
      vertexWrite += 3;

      const color = sampleBiomeColorAt(config, x, z, y);
      colors[colorWrite] = color.r;
      colors[colorWrite + 1] = color.g;
      colors[colorWrite + 2] = color.b;
      colorWrite += 3;
    }
  }

  let indexWrite = 0;
  for (let row = 0; row < quadsPerAxis; row += 1) {
    for (let col = 0; col < quadsPerAxis; col += 1) {
      const topLeft = row * verticesPerAxis + col;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + verticesPerAxis;
      const bottomRight = bottomLeft + 1;

      indices[indexWrite] = topLeft;
      indices[indexWrite + 1] = bottomLeft;
      indices[indexWrite + 2] = topRight;
      indices[indexWrite + 3] = topRight;
      indices[indexWrite + 4] = bottomLeft;
      indices[indexWrite + 5] = bottomRight;
      indexWrite += 6;
    }
  }

  return {
    vertices,
    colors,
    indices,
    quadsPerAxis
  };
}

function getRuntimeMapSource(): Record<string, unknown> {
  const source: Record<string, unknown> = {};

  if (typeof process !== "undefined" && process.env) {
    if (process.env.MAP_ID) source.mapId = process.env.MAP_ID;
    if (process.env.MAP_INSTANCE_ID) source.instanceId = process.env.MAP_INSTANCE_ID;
    if (process.env.MAP_SEED) source.seed = process.env.MAP_SEED;
    if (process.env.MAP_GROUND_HALF_EXTENT) source.groundHalfExtent = process.env.MAP_GROUND_HALF_EXTENT;
    if (process.env.MAP_GROUND_HALF_THICKNESS) {
      source.groundHalfThickness = process.env.MAP_GROUND_HALF_THICKNESS;
    }
    if (process.env.MAP_CUBE_COUNT) source.cubeCount = process.env.MAP_CUBE_COUNT;
    if (process.env.MAP_OCEAN_BASE_HEIGHT) source.oceanBaseHeight = process.env.MAP_OCEAN_BASE_HEIGHT;
    if (process.env.MAP_OCEAN_EDGE_DEPTH) source.oceanEdgeDepth = process.env.MAP_OCEAN_EDGE_DEPTH;
    if (process.env.MAP_OCEAN_WAVE_AMPLITUDE) source.oceanWaveAmplitude = process.env.MAP_OCEAN_WAVE_AMPLITUDE;
    if (process.env.MAP_OCEAN_WAVE_SPEED) source.oceanWaveSpeed = process.env.MAP_OCEAN_WAVE_SPEED;
    if (process.env.MAP_OCEAN_WAVE_LENGTH) source.oceanWaveLength = process.env.MAP_OCEAN_WAVE_LENGTH;
  }

  const globalObject = globalThis as unknown as {
    __runtimeMapConfig?: Partial<RuntimeMapConfig>;
  };
  const runtimeConfig = globalObject.__runtimeMapConfig;
  if (runtimeConfig) {
    Object.assign(source, runtimeConfig);
  }

  const maybeWindow = globalThis as unknown as { window?: { location?: { search?: string } } };
  if (maybeWindow.window?.location?.search) {
    const params = new URLSearchParams(maybeWindow.window.location.search);
    if (params.has("mapId")) source.mapId = params.get("mapId");
    if (params.has("mapInstanceId")) source.instanceId = params.get("mapInstanceId");
    if (params.has("mapSeed")) source.seed = params.get("mapSeed");
    if (params.has("mapGroundHalfExtent")) source.groundHalfExtent = params.get("mapGroundHalfExtent");
    if (params.has("mapGroundHalfThickness")) {
      source.groundHalfThickness = params.get("mapGroundHalfThickness");
    }
    if (params.has("mapCubeCount")) source.cubeCount = params.get("mapCubeCount");
    if (params.has("mapOceanBaseHeight")) source.oceanBaseHeight = params.get("mapOceanBaseHeight");
    if (params.has("mapOceanEdgeDepth")) source.oceanEdgeDepth = params.get("mapOceanEdgeDepth");
    if (params.has("mapOceanWaveAmplitude")) source.oceanWaveAmplitude = params.get("mapOceanWaveAmplitude");
    if (params.has("mapOceanWaveSpeed")) source.oceanWaveSpeed = params.get("mapOceanWaveSpeed");
    if (params.has("mapOceanWaveLength")) source.oceanWaveLength = params.get("mapOceanWaveLength");
  }

  return source;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  const integer = Math.floor(raw);
  return Math.max(min, Math.min(max, integer));
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, raw));
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function createRuntimeTerrainNoise(seed: number): (x: number, y: number) => number {
  return createCachedNoise2D(seed | 0, terrainNoiseCache, 0xa5a5a5a5);
}

function createRuntimeTemperatureNoise(seed: number): (x: number, y: number) => number {
  return createCachedNoise2D(seed | 0, temperatureNoiseCache, 0xc6bc2796);
}

function createRuntimeMoistureNoise(seed: number): (x: number, y: number) => number {
  return createCachedNoise2D(seed | 0, moistureNoiseCache, 0x165667b1);
}

function createCachedNoise2D(
  seed: number,
  cache: Map<number, (x: number, y: number) => number>,
  salt: number
): (x: number, y: number) => number {
  const cached = cache.get(seed);
  if (cached) {
    return cached;
  }
  const rng = mulberry32((seed ^ salt) >>> 0);
  const noise = createNoise2D(rng);
  cache.set(seed, noise);
  return noise;
}

function sampleBiomeColorAt(
  config: RuntimeMapConfig,
  x: number,
  z: number,
  height: number
): { r: number; g: number; b: number } {
  const weights = sampleBiomeWeights(config, x, z, height);
  const r =
    weights.desert * BIOME_DESERT_COLOR.r +
    weights.grass * BIOME_GRASS_COLOR.r +
    weights.rock * BIOME_ROCK_COLOR.r +
    weights.snow * BIOME_SNOW_COLOR.r;
  const g =
    weights.desert * BIOME_DESERT_COLOR.g +
    weights.grass * BIOME_GRASS_COLOR.g +
    weights.rock * BIOME_ROCK_COLOR.g +
    weights.snow * BIOME_SNOW_COLOR.g;
  const b =
    weights.desert * BIOME_DESERT_COLOR.b +
    weights.grass * BIOME_GRASS_COLOR.b +
    weights.rock * BIOME_ROCK_COLOR.b +
    weights.snow * BIOME_SNOW_COLOR.b;
  return { r, g, b };
}

function sampleBiomeWeights(config: RuntimeMapConfig, x: number, z: number, height: number): BiomeWeights {
  const temperatureNoise = createRuntimeTemperatureNoise(config.seed);
  const moistureNoise = createRuntimeMoistureNoise(config.seed);
  const temperatureSample = temperatureNoise(x * BIOME_TEMPERATURE_FREQUENCY, z * BIOME_TEMPERATURE_FREQUENCY);
  const moistureSample = moistureNoise(x * BIOME_MOISTURE_FREQUENCY, z * BIOME_MOISTURE_FREQUENCY);

  const elevation = clamp01((height - TERRAIN_MIN_HEIGHT) / (TERRAIN_MAX_HEIGHT - TERRAIN_MIN_HEIGHT));
  const temperature = clamp01(temperatureSample * 0.5 + 0.5 - elevation * 0.38);
  const moisture = clamp01(moistureSample * 0.5 + 0.5);
  const warm = smoothstep(0.45, 0.75, temperature);
  const cold = 1 - smoothstep(0.30, 0.58, temperature);
  const dry = 1 - smoothstep(0.33, 0.67, moisture);
  const wet = smoothstep(0.38, 0.72, moisture);
  const high = smoothstep(0.55, 0.90, elevation);
  const low = 1 - smoothstep(0.30, 0.62, elevation);

  let desert = warm * dry * (0.65 + low * 0.35);
  let snow = cold * high + cold * wet * 0.25;
  let grass = (1 - Math.abs(temperature - 0.56) * 1.9) * wet * (1 - high * 0.65) + 0.08;
  let rock = high * (1 - wet * 0.45) + dry * high * BIOME_ROCK_DRY_BONUS;

  desert = Math.max(0, desert);
  snow = Math.max(0, snow);
  grass = Math.max(0, grass);
  rock = Math.max(0, rock);

  const sum = desert + grass + rock + snow;
  if (sum <= 0.000001) {
    return { desert: 0, grass: 1, rock: 0, snow: 0 };
  }
  const normalized = {
    desert: desert / sum,
    grass: grass / sum,
    rock: rock / sum,
    snow: snow / sum
  };
  return sharpenBiomeWeights(normalized, BIOME_BLEND_SHARPNESS);
}

function generateDeterministicProps(
  config: RuntimeMapConfig,
  rng: () => number,
  output: StaticWorldProp[]
): void {
  const area = (config.groundHalfExtent * 2) * (config.groundHalfExtent * 2);
  const targetTrees = Math.max(0, Math.floor(area * PROP_TREE_DENSITY));
  const targetRocks = Math.max(0, Math.floor(area * PROP_ROCK_DENSITY));
  let treesPlaced = 0;
  let rocksPlaced = 0;
  let attempts = 0;
  const minTreeSpacingSq = 3.8 * 3.8;
  const minRockSpacingSq = 2.8 * 2.8;

  while (
    attempts < MAX_PROP_ATTEMPTS &&
    (treesPlaced < targetTrees || rocksPlaced < targetRocks)
  ) {
    attempts += 1;
    const x = (rng() * 2 - 1) * config.groundHalfExtent * 0.98;
    const z = (rng() * 2 - 1) * config.groundHalfExtent * 0.98;
    const y = sampleTerrainHeightAt(config, x, z);
    const biome = sampleDominantBiomeAt(config, x, z, y);
    const slope = sampleTerrainSlopeDegreesAt(config, x, z);
    const isUnderwater = y < config.oceanBaseHeight - 0.25;
    if (isUnderwater) {
      continue;
    }

    if (treesPlaced < targetTrees && biome === "grass" && slope <= 28 && rng() > 0.2) {
      if (!isTooCloseToKind(output, "tree", x, z, minTreeSpacingSq)) {
        output.push({
          kind: "tree",
          x,
          y,
          z,
          rotationY: (rng() - 0.5) * Math.PI * 2,
          scale: lerp(TREE_MIN_SCALE, TREE_MAX_SCALE, rng())
        });
        treesPlaced += 1;
      }
      continue;
    }

    if (
      rocksPlaced < targetRocks &&
      biome !== "snow" &&
      slope <= 38 &&
      rng() > (biome === "grass" ? 0.1 : 0.45)
    ) {
      if (!isTooCloseToKind(output, "rock", x, z, minRockSpacingSq)) {
        output.push({
          kind: "rock",
          x,
          y,
          z,
          rotationY: (rng() - 0.5) * Math.PI * 2,
          scale: lerp(ROCK_MIN_SCALE, ROCK_MAX_SCALE, rng())
        });
        rocksPlaced += 1;
      }
      continue;
    }

  }
}

function isTooCloseToKind(
  props: readonly StaticWorldProp[],
  kind: StaticWorldProp["kind"],
  x: number,
  z: number,
  minDistanceSq: number
): boolean {
  for (const prop of props) {
    if (prop.kind !== kind) {
      continue;
    }
    const dx = prop.x - x;
    const dz = prop.z - z;
    if (dx * dx + dz * dz < minDistanceSq) {
      return true;
    }
  }
  return false;
}

function isTooCloseToVisualBush(
  bushes: readonly VisualBushProp[],
  x: number,
  z: number,
  minDistanceSq: number
): boolean {
  for (const bush of bushes) {
    const dx = bush.x - x;
    const dz = bush.z - z;
    if (dx * dx + dz * dz < minDistanceSq) {
      return true;
    }
  }
  return false;
}

function isTooCloseToVisualGrass(
  grasses: readonly VisualGrassInstance[],
  x: number,
  z: number,
  minDistanceSq: number
): boolean {
  for (const grass of grasses) {
    const dx = grass.x - x;
    const dz = grass.z - z;
    if (dx * dx + dz * dz < minDistanceSq) {
      return true;
    }
  }
  return false;
}

function pickWeightedGrassVariant(
  variants: readonly VisualGrassVariantDefinition[],
  rng: () => number
): VisualGrassVariantDefinition | null {
  let weightTotal = 0;
  for (const variant of variants) {
    weightTotal += Math.max(0, variant.weight) * Math.max(0, variant.densityScale);
  }
  if (weightTotal <= 0) {
    return null;
  }
  let pick = rng() * weightTotal;
  for (const variant of variants) {
    pick -= Math.max(0, variant.weight) * Math.max(0, variant.densityScale);
    if (pick <= 0) {
      return variant;
    }
  }
  return variants[variants.length - 1] ?? null;
}

function sampleFractalNoise(noise2D: (x: number, y: number) => number, x: number, z: number): number {
  let amplitude = 1;
  let frequency = TERRAIN_BASE_FREQUENCY;
  let value = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < TERRAIN_OCTAVES; octave += 1) {
    value += noise2D(x * frequency, z * frequency) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= TERRAIN_PERSISTENCE;
    frequency *= TERRAIN_LACUNARITY;
  }

  if (amplitudeSum <= 0) {
    return 0;
  }

  return value / amplitudeSum;
}

function computeRadialFalloff(halfExtent: number, x: number, z: number): number {
  const safeHalfExtent = Math.max(1, halfExtent);
  const radius = Math.hypot(x, z);
  const normalized = clampNumber(radius / safeHalfExtent, 0, 1.4);
  if (normalized <= 0.82) {
    return 1;
  }
  const edgeT = clampNumber((normalized - 0.82) / 0.58, 0, 1);
  const smooth = edgeT * edgeT * (3 - 2 * edgeT);
  return 1 - smooth * 0.72;
}

function applyCoastalEdgeShaping(config: RuntimeMapConfig, x: number, z: number, height: number): number {
  const radius = Math.hypot(x, z);
  const normalized = clampNumber(radius / Math.max(1, config.groundHalfExtent), 0, 1.2);
  const blend = smoothstep(0.89, 1.0, normalized);
  const targetEdgeHeight = config.oceanBaseHeight - config.oceanEdgeDepth;
  return lerp(height, targetEdgeHeight, blend);
}

function remapSymmetricNoise(value: number, min: number, max: number): number {
  const normalized = clampNumber(value * 0.5 + 0.5, 0, 1);
  return min + (max - min) * normalized;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clampNumber(value, 0, 1);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sharpenBiomeWeights(weights: BiomeWeights, sharpness: number): BiomeWeights {
  const clampedSharpness = Math.max(1, sharpness);
  const desert = Math.pow(weights.desert, clampedSharpness);
  const grass = Math.pow(weights.grass, clampedSharpness);
  const rock = Math.pow(weights.rock, clampedSharpness);
  const snow = Math.pow(weights.snow, clampedSharpness);
  const sum = desert + grass + rock + snow;
  if (sum <= 0.000001) {
    return { desert: 0, grass: 1, rock: 0, snow: 0 };
  }
  return {
    desert: desert / sum,
    grass: grass / sum,
    rock: rock / sum,
    snow: snow / sum
  };
}
