// Defines authored axis-aligned environment volumes and blend weights shared by clients and servers.
import {
  ENVIRONMENT_PRESET_VOID_ARCANE,
  ENVIRONMENT_PRESET_VOID_DEEP,
  ENVIRONMENT_PRESET_VOID_INFERNAL,
  ENVIRONMENT_PRESET_VOID_NEUTRAL
} from "./worldLocations";

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

export const VOID_ENVIRONMENT_VOLUME_DEFINITIONS: readonly EnvironmentVolumeDefinition[] = Object.freeze([
  {
    id: "void-region.neutral-origin-expanse",
    kind: "voidRegion",
    priority: ENVIRONMENT_PRIORITY_VOID_REGION,
    environmentPresetId: ENVIRONMENT_PRESET_VOID_NEUTRAL,
    x: 0,
    y: 0,
    z: 0,
    halfX: 900,
    halfY: 760,
    halfZ: 760,
    blendDistance: 360
  },
  {
    id: "void-region.infernal-blackstone-expanse",
    kind: "voidRegion",
    priority: ENVIRONMENT_PRIORITY_VOID_REGION,
    environmentPresetId: ENVIRONMENT_PRESET_VOID_INFERNAL,
    x: 1250,
    y: 40,
    z: -760,
    halfX: 820,
    halfY: 760,
    halfZ: 780,
    blendDistance: 360
  },
  {
    id: "void-region.arcane-drift-belt",
    kind: "voidRegion",
    priority: ENVIRONMENT_PRIORITY_VOID_REGION,
    environmentPresetId: ENVIRONMENT_PRESET_VOID_ARCANE,
    x: -760,
    y: 130,
    z: -520,
    halfX: 820,
    halfY: 760,
    halfZ: 780,
    blendDistance: 360
  },
  {
    id: "void-region.deep-skybox-survey",
    kind: "voidRegion",
    priority: ENVIRONMENT_PRIORITY_VOID_REGION,
    environmentPresetId: ENVIRONMENT_PRESET_VOID_DEEP,
    x: -1420,
    y: 80,
    z: 980,
    halfX: 900,
    halfY: 760,
    halfZ: 840,
    blendDistance: 360
  }
]);

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
