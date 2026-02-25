// SQLite persistence service for auth, player runtime snapshots, and ability bar state.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  ABILITY_CREATOR_MAX_ABILITIES,
  ABILITY_CREATOR_MAX_TIER,
  ABILITY_CREATOR_MIN_TIER,
  ABILITY_DYNAMIC_ID_START,
  ABILITY_ID_NONE,
  DEFAULT_HOTBAR_ABILITY_IDS,
  HOTBAR_SLOT_COUNT,
  PLAYER_MAX_HEALTH,
  type AbilityCreatorType
} from "../../shared/index";

const ACCESS_KEY_PATTERN = /^[A-Za-z0-9]{12}$/;
const KEY_SCRYPT_BYTES = 64;
const KEY_SALT_BYTES = 16;
const CHARACTER_SCHEMA_VERSION = 1;

const IP_BUCKET_CAPACITY = 10;
const IP_BUCKET_REFILL_PER_MS = 30 / 60000;
const KEY_BUCKET_CAPACITY = 4;
const KEY_BUCKET_REFILL_PER_MS = 12 / 60000;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const TEMP_BAN_THRESHOLD = 60;
const TEMP_BAN_DURATION_MS = 15 * 60 * 1000;
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 30000;
export const GUEST_ACCOUNT_ID_BASE = 1_000_000_000;

type AuthResultCode = "ok" | "invalid_key_format" | "rate_limited" | "banned" | "invalid_credentials" | "server_error";

export interface AuthResult {
  ok: boolean;
  code: AuthResultCode;
  accountId: number | null;
  retryAfterMs: number;
}

export interface PersistedPlayerState {
  accountId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  health: number;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
}

export interface PlayerSnapshot {
  accountId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  health: number;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
}

export interface CriticalEventRecord {
  eventId: string;
  instanceId: string;
  accountId: number;
  eventType: string;
  eventPayloadJson: string;
  eventAtMs: number;
}

export interface PersistedAbilityDefinitionRecord {
  abilityId: number;
  name: string;
  type: AbilityCreatorType;
  tier: number;
  coreExampleStat: number;
  exampleUpsideEnabled: boolean;
  exampleDownsideEnabled: boolean;
  createdByPlayerId: number;
  createdAt: number;
}

export interface CreateOwnedAbilityRequest {
  accountId: number;
  name: string;
  type: AbilityCreatorType;
  tier: number;
  coreExampleStat: number;
  exampleUpsideEnabled: boolean;
  exampleDownsideEnabled: boolean;
  templateAbilityId: number | null;
  maxAbilities: number;
}

export interface ForgetOwnedAbilityRequest {
  accountId: number;
  abilityId: number;
}

export type CreateOwnedAbilityResult =
  | {
      ok: true;
      ability: PersistedAbilityDefinitionRecord;
      replacedAbilityId: number | null;
      ownedAbilityIds: number[];
    }
  | {
      ok: false;
      error: string;
    };

export type ForgetOwnedAbilityResult =
  | {
      ok: true;
      ownedAbilityIds: number[];
    }
  | {
      ok: false;
      error: string;
    };

type TokenBucketState = {
  tokens: number;
  lastRefillMs: number;
};

type FailureState = {
  windowStartMs: number;
  failuresInWindow: number;
  backoffUntilMs: number;
  bannedUntilMs: number;
};

export class PersistenceService {
  private readonly db: Database;
  private readonly ipBuckets = new Map<string, TokenBucketState>();
  private readonly keyBuckets = new Map<string, TokenBucketState>();
  private readonly failureStateByIp = new Map<string, FailureState>();
  private readonly disableRateLimit: boolean;
  private readonly disablePersistenceWrites: boolean;
  private readonly transientAccountIdByKey = new Map<string, number>();
  private nextTransientAccountId = GUEST_ACCOUNT_ID_BASE * 2;

  public constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.disableRateLimit = process.env.SERVER_AUTH_DISABLE_RATE_LIMIT === "1";
    this.disablePersistenceWrites = process.env.SERVER_DISABLE_PERSISTENCE_WRITES === "1";
    this.initializeSchema();
  }

  public close(): void {
    this.db.close();
  }

  public authenticateOrCreate(rawAccessKey: unknown, remoteIpRaw: unknown): AuthResult {
    const remoteIp = this.normalizeRemoteIp(remoteIpRaw);
    const now = Date.now();
    const accessKey = typeof rawAccessKey === "string" ? rawAccessKey : "";
    if (!ACCESS_KEY_PATTERN.test(accessKey)) {
      this.appendAuthAudit(remoteIp, "fail", "invalid_key_format");
      return {
        ok: false,
        code: "invalid_key_format",
        accountId: null,
        retryAfterMs: 0
      };
    }

    const keyFingerprint = this.computeKeyFingerprint(accessKey);
    if (this.disablePersistenceWrites) {
      const existingAccountId = this.transientAccountIdByKey.get(keyFingerprint);
      if (typeof existingAccountId === "number") {
        return {
          ok: true,
          code: "ok",
          accountId: existingAccountId,
          retryAfterMs: 0
        };
      }
      const accountId = this.nextTransientAccountId++;
      this.transientAccountIdByKey.set(keyFingerprint, accountId);
      return {
        ok: true,
        code: "ok",
        accountId,
        retryAfterMs: 0
      };
    }

    const throttle = this.evaluateThrottle(remoteIp, keyFingerprint, now);
    if (!throttle.allowed) {
      const code: AuthResultCode = throttle.reason === "banned" ? "banned" : "rate_limited";
      this.appendAuthAudit(remoteIp, code === "banned" ? "blocked" : "rate_limited", throttle.reason);
      return {
        ok: false,
        code,
        accountId: null,
        retryAfterMs: throttle.retryAfterMs
      };
    }

    try {
      const playerRow = this.db
        .prepare(
          `SELECT account_id AS accountId, key_salt AS keySalt, key_hash AS keyHash
           FROM players
           WHERE key_fingerprint = ?`
        )
        .get(keyFingerprint) as
        | { accountId: number; keySalt: Buffer; keyHash: Buffer }
        | undefined;

      if (!playerRow) {
        const salt = randomBytes(KEY_SALT_BYTES);
        const hash = this.deriveKeyHash(accessKey, salt);
        const accountId = this.createPlayer(keyFingerprint, salt, hash, now);
        this.markAuthSuccess(remoteIp);
        this.appendAuthAudit(remoteIp, "success", "created");
        return {
          ok: true,
          code: "ok",
          accountId,
          retryAfterMs: 0
        };
      }

      const expectedHash = Buffer.from(playerRow.keyHash);
      const actualHash = this.deriveKeyHash(accessKey, Buffer.from(playerRow.keySalt));
      const valid = expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
      if (!valid) {
        const retryAfterMs = this.markAuthFailure(remoteIp, now);
        this.appendAuthAudit(remoteIp, "fail", "invalid_credentials");
        return {
          ok: false,
          code: "invalid_credentials",
          accountId: null,
          retryAfterMs
        };
      }

      this.db
        .prepare(
          `UPDATE players
           SET last_login_at = ?
           WHERE account_id = ?`
        )
        .run(now, playerRow.accountId);
      this.markAuthSuccess(remoteIp);
      this.appendAuthAudit(remoteIp, "success", "existing");
      return {
        ok: true,
        code: "ok",
        accountId: playerRow.accountId,
        retryAfterMs: 0
      };
    } catch (error) {
      const retryAfterMs = this.markAuthFailure(remoteIp, now);
      this.appendAuthAudit(remoteIp, "fail", "server_error");
      console.error("[persist] authenticateOrCreate failed", error);
      return {
        ok: false,
        code: "server_error",
        accountId: null,
        retryAfterMs
      };
    }
  }

  public loadPlayerState(accountId: number): PersistedPlayerState | null {
    if (this.disablePersistenceWrites) {
      return null;
    }
    const character = this.db
      .prepare(
        `SELECT x, y, z, yaw, pitch, vx, vy, vz, health,
                primary_mouse_slot AS primaryMouseSlot,
                secondary_mouse_slot AS secondaryMouseSlot
         FROM characters
         WHERE player_id = ?`
      )
      .get(accountId) as
      | {
          x: number;
          y: number;
          z: number;
          yaw: number;
          pitch: number;
          vx: number;
          vy: number;
          vz: number;
          health: number;
          primaryMouseSlot: number;
          secondaryMouseSlot: number;
        }
      | undefined;

    const slots = this.db
      .prepare(
        `SELECT slot_index AS slotIndex, ability_id AS abilityId
         FROM player_loadout_slots
         WHERE player_id = ?`
      )
      .all(accountId) as Array<{ slotIndex: number; abilityId: number }>;

    if (!character && slots.length === 0) {
      return null;
    }

    const hotbar = [...DEFAULT_HOTBAR_ABILITY_IDS];
    for (const slot of slots) {
      if (!Number.isInteger(slot.slotIndex) || slot.slotIndex < 0 || slot.slotIndex >= HOTBAR_SLOT_COUNT) {
        continue;
      }
      hotbar[slot.slotIndex] = Math.max(ABILITY_ID_NONE, Math.floor(slot.abilityId));
    }

    return {
      accountId,
      x: character?.x ?? 0,
      y: character?.y ?? 0,
      z: character?.z ?? 0,
      yaw: character?.yaw ?? 0,
      pitch: character?.pitch ?? 0,
      vx: character?.vx ?? 0,
      vy: character?.vy ?? 0,
      vz: character?.vz ?? 0,
      health: this.clampInteger(character?.health ?? PLAYER_MAX_HEALTH, 0, PLAYER_MAX_HEALTH),
      primaryMouseSlot: this.clampInteger(character?.primaryMouseSlot ?? 0, 0, HOTBAR_SLOT_COUNT - 1),
      secondaryMouseSlot: this.clampInteger(
        character?.secondaryMouseSlot ?? 1,
        0,
        HOTBAR_SLOT_COUNT - 1
      ),
      hotbarAbilityIds: hotbar
    };
  }

  public loadOwnedAbilityIds(accountId: number, defaultAbilityIds: ReadonlyArray<number>): number[] {
    if (this.disablePersistenceWrites) {
      return Array.from(
        new Set(
          defaultAbilityIds
            .map((abilityId) => this.clampInteger(abilityId, 0, 0xffff))
            .filter((abilityId) => abilityId > ABILITY_ID_NONE)
        )
      ).sort((a, b) => a - b);
    }

    const tx = this.db.transaction((playerId: number, defaults: ReadonlyArray<number>) => {
      const rows = this.db
        .prepare(
          `SELECT ability_id AS abilityId
           FROM player_ability_ownership
           WHERE player_id = ?
           ORDER BY ability_id ASC`
        )
        .all(playerId) as Array<{ abilityId: number }>;
      if (rows.length > 0) {
        return rows
          .map((row) => this.clampInteger(row.abilityId, 0, 0xffff))
          .filter((abilityId) => abilityId > ABILITY_ID_NONE);
      }

      const defaultsNormalized = Array.from(
        new Set(
          defaults
            .map((abilityId) => this.clampInteger(abilityId, 0, 0xffff))
            .filter((abilityId) => abilityId > ABILITY_ID_NONE)
        )
      ).sort((a, b) => a - b);
      const insertOwnership = this.db.prepare(
        `INSERT INTO player_ability_ownership (player_id, ability_id, unlocked_at)
         VALUES (?, ?, ?)`
      );
      const now = Date.now();
      for (const abilityId of defaultsNormalized) {
        insertOwnership.run(playerId, abilityId, now);
      }
      return defaultsNormalized;
    });

    return tx(accountId, defaultAbilityIds);
  }

  public loadOwnedDynamicAbilityDefinitions(accountId: number): PersistedAbilityDefinitionRecord[] {
    if (this.disablePersistenceWrites) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT d.ability_id AS abilityId,
                d.name AS name,
                d.ability_type AS abilityType,
                d.tier AS tier,
                d.core_example_stat AS coreExampleStat,
                d.example_upside_enabled AS exampleUpsideEnabled,
                d.example_downside_enabled AS exampleDownsideEnabled,
                d.created_by_player_id AS createdByPlayerId,
                d.created_at AS createdAt
         FROM player_ability_ownership AS o
         INNER JOIN ability_definitions AS d
           ON d.ability_id = o.ability_id
         WHERE o.player_id = ?
         ORDER BY o.ability_id ASC`
      )
      .all(accountId) as Array<{
      abilityId: number;
      name: string;
      abilityType: string;
      tier: number;
      coreExampleStat: number;
      exampleUpsideEnabled: number;
      exampleDownsideEnabled: number;
      createdByPlayerId: number;
      createdAt: number;
    }>;

    const records: PersistedAbilityDefinitionRecord[] = [];
    for (const row of rows) {
      const type = this.parseAbilityCreatorType(row.abilityType);
      if (!type) {
        continue;
      }
      records.push({
        abilityId: this.clampInteger(row.abilityId, 0, 0xffff),
        name: this.sanitizeAbilityName(row.name),
        type,
        tier: this.clampInteger(row.tier, ABILITY_CREATOR_MIN_TIER, ABILITY_CREATOR_MAX_TIER),
        coreExampleStat: Math.max(0, this.clampInteger(row.coreExampleStat, 0, 0xff)),
        exampleUpsideEnabled: row.exampleUpsideEnabled !== 0,
        exampleDownsideEnabled: row.exampleDownsideEnabled !== 0,
        createdByPlayerId: Math.max(1, this.clampInteger(row.createdByPlayerId, 1, 0x7fffffff)),
        createdAt: Math.max(0, this.clampInteger(row.createdAt, 0, Number.MAX_SAFE_INTEGER))
      });
    }
    return records;
  }

  public createOwnedAbility(request: CreateOwnedAbilityRequest): CreateOwnedAbilityResult {
    if (this.disablePersistenceWrites) {
      return {
        ok: false,
        error: "Ability creation requires persistence writes to be enabled."
      };
    }
    const playerId = Math.max(1, this.clampInteger(request.accountId, 1, 0x7fffffff));
    const normalizedName = this.sanitizeAbilityName(request.name);
    const normalizedType = this.parseAbilityCreatorType(request.type);
    if (!normalizedType) {
      return {
        ok: false,
        error: "Invalid ability type."
      };
    }
    const normalizedTier = this.clampInteger(request.tier, ABILITY_CREATOR_MIN_TIER, ABILITY_CREATOR_MAX_TIER);
    const normalizedCoreExampleStat = Math.max(0, this.clampInteger(request.coreExampleStat, 0, 0xff));
    const normalizedExampleUpsideEnabled = Boolean(request.exampleUpsideEnabled);
    const normalizedExampleDownsideEnabled = Boolean(request.exampleDownsideEnabled);
    const normalizedTemplateAbilityId =
      request.templateAbilityId === null
        ? null
        : this.clampInteger(request.templateAbilityId, 0, 0xffff);
    const maxAbilities = this.clampInteger(
      request.maxAbilities,
      1,
      ABILITY_CREATOR_MAX_ABILITIES
    );
    if (normalizedName.length < 3) {
      return {
        ok: false,
        error: "Ability name must be at least 3 characters."
      };
    }

    try {
      const tx = this.db.transaction((params: {
        playerId: number;
        name: string;
        type: AbilityCreatorType;
        tier: number;
        coreExampleStat: number;
        exampleUpsideEnabled: boolean;
        exampleDownsideEnabled: boolean;
        templateAbilityId: number | null;
        maxAbilities: number;
      }): CreateOwnedAbilityResult => {
        const ownedRows = this.db
          .prepare(
            `SELECT ability_id AS abilityId
             FROM player_ability_ownership
             WHERE player_id = ?`
          )
          .all(params.playerId) as Array<{ abilityId: number }>;
        const ownedSet = new Set<number>(
          ownedRows
            .map((row) => this.clampInteger(row.abilityId, 0, 0xffff))
            .filter((abilityId) => abilityId > ABILITY_ID_NONE)
        );

        if (params.templateAbilityId !== null && !ownedSet.has(params.templateAbilityId)) {
          return {
            ok: false,
            error: "Template ability is not owned by this player."
          };
        }
        if (params.templateAbilityId === null && ownedSet.size >= params.maxAbilities) {
          return {
            ok: false,
            error: `Ability limit reached (${params.maxAbilities}/${params.maxAbilities}).`
          };
        }

        const maxRow = this.db
          .prepare("SELECT MAX(ability_id) AS maxAbilityId FROM ability_definitions")
          .get() as { maxAbilityId: number | null };
        const maxAbilityId = maxRow?.maxAbilityId ?? ABILITY_DYNAMIC_ID_START - 1;
        if (maxAbilityId >= 0xffff) {
          return {
            ok: false,
            error: "No more ability ids are available."
          };
        }
        const nextAbilityId = Math.max(
          ABILITY_DYNAMIC_ID_START,
          this.clampInteger(maxAbilityId + 1, 0, 0xffff)
        );

        const now = Date.now();
        this.db
          .prepare(
            `INSERT INTO ability_definitions (
               ability_id, name, ability_type, tier, core_example_stat,
               example_upside_enabled, example_downside_enabled, created_by_player_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            nextAbilityId,
            params.name,
            params.type,
            params.tier,
            params.coreExampleStat,
            params.exampleUpsideEnabled ? 1 : 0,
            params.exampleDownsideEnabled ? 1 : 0,
            params.playerId,
            now
          );

        this.db
          .prepare(
            `INSERT OR REPLACE INTO player_ability_ownership (
               player_id, ability_id, unlocked_at
             ) VALUES (?, ?, ?)`
          )
          .run(params.playerId, nextAbilityId, now);

        if (params.templateAbilityId !== null) {
          this.db
            .prepare(
              `DELETE FROM player_ability_ownership
               WHERE player_id = ? AND ability_id = ?`
            )
            .run(params.playerId, params.templateAbilityId);
        }

        const ownedAfterRows = this.db
          .prepare(
            `SELECT ability_id AS abilityId
             FROM player_ability_ownership
             WHERE player_id = ?
             ORDER BY ability_id ASC`
          )
          .all(params.playerId) as Array<{ abilityId: number }>;
        const ownedAbilityIds = ownedAfterRows
          .map((row) => this.clampInteger(row.abilityId, 0, 0xffff))
          .filter((abilityId) => abilityId > ABILITY_ID_NONE);

        return {
          ok: true,
          ability: {
            abilityId: nextAbilityId,
            name: params.name,
            type: params.type,
            tier: params.tier,
            coreExampleStat: params.coreExampleStat,
            exampleUpsideEnabled: params.exampleUpsideEnabled,
            exampleDownsideEnabled: params.exampleDownsideEnabled,
            createdByPlayerId: params.playerId,
            createdAt: now
          },
          replacedAbilityId: params.templateAbilityId,
          ownedAbilityIds
        };
      });

      return tx({
        playerId,
        name: normalizedName,
        type: normalizedType,
        tier: normalizedTier,
        coreExampleStat: normalizedCoreExampleStat,
        exampleUpsideEnabled: normalizedExampleUpsideEnabled,
        exampleDownsideEnabled: normalizedExampleDownsideEnabled,
        templateAbilityId: normalizedTemplateAbilityId && normalizedTemplateAbilityId > 0 ? normalizedTemplateAbilityId : null,
        maxAbilities
      });
    } catch (error) {
      console.error("[persist] createOwnedAbility failed", error);
      return {
        ok: false,
        error: "Failed to create ability."
      };
    }
  }

  public forgetOwnedAbility(request: ForgetOwnedAbilityRequest): ForgetOwnedAbilityResult {
    if (this.disablePersistenceWrites) {
      return {
        ok: false,
        error: "Ability forgetting requires persistence writes to be enabled."
      };
    }

    const playerId = Math.max(1, this.clampInteger(request.accountId, 1, 0x7fffffff));
    const abilityId = this.clampInteger(request.abilityId, 0, 0xffff);
    if (abilityId <= ABILITY_ID_NONE) {
      return {
        ok: false,
        error: "Invalid ability id."
      };
    }

    try {
      const tx = this.db.transaction((params: {
        playerId: number;
        abilityId: number;
      }): ForgetOwnedAbilityResult => {
        const ownedRow = this.db
          .prepare(
            `SELECT 1 AS found
             FROM player_ability_ownership
             WHERE player_id = ? AND ability_id = ?
             LIMIT 1`
          )
          .get(params.playerId, params.abilityId) as { found: number } | undefined;
        if (!ownedRow) {
          return {
            ok: false,
            error: "Ability is not owned by this player."
          };
        }

        this.db
          .prepare(
            `DELETE FROM player_ability_ownership
             WHERE player_id = ? AND ability_id = ?`
          )
          .run(params.playerId, params.abilityId);

        this.db
          .prepare(
            `DELETE FROM player_loadout_slots
             WHERE player_id = ? AND ability_id = ?`
          )
          .run(params.playerId, params.abilityId);

        const ownedAfterRows = this.db
          .prepare(
            `SELECT ability_id AS abilityId
             FROM player_ability_ownership
             WHERE player_id = ?
             ORDER BY ability_id ASC`
          )
          .all(params.playerId) as Array<{ abilityId: number }>;
        const ownedAbilityIds = ownedAfterRows
          .map((row) => this.clampInteger(row.abilityId, 0, 0xffff))
          .filter((ownedAbilityId) => ownedAbilityId > ABILITY_ID_NONE);

        return {
          ok: true,
          ownedAbilityIds
        };
      });

      return tx({
        playerId,
        abilityId
      });
    } catch (error) {
      console.error("[persist] forgetOwnedAbility failed", error);
      return {
        ok: false,
        error: "Failed to forget ability."
      };
    }
  }

  public savePlayerSnapshot(snapshot: PlayerSnapshot): void {
    this.saveCharacterSnapshot(snapshot);
    this.saveAbilityStateSnapshot(snapshot);
  }

  public saveCharacterSnapshot(snapshot: PlayerSnapshot): void {
    if (this.disablePersistenceWrites) {
      return;
    }
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO characters (
            player_id, x, y, z, yaw, pitch, vx, vy, vz, health,
            active_hotbar_slot, primary_mouse_slot, secondary_mouse_slot, updated_at, schema_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET
           x=excluded.x,
           y=excluded.y,
           z=excluded.z,
           yaw=excluded.yaw,
           pitch=excluded.pitch,
           vx=excluded.vx,
           vy=excluded.vy,
           vz=excluded.vz,
           health=excluded.health,
           active_hotbar_slot=excluded.active_hotbar_slot,
           primary_mouse_slot=excluded.primary_mouse_slot,
           secondary_mouse_slot=excluded.secondary_mouse_slot,
           updated_at=excluded.updated_at,
           schema_version=excluded.schema_version`
      )
      .run(
        snapshot.accountId,
        snapshot.x,
        snapshot.y,
        snapshot.z,
        snapshot.yaw,
        snapshot.pitch,
        snapshot.vx,
        snapshot.vy,
        snapshot.vz,
        this.clampInteger(snapshot.health, 0, PLAYER_MAX_HEALTH),
        this.clampInteger(snapshot.primaryMouseSlot, 0, HOTBAR_SLOT_COUNT - 1),
        this.clampInteger(snapshot.primaryMouseSlot, 0, HOTBAR_SLOT_COUNT - 1),
        this.clampInteger(snapshot.secondaryMouseSlot, 0, HOTBAR_SLOT_COUNT - 1),
        now,
        CHARACTER_SCHEMA_VERSION
      );
  }

  public saveAbilityStateSnapshot(snapshot: PlayerSnapshot): void {
    if (this.disablePersistenceWrites) {
      return;
    }
    const tx = this.db.transaction((state: PlayerSnapshot) => {
      this.db
        .prepare("DELETE FROM player_loadout_slots WHERE player_id = ?")
        .run(state.accountId);
      const insertSlot = this.db.prepare(
        `INSERT INTO player_loadout_slots (player_id, slot_index, ability_id)
         VALUES (?, ?, ?)`
      );
      for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
        const abilityId = state.hotbarAbilityIds[slot] ?? ABILITY_ID_NONE;
        insertSlot.run(state.accountId, slot, Math.max(ABILITY_ID_NONE, Math.floor(abilityId)));
      }
    });

    tx(snapshot);
  }

  public saveCriticalEvent(record: CriticalEventRecord): void {
    if (this.disablePersistenceWrites) {
      return;
    }
    this.db
      .prepare(
        `INSERT INTO critical_events (event_id, instance_id, account_id, event_type, event_payload_json, event_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO NOTHING`
      )
      .run(
        record.eventId,
        record.instanceId,
        Math.max(1, this.clampInteger(record.accountId, 1, 0x7fffffff)),
        record.eventType,
        record.eventPayloadJson,
        Math.max(0, this.clampInteger(record.eventAtMs, 0, Number.MAX_SAFE_INTEGER))
      );
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        account_id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_fingerprint TEXT NOT NULL UNIQUE,
        key_salt BLOB NOT NULL,
        key_hash BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS characters (
        player_id INTEGER PRIMARY KEY,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        yaw REAL NOT NULL,
        pitch REAL NOT NULL,
        vx REAL NOT NULL,
        vy REAL NOT NULL,
        vz REAL NOT NULL,
        health INTEGER NOT NULL,
        active_hotbar_slot INTEGER NOT NULL DEFAULT 0,
        primary_mouse_slot INTEGER NOT NULL DEFAULT 0,
        secondary_mouse_slot INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        FOREIGN KEY(player_id) REFERENCES players(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS player_loadout_slots (
        player_id INTEGER NOT NULL,
        slot_index INTEGER NOT NULL,
        ability_id INTEGER NOT NULL,
        PRIMARY KEY (player_id, slot_index),
        FOREIGN KEY(player_id) REFERENCES players(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ability_definitions (
        ability_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        ability_type TEXT NOT NULL,
        tier INTEGER NOT NULL,
        core_example_stat INTEGER NOT NULL,
        example_upside_enabled INTEGER NOT NULL DEFAULT 0,
        example_downside_enabled INTEGER NOT NULL DEFAULT 0,
        created_by_player_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS player_ability_ownership (
        player_id INTEGER NOT NULL,
        ability_id INTEGER NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, ability_id),
        FOREIGN KEY(player_id) REFERENCES players(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS auth_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        remote_ip TEXT NOT NULL,
        result TEXT NOT NULL,
        reason TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS critical_events (
        event_id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_payload_json TEXT NOT NULL,
        event_at_ms INTEGER NOT NULL
      );
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_player_ability_ownership_player_id ON player_ability_ownership(player_id)"
    );
    this.ensureCharacterColumn("active_hotbar_slot", "INTEGER NOT NULL DEFAULT 0");
    this.ensureCharacterColumn("primary_mouse_slot", "INTEGER NOT NULL DEFAULT 0");
    this.ensureCharacterColumn("secondary_mouse_slot", "INTEGER NOT NULL DEFAULT 1");
    this.ensureAbilityDefinitionColumn("example_upside_enabled", "INTEGER NOT NULL DEFAULT 0");
    this.ensureAbilityDefinitionColumn("example_downside_enabled", "INTEGER NOT NULL DEFAULT 0");
    this.migrateLegacyExampleAttributeColumn();
  }

  private ensureCharacterColumn(columnName: string, columnTypeSql: string): void {
    const existing = this.db
      .prepare("SELECT 1 FROM pragma_table_info('characters') WHERE name = ? LIMIT 1")
      .get(columnName) as { 1: number } | undefined;
    if (existing) {
      return;
    }
    this.db.exec(`ALTER TABLE characters ADD COLUMN ${columnName} ${columnTypeSql}`);
  }

  private ensureAbilityDefinitionColumn(columnName: string, columnTypeSql: string): void {
    const existing = this.db
      .prepare("SELECT 1 FROM pragma_table_info('ability_definitions') WHERE name = ? LIMIT 1")
      .get(columnName) as { 1: number } | undefined;
    if (existing) {
      return;
    }
    this.db.exec(`ALTER TABLE ability_definitions ADD COLUMN ${columnName} ${columnTypeSql}`);
  }

  private hasAbilityDefinitionColumn(columnName: string): boolean {
    const existing = this.db
      .prepare("SELECT 1 FROM pragma_table_info('ability_definitions') WHERE name = ? LIMIT 1")
      .get(columnName) as { 1: number } | undefined;
    return Boolean(existing);
  }

  private migrateLegacyExampleAttributeColumn(): void {
    if (!this.hasAbilityDefinitionColumn("example_attribute_enabled")) {
      return;
    }
    this.db.exec(`
      UPDATE ability_definitions
      SET example_upside_enabled = example_attribute_enabled
      WHERE example_upside_enabled = 0 AND example_attribute_enabled != 0
    `);
  }

  private createPlayer(keyFingerprint: string, keySalt: Buffer, keyHash: Buffer, now: number): number {
    const result = this.db
      .prepare(
        `INSERT INTO players (key_fingerprint, key_salt, key_hash, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(keyFingerprint, keySalt, keyHash, now, now);
    return Number(result.lastInsertRowid);
  }

  private computeKeyFingerprint(accessKey: string): string {
    return createHash("sha256").update(accessKey).digest("hex");
  }

  private deriveKeyHash(accessKey: string, salt: Buffer): Buffer {
    return scryptSync(accessKey, salt, KEY_SCRYPT_BYTES) as Buffer;
  }

  private evaluateThrottle(
    remoteIp: string,
    keyFingerprint: string,
    now: number
  ): { allowed: true } | { allowed: false; reason: "rate_limited" | "banned"; retryAfterMs: number } {
    if (this.disableRateLimit) {
      return { allowed: true };
    }

    const failureState = this.failureStateByIp.get(remoteIp);
    if (failureState) {
      if (failureState.bannedUntilMs > now) {
        return {
          allowed: false,
          reason: "banned",
          retryAfterMs: failureState.bannedUntilMs - now
        };
      }
      if (failureState.backoffUntilMs > now) {
        return {
          allowed: false,
          reason: "rate_limited",
          retryAfterMs: failureState.backoffUntilMs - now
        };
      }
    }

    const ipBucket = this.getOrCreateBucket(this.ipBuckets, remoteIp, IP_BUCKET_CAPACITY, now);
    if (!this.tryConsumeToken(ipBucket, IP_BUCKET_CAPACITY, IP_BUCKET_REFILL_PER_MS, now)) {
      return {
        allowed: false,
        reason: "rate_limited",
        retryAfterMs: this.estimateTokenRetryMs(ipBucket, IP_BUCKET_CAPACITY, IP_BUCKET_REFILL_PER_MS, now)
      };
    }

    const keyBucket = this.getOrCreateBucket(this.keyBuckets, keyFingerprint, KEY_BUCKET_CAPACITY, now);
    if (!this.tryConsumeToken(keyBucket, KEY_BUCKET_CAPACITY, KEY_BUCKET_REFILL_PER_MS, now)) {
      return {
        allowed: false,
        reason: "rate_limited",
        retryAfterMs: this.estimateTokenRetryMs(keyBucket, KEY_BUCKET_CAPACITY, KEY_BUCKET_REFILL_PER_MS, now)
      };
    }

    return { allowed: true };
  }

  private markAuthFailure(remoteIp: string, now: number): number {
    const current = this.failureStateByIp.get(remoteIp);
    const state: FailureState = current
      ? { ...current }
      : {
          windowStartMs: now,
          failuresInWindow: 0,
          backoffUntilMs: now,
          bannedUntilMs: now
        };

    if (now - state.windowStartMs > FAILURE_WINDOW_MS) {
      state.windowStartMs = now;
      state.failuresInWindow = 0;
    }
    state.failuresInWindow += 1;

    const exponent = Math.min(8, state.failuresInWindow);
    const backoffMs = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, exponent));
    state.backoffUntilMs = now + backoffMs;

    if (state.failuresInWindow >= TEMP_BAN_THRESHOLD) {
      state.bannedUntilMs = now + TEMP_BAN_DURATION_MS;
    }

    this.failureStateByIp.set(remoteIp, state);
    return Math.max(state.backoffUntilMs, state.bannedUntilMs) - now;
  }

  private markAuthSuccess(remoteIp: string): void {
    this.failureStateByIp.delete(remoteIp);
  }

  private appendAuthAudit(remoteIp: string, result: string, reason: string): void {
    if (this.disablePersistenceWrites) {
      return;
    }
    this.db
      .prepare(
        `INSERT INTO auth_audit_log (ts, remote_ip, result, reason)
         VALUES (?, ?, ?, ?)`
      )
      .run(Date.now(), remoteIp, result, reason);
  }

  private getOrCreateBucket(
    source: Map<string, TokenBucketState>,
    key: string,
    capacity: number,
    now: number
  ): TokenBucketState {
    let bucket = source.get(key);
    if (!bucket) {
      bucket = {
        tokens: capacity,
        lastRefillMs: now
      };
      source.set(key, bucket);
    }
    return bucket;
  }

  private tryConsumeToken(
    bucket: TokenBucketState,
    capacity: number,
    refillPerMs: number,
    now: number
  ): boolean {
    this.refillBucket(bucket, capacity, refillPerMs, now);
    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }

  private estimateTokenRetryMs(
    bucket: TokenBucketState,
    capacity: number,
    refillPerMs: number,
    now: number
  ): number {
    this.refillBucket(bucket, capacity, refillPerMs, now);
    if (bucket.tokens >= 1) {
      return 0;
    }
    if (refillPerMs <= 0) {
      return 1000;
    }
    return Math.ceil((1 - bucket.tokens) / refillPerMs);
  }

  private refillBucket(
    bucket: TokenBucketState,
    capacity: number,
    refillPerMs: number,
    now: number
  ): void {
    if (now <= bucket.lastRefillMs) {
      return;
    }
    const elapsed = now - bucket.lastRefillMs;
    bucket.lastRefillMs = now;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
  }

  private normalizeRemoteIp(remoteIpRaw: unknown): string {
    const value = typeof remoteIpRaw === "string" ? remoteIpRaw.trim() : "";
    return value.length > 0 ? value : "unknown";
  }

  private parseAbilityCreatorType(rawType: unknown): AbilityCreatorType | null {
    if (
      rawType === "melee" ||
      rawType === "projectile" ||
      rawType === "beam" ||
      rawType === "aoe" ||
      rawType === "buff" ||
      rawType === "movement"
    ) {
      return rawType;
    }
    return null;
  }

  private sanitizeAbilityName(rawName: string): string {
    const source = typeof rawName === "string" ? rawName : "";
    return source.replace(/\s+/g, " ").trim().slice(0, 24);
  }

  private clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, Math.floor(value)));
  }
}
