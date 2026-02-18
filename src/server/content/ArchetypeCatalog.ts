import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  const playerMaxHealth = asNumber(playerRaw.maxHealth, "player.maxHealth");
  if (playerMaxHealth <= 0) {
    throw new Error("player.maxHealth must be > 0.");
  }

  const dummyMaxHealth = asNumber(dummyRaw.maxHealth, "trainingDummy.maxHealth");
  if (dummyMaxHealth <= 0) {
    throw new Error("trainingDummy.maxHealth must be > 0.");
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
    }
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
