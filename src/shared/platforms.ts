export type PlatformKind = 1 | 2;

export interface PlatformDefinition {
  pid: number;
  kind: PlatformKind;
  halfX: number;
  halfY: number;
  halfZ: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  baseYaw: number;
  amplitudeX: number;
  amplitudeY: number;
  frequency: number;
  phase: number;
  angularSpeed: number;
}

export interface PlatformTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface PlatformPose extends PlatformTransform {
  pid: number;
  kind: PlatformKind;
  halfX: number;
  halfY: number;
  halfZ: number;
}

export const PLATFORM_DEFINITIONS: PlatformDefinition[] = [
  {
    pid: 1,
    kind: 1,
    halfX: 2.25,
    halfY: 0.35,
    halfZ: 2.25,
    baseX: 8,
    baseY: 0.9,
    baseZ: 0,
    baseYaw: 0,
    amplitudeX: 4.5,
    amplitudeY: 1.2,
    frequency: 0.55,
    phase: 0,
    angularSpeed: 0
  },
  {
    pid: 2,
    kind: 2,
    halfX: 2.8,
    halfY: 0.35,
    halfZ: 2.8,
    baseX: -10,
    baseY: 1.1,
    baseZ: -6,
    baseYaw: 0,
    amplitudeX: 0,
    amplitudeY: 0,
    frequency: 0,
    phase: 0,
    angularSpeed: Math.PI * 0.45
  }
];

export function samplePlatformTransform(definition: PlatformDefinition, seconds: number): PlatformTransform {
  let x = definition.baseX;
  let y = definition.baseY;
  const z = definition.baseZ;
  let yaw = definition.baseYaw;

  if (definition.kind === 1) {
    const wave = seconds * definition.frequency + definition.phase;
    x = definition.baseX + Math.sin(wave) * definition.amplitudeX;
    y = definition.baseY + Math.sin(wave * 0.8) * definition.amplitudeY;
  }

  if (definition.kind === 2) {
    yaw = normalizeYaw(definition.baseYaw + definition.angularSpeed * seconds);
  }

  return { x, y, z, yaw };
}

export function toPlatformLocal(
  platform: Pick<PlatformTransform, "x" | "z" | "yaw">,
  worldX: number,
  worldZ: number
): { x: number; z: number } {
  const dx = worldX - platform.x;
  const dz = worldZ - platform.z;
  const cos = Math.cos(platform.yaw);
  const sin = Math.sin(platform.yaw);
  // Inverse of three.js Y-rotation world transform:
  // world = R_y(yaw) * local, so local = R_y(-yaw) * (world - center).
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos
  };
}

export function applyPlatformCarry(
  previous: PlatformTransform,
  current: PlatformTransform,
  point: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  const deltaY = current.y - previous.y;
  // Convert the point into the previous platform-local frame,
  // then reconstruct it in the current platform frame.
  const local = toPlatformLocal(previous, point.x, point.z);
  const cos = Math.cos(current.yaw);
  const sin = Math.sin(current.yaw);
  const rotatedX = local.x * cos + local.z * sin;
  const rotatedZ = -local.x * sin + local.z * cos;

  return {
    x: current.x + rotatedX,
    y: point.y + deltaY,
    z: current.z + rotatedZ
  };
}

export function normalizeYaw(value: number): number {
  let yaw = value;
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;
  return yaw;
}
