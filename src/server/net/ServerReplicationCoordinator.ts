import type { AbilityDefinition } from "../../shared/index";
import { NType } from "../../shared/netcode";
import { NetReplicationBridge, type ReplicatedSnapshot } from "../netcode/NetReplicationBridge";
import {
  ReplicationMessagingSystem,
  type InputAckStateSnapshot,
  type LoadoutStateSnapshot,
  type ReplicationPlayer,
  type ReplicationUser
} from "../netcode/ReplicationMessagingSystem";

interface ServerReplicationCoordinatorOptions<
  TUser extends ReplicationUser,
  TPlayer extends ReplicationPlayer
> {
  readonly spatialChannel: {
    addEntity: (entity: unknown) => void;
    removeEntity: (entity: unknown) => void;
    addMessage: (message: unknown) => void;
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
    this.replicationBridge = new NetReplicationBridge(options.spatialChannel);
    this.replicationMessaging = new ReplicationMessagingSystem<TUser, TPlayer>({
      getTickNumber: options.getTickNumber,
      getUserById: options.getUserById,
      queueSpatialMessage: (message) => options.spatialChannel.addMessage(message),
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
    health: number,
    maxHealth: number
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
      health,
      maxHealth
    );
  }

  public syncUserViewPosition(userId: number, x: number, y: number, z: number): void {
    this.replicationMessaging.syncUserViewPosition(userId, x, y, z);
  }

  public queueInputAckFromState(userId: number, state: InputAckStateSnapshot): void {
    this.replicationMessaging.queueInputAckFromState(userId, state);
  }

  public sendInitialAbilityStateFromSnapshot(user: TUser, snapshot: LoadoutStateSnapshot): void {
    this.replicationMessaging.sendInitialAbilityStateFromSnapshot(user, snapshot);
  }

  public queueLoadoutStateMessageFromSnapshot(user: TUser, snapshot: LoadoutStateSnapshot): void {
    this.replicationMessaging.queueLoadoutStateMessageFromSnapshot(user, snapshot);
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
