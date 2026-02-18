import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PlatformDefinition, PlatformKind } from "../../shared/platforms";

type Vec3Yaw = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

export interface ServerArchetypeCatalog {
  readonly player: {
    readonly modelId: number;
    readonly maxHealth: number;
  };
  readonly trainingDummy: {
    readonly modelId: number;
    readonly maxHealth: number;
    readonly capsuleHalfHeight: number;
    readonly capsuleRadius: number;
    readonly spawns: readonly Vec3Yaw[];
  };
  readonly platforms: readonly PlatformDefinition[];
}

export function loadServerArchetypeCatalog(): ServerArchetypeCatalog {
  const archetypePath = resolve(process.cwd(), "data", "archetypes", "server-archetypes.json");
  const rawText = readFileSync(archetypePath, "utf8");
  const parsed = JSON.parse(rawText) as unknown;
  return validateServerArchetypeCatalog(parsed);
}

function validateServerArchetypeCatalog(value: unknown): ServerArchetypeCatalog {
  if (!value || typeof value !== "object") {
    throw new Error("Archetype catalog must be a JSON object.");
  }
  const root = value as Record<string, unknown>;
  const version = asNumber(root.version, "version");
  if (version !== 1) {
    throw new Error(`Unsupported archetype catalog version: ${version}`);
  }

  const playerRaw = asRecord(root.player, "player");
  const dummyRaw = asRecord(root.trainingDummy, "trainingDummy");
  const platformsRaw = root.platforms;
  const spawnsRaw = dummyRaw.spawns;
  if (!Array.isArray(spawnsRaw)) {
    throw new Error("trainingDummy.spawns must be an array.");
  }

  const spawns: Vec3Yaw[] = spawnsRaw.map((spawn, index) => {
    const record = asRecord(spawn, `trainingDummy.spawns[${index}]`);
    return {
      x: asNumber(record.x, `trainingDummy.spawns[${index}].x`),
      y: asNumber(record.y, `trainingDummy.spawns[${index}].y`),
      z: asNumber(record.z, `trainingDummy.spawns[${index}].z`),
      yaw: asNumber(record.yaw, `trainingDummy.spawns[${index}].yaw`)
    };
  });

  if (spawns.length === 0) {
    throw new Error("trainingDummy.spawns must include at least one spawn point.");
  }
  if (!Array.isArray(platformsRaw) || platformsRaw.length === 0) {
    throw new Error("platforms must be a non-empty array.");
  }

  const playerMaxHealth = asNumber(playerRaw.maxHealth, "player.maxHealth");
  if (playerMaxHealth <= 0) {
    throw new Error("player.maxHealth must be > 0.");
  }

  const dummyMaxHealth = asNumber(dummyRaw.maxHealth, "trainingDummy.maxHealth");
  if (dummyMaxHealth <= 0) {
    throw new Error("trainingDummy.maxHealth must be > 0.");
  }
  const platforms: PlatformDefinition[] = platformsRaw.map((platform, index) => {
    const record = asRecord(platform, `platforms[${index}]`);
    return {
      pid: asInt(record.pid, `platforms[${index}].pid`),
      kind: asPlatformKind(record.kind, `platforms[${index}].kind`),
      halfX: asPositiveNumber(record.halfX, `platforms[${index}].halfX`),
      halfY: asPositiveNumber(record.halfY, `platforms[${index}].halfY`),
      halfZ: asPositiveNumber(record.halfZ, `platforms[${index}].halfZ`),
      baseX: asNumber(record.baseX, `platforms[${index}].baseX`),
      baseY: asNumber(record.baseY, `platforms[${index}].baseY`),
      baseZ: asNumber(record.baseZ, `platforms[${index}].baseZ`),
      baseYaw: asNumber(record.baseYaw, `platforms[${index}].baseYaw`),
      amplitudeX: asNumber(record.amplitudeX, `platforms[${index}].amplitudeX`),
      amplitudeY: asNumber(record.amplitudeY, `platforms[${index}].amplitudeY`),
      frequency: asNonNegativeNumber(record.frequency, `platforms[${index}].frequency`),
      phase: asNumber(record.phase, `platforms[${index}].phase`),
      angularSpeed: asNumber(record.angularSpeed, `platforms[${index}].angularSpeed`)
    };
  });
  const pidSet = new Set<number>();
  for (const platform of platforms) {
    if (pidSet.has(platform.pid)) {
      throw new Error(`platforms contains duplicate pid ${platform.pid}`);
    }
    pidSet.add(platform.pid);
  }

  const catalog: ServerArchetypeCatalog = {
    player: {
      modelId: asInt(playerRaw.modelId, "player.modelId"),
      maxHealth: Math.floor(playerMaxHealth)
    },
    trainingDummy: {
      modelId: asInt(dummyRaw.modelId, "trainingDummy.modelId"),
      maxHealth: Math.floor(dummyMaxHealth),
      capsuleHalfHeight: asNumber(dummyRaw.capsuleHalfHeight, "trainingDummy.capsuleHalfHeight"),
      capsuleRadius: asNumber(dummyRaw.capsuleRadius, "trainingDummy.capsuleRadius"),
      spawns
    },
    platforms
  };

  return catalog;
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
