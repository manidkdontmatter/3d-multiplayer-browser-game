/**
 * Purpose: This file handles deterministic moving platform data and runtime updates.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
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

export interface PlatformArchetypeCatalog {
  version: unknown;
  platforms: unknown;
}

export let PLATFORM_DEFINITIONS: readonly PlatformDefinition[] = Object.freeze([]);

export function injectPlatformCatalog(raw: PlatformArchetypeCatalog): void {
  PLATFORM_DEFINITIONS = Object.freeze(parsePlatformArchetypeCatalog(raw));
}

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

function parsePlatformArchetypeCatalog(raw: PlatformArchetypeCatalog): PlatformDefinition[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("platform-archetypes catalog must be an object.");
  }
  const version = asNumber(raw.version, "platform-archetypes.version");
  if (version !== 1) {
    throw new Error(`Unsupported platform-archetypes version: ${version}`);
  }
  if (!Array.isArray(raw.platforms) || raw.platforms.length === 0) {
    throw new Error("platform-archetypes.platforms must be a non-empty array.");
  }

  const pidSet = new Set<number>();
  const platforms = raw.platforms.map((platform, index) => {
    const record = asRecord(platform, `platform-archetypes.platforms[${index}]`);
    const definition: PlatformDefinition = {
      pid: asInt(record.pid, `platform-archetypes.platforms[${index}].pid`),
      kind: asPlatformKind(record.kind, `platform-archetypes.platforms[${index}].kind`),
      halfX: asPositiveNumber(record.halfX, `platform-archetypes.platforms[${index}].halfX`),
      halfY: asPositiveNumber(record.halfY, `platform-archetypes.platforms[${index}].halfY`),
      halfZ: asPositiveNumber(record.halfZ, `platform-archetypes.platforms[${index}].halfZ`),
      baseX: asNumber(record.baseX, `platform-archetypes.platforms[${index}].baseX`),
      baseY: asNumber(record.baseY, `platform-archetypes.platforms[${index}].baseY`),
      baseZ: asNumber(record.baseZ, `platform-archetypes.platforms[${index}].baseZ`),
      baseYaw: asNumber(record.baseYaw, `platform-archetypes.platforms[${index}].baseYaw`),
      amplitudeX: asNumber(record.amplitudeX, `platform-archetypes.platforms[${index}].amplitudeX`),
      amplitudeY: asNumber(record.amplitudeY, `platform-archetypes.platforms[${index}].amplitudeY`),
      frequency: asNonNegativeNumber(record.frequency, `platform-archetypes.platforms[${index}].frequency`),
      phase: asNumber(record.phase, `platform-archetypes.platforms[${index}].phase`),
      angularSpeed: asNumber(record.angularSpeed, `platform-archetypes.platforms[${index}].angularSpeed`)
    };
    if (pidSet.has(definition.pid)) {
      throw new Error(`platform-archetypes contains duplicate pid ${definition.pid}`);
    }
    pidSet.add(definition.pid);
    return Object.freeze(definition);
  });

  return platforms;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function asInt(value: unknown, label: string): number {
  const numberValue = asNumber(value, label);
  return Math.max(0, Math.floor(numberValue));
}

function asNonNegativeNumber(value: unknown, label: string): number {
  const numberValue = asNumber(value, label);
  if (numberValue < 0) {
    throw new Error(`${label} must be >= 0.`);
  }
  return numberValue;
}

function asPositiveNumber(value: unknown, label: string): number {
  const numberValue = asNumber(value, label);
  if (numberValue <= 0) {
    throw new Error(`${label} must be > 0.`);
  }
  return numberValue;
}

function asPlatformKind(value: unknown, label: string): PlatformKind {
  const numberValue = asInt(value, label);
  if (numberValue !== 1 && numberValue !== 2) {
    throw new Error(`${label} must be 1 or 2.`);
  }
  return numberValue as PlatformKind;
}
