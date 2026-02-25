// Handles player connect/disconnect flow and runtime entity spawn/teardown wiring.
import RAPIER from "@dimforge/rapier3d-compat";
import type { PlayerSnapshot } from "../persistence/PersistenceService";

export interface BroadcastSubscriptionChannel<TUser> {
  subscribe(user: TUser): void;
}

export interface SpatialSubscriptionChannel<TUser, TView> {
  subscribe(user: TUser, view: TView): void;
}

export interface LifecycleUser {
  id: number;
  queueMessage: (message: unknown) => void;
  accountId?: number;
  view?: {
    x: number;
    y: number;
    z: number;
    halfWidth: number;
    halfHeight: number;
    halfDepth: number;
  };
}

export interface LifecyclePlayer {
  accountId: number;
  nid: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vy: number;
  vx: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  health: number;
  maxHealth: number;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
  hotbarAbilityIds: number[];
  lastPrimaryFireAtSeconds: number;
  lastProcessedSequence: number;
  primaryHeld: boolean;
  secondaryHeld: boolean;
  unlockedAbilityIds: Set<number>;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface PlayerLifecycleSystemOptions<TUser extends LifecycleUser, TPlayer extends LifecyclePlayer> {
  readonly world: RAPIER.World;
  readonly globalChannel: BroadcastSubscriptionChannel<TUser>;
  readonly spatialChannel: SpatialSubscriptionChannel<TUser, TUser["view"]>;
  readonly createUserView: (position: {
    x: number;
    y: number;
    z: number;
    halfWidth: number;
    halfHeight: number;
    halfDepth: number;
  }) => NonNullable<TUser["view"]>;
  readonly usersById: Map<number, TUser>;
  readonly resolvePlayerByUserId: (userId: number) => TPlayer | undefined;
  readonly takePendingSnapshotForLogin: (accountId: number) => PlayerSnapshot | null;
  readonly loadPlayerState: (accountId: number) => PlayerSnapshot | null;
  readonly getSpawnPosition: () => { x: number; z: number };
  readonly playerBodyCenterHeight: number;
  readonly playerCameraOffsetY: number;
  readonly playerCapsuleHalfHeight: number;
  readonly playerCapsuleRadius: number;
  readonly maxPlayerHealth: number;
  readonly defaultUnlockedAbilityIds: readonly number[];
  readonly resolveInitialUnlockedAbilityIds: (
    accountId: number,
    defaultUnlockedAbilityIds: readonly number[]
  ) => number[];
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
    health: number;
    primaryMouseSlot: number;
    secondaryMouseSlot: number;
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
  readonly resolveOfflineSnapshotByAccountId: (accountId: number) => PlayerSnapshot | null;
  readonly viewHalfWidth: number;
  readonly viewHalfHeight: number;
  readonly viewHalfDepth: number;
  readonly onPlayerAdded?: (user: TUser, player: TPlayer) => void;
  readonly onPlayerRemoved?: (user: TUser, player: TPlayer) => void;
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
      health: this.options.clampHealth(loaded?.health ?? this.options.maxPlayerHealth),
      primaryMouseSlot: this.options.sanitizeHotbarSlot(loaded?.primaryMouseSlot ?? 0, 0),
      secondaryMouseSlot: this.options.sanitizeHotbarSlot(loaded?.secondaryMouseSlot ?? 1, 1),
      hotbarAbilityIds: this.options.createInitialHotbar(loaded?.hotbarAbilityIds),
      unlockedAbilityIds: new Set<number>(
        this.options.resolveInitialUnlockedAbilityIds(
          accountId,
          this.options.defaultUnlockedAbilityIds
        )
      )
    });

    this.options.ensurePunchAssigned(player);

    this.options.globalChannel.subscribe(user);
    this.options.usersById.set(user.id, user);
    this.options.onPlayerAdded?.(user, player);
    this.options.registerPlayerForDamage(player);

    const view = this.options.createUserView({
      x: player.x,
      y: player.y,
      z: player.z,
      halfWidth: this.options.viewHalfWidth,
      halfHeight: this.options.viewHalfHeight,
      halfDepth: this.options.viewHalfDepth
    });
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
    const player = this.options.resolvePlayerByUserId(user.id);
    if (!player) {
      return;
    }

    const offlineSnapshot = this.options.resolveOfflineSnapshotByAccountId(player.accountId);
    if (offlineSnapshot) {
      this.options.queueOfflineSnapshot(player.accountId, offlineSnapshot);
    }
    this.options.onPlayerRemoved?.(user, player);
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
