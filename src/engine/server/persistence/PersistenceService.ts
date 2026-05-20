/**
 * Purpose: This file loads/saves persistent data through the persistence pipeline.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  ABILITY_ID_NONE,
  DEFAULT_HOTBAR_ABILITY_IDS,
  HOTBAR_SLOT_COUNT,
  INVENTORY_MAX_SLOTS,
  PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_SETTINGS,
  coercePlayerSettings,
  type PlayerSettings,
  coerceBlueprintDefinition,
  type BlueprintAccessTag,
  type BlueprintDefinition,
  type EquipmentSlot,
  type InventorySnapshot,
  type PickupPersistencePolicy
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

export interface PlayerSnapshotBatchEntry {
  snapshot: PlayerSnapshot;
  saveCharacter: boolean;
  saveAbilityState: boolean;
  saveSettings?: boolean;
  settings?: PlayerSettings | null;
}

export type PersistedInventoryState = InventorySnapshot;

export interface PersistedPickupState {
  pickupId: number;
  definitionId: number;
  modelId: number;
  quantity: number;
  persistencePolicy: PickupPersistencePolicy;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number; w: number };
}

export type PersistedPlayerSettings = PlayerSettings;

export interface SaveBlueprintAndGrantAccessRequest {
  blueprint: BlueprintDefinition;
  createdByAccountId: number;
  grantAccessTags: readonly BlueprintAccessTag[];
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

  public loadAccessibleBlueprintIds(
    accountId: number,
    accessTag: BlueprintAccessTag,
    defaultBlueprintIds: ReadonlyArray<number>
  ): number[] {
    if (this.disablePersistenceWrites || accountId >= GUEST_ACCOUNT_ID_BASE) {
      return Array.from(
        new Set(
          defaultBlueprintIds
            .map((blueprintId) => this.clampInteger(blueprintId, 0, 0xffff))
            .filter((blueprintId) => blueprintId > ABILITY_ID_NONE)
        )
      ).sort((a, b) => a - b);
    }

    const tx = this.db.transaction((characterId: number, tag: BlueprintAccessTag, defaults: ReadonlyArray<number>) => {
      const rows = this.db
        .prepare(
          `SELECT blueprint_id AS blueprintId
           FROM character_blueprint_access
           WHERE character_id = ? AND access_tag = ?
           ORDER BY blueprint_id ASC`
        )
        .all(characterId, tag) as Array<{ blueprintId: number }>;
      if (rows.length > 0) {
        return rows
          .map((row) => this.clampInteger(row.blueprintId, 0, 0xffff))
          .filter((blueprintId) => blueprintId > ABILITY_ID_NONE);
      }

      const defaultsNormalized = Array.from(
        new Set(
          defaults
            .map((blueprintId) => this.clampInteger(blueprintId, 0, 0xffff))
            .filter((blueprintId) => blueprintId > ABILITY_ID_NONE)
        )
      ).sort((a, b) => a - b);
      const insertAccess = this.db.prepare(
        `INSERT INTO character_blueprint_access (
           character_id, blueprint_id, access_tag, granted_at, granted_by_character_id
         ) VALUES (?, ?, ?, ?, NULL)`
      );
      const now = Date.now();
      for (const blueprintId of defaultsNormalized) {
        insertAccess.run(characterId, blueprintId, tag, now);
      }
      return defaultsNormalized;
    });

    return tx(accountId, accessTag, defaultBlueprintIds);
  }

  public loadPersistedBlueprintDefinitions(
    blueprintIds: ReadonlyArray<number>
  ): BlueprintDefinition[] {
    if (this.disablePersistenceWrites || blueprintIds.length === 0) {
      return [];
    }
    const normalizedIds = Array.from(
      new Set(
        blueprintIds
          .map((blueprintId) => this.clampInteger(blueprintId, 1, 0xffff))
          .filter((blueprintId) => blueprintId > 0)
      )
    ).sort((a, b) => a - b);
    if (normalizedIds.length === 0) {
      return [];
    }
    const placeholders = normalizedIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT blueprint_id AS blueprintId, blueprint_json AS blueprintJson
         FROM blueprints
         WHERE archived = 0 AND blueprint_id IN (${placeholders})
         ORDER BY blueprint_id ASC`
      )
      .all(...normalizedIds) as Array<{ blueprintId: number; blueprintJson: string }>;
    const blueprints: BlueprintDefinition[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.blueprintJson) as unknown;
        blueprints.push(coerceBlueprintDefinition(parsed, `persistedBlueprint(${row.blueprintId})`));
      } catch (error) {
        console.warn("[persist] failed to parse blueprint", row.blueprintId, error);
      }
    }
    return blueprints;
  }

  public saveBlueprintAndGrantAccess(request: SaveBlueprintAndGrantAccessRequest): void {
    if (this.disablePersistenceWrites || request.createdByAccountId >= GUEST_ACCOUNT_ID_BASE) {
      return;
    }
    const characterId = Math.max(1, this.clampInteger(request.createdByAccountId, 1, 0x7fffffff));
    const blueprintId = this.clampInteger(request.blueprint.id, 1, 0xffff);
    const blueprintJson = JSON.stringify(request.blueprint);
    const authoredViaProfile = typeof request.blueprint.metadata?.authoredViaProfile === "string"
      ? request.blueprint.metadata.authoredViaProfile
      : null;
    const accessTags = Array.from(new Set(request.grantAccessTags)).filter(
      (tag): tag is BlueprintAccessTag => typeof tag === "string" && tag.length > 0
    );
    const tx = this.db.transaction(() => {
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO blueprints (
             blueprint_id, blueprint_json, authored_via_profile, created_by_player_id, created_at, updated_at, archived
           ) VALUES (?, ?, ?, ?, ?, ?, 0)`
        )
        .run(blueprintId, blueprintJson, authoredViaProfile, characterId, now, now);
      const insertAccess = this.db.prepare(
        `INSERT OR REPLACE INTO character_blueprint_access (
           character_id, blueprint_id, access_tag, granted_at, granted_by_character_id
         ) VALUES (?, ?, ?, ?, ?)`
      );
      for (const accessTag of accessTags) {
        insertAccess.run(characterId, blueprintId, accessTag, now, characterId);
      }
    });
    tx();
  }

  public revokeBlueprintAccess(
    accountId: number,
    blueprintId: number,
    accessTag: BlueprintAccessTag
  ): void {
    if (this.disablePersistenceWrites || accountId >= GUEST_ACCOUNT_ID_BASE) {
      return;
    }
    this.db
      .prepare(
        `DELETE FROM character_blueprint_access
         WHERE character_id = ? AND blueprint_id = ? AND access_tag = ?`
      )
      .run(
        Math.max(1, this.clampInteger(accountId, 1, 0x7fffffff)),
        this.clampInteger(blueprintId, 1, 0xffff),
        accessTag
      );
  }

  public loadInventoryState(accountId: number): PersistedInventoryState {
    if (this.disablePersistenceWrites || accountId >= GUEST_ACCOUNT_ID_BASE) {
      return {
        maxSlots: INVENTORY_MAX_SLOTS,
        itemInstances: [],
        equipment: {},
        hotbarSlots: []
      };
    }

    const itemRows = this.db
      .prepare(
        `SELECT item_instance_id AS itemInstanceId,
                archetype_id AS definitionId,
                quantity AS quantity,
                slot_index AS slotIndex
         FROM player_inventory_items
         WHERE player_id = ?
         ORDER BY slot_index ASC, item_instance_id ASC`
      )
      .all(accountId) as Array<{
      itemInstanceId: number;
      definitionId: number;
      quantity: number;
      slotIndex: number;
    }>;
    const equipmentRows = this.db
      .prepare(
        `SELECT equip_slot AS equipSlot,
                item_instance_id AS itemInstanceId
         FROM player_equipment_slots
         WHERE player_id = ?`
      )
      .all(accountId) as Array<{
      equipSlot: string;
      itemInstanceId: number;
    }>;
    const hotbarRows = this.db
      .prepare(
        `SELECT slot_index AS slotIndex,
                payload_kind AS payloadKind,
                ref_id AS refId
         FROM player_inventory_hotbar_slots
         WHERE player_id = ?
         ORDER BY slot_index ASC`
      )
      .all(accountId) as Array<{
      slotIndex: number;
      payloadKind: string;
      refId: number;
    }>;

    const equipment: Partial<Record<EquipmentSlot, number>> = {};
    for (const row of equipmentRows) {
      const slot = this.parseEquipmentSlot(row.equipSlot);
      if (!slot) {
        continue;
      }
      const itemInstanceId = this.clampInteger(row.itemInstanceId, 1, 0x7fffffff);
      if (itemInstanceId > 0) {
        equipment[slot] = itemInstanceId;
      }
    }

    const hotbarSlots: InventorySnapshot["hotbarSlots"] = [];
    for (const row of hotbarRows) {
      const slotIndex = this.clampInteger(row.slotIndex, 0, HOTBAR_SLOT_COUNT - 1);
      const kind = row.payloadKind === "item_instance" || row.payloadKind === "ability" || row.payloadKind === "action"
        ? row.payloadKind
        : null;
      const refId = this.clampInteger(row.refId, 1, 0x7fffffff);
      if (!kind || refId <= 0) {
        continue;
      }
      while (hotbarSlots.length <= slotIndex) {
        hotbarSlots.push(null);
      }
      hotbarSlots[slotIndex] = { kind, refId };
    }

    return {
      maxSlots: INVENTORY_MAX_SLOTS,
      itemInstances: itemRows
        .map((row) => ({
          itemInstanceId: this.clampInteger(row.itemInstanceId, 1, 0x7fffffff),
          definitionId: this.clampInteger(row.definitionId, 1, 0xffff),
          quantity: this.clampInteger(row.quantity, 1, 0xffff),
          slotIndex: this.clampInteger(row.slotIndex, 0, INVENTORY_MAX_SLOTS - 1)
        }))
        .filter((item) => item.itemInstanceId > 0 && item.definitionId > 0 && item.quantity > 0),
      equipment,
      hotbarSlots
    };
  }

  public loadPlayerSettings(accountId: number): PersistedPlayerSettings {
    if (this.disablePersistenceWrites || accountId >= GUEST_ACCOUNT_ID_BASE) {
      return { ...DEFAULT_PLAYER_SETTINGS };
    }
    const row = this.db
      .prepare(
        `SELECT settings_json AS settingsJson
         FROM player_settings
         WHERE player_id = ?`
      )
      .get(accountId) as { settingsJson: string } | undefined;
    if (!row || typeof row.settingsJson !== "string" || row.settingsJson.length === 0) {
      return { ...DEFAULT_PLAYER_SETTINGS };
    }
    try {
      return coercePlayerSettings(JSON.parse(row.settingsJson));
    } catch {
      return { ...DEFAULT_PLAYER_SETTINGS };
    }
  }

  public savePlayerSettings(accountId: number, settings: PlayerSettings): void {
    if (this.disablePersistenceWrites || accountId >= GUEST_ACCOUNT_ID_BASE) {
      return;
    }
    const normalized = coercePlayerSettings(settings);
    this.db
      .prepare(
        `INSERT INTO player_settings (player_id, settings_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET
           settings_json=excluded.settings_json,
           updated_at=excluded.updated_at`
      )
      .run(
        Math.max(1, this.clampInteger(accountId, 1, 0x7fffffff)),
        JSON.stringify(normalized),
        Date.now()
      );
  }

  public saveInventoryState(accountId: number, state: InventorySnapshot): void {
    if (this.disablePersistenceWrites || accountId >= GUEST_ACCOUNT_ID_BASE) {
      return;
    }
    const playerId = Math.max(1, this.clampInteger(accountId, 1, 0x7fffffff));
    const tx = this.db.transaction((snapshot: InventorySnapshot) => {
      const now = Date.now();
      this.db.prepare("DELETE FROM player_inventory_items WHERE player_id = ?").run(playerId);
      this.db.prepare("DELETE FROM player_equipment_slots WHERE player_id = ?").run(playerId);
      this.db.prepare("DELETE FROM player_inventory_hotbar_slots WHERE player_id = ?").run(playerId);
      const insertItem = this.db.prepare(
        `INSERT INTO player_inventory_items (
           player_id, item_instance_id, archetype_id, quantity, slot_index, custom_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of snapshot.itemInstances) {
        insertItem.run(
          playerId,
          this.clampInteger(item.itemInstanceId, 1, 0x7fffffff),
          this.clampInteger(item.definitionId, 1, 0xffff),
          this.clampInteger(item.quantity, 1, 0xffff),
          this.clampInteger(item.slotIndex, 0, INVENTORY_MAX_SLOTS - 1),
          "{}",
          now
        );
      }
      const liveItemIds = new Set(snapshot.itemInstances.map((item) => this.clampInteger(item.itemInstanceId, 1, 0x7fffffff)));
      const insertEquipment = this.db.prepare(
        `INSERT INTO player_equipment_slots (player_id, equip_slot, item_instance_id, updated_at)
         VALUES (?, ?, ?, ?)`
      );
      for (const [slot, rawItemInstanceId] of Object.entries(snapshot.equipment)) {
        const equipmentSlot = this.parseEquipmentSlot(slot);
        const itemInstanceId = this.clampInteger(Number(rawItemInstanceId), 1, 0x7fffffff);
        if (!equipmentSlot || !liveItemIds.has(itemInstanceId)) {
          continue;
        }
        insertEquipment.run(playerId, equipmentSlot, itemInstanceId, now);
      }
      const insertHotbarSlot = this.db.prepare(
        `INSERT INTO player_inventory_hotbar_slots (player_id, slot_index, payload_kind, ref_id, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      const hotbarSlots = Array.isArray(snapshot.hotbarSlots) ? snapshot.hotbarSlots : [];
      for (let slotIndex = 0; slotIndex < HOTBAR_SLOT_COUNT; slotIndex += 1) {
        const entry = hotbarSlots[slotIndex] ?? null;
        if (!entry) {
          continue;
        }
        const kind = entry.kind === "item_instance" || entry.kind === "ability" || entry.kind === "action"
          ? entry.kind
          : null;
        const refId = this.clampInteger(entry.refId, 1, 0x7fffffff);
        if (!kind || refId <= 0) {
          continue;
        }
        insertHotbarSlot.run(playerId, slotIndex, kind, refId, now);
      }
    });
    tx(state);
  }

  public loadNextInventoryItemInstanceId(): number {
    if (this.disablePersistenceWrites) {
      return 1;
    }
    const row = this.db
      .prepare("SELECT MAX(item_instance_id) AS maxItemInstanceId FROM player_inventory_items")
      .get() as { maxItemInstanceId: number | null };
    return Math.max(1, this.clampInteger((row.maxItemInstanceId ?? 0) + 1, 1, 0x7fffffff));
  }

  public loadPersistentPickups(instanceIdRaw: string): PersistedPickupState[] {
    if (this.disablePersistenceWrites) {
      return [];
    }
    const instanceId = this.normalizeInstanceId(instanceIdRaw);
    if (instanceId.length === 0) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT pickup_id AS pickupId,
                definition_id AS definitionId,
                model_id AS modelId,
                quantity AS quantity,
                persistence_policy AS persistencePolicy,
                x AS x,
                y AS y,
                z AS z,
                rotation_x AS rotationX,
                rotation_y AS rotationY,
                rotation_z AS rotationZ,
                rotation_w AS rotationW
         FROM world_pickups
         WHERE instance_id = ?
         ORDER BY pickup_id ASC`
      )
      .all(instanceId) as Array<{
      pickupId: number;
      definitionId: number;
      modelId: number;
      quantity: number;
      persistencePolicy: string;
      x: number;
      y: number;
      z: number;
      rotationX: number;
      rotationY: number;
      rotationZ: number;
      rotationW: number;
    }>;
    const pickups: PersistedPickupState[] = [];
    for (const row of rows) {
      const pickupId = this.clampInteger(row.pickupId, 1, 0x7fffffff);
      const definitionId = this.clampInteger(row.definitionId, 1, 0xffff);
      const quantity = this.clampInteger(row.quantity, 1, 0xffff);
      const persistencePolicy = this.parsePickupPersistencePolicy(row.persistencePolicy);
      if (pickupId <= 0 || definitionId <= 0 || quantity <= 0 || persistencePolicy !== "persistent") {
        continue;
      }
      pickups.push({
        pickupId,
        definitionId,
        modelId: this.clampInteger(row.modelId, 0, 0xffff),
        quantity,
        persistencePolicy,
        x: this.clampFiniteNumber(row.x),
        y: this.clampFiniteNumber(row.y),
        z: this.clampFiniteNumber(row.z),
        rotation: {
          x: this.clampFiniteNumber(row.rotationX),
          y: this.clampFiniteNumber(row.rotationY),
          z: this.clampFiniteNumber(row.rotationZ),
          w: this.clampFiniteNumber(row.rotationW, 1)
        }
      });
    }
    return pickups;
  }

  public savePersistentPickups(instanceIdRaw: string, pickups: readonly PersistedPickupState[]): void {
    if (this.disablePersistenceWrites) {
      return;
    }
    const instanceId = this.normalizeInstanceId(instanceIdRaw);
    if (instanceId.length === 0) {
      return;
    }
    const tx = this.db.transaction((targetInstanceId: string, snapshot: readonly PersistedPickupState[]) => {
      this.db.prepare("DELETE FROM world_pickups WHERE instance_id = ?").run(targetInstanceId);
      if (snapshot.length <= 0) {
        return;
      }
      const now = Date.now();
      const insertPickup = this.db.prepare(
        `INSERT INTO world_pickups (
           instance_id, pickup_id, definition_id, model_id, quantity, persistence_policy,
           x, y, z, rotation_x, rotation_y, rotation_z, rotation_w, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const pickup of snapshot) {
        const pickupId = this.clampInteger(pickup.pickupId, 1, 0x7fffffff);
        const definitionId = this.clampInteger(pickup.definitionId, 1, 0xffff);
        const quantity = this.clampInteger(pickup.quantity, 1, 0xffff);
        if (
          pickupId <= 0 ||
          definitionId <= 0 ||
          quantity <= 0 ||
          this.parsePickupPersistencePolicy(pickup.persistencePolicy) !== "persistent"
        ) {
          continue;
        }
        insertPickup.run(
          targetInstanceId,
          pickupId,
          definitionId,
          this.clampInteger(pickup.modelId, 0, 0xffff),
          quantity,
          "persistent",
          this.clampFiniteNumber(pickup.x),
          this.clampFiniteNumber(pickup.y),
          this.clampFiniteNumber(pickup.z),
          this.clampFiniteNumber(pickup.rotation.x),
          this.clampFiniteNumber(pickup.rotation.y),
          this.clampFiniteNumber(pickup.rotation.z),
          this.clampFiniteNumber(pickup.rotation.w, 1),
          now
        );
      }
    });
    tx(instanceId, pickups);
  }

  public savePlayerSnapshot(snapshot: PlayerSnapshot): void {
    this.saveCharacterSnapshot(snapshot);
    this.saveAbilityStateSnapshot(snapshot);
  }

  public savePlayerSnapshotBatch(entries: ReadonlyArray<PlayerSnapshotBatchEntry>): void {
    if (this.disablePersistenceWrites || entries.length === 0) {
      return;
    }
    const tx = this.db.transaction((batch: ReadonlyArray<PlayerSnapshotBatchEntry>) => {
      const now = Date.now();
      const upsertCharacter = this.db.prepare(
        `INSERT INTO characters (
            player_id, x, y, z, yaw, pitch, vx, vy, vz, health,
            primary_mouse_slot, secondary_mouse_slot, updated_at, schema_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           primary_mouse_slot=excluded.primary_mouse_slot,
           secondary_mouse_slot=excluded.secondary_mouse_slot,
           updated_at=excluded.updated_at,
           schema_version=excluded.schema_version`
      );
      const deleteLoadoutSlots = this.db.prepare("DELETE FROM player_loadout_slots WHERE player_id = ?");
      const insertLoadoutSlot = this.db.prepare(
        `INSERT INTO player_loadout_slots (player_id, slot_index, ability_id)
         VALUES (?, ?, ?)`
      );
      const upsertSettings = this.db.prepare(
        `INSERT INTO player_settings (player_id, settings_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET
           settings_json=excluded.settings_json,
           updated_at=excluded.updated_at`
      );
      for (const entry of batch) {
        const snapshot = entry.snapshot;
        if (entry.saveCharacter) {
          upsertCharacter.run(
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
            this.clampInteger(snapshot.secondaryMouseSlot, 0, HOTBAR_SLOT_COUNT - 1),
            now,
            CHARACTER_SCHEMA_VERSION
          );
        }
        if (entry.saveAbilityState) {
          deleteLoadoutSlots.run(snapshot.accountId);
          for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
            const abilityId = snapshot.hotbarAbilityIds[slot] ?? ABILITY_ID_NONE;
            insertLoadoutSlot.run(
              snapshot.accountId,
              slot,
              Math.max(ABILITY_ID_NONE, Math.floor(abilityId))
            );
          }
        }
        if (entry.saveSettings) {
          const settings = coercePlayerSettings(entry.settings);
          upsertSettings.run(snapshot.accountId, JSON.stringify(settings), now);
        }
      }
    });
    tx(entries);
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
            primary_mouse_slot, secondary_mouse_slot, updated_at, schema_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      CREATE TABLE IF NOT EXISTS blueprints (
        blueprint_id INTEGER PRIMARY KEY,
        blueprint_json TEXT NOT NULL,
        authored_via_profile TEXT,
        created_by_player_id INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(created_by_player_id) REFERENCES players(account_id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS character_blueprint_access (
        character_id INTEGER NOT NULL,
        blueprint_id INTEGER NOT NULL,
        access_tag TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        granted_by_character_id INTEGER,
        PRIMARY KEY (character_id, blueprint_id, access_tag),
        FOREIGN KEY(character_id) REFERENCES players(account_id) ON DELETE CASCADE,
        FOREIGN KEY(granted_by_character_id) REFERENCES players(account_id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS player_inventory_items (
        player_id INTEGER NOT NULL,
        item_instance_id INTEGER NOT NULL,
        archetype_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        slot_index INTEGER NOT NULL,
        custom_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, item_instance_id),
        FOREIGN KEY(player_id) REFERENCES players(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS player_equipment_slots (
        player_id INTEGER NOT NULL,
        equip_slot TEXT NOT NULL,
        item_instance_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, equip_slot),
        FOREIGN KEY(player_id) REFERENCES players(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS player_inventory_hotbar_slots (
        player_id INTEGER NOT NULL,
        slot_index INTEGER NOT NULL,
        payload_kind TEXT NOT NULL,
        ref_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, slot_index),
        FOREIGN KEY(player_id) REFERENCES players(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS world_pickups (
        instance_id TEXT NOT NULL,
        pickup_id INTEGER NOT NULL,
        definition_id INTEGER NOT NULL,
        model_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        persistence_policy TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        rotation_x REAL NOT NULL,
        rotation_y REAL NOT NULL,
        rotation_z REAL NOT NULL,
        rotation_w REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (instance_id, pickup_id)
      );

      CREATE TABLE IF NOT EXISTS player_settings (
        player_id INTEGER PRIMARY KEY,
        settings_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
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
      "CREATE INDEX IF NOT EXISTS idx_character_blueprint_access_character_tag ON character_blueprint_access(character_id, access_tag)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_blueprints_archived ON blueprints(archived, blueprint_id)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_player_inventory_items_player_id ON player_inventory_items(player_id)"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_world_pickups_instance_id ON world_pickups(instance_id)"
    );
    this.ensureCharacterColumn("active_hotbar_slot", "INTEGER NOT NULL DEFAULT 0");
    this.ensureCharacterColumn("primary_mouse_slot", "INTEGER NOT NULL DEFAULT 0");
    this.ensureCharacterColumn("secondary_mouse_slot", "INTEGER NOT NULL DEFAULT 1");
    this.migrateLegacyAbilityAccessToBlueprintAccess();
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

  private migrateLegacyAbilityAccessToBlueprintAccess(): void {
    if (!this.hasTable("player_ability_ownership")) {
      return;
    }
    this.db.exec(`
      INSERT OR IGNORE INTO character_blueprint_access (
        character_id, blueprint_id, access_tag, granted_at, granted_by_character_id
      )
      SELECT player_id, ability_id, 'ability.use', unlocked_at, NULL
      FROM player_ability_ownership
    `);
    this.db.exec(`
      INSERT OR IGNORE INTO character_blueprint_access (
        character_id, blueprint_id, access_tag, granted_at, granted_by_character_id
      )
      SELECT player_id, ability_id, 'blueprint.template', unlocked_at, NULL
      FROM player_ability_ownership
    `);
  }

  private hasTable(tableName: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found
         FROM sqlite_master
         WHERE type = 'table' AND name = ?
         LIMIT 1`
      )
      .get(tableName) as { found: number } | undefined;
    return Boolean(row?.found);
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

  private normalizeInstanceId(instanceIdRaw: unknown): string {
    const value = typeof instanceIdRaw === "string" ? instanceIdRaw.trim() : "";
    if (value.length <= 0) {
      return "";
    }
    return value.slice(0, 96);
  }

  private parseEquipmentSlot(rawSlot: unknown): EquipmentSlot | null {
    if (
      rawSlot === "weapon" ||
      rawSlot === "head" ||
      rawSlot === "body" ||
      rawSlot === "legs" ||
      rawSlot === "accessory"
    ) {
      return rawSlot;
    }
    return null;
  }

  private parsePickupPersistencePolicy(rawPolicy: unknown): PickupPersistencePolicy {
    return rawPolicy === "persistent" ? "persistent" : "transient_runtime";
  }

  private clampFiniteNumber(value: number, fallback = 0): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return value;
  }

  private clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, Math.floor(value)));
  }
}


