/**
 * Purpose: This file handles player/session lifecycle transitions.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { PHYSICS_GROUP_CHARACTER } from "../../shared/index";
import type { PlayerSnapshot } from "../persistence/PersistenceService";

export interface LifecycleUser {
  id: number;
  queueMessage: (message: unknown) => void;
  accountId?: number;
  view?: { x: number; y: number; z: number; halfWidth: number; halfHeight: number; halfDepth: number };
  farView?: { x: number; y: number; z: number; halfWidth: number; halfHeight: number; halfDepth: number };
}

export interface PlayerSpawnContext {
  accountId: number;
  spawnX: number;
  spawnZ: number;
  initialBodyY: number;
  initialCameraY: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  health: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: number[];
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface PlayerLifecycleSystemOptions<TUser extends LifecycleUser> {
  readonly world: RAPIER.World;
  readonly globalChannel: { subscribe(user: TUser): void };
  readonly nearChannel: { subscribe(user: TUser, view: TUser["view"]): void };
  readonly farChannel: { subscribe(user: TUser, view: TUser["farView"]): void };
  readonly createUserView: (position: { x: number; y: number; z: number; halfWidth: number; halfHeight: number; halfDepth: number }) => NonNullable<TUser["view"]>;
  readonly usersById: Map<number, TUser>;
  readonly getSpawnPosition: () => { x: number; z: number };
  readonly getSpawnBodyY: (x: number, z: number) => number;
  readonly playerBodyCenterHeight: number;
  readonly playerCameraOffsetY: number;
  readonly playerCapsuleHalfHeight: number;
  readonly playerCapsuleRadius: number;
  readonly maxPlayerHealth: number;
  readonly defaultUnlockedAbilityIds: readonly number[];
  readonly resolveInitialUnlockedAbilityIds: (accountId: number, defaultIds: readonly number[]) => number[];
  readonly sanitizeHotbarSlot: (rawSlot: unknown, fallbackSlot: number) => number;
  readonly createInitialHotbar: (savedHotbar?: number[]) => number[];
  readonly clampHealth: (value: number) => number;
  // Called after ECS entity is created. Returns void — all wiring is done here.
  readonly spawnPlayer: (user: TUser, ctx: PlayerSpawnContext) => number;
  readonly despawnPlayer: (user: TUser, eid: number) => void;
  readonly sendInitialReplicationState: (user: TUser, accountId: number) => void;
  readonly resolvePlayerEidByUserId: (userId: number) => number | undefined;
  readonly takePendingSnapshotForLogin: (accountId: number) => PlayerSnapshot | null;
  readonly loadPlayerState: (accountId: number) => PlayerSnapshot | null;
  readonly queueOfflineSnapshot: (accountId: number, snapshot: PlayerSnapshot) => void;
  readonly resolveOfflineSnapshotByAccountId: (accountId: number) => PlayerSnapshot | null;
  readonly markPlayerDirty: (accountId: number, options: { dirtyCharacter: boolean; dirtyAbilityState: boolean }) => void;
  readonly unregisterPlayerCollider: (colliderHandle: number) => void;
  readonly removeProjectilesByOwner: (ownerNid: number) => void;
  readonly queueIdentityMessage: (user: TUser, playerNid: number) => void;
  readonly viewHalfWidth: number; readonly viewHalfHeight: number; readonly viewHalfDepth: number;
  readonly farViewHalfWidth: number; readonly farViewHalfHeight: number; readonly farViewHalfDepth: number;
}

export class PlayerLifecycleSystem<TUser extends LifecycleUser> {
  private readonly spawnedByUserId = new Map<number, { eid: number; nid: number; body: RAPIER.RigidBody; collider: RAPIER.Collider }>();

  public constructor(private readonly options: PlayerLifecycleSystemOptions<TUser>) {}

  public addUser(user: TUser): void {
    const accountId = this.resolveAccountId(user.accountId);
    if (accountId === null) return;

    const pendingSnapshot = this.options.takePendingSnapshotForLogin(accountId);
    const loaded = pendingSnapshot ?? this.options.loadPlayerState(accountId);
    const spawn = loaded ? { x: loaded.x, z: loaded.z } : this.options.getSpawnPosition();
    const spawnedBodyY = this.options.getSpawnBodyY(spawn.x, spawn.z);
    const initialCameraY = loaded?.y ?? (spawnedBodyY + this.options.playerCameraOffsetY);
    const initialBodyY = initialCameraY - this.options.playerCameraOffsetY;

    const body = this.options.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, initialBodyY, spawn.z)
    );
    const collider = this.options.world.createCollider(
      RAPIER.ColliderDesc
        .capsule(this.options.playerCapsuleHalfHeight, this.options.playerCapsuleRadius)
        .setFriction(0)
        .setCollisionGroups(PHYSICS_GROUP_CHARACTER)
        .setSolverGroups(PHYSICS_GROUP_CHARACTER),
      body
    );

    const ctx: PlayerSpawnContext = {
      accountId,
      spawnX: spawn.x,
      spawnZ: spawn.z,
      initialBodyY,
      initialCameraY,
      body,
      collider,
      health: this.options.clampHealth(loaded?.health ?? this.options.maxPlayerHealth),
      hotbarAbilityIds: this.options.createInitialHotbar(loaded?.hotbarAbilityIds),
      unlockedAbilityIds: this.options.resolveInitialUnlockedAbilityIds(accountId, this.options.defaultUnlockedAbilityIds),
      yaw: loaded?.yaw ?? 0,
      pitch: loaded?.pitch ?? 0,
      vx: loaded?.vx ?? 0,
      vy: loaded?.vy ?? 0,
      vz: loaded?.vz ?? 0
    };

    const eid = this.options.spawnPlayer(user, ctx);

    // Channel subscriptions
    this.options.globalChannel.subscribe(user);
    this.options.usersById.set(user.id, user);

    const view = this.options.createUserView({
      x: spawn.x, y: initialCameraY, z: spawn.z,
      halfWidth: this.options.viewHalfWidth,
      halfHeight: this.options.viewHalfHeight,
      halfDepth: this.options.viewHalfDepth
    });
    user.view = view;
    this.options.nearChannel.subscribe(user, view);

    const farView = this.options.createUserView({
      x: spawn.x, y: initialCameraY, z: spawn.z,
      halfWidth: this.options.farViewHalfWidth,
      halfHeight: this.options.farViewHalfHeight,
      halfDepth: this.options.farViewHalfDepth
    });
    user.farView = farView;
    this.options.farChannel.subscribe(user, farView);

    this.options.sendInitialReplicationState(user, accountId);
    this.options.markPlayerDirty(accountId, { dirtyCharacter: true, dirtyAbilityState: true });

    this.spawnedByUserId.set(user.id, { eid, nid: 0, body, collider });
  }

  public removeUser(user: TUser): void {
    const spawned = this.spawnedByUserId.get(user.id);
    if (!spawned) return;

    const eid = spawned.eid;
    const accountId = user.accountId;

    if (typeof accountId === "number" && Number.isFinite(accountId)) {
      const offlineSnapshot = this.options.resolveOfflineSnapshotByAccountId(accountId);
      if (offlineSnapshot) {
        this.options.queueOfflineSnapshot(accountId, offlineSnapshot);
      }
    }

    this.options.unregisterPlayerCollider(spawned.collider.handle);
    this.options.usersById.delete(user.id);
    this.options.removeProjectilesByOwner(spawned.nid);
    this.options.world.removeCollider(spawned.collider, true);
    this.options.world.removeRigidBody(spawned.body);
    this.options.despawnPlayer(user, eid);
    this.spawnedByUserId.delete(user.id);
  }

  public getSpawnedEid(userId: number): number | undefined {
    return this.spawnedByUserId.get(userId)?.eid;
  }

  public updateSpawnedNid(userId: number, nid: number): void {
    const spawned = this.spawnedByUserId.get(userId);
    if (spawned) spawned.nid = nid;
  }

  private resolveAccountId(rawAccountId: number | undefined): number | null {
    if (typeof rawAccountId !== "number" || !Number.isFinite(rawAccountId)) return null;
    return Math.max(1, Math.floor(rawAccountId));
  }
}
