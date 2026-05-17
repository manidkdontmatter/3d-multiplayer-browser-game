/**
 * Purpose: This file builds or queries navigation data for movement/pathing, and defines world state, world helpers, or world orchestration behavior.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { exportNavMesh, importNavMesh } from "recast-navigation";
import { generateSoloNavMesh, type SoloNavMeshGeneratorConfig } from "recast-navigation/generators";
import {
  buildLocationTerrainConfig,
  buildTerrainMeshData,
  sampleLocationTransform,
  VOID_LOCATION_DEFINITIONS,
  type LocationRootDefinition
} from "../../shared/index";
import {
  createYawFrame,
  NavigationWorld,
  RecastNavigationContext,
  type NavigationBounds,
  type NavigationFrameTransform
} from "./NavigationService";

interface NavigationGeometry {
  readonly positions: number[];
  readonly indices: number[];
}

const CACHE_SCHEMA_VERSION = 1;

const RECAST_CONTEXT_CONFIG: Partial<SoloNavMeshGeneratorConfig> = {
  cs: 0.35,
  ch: 0.2,
  walkableSlopeAngle: 50,
  walkableHeight: 6,
  walkableClimb: 2,
  walkableRadius: 2,
  maxEdgeLen: 24,
  maxSimplificationError: 1.3,
  minRegionArea: 8,
  mergeRegionArea: 24,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 1
};

export interface NavigationBuildCacheOptions {
  readonly enabled?: boolean;
  readonly directory?: string;
  readonly readEnabled?: boolean;
  readonly writeEnabled?: boolean;
}

export interface NavigationWorldBuildOptions {
  readonly getElapsedSeconds?: () => number;
  readonly enableRecastSurfaceNavigation?: boolean;
  readonly cache?: NavigationBuildCacheOptions;
  readonly verboseLogging?: boolean;
}

export interface NavigationContextBuildStat {
  readonly contextId: string;
  readonly kind: "staticWorld" | "location" | "movingFrame";
  readonly source: "cache" | "generated";
  readonly vertices: number;
  readonly triangles: number;
  readonly durationMs: number;
}

export interface NavigationBuildReport {
  readonly startedAtIso: string;
  readonly durationMs: number;
  readonly recastEnabled: boolean;
  readonly surfaceContextCount: number;
  readonly cacheEnabled: boolean;
  readonly cacheReads: number;
  readonly cacheHits: number;
  readonly cacheWrites: number;
  readonly generatedCount: number;
  readonly failedCount: number;
  readonly contexts: readonly NavigationContextBuildStat[];
}

export interface NavigationWorldBuildResult {
  readonly world: NavigationWorld;
  readonly report: NavigationBuildReport;
}

type RecastContextBuildRequest = {
  readonly id: string;
  readonly kind: "staticWorld" | "location" | "movingFrame";
  readonly referenceFrameId: number | null;
  readonly priority: number;
  readonly geometry: NavigationGeometry;
  readonly frame?: ReturnType<typeof createYawFrame>;
};

class NavMeshCacheStore {
  private readonly dir: string;
  private readonly enabled: boolean;
  private readonly readEnabled: boolean;
  private readonly writeEnabled: boolean;
  private reads = 0;
  private hits = 0;
  private writes = 0;

  public constructor(options?: NavigationBuildCacheOptions) {
    this.enabled = options?.enabled !== false;
    this.readEnabled = this.enabled && options?.readEnabled !== false;
    this.writeEnabled = this.enabled && options?.writeEnabled !== false;
    this.dir = options?.directory?.trim().length ? options.directory.trim() : "./data/navmesh-cache";
    if (this.enabled) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  public getStats(): { enabled: boolean; reads: number; hits: number; writes: number } {
    return {
      enabled: this.enabled,
      reads: this.reads,
      hits: this.hits,
      writes: this.writes
    };
  }

  public read(cacheKey: string): Uint8Array | null {
    if (!this.readEnabled) {
      return null;
    }
    this.reads += 1;
    const file = this.resolveFile(cacheKey);
    if (!existsSync(file)) {
      return null;
    }
    const bytes = readFileSync(file);
    if (bytes.byteLength === 0) {
      return null;
    }
    this.hits += 1;
    return new Uint8Array(bytes);
  }

  public write(cacheKey: string, data: Uint8Array): void {
    if (!this.writeEnabled || data.byteLength === 0) {
      return;
    }
    const file = this.resolveFile(cacheKey);
    writeFileSync(file, data);
    this.writes += 1;
  }

  private resolveFile(cacheKey: string): string {
    return join(this.dir, `${cacheKey}.navmesh.bin`);
  }
}

export function buildServerNavigationWorld(options: NavigationWorldBuildOptions = {}): NavigationWorldBuildResult {
  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const world = new NavigationWorld();
  const cache = new NavMeshCacheStore(options.cache);
  const contextStats: NavigationContextBuildStat[] = [];
  let generatedCount = 0;
  let failedCount = 0;

  if (options.enableRecastSurfaceNavigation !== false) {
    for (const definition of VOID_LOCATION_DEFINITIONS) {
      const request = definition.motion === "static"
        ? createStaticLocationRequest(definition)
        : createMovingFrameRequest(definition, options.getElapsedSeconds ?? (() => 0));
      if (!request || request.geometry.positions.length === 0 || request.geometry.indices.length === 0) {
        continue;
      }
      const built = registerRecastContext(world, request, cache);
      if (!built) {
        failedCount += 1;
        continue;
      }
      if (built.source === "generated") {
        generatedCount += 1;
      }
      contextStats.push(built);
    }
  }

  const cacheStats = cache.getStats();
  const durationMs = performance.now() - startedAt;
  const report: NavigationBuildReport = {
    startedAtIso,
    durationMs,
    recastEnabled: options.enableRecastSurfaceNavigation !== false,
    surfaceContextCount: contextStats.length,
    cacheEnabled: cacheStats.enabled,
    cacheReads: cacheStats.reads,
    cacheHits: cacheStats.hits,
    cacheWrites: cacheStats.writes,
    generatedCount,
    failedCount,
    contexts: contextStats
  };
  if (options.verboseLogging) {
    logBuildReport(report);
  }
  return { world, report };
}

function createStaticLocationRequest(definition: LocationRootDefinition): RecastContextBuildRequest | null {
  const pose = sampleLocationTransform(definition, 0);
  const geometry = buildStaticLocationNavigationGeometry(definition, pose);
  if (geometry.positions.length === 0 || geometry.indices.length === 0) {
    return null;
  }
  return {
    id: `location:${definition.pid}`,
    kind: "location",
    referenceFrameId: definition.pid,
    priority: 100,
    geometry
  };
}

function createMovingFrameRequest(
  definition: LocationRootDefinition,
  getElapsedSeconds: () => number
): RecastContextBuildRequest | null {
  const geometry = buildMovingFrameNavigationGeometry(definition);
  if (geometry.positions.length === 0 || geometry.indices.length === 0) {
    return null;
  }
  return {
    id: `movingFrame:${definition.pid}`,
    kind: "movingFrame",
    referenceFrameId: definition.pid,
    priority: 200,
    geometry,
    frame: createYawFrame((): NavigationFrameTransform => sampleLocationTransform(definition, getElapsedSeconds()))
  };
}

function registerRecastContext(
  world: NavigationWorld,
  request: RecastContextBuildRequest,
  cache: NavMeshCacheStore
): NavigationContextBuildStat | null {
  const startedAt = performance.now();
  const cacheKey = createContextCacheKey(request);

  try {
    const cachedBytes = cache.read(cacheKey);
    if (cachedBytes) {
      const imported = importNavMesh(cachedBytes);
      world.registerContext(new RecastNavigationContext({
        id: request.id,
        kind: request.kind,
        navMesh: imported.navMesh,
        referenceFrameId: request.referenceFrameId,
        priority: request.priority,
        bounds: computeBounds(request.geometry.positions),
        frame: request.frame ?? null
      }));
      return {
        contextId: request.id,
        kind: request.kind,
        source: "cache",
        vertices: request.geometry.positions.length / 3,
        triangles: request.geometry.indices.length / 3,
        durationMs: performance.now() - startedAt
      };
    }
  } catch (error) {
    console.warn(`[navigation] cache read/import failed for ${request.id}`, error);
  }

  const generated = generateSoloNavMesh(request.geometry.positions, request.geometry.indices, RECAST_CONTEXT_CONFIG);
  if (!generated.success) {
    console.warn(`[navigation] failed to build ${request.id} navmesh: ${generated.error}`);
    return null;
  }

  try {
    const bytes = exportNavMesh(generated.navMesh);
    cache.write(cacheKey, bytes);
  } catch (error) {
    console.warn(`[navigation] cache write/export failed for ${request.id}`, error);
  }

  world.registerContext(new RecastNavigationContext({
    id: request.id,
    kind: request.kind,
    navMesh: generated.navMesh,
    referenceFrameId: request.referenceFrameId,
    priority: request.priority,
    bounds: computeBounds(request.geometry.positions),
    frame: request.frame ?? null
  }));
  return {
    contextId: request.id,
    kind: request.kind,
    source: "generated",
    vertices: request.geometry.positions.length / 3,
    triangles: request.geometry.indices.length / 3,
    durationMs: performance.now() - startedAt
  };
}

function createContextCacheKey(request: RecastContextBuildRequest): string {
  const payload = JSON.stringify({
    schemaVersion: CACHE_SCHEMA_VERSION,
    id: request.id,
    kind: request.kind,
    referenceFrameId: request.referenceFrameId,
    recastConfig: RECAST_CONTEXT_CONFIG,
    geometryHash: hashNavigationGeometry(request.geometry)
  });
  return createHash("sha256").update(payload).digest("hex");
}

function hashNavigationGeometry(geometry: NavigationGeometry): string {
  const positions = new Float32Array(geometry.positions.length);
  for (let i = 0; i < geometry.positions.length; i += 1) {
    positions[i] = geometry.positions[i] ?? 0;
  }
  const indices = new Uint32Array(geometry.indices.length);
  for (let i = 0; i < geometry.indices.length; i += 1) {
    indices[i] = Math.max(0, Math.floor(geometry.indices[i] ?? 0));
  }
  const hash = createHash("sha256");
  hash.update(Buffer.from(positions.buffer));
  hash.update(Buffer.from(indices.buffer));
  return hash.digest("hex");
}

function logBuildReport(report: NavigationBuildReport): void {
  console.log(
    `[navigation] boot contexts=${report.surfaceContextCount} generated=${report.generatedCount} failed=${report.failedCount} cache=${report.cacheEnabled ? "on" : "off"} cacheHits=${report.cacheHits}/${report.cacheReads} writes=${report.cacheWrites} totalMs=${report.durationMs.toFixed(1)}`
  );
  for (const context of report.contexts) {
    console.log(
      `[navigation] context id=${context.contextId} kind=${context.kind} source=${context.source} verts=${context.vertices} tris=${context.triangles} ms=${context.durationMs.toFixed(1)}`
    );
  }
}

function buildStaticLocationNavigationGeometry(
  definition: LocationRootDefinition,
  pose: NavigationFrameTransform
): NavigationGeometry {
  if (definition.kind === "terrainIsland") {
    const config = buildLocationTerrainConfig(definition);
    if (!config) {
      return emptyGeometry();
    }
    const terrain = buildTerrainMeshData(config);
    const positions = new Array<number>(terrain.vertices.length);
    for (let i = 0; i < terrain.vertices.length; i += 3) {
      const world = transformLocalToWorld(
        { x: terrain.vertices[i] ?? 0, y: terrain.vertices[i + 1] ?? 0, z: terrain.vertices[i + 2] ?? 0 },
        pose
      );
      positions[i] = world.x;
      positions[i + 1] = world.y;
      positions[i + 2] = world.z;
    }
    return {
      positions,
      indices: Array.from(terrain.indices)
    };
  }

  const geometry = createGeometry();
  if (definition.kind === "staticCastle") {
    addTopQuad(geometry, pose, 0, 5, 0, 34, 24);
    addTopQuad(geometry, pose, 0, 21, 0, 22, 14);
    addTopQuad(geometry, pose, -26, 26, -18, 6, 6);
    addTopQuad(geometry, pose, 26, 26, -18, 6, 6);
    addTopQuad(geometry, pose, -26, 26, 18, 6, 6);
    addTopQuad(geometry, pose, 26, 26, 18, 6, 6);
  }
  if (definition.kind === "testArena") {
    addTopQuad(geometry, pose, 0, 2, 0, 42, 42);
    addTopQuad(geometry, pose, 0, 16, -34, 12, 3);
  }
  return geometry;
}

function buildMovingFrameNavigationGeometry(definition: LocationRootDefinition): NavigationGeometry {
  const geometry = createGeometry();
  if (definition.kind === "movingCastle") {
    addTopQuad(geometry, identityPose(), 0, 9, 0, 42, 28);
    addTopQuad(geometry, identityPose(), 0, 28, 0, 22, 14);
  }
  if (definition.kind === "movingTestPlatform") {
    addTopQuad(geometry, identityPose(), 0, 0.5, 0, 60, 35);
  }
  return geometry;
}

function createGeometry(): NavigationGeometry {
  return {
    positions: [],
    indices: []
  };
}

function emptyGeometry(): NavigationGeometry {
  return createGeometry();
}

function addTopQuad(
  geometry: NavigationGeometry,
  pose: NavigationFrameTransform,
  localCenterX: number,
  localTopY: number,
  localCenterZ: number,
  halfX: number,
  halfZ: number
): void {
  const baseIndex = geometry.positions.length / 3;
  const corners = [
    { x: localCenterX - halfX, y: localTopY, z: localCenterZ - halfZ },
    { x: localCenterX - halfX, y: localTopY, z: localCenterZ + halfZ },
    { x: localCenterX + halfX, y: localTopY, z: localCenterZ - halfZ },
    { x: localCenterX + halfX, y: localTopY, z: localCenterZ + halfZ }
  ].map((point) => transformLocalToWorld(point, pose));

  for (const corner of corners) {
    geometry.positions.push(corner.x, corner.y, corner.z);
  }
  geometry.indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
  geometry.indices.push(baseIndex + 2, baseIndex + 1, baseIndex + 3);
}

function transformLocalToWorld(point: { x: number; y: number; z: number }, pose: NavigationFrameTransform): {
  x: number;
  y: number;
  z: number;
} {
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  return {
    x: pose.x + point.x * cos + point.z * sin,
    y: pose.y + point.y,
    z: pose.z - point.x * sin + point.z * cos
  };
}

function identityPose(): NavigationFrameTransform {
  return { x: 0, y: 0, z: 0, yaw: 0 };
}

function computeBounds(positions: readonly number[]): NavigationBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const margin = 6;
  return {
    minX: minX - margin,
    minY: minY - margin,
    minZ: minZ - margin,
    maxX: maxX + margin,
    maxY: maxY + margin,
    maxZ: maxZ + margin
  };
}
