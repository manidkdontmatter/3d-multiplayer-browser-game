// Defines moving reference-frame carrier volumes and transform-delta math for large moving locations.
import { normalizeYaw } from "./platforms";

export type CarrierVolumeShape = "box" | "sphere";

export interface CarrierVolumeDefinition {
  readonly id: string;
  readonly shape: CarrierVolumeShape;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly localYaw?: number;
  readonly halfX?: number;
  readonly halfY?: number;
  readonly halfZ?: number;
  readonly radius?: number;
}

export interface ReferenceFrameTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface ReferenceFrameCarryDelta {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface ReferenceFramePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function getReferenceFrameCarryDelta(
  previous: ReferenceFrameTransform,
  current: ReferenceFrameTransform,
  point: ReferenceFramePoint
): ReferenceFrameCarryDelta {
  const local = worldPointToFrameLocal(previous, point);
  const carried = frameLocalPointToWorld(current, local);
  return {
    x: carried.x - point.x,
    y: carried.y - point.y,
    z: carried.z - point.z,
    yaw: normalizeYaw(current.yaw - previous.yaw)
  };
}

export function isPointInsideCarrierVolume(
  volume: CarrierVolumeDefinition,
  frame: ReferenceFrameTransform,
  point: ReferenceFramePoint,
  margin = 0
): boolean {
  const safeMargin = Math.max(0, Number.isFinite(margin) ? margin : 0);
  const local = worldPointToFrameLocal(frame, point);
  const dx = local.x - volume.localX;
  const dy = local.y - volume.localY;
  const dz = local.z - volume.localZ;
  const volumeYaw = volume.localYaw ?? 0;
  const cos = Math.cos(volumeYaw);
  const sin = Math.sin(volumeYaw);
  const volumeLocalX = dx * cos - dz * sin;
  const volumeLocalZ = dx * sin + dz * cos;

  if (volume.shape === "sphere") {
    const radius = Math.max(0, volume.radius ?? 0) + safeMargin;
    return volumeLocalX * volumeLocalX + dy * dy + volumeLocalZ * volumeLocalZ <= radius * radius;
  }

  const halfX = Math.max(0, volume.halfX ?? 0) + safeMargin;
  const halfY = Math.max(0, volume.halfY ?? 0) + safeMargin;
  const halfZ = Math.max(0, volume.halfZ ?? 0) + safeMargin;
  return Math.abs(volumeLocalX) <= halfX && Math.abs(dy) <= halfY && Math.abs(volumeLocalZ) <= halfZ;
}

export function hasCarrierVolumesContainingPoint(
  volumes: readonly CarrierVolumeDefinition[] | undefined,
  frame: ReferenceFrameTransform,
  point: ReferenceFramePoint,
  margin = 0
): boolean {
  if (!volumes || volumes.length === 0) {
    return false;
  }
  return volumes.some((volume) => isPointInsideCarrierVolume(volume, frame, point, margin));
}

export function transformCarrierVolumeCenter(
  volume: CarrierVolumeDefinition,
  frame: ReferenceFrameTransform
): ReferenceFrameTransform {
  const world = frameLocalPointToWorld(frame, {
    x: volume.localX,
    y: volume.localY,
    z: volume.localZ
  });
  return {
    x: world.x,
    y: world.y,
    z: world.z,
    yaw: normalizeYaw(frame.yaw + (volume.localYaw ?? 0))
  };
}

function worldPointToFrameLocal(
  frame: ReferenceFrameTransform,
  point: ReferenceFramePoint
): ReferenceFramePoint {
  const dx = point.x - frame.x;
  const dy = point.y - frame.y;
  const dz = point.z - frame.z;
  const cos = Math.cos(frame.yaw);
  const sin = Math.sin(frame.yaw);
  return {
    x: dx * cos - dz * sin,
    y: dy,
    z: dx * sin + dz * cos
  };
}

function frameLocalPointToWorld(
  frame: ReferenceFrameTransform,
  point: ReferenceFramePoint
): ReferenceFramePoint {
  const cos = Math.cos(frame.yaw);
  const sin = Math.sin(frame.yaw);
  return {
    x: frame.x + point.x * cos + point.z * sin,
    y: frame.y + point.y,
    z: frame.z - point.x * sin + point.z * cos
  };
}
