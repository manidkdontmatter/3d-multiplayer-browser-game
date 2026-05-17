/**
 * Purpose: This file builds or queries navigation data for movement/pathing.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { NavMeshQuery, type NavMesh } from "recast-navigation";

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

export type NavigationMode = "auto" | "freeFlight" | "surface";
export type NavigationContextKind = "freeFlight" | "staticWorld" | "location" | "movingFrame";
export type NavigationPathStatus = "complete" | "partial" | "failed";

export interface NavigationFrameTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface NavigationPathRequest {
  readonly start: NavPoint;
  readonly end: NavPoint;
  readonly mode?: NavigationMode;
  readonly startFrameId?: number | null;
  readonly endFrameId?: number | null;
  readonly preferFrameId?: number | null;
  readonly allowFreeFlightFallback?: boolean;
}

export interface NavigationPathResult {
  readonly status: NavigationPathStatus;
  readonly contextId: string | null;
  readonly contextKind: NavigationContextKind | null;
  readonly mode: Exclude<NavigationMode, "auto"> | null;
  readonly points: NavPoint[];
  readonly usedFallback: boolean;
}

export interface NavigationContext {
  readonly id: string;
  readonly kind: NavigationContextKind;
  readonly priority: number;
  readonly referenceFrameId: number | null;
  containsPoint(point: NavPoint): boolean;
  findNearestWalkable(point: NavPoint): NavPoint | null;
  findPath(request: NavigationPathRequest): NavigationPathResult;
}

export interface NavigationService {
  findPath(start: NavPoint, end: NavPoint): NavPoint[];
  findNearestWalkable(point: NavPoint): NavPoint | null;
}

export interface NavigationCoordinateFrame {
  toLocal(point: NavPoint): NavPoint;
  toWorld(point: NavPoint): NavPoint;
}

export interface NavigationBounds {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export interface RecastNavigationContextOptions {
  readonly id: string;
  readonly kind: Exclude<NavigationContextKind, "freeFlight">;
  readonly navMesh: NavMesh;
  readonly priority?: number;
  readonly referenceFrameId?: number | null;
  readonly bounds?: NavigationBounds | null;
  readonly frame?: NavigationCoordinateFrame | null;
  readonly queryHalfExtents?: NavPoint;
}

const DEFAULT_QUERY_HALF_EXTENTS: NavPoint = { x: 2, y: 4, z: 2 };

export class FreeFlightNavigationContext implements NavigationContext, NavigationService {
  public readonly id = "freeFlight:void";
  public readonly kind = "freeFlight";
  public readonly priority = -1000;
  public readonly referenceFrameId = null;

  public containsPoint(point: NavPoint): boolean {
    return isFiniteNavPoint(point);
  }

  public findPath(request: NavigationPathRequest): NavigationPathResult;
  public findPath(start: NavPoint, end: NavPoint): NavPoint[];
  public findPath(startOrRequest: NavPoint | NavigationPathRequest, maybeEnd?: NavPoint): NavPoint[] | NavigationPathResult {
    const request = isNavigationPathRequest(startOrRequest)
      ? startOrRequest
      : { start: startOrRequest, end: maybeEnd as NavPoint };
    const start = this.findNearestWalkable(request.start);
    const end = this.findNearestWalkable(request.end);
    const points = start && end ? [start, end] : [];
    if (!isNavigationPathRequest(startOrRequest)) {
      return points;
    }
    return {
      status: points.length > 0 ? "complete" : "failed",
      contextId: this.id,
      contextKind: this.kind,
      mode: "freeFlight",
      points,
      usedFallback: false
    };
  }

  public findNearestWalkable(point: NavPoint): NavPoint | null {
    if (!isFiniteNavPoint(point)) {
      return null;
    }
    return cloneNavPoint(point);
  }
}

export class RecastNavigationContext implements NavigationContext {
  public readonly id: string;
  public readonly kind: Exclude<NavigationContextKind, "freeFlight">;
  public readonly priority: number;
  public readonly referenceFrameId: number | null;
  private readonly query: NavMeshQuery;
  private readonly bounds: NavigationBounds | null;
  private readonly frame: NavigationCoordinateFrame | null;
  private readonly queryHalfExtents: NavPoint;

  public constructor(options: RecastNavigationContextOptions) {
    this.id = options.id;
    this.kind = options.kind;
    this.priority = options.priority ?? 0;
    this.referenceFrameId = options.referenceFrameId ?? null;
    this.query = new NavMeshQuery(options.navMesh);
    this.bounds = options.bounds ?? null;
    this.frame = options.frame ?? null;
    this.queryHalfExtents = options.queryHalfExtents ?? DEFAULT_QUERY_HALF_EXTENTS;
  }

  public containsPoint(point: NavPoint): boolean {
    if (!isFiniteNavPoint(point)) {
      return false;
    }
    const local = this.toLocal(point);
    if (this.bounds && !containsPointInBounds(this.bounds, local)) {
      return false;
    }
    return this.query.findNearestPoly(local, { halfExtents: this.queryHalfExtents }).success;
  }

  public findNearestWalkable(point: NavPoint): NavPoint | null {
    if (!isFiniteNavPoint(point)) {
      return null;
    }
    const nearest = this.query.findClosestPoint(this.toLocal(point), {
      halfExtents: this.queryHalfExtents
    });
    if (!nearest.success) {
      return null;
    }
    return this.toWorld(nearest.point);
  }

  public findPath(request: NavigationPathRequest): NavigationPathResult {
    const start = this.findNearestWalkable(request.start);
    const end = this.findNearestWalkable(request.end);
    if (!start || !end) {
      return failedNavigationResult(this, false);
    }
    const path = this.query.computePath(this.toLocal(start), this.toLocal(end), {
      halfExtents: this.queryHalfExtents
    });
    if (!path.success || path.path.length === 0) {
      return failedNavigationResult(this, false);
    }
    return {
      status: "complete",
      contextId: this.id,
      contextKind: this.kind,
      mode: "surface",
      points: path.path.map((point) => this.toWorld(point)),
      usedFallback: false
    };
  }

  private toLocal(point: NavPoint): NavPoint {
    return this.frame ? this.frame.toLocal(point) : cloneNavPoint(point);
  }

  private toWorld(point: NavPoint): NavPoint {
    return this.frame ? this.frame.toWorld(point) : cloneNavPoint(point);
  }
}

export class DynamicYawFrame implements NavigationCoordinateFrame {
  public constructor(private readonly getTransform: () => NavigationFrameTransform) {}

  public toLocal(point: NavPoint): NavPoint {
    const frame = this.getTransform();
    const dx = point.x - frame.x;
    const dz = point.z - frame.z;
    const cos = Math.cos(frame.yaw);
    const sin = Math.sin(frame.yaw);
    return {
      x: dx * cos - dz * sin,
      y: point.y - frame.y,
      z: dx * sin + dz * cos
    };
  }

  public toWorld(point: NavPoint): NavPoint {
    const frame = this.getTransform();
    const cos = Math.cos(frame.yaw);
    const sin = Math.sin(frame.yaw);
    return {
      x: frame.x + point.x * cos + point.z * sin,
      y: frame.y + point.y,
      z: frame.z - point.x * sin + point.z * cos
    };
  }
}

export class NavigationWorld implements NavigationService {
  private readonly contexts = new Map<string, NavigationContext>();
  private readonly freeFlight = new FreeFlightNavigationContext();

  public constructor() {
    this.registerContext(this.freeFlight);
  }

  public registerContext(context: NavigationContext): void {
    this.contexts.set(context.id, context);
  }

  public getContext(id: string): NavigationContext | null {
    return this.contexts.get(id) ?? null;
  }

  public getContexts(): readonly NavigationContext[] {
    return Array.from(this.contexts.values()).sort((a, b) => b.priority - a.priority);
  }

  public findPath(start: NavPoint, end: NavPoint): NavPoint[] {
    return this.planPath({ start, end }).points;
  }

  public findNearestWalkable(point: NavPoint): NavPoint | null {
    const context = this.pickSurfaceContext({ start: point, end: point, mode: "surface" });
    return context?.findNearestWalkable(point) ?? this.freeFlight.findNearestWalkable(point);
  }

  public planPath(request: NavigationPathRequest): NavigationPathResult {
    const mode = request.mode ?? "auto";
    if (mode === "freeFlight") {
      return this.freeFlight.findPath(request) as NavigationPathResult;
    }

    const surfaceContext = this.pickSurfaceContext(request);
    if (surfaceContext) {
      const result = surfaceContext.findPath(request);
      if (result.status !== "failed" || request.allowFreeFlightFallback === false || mode === "surface") {
        return result;
      }
    }

    if (mode === "surface" || request.allowFreeFlightFallback === false) {
      return surfaceContext ? failedNavigationResult(surfaceContext, false) : emptyNavigationResult();
    }
    const fallback = this.freeFlight.findPath(request) as NavigationPathResult;
    return {
      ...fallback,
      usedFallback: surfaceContext !== null
    };
  }

  private pickSurfaceContext(request: NavigationPathRequest): NavigationContext | null {
    const preferredFrameId = request.preferFrameId ?? request.startFrameId ?? null;
    const sameKnownFrame =
      request.startFrameId !== null &&
      request.startFrameId !== undefined &&
      request.startFrameId === (request.endFrameId ?? request.startFrameId);
    const candidates = this.getContexts()
      .filter((context) => context.kind !== "freeFlight")
      .filter((context) => {
        if (preferredFrameId === null) {
          return context.referenceFrameId === null || context.kind !== "movingFrame";
        }
        return context.referenceFrameId === preferredFrameId || (!sameKnownFrame && context.referenceFrameId === null);
      });

    const containing = candidates.find((context) =>
      context.containsPoint(request.start) && context.containsPoint(request.end)
    );
    if (containing) {
      return containing;
    }
    return candidates.find((context) => context.containsPoint(request.start)) ?? null;
  }
}

export class CharacterNavigationPlanner implements NavigationService {
  public constructor(private readonly world: NavigationWorld) {}

  public findPath(start: NavPoint, end: NavPoint): NavPoint[] {
    return this.planPath({ start, end }).points;
  }

  public planPath(request: NavigationPathRequest): NavigationPathResult {
    return this.world.planPath(request);
  }

  public findNearestWalkable(point: NavPoint): NavPoint | null {
    return this.world.findNearestWalkable(point);
  }
}

export function createYawFrame(getTransform: () => NavigationFrameTransform): NavigationCoordinateFrame {
  return new DynamicYawFrame(getTransform);
}

function isNavigationPathRequest(value: NavPoint | NavigationPathRequest): value is NavigationPathRequest {
  return "start" in value && "end" in value;
}

function isFiniteNavPoint(point: NavPoint | undefined): point is NavPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function cloneNavPoint(point: NavPoint): NavPoint {
  return { x: point.x, y: point.y, z: point.z };
}

function containsPointInBounds(bounds: NavigationBounds, point: NavPoint): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ
  );
}

function failedNavigationResult(context: NavigationContext, usedFallback: boolean): NavigationPathResult {
  return {
    status: "failed",
    contextId: context.id,
    contextKind: context.kind,
    mode: context.kind === "freeFlight" ? "freeFlight" : "surface",
    points: [],
    usedFallback
  };
}

function emptyNavigationResult(): NavigationPathResult {
  return {
    status: "failed",
    contextId: null,
    contextKind: null,
    mode: null,
    points: [],
    usedFallback: false
  };
}
