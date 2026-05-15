// Bridges simulation state changes into nengi replication entities and server messages.
import type { AbilityDefinition } from "../../shared/index";
import type { CreatorSessionSnapshot } from "../../shared/index";
import type { MovementMode } from "../../shared/index";
import { NType } from "../../shared/netcode";
import { NetReplicationBridge, type ReplicatedSnapshot } from "../netcode/NetReplicationBridge";
import {
  ReplicationMessagingSystem,
  type AbilityStateSnapshot,
  type InputAckStateSnapshot,
  type ReplicationPlayer,
  type ReplicationUser
} from "../netcode/ReplicationMessagingSystem";

interface ServerReplicationCoordinatorOptions<
  TUser extends ReplicationUser,
  TPlayer extends ReplicationPlayer
> {
  readonly nearChannel: {
    addEntity: (entity: unknown) => void;
    removeEntity: (entity: unknown) => void;
    addMessage: (message: unknown) => void;
  };
  readonly farChannel: {
    addEntity: (entity: unknown) => void;
    removeEntity: (entity: unknown) => void;
  };
  readonly getTickNumber: () => number;
  readonly getUserById: (userId: number) => TUser | undefined;
  readonly sanitizeHotbarSlot: (rawSlot: unknown, fallbackSlot: number) => number;
  readonly getAbilityDefinitionById: (abilityId: number) => AbilityDefinition | null;
}

export class ServerReplicationCoordinator<
  TUser extends ReplicationUser,
  TPlayer extends ReplicationPlayer
> {
  private readonly replicationBridge: NetReplicationBridge;
  private readonly replicationMessaging: ReplicationMessagingSystem<TUser, TPlayer>;

  public constructor(options: ServerReplicationCoordinatorOptions<TUser, TPlayer>) {
    this.replicationBridge = new NetReplicationBridge(options.nearChannel, options.farChannel);
    this.replicationMessaging = new ReplicationMessagingSystem<TUser, TPlayer>({
      getTickNumber: options.getTickNumber,
      getUserById: options.getUserById,
      queueSpatialMessage: (message) => options.nearChannel.addMessage(message),
      sanitizeHotbarSlot: options.sanitizeHotbarSlot,
      getAbilityDefinitionById: options.getAbilityDefinitionById
    });
  }

  public spawnEntity(simEid: number, snapshot: ReplicatedSnapshot): number {
    return this.replicationBridge.spawn(simEid, snapshot);
  }

  public despawnEntity(simEid: number): void {
    this.replicationBridge.despawn(simEid);
  }

  public syncEntityFromValues(
    simEid: number,
    modelId: number,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    rw: number,
    grounded: boolean,
    movementMode: MovementMode,
    health: number,
    maxHealth: number,
    itemArchetypeId: number,
    itemQuantity: number,
    locationKind: number,
    locationArchetypeId: number,
    locationSeed: number,
    locationEnvironmentId: number,
    locationStreamingRadius: number,
    locationInfluenceRadius: number
  ): void {
    this.replicationBridge.syncFromValues(
      simEid,
      modelId,
      x,
      y,
      z,
      rx,
      ry,
      rz,
      rw,
      grounded,
      movementMode,
      health,
      maxHealth,
      itemArchetypeId,
      itemQuantity,
      locationKind,
      locationArchetypeId,
      locationSeed,
      locationEnvironmentId,
      locationStreamingRadius,
      locationInfluenceRadius
    );
  }

  public syncUserViewPosition(userId: number, x: number, y: number, z: number): void {
    this.replicationMessaging.syncUserViewPosition(userId, x, y, z);
  }

  public queueInputAckFromState(userId: number, state: InputAckStateSnapshot): void {
    this.replicationMessaging.queueInputAckFromState(userId, state);
  }

  public sendInitialAbilityStateFromSnapshot(user: TUser, snapshot: AbilityStateSnapshot): void {
    this.replicationMessaging.sendInitialAbilityStateFromSnapshot(user, snapshot);
  }

  public queueAbilityStateMessageFromSnapshot(user: TUser, snapshot: AbilityStateSnapshot): void {
    this.replicationMessaging.queueAbilityStateMessageFromSnapshot(user, snapshot);
  }

  public queueAbilityOwnershipMessage(user: TUser, unlockedAbilityIds: ReadonlyArray<number>): void {
    this.replicationMessaging.queueAbilityOwnershipMessage(user, unlockedAbilityIds);
  }

  public queueAbilityDefinitionMessage(user: TUser, ability: AbilityDefinition): void {
    this.replicationMessaging.queueAbilityDefinitionMessage(user, ability);
  }

  public queueCreatorStateMessage(user: TUser, snapshot: CreatorSessionSnapshot): void {
    this.replicationMessaging.queueCreatorStateMessage(user, snapshot);
  }

  public broadcastAbilityUseMessage(player: TPlayer, ability: AbilityDefinition): void {
    this.replicationMessaging.broadcastAbilityUseMessage(player, ability);
  }

  public queueIdentityMessage(user: TUser, playerNid: number): void {
    user.queueMessage({
      ntype: NType.IdentityMessage,
      playerNid
    });
  }
}
