import RAPIER from "@dimforge/rapier3d-compat";
import { AABB3D, type Channel, type ChannelAABB3D } from "nengi";
import type { PlayerSnapshot } from "../persistence/PersistenceService";

export interface LifecycleUser {
  id: number;
  queueMessage: (message: unknown) => void;
  accountId?: number;
  view?: AABB3D;
}

export interface LifecyclePlayer {
  accountId: number;
  nid: number;
  ntype: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  serverTick: number;
  vy: number;
  vx: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  health: number;
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
  lastPrimaryFireAtSeconds: number;
  lastProcessedSequence: number;
  primaryHeld: boolean;
  unlockedAbilityIds: Set<number>;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface PlayerLifecycleSystemOptions<TUser extends LifecycleUser, TPlayer extends LifecyclePlayer> {
  readonly world: RAPIER.World;
  readonly globalChannel: Channel;
  readonly spatialChannel: ChannelAABB3D;
  readonly playersByUserId: Map<number, TPlayer>;
  readonly playersByAccountId: Map<number, TPlayer>;
  readonly playersByNid: Map<number, TPlayer>;
  readonly usersById: Map<number, TUser>;
  readonly getTickNumber: () => number;
  readonly takePendingSnapshotForLogin: (accountId: number) => PlayerSnapshot | null;
  readonly loadPlayerState: (accountId: number) => PlayerSnapshot | null;
  readonly getSpawnPosition: () => { x: number; z: number };
  readonly playerBodyCenterHeight: number;
  readonly playerCameraOffsetY: number;
  readonly playerCapsuleHalfHeight: number;
  readonly playerCapsuleRadius: number;
  readonly maxPlayerHealth: number;
  readonly defaultUnlockedAbilityIds: readonly number[];
  readonly sanitizeHotbarSlot: (rawSlot: unknown, fallbackSlot: number) => number;
  readonly createInitialHotbar: (savedHotbar?: number[]) => number[];
  readonly clampHealth: (value: number) => number;
  readonly ensurePunchAssigned: (player: TPlayer) => void;
  readonly buildPlayerEntity: (options: {
    accountId: number;
    spawnX: number;
    spawnZ: number;
    spawnBodyY: number;
    spawnCameraY: number;
    loaded: PlayerSnapshot | null;
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
    tickNumber: number;
    health: number;
    activeHotbarSlot: number;
    hotbarAbilityIds: number[];
    unlockedAbilityIds: Set<number>;
  }) => TPlayer;
  readonly markPlayerDirty: (
    player: TPlayer,
    options: { dirtyCharacter: boolean; dirtyAbilityState: boolean }
  ) => void;
  readonly registerPlayerForDamage: (player: TPlayer) => void;
  readonly unregisterPlayerCollider: (colliderHandle: number) => void;
  readonly removeProjectilesByOwner: (ownerNid: number) => void;
  readonly queueIdentityMessage: (user: TUser, playerNid: number) => void;
  readonly sendInitialReplicationState: (user: TUser, player: TPlayer) => void;
  readonly queueOfflineSnapshot: (accountId: number, snapshot: PlayerSnapshot) => void;
  readonly capturePlayerSnapshot: (player: TPlayer) => PlayerSnapshot;
  readonly viewHalfWidth: number;
  readonly viewHalfHeight: number;
  readonly viewHalfDepth: number;
}

export class PlayerLifecycleSystem<TUser extends LifecycleUser, TPlayer extends LifecyclePlayer> {
  public constructor(private readonly options: PlayerLifecycleSystemOptions<TUser, TPlayer>) {}

  public addUser(user: TUser): void {
    const accountId = this.resolveAccountId(user.accountId);
    if (accountId === null) {
      return;
    }

    const pendingSnapshot = this.options.takePendingSnapshotForLogin(accountId);
    const loaded = pendingSnapshot ?? this.options.loadPlayerState(accountId);
    const spawn = loaded ? { x: loaded.x, z: loaded.z } : this.options.getSpawnPosition();
    const initialCameraY = loaded?.y ?? (this.options.playerBodyCenterHeight + this.options.playerCameraOffsetY);
    const initialBodyY = initialCameraY - this.options.playerCameraOffsetY;
    const body = this.options.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        initialBodyY,
        spawn.z
      )
    );
    const collider = this.options.world.createCollider(
      RAPIER.ColliderDesc
        .capsule(this.options.playerCapsuleHalfHeight, this.options.playerCapsuleRadius)
        .setFriction(0),
      body
    );

    const player = this.options.buildPlayerEntity({
      accountId,
      spawnX: spawn.x,
      spawnZ: spawn.z,
      spawnBodyY: initialBodyY,
      spawnCameraY: initialCameraY,
      loaded,
      body,
      collider,
      tickNumber: this.options.getTickNumber(),
      health: this.options.clampHealth(loaded?.health ?? this.options.maxPlayerHealth),
      activeHotbarSlot: this.options.sanitizeHotbarSlot(loaded?.activeHotbarSlot ?? 0, 0),
      hotbarAbilityIds: this.options.createInitialHotbar(loaded?.hotbarAbilityIds),
      unlockedAbilityIds: new Set<number>(this.options.defaultUnlockedAbilityIds)
    });

    this.options.ensurePunchAssigned(player);

    this.options.globalChannel.subscribe(user);
    this.options.spatialChannel.addEntity(player);
    this.options.playersByUserId.set(user.id, player);
    this.options.playersByAccountId.set(player.accountId, player);
    this.options.playersByNid.set(player.nid, player);
    this.options.registerPlayerForDamage(player);
    this.options.usersById.set(user.id, user);

    const view = new AABB3D(
      player.x,
      player.y,
      player.z,
      this.options.viewHalfWidth,
      this.options.viewHalfHeight,
      this.options.viewHalfDepth
    );
    user.view = view;
    this.options.spatialChannel.subscribe(user, view);

    this.options.queueIdentityMessage(user, player.nid);
    this.options.sendInitialReplicationState(user, player);
    this.options.markPlayerDirty(player, {
      dirtyCharacter: true,
      dirtyAbilityState: true
    });
  }

  public removeUser(user: TUser): void {
    const player = this.options.playersByUserId.get(user.id);
    if (!player) {
      return;
    }

    this.options.queueOfflineSnapshot(
      player.accountId,
      this.options.capturePlayerSnapshot(player)
    );
    this.options.spatialChannel.removeEntity(player);
    this.options.playersByUserId.delete(user.id);
    this.options.playersByAccountId.delete(player.accountId);
    this.options.playersByNid.delete(player.nid);
    this.options.unregisterPlayerCollider(player.collider.handle);
    this.options.usersById.delete(user.id);
    this.options.removeProjectilesByOwner(player.nid);
    this.options.world.removeCollider(player.collider, true);
    this.options.world.removeRigidBody(player.body);
  }

  private resolveAccountId(rawAccountId: number | undefined): number | null {
    if (typeof rawAccountId !== "number" || !Number.isFinite(rawAccountId)) {
      return null;
    }
    return Math.max(1, Math.floor(rawAccountId));
  }
}
