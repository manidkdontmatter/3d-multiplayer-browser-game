// Deterministic procedural static-world generation shared by server and client.
export interface StaticWorldBlock {
  x: number;
  y: number;
  z: number;
  halfX: number;
  halfY: number;
  halfZ: number;
  rotationY?: number;
}

export interface RuntimeMapConfig {
  mapId: string;
  instanceId: string;
  seed: number;
  groundHalfExtent: number;
  groundHalfThickness: number;
  cubeCount: number;
}

export interface RuntimeMapLayout {
  config: RuntimeMapConfig;
  staticBlocks: StaticWorldBlock[];
}

const DEFAULT_MAP_ID = "sandbox-alpha";
const DEFAULT_INSTANCE_ID = "default-1";
const DEFAULT_SEED = 1337;
const DEFAULT_GROUND_HALF_EXTENT = 192;
const DEFAULT_GROUND_HALF_THICKNESS = 0.5;
const DEFAULT_CUBE_COUNT = 280;

export function resolveRuntimeMapConfig(): RuntimeMapConfig {
  const runtime = getRuntimeMapSource();
  const mapId = normalizeString(runtime.mapId, DEFAULT_MAP_ID);
  const instanceId = normalizeString(runtime.instanceId, DEFAULT_INSTANCE_ID);
  const seed = normalizeInteger(runtime.seed, DEFAULT_SEED, 0, 2_147_483_647);
  const groundHalfExtent = normalizeNumber(
    runtime.groundHalfExtent,
    DEFAULT_GROUND_HALF_EXTENT,
    32,
    4096
  );
  const groundHalfThickness = normalizeNumber(
    runtime.groundHalfThickness,
    DEFAULT_GROUND_HALF_THICKNESS,
    0.1,
    10
  );
  const cubeCount = normalizeInteger(runtime.cubeCount, DEFAULT_CUBE_COUNT, 0, 10_000);

  return {
    mapId,
    instanceId,
    seed,
    groundHalfExtent,
    groundHalfThickness,
    cubeCount
  };
}

export function generateRuntimeMapLayout(config: RuntimeMapConfig): RuntimeMapLayout {
  const rng = mulberry32(config.seed);
  const blocks: StaticWorldBlock[] = [];
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
    const y = halfY;
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

  blocks.push({
    x: 0,
    y: 1,
    z: 0,
    halfX: 6,
    halfY: 1,
    halfZ: 6,
    rotationY: 0
  });

  return {
    config,
    staticBlocks: blocks
  };
}

export function getRuntimeMapLayout(): RuntimeMapLayout {
  return generateRuntimeMapLayout(resolveRuntimeMapConfig());
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
