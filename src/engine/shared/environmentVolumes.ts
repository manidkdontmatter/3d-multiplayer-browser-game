// Shared environment volume definitions and blend helpers.
// Game data is injected by the game layer at startup via injectEnvironmentVolumeDefinitions().

export type EnvironmentVolumeKind = "voidRegion" | "location" | "interior";

export const ENVIRONMENT_PRIORITY_GLOBAL = 0;
export const ENVIRONMENT_PRIORITY_VOID_REGION = 10;
export const ENVIRONMENT_PRIORITY_LOCATION = 100;
export const ENVIRONMENT_PRIORITY_INTERIOR = 200;

export interface EnvironmentVolumeDefinition {
  readonly id: string;
  readonly kind: EnvironmentVolumeKind;
  readonly priority: number;
  readonly environmentPresetId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfY: number;
  readonly halfZ: number;
  readonly blendDistance: number;
}

export interface EnvironmentSamplePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export let VOID_ENVIRONMENT_VOLUME_DEFINITIONS: readonly EnvironmentVolumeDefinition[] = Object.freeze([]);

export function injectEnvironmentVolumeDefinitions(definitions: readonly EnvironmentVolumeDefinition[]): void {
  VOID_ENVIRONMENT_VOLUME_DEFINITIONS = Object.freeze(definitions);
}

export function getEnvironmentVolumeWeight(
  volume: EnvironmentVolumeDefinition,
  point: EnvironmentSamplePoint
): number {
  const { halfX, halfY, halfZ } = volume;
  if (
    !Number.isFinite(halfX) ||
    !Number.isFinite(halfY) ||
    !Number.isFinite(halfZ) ||
    halfX <= 0 ||
    halfY <= 0 ||
    halfZ <= 0
  ) {
    return 0;
  }

  const dx = point.x - volume.x;
  const dy = point.y - volume.y;
  const dz = point.z - volume.z;
  const overflowX = Math.abs(dx) - halfX;
  const overflowY = Math.abs(dy) - halfY;
  const overflowZ = Math.abs(dz) - halfZ;
  const outsideDistance = Math.hypot(
    Math.max(0, overflowX),
    Math.max(0, overflowY),
    Math.max(0, overflowZ)
  );
  const blendDistance = Math.max(1e-6, volume.blendDistance);
  if (outsideDistance > blendDistance) {
    return 0;
  }
  if (outsideDistance > 0) {
    return 1 - smoothstep(outsideDistance / blendDistance);
  }
  return 1;
}

function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
