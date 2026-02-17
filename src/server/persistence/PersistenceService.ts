import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  ABILITY_ID_NONE,
  DEFAULT_HOTBAR_ABILITY_IDS,
  HOTBAR_SLOT_COUNT,
  PLAYER_MAX_HEALTH
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
  activeHotbarSlot: number;
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
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
}

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

  public constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
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
    const character = this.db
      .prepare(
        `SELECT x, y, z, yaw, pitch, vx, vy, vz, health, active_hotbar_slot AS activeHotbarSlot
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
          activeHotbarSlot: number;
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
      activeHotbarSlot: this.clampInteger(character?.activeHotbarSlot ?? 0, 0, HOTBAR_SLOT_COUNT - 1),
      hotbarAbilityIds: hotbar
    };
  }

  public savePlayerSnapshot(snapshot: PlayerSnapshot): void {
    this.saveCharacterSnapshot(snapshot);
    this.saveAbilityStateSnapshot(snapshot);
  }

  public saveCharacterSnapshot(snapshot: PlayerSnapshot): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO characters (
            player_id, x, y, z, yaw, pitch, vx, vy, vz, health, active_hotbar_slot, updated_at, schema_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        this.clampInteger(snapshot.activeHotbarSlot, 0, HOTBAR_SLOT_COUNT - 1),
        now,
        CHARACTER_SCHEMA_VERSION
      );
  }

  public saveAbilityStateSnapshot(snapshot: PlayerSnapshot): void {
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
        active_hotbar_slot INTEGER NOT NULL,
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

      CREATE TABLE IF NOT EXISTS auth_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        remote_ip TEXT NOT NULL,
        result TEXT NOT NULL,
        reason TEXT NOT NULL
      );
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

  private clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, Math.floor(value)));
  }
}
