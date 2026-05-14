// Loads and validates server-only archetype data while using shared catalogs for cross-runtime content.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLATFORM_DEFINITIONS, type PlatformDefinition } from "../../shared/platforms";

type Vec3Yaw = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

export interface CharacterArchetypeDefinition {
  readonly id: number;
  readonly name: string;
  readonly modelId: number;
  readonly maxHealth: number;
  readonly capsuleHalfHeight: number;
  readonly capsuleRadius: number;
  readonly moveSpeed: number;
  readonly perceptionRadius: number;
  readonly attackRange: number;
  readonly attackDamage: number;
  readonly attackCooldownSeconds: number;
  readonly activationRadius: number;
  readonly deactivationRadius: number;
  readonly behaviorTreeId: string;
}

export interface NpcSpawnDefinition {
  readonly archetypeId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly patrolPoints: readonly { x: number; y: number; z: number }[];
}

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
  readonly characterArchetypes: ReadonlyMap<number, CharacterArchetypeDefinition>;
  readonly npcSpawns: readonly NpcSpawnDefinition[];
  readonly platforms: readonly PlatformDefinition[];
  readonly projectiles: ReadonlyMap<number, { modelId: number }>;
}

export function loadServerArchetypeCatalog(): ServerArchetypeCatalog {
  const archetypePath = resolve(process.cwd(), "src", "game", "shared", "archetypes", "server-archetypes.json");
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
  const projectileKindsRaw = root.projectileKinds;
  if (!Array.isArray(projectileKindsRaw) || projectileKindsRaw.length === 0) {
    throw new Error("projectileKinds must be a non-empty array.");
  }

  const playerMaxHealth = asNumber(playerRaw.maxHealth, "player.maxHealth");
  if (playerMaxHealth <= 0) {
    throw new Error("player.maxHealth must be > 0.");
  }

  const dummyMaxHealth = asNumber(dummyRaw.maxHealth, "trainingDummy.maxHealth");
  if (dummyMaxHealth <= 0) {
    throw new Error("trainingDummy.maxHealth must be > 0.");
  }
  const characterArchetypes = parseCharacterArchetypes(root.characterArchetypes);
  const npcSpawns = parseNpcSpawns(root.npcSpawns, characterArchetypes);
  const projectileKinds = new Map<number, { modelId: number }>();
  for (let index = 0; index < projectileKindsRaw.length; index += 1) {
    const record = asRecord(projectileKindsRaw[index], `projectileKinds[${index}]`);
    const kind = asInt(record.kind, `projectileKinds[${index}].kind`);
    const modelId = asInt(record.modelId, `projectileKinds[${index}].modelId`);
    if (projectileKinds.has(kind)) {
      throw new Error(`projectileKinds contains duplicate kind ${kind}`);
    }
    projectileKinds.set(kind, { modelId });
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
    characterArchetypes,
    npcSpawns,
    platforms: PLATFORM_DEFINITIONS,
    projectiles: projectileKinds
  };

  return catalog;
}

function parseCharacterArchetypes(value: unknown): ReadonlyMap<number, CharacterArchetypeDefinition> {
  if (!Array.isArray(value)) {
    return new Map();
  }
  const archetypes = new Map<number, CharacterArchetypeDefinition>();
  for (let index = 0; index < value.length; index += 1) {
    const record = asRecord(value[index], `characterArchetypes[${index}]`);
    const id = asInt(record.id, `characterArchetypes[${index}].id`);
    if (archetypes.has(id)) {
      throw new Error(`characterArchetypes contains duplicate id ${id}`);
    }
    const maxHealth = asNumber(record.maxHealth, `characterArchetypes[${index}].maxHealth`);
    if (maxHealth <= 0) {
      throw new Error(`characterArchetypes[${index}].maxHealth must be > 0.`);
    }
    archetypes.set(id, {
      id,
      name: asString(record.name, `characterArchetypes[${index}].name`),
      modelId: asInt(record.modelId, `characterArchetypes[${index}].modelId`),
      maxHealth: Math.floor(maxHealth),
      capsuleHalfHeight: positiveNumber(record.capsuleHalfHeight, `characterArchetypes[${index}].capsuleHalfHeight`),
      capsuleRadius: positiveNumber(record.capsuleRadius, `characterArchetypes[${index}].capsuleRadius`),
      moveSpeed: positiveNumber(record.moveSpeed, `characterArchetypes[${index}].moveSpeed`),
      perceptionRadius: positiveNumber(record.perceptionRadius, `characterArchetypes[${index}].perceptionRadius`),
      attackRange: positiveNumber(record.attackRange, `characterArchetypes[${index}].attackRange`),
      attackDamage: positiveNumber(record.attackDamage, `characterArchetypes[${index}].attackDamage`),
      attackCooldownSeconds: positiveNumber(
        record.attackCooldownSeconds,
        `characterArchetypes[${index}].attackCooldownSeconds`
      ),
      activationRadius: positiveNumber(record.activationRadius, `characterArchetypes[${index}].activationRadius`),
      deactivationRadius: positiveNumber(record.deactivationRadius, `characterArchetypes[${index}].deactivationRadius`),
      behaviorTreeId: asString(record.behaviorTreeId, `characterArchetypes[${index}].behaviorTreeId`)
    });
  }
  return archetypes;
}

function parseNpcSpawns(
  value: unknown,
  archetypes: ReadonlyMap<number, CharacterArchetypeDefinition>
): NpcSpawnDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((spawn, index) => {
    const record = asRecord(spawn, `npcSpawns[${index}]`);
    const archetypeId = asInt(record.archetypeId, `npcSpawns[${index}].archetypeId`);
    if (!archetypes.has(archetypeId)) {
      throw new Error(`npcSpawns[${index}].archetypeId references unknown character archetype ${archetypeId}.`);
    }
    return {
      archetypeId,
      x: asNumber(record.x, `npcSpawns[${index}].x`),
      y: asNumber(record.y, `npcSpawns[${index}].y`),
      z: asNumber(record.z, `npcSpawns[${index}].z`),
      yaw: asNumber(record.yaw, `npcSpawns[${index}].yaw`),
      patrolPoints: parsePatrolPoints(record.patrolPoints, `npcSpawns[${index}].patrolPoints`)
    };
  });
}

function parsePatrolPoints(value: unknown, label: string): { x: number; y: number; z: number }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((point, index) => {
    const record = asRecord(point, `${label}[${index}]`);
    return {
      x: asNumber(record.x, `${label}[${index}].x`),
      y: asNumber(record.y, `${label}[${index}].y`),
      z: asNumber(record.z, `${label}[${index}].z`)
    };
  });
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

function positiveNumber(value: unknown, label: string): number {
  const numberValue = asNumber(value, label);
  if (numberValue <= 0) {
    throw new Error(`${label} must be > 0.`);
  }
  return numberValue;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function asInt(value: unknown, label: string): number {
  const numberValue = asNumber(value, label);
  return Math.max(0, Math.floor(numberValue));
}
