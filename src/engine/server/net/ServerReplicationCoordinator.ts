// Bridges simulation state changes into nengi replication entities and server messages.
import type { AbilityDefinition } from "../../shared/index";
import type { CreatorSessionSnapshot } from "../../shared/index";
import { NType } from "../../shared/netcode";
import { NetReplicationBridge } from "../netcode/NetReplicationBridge";
import type { WorldWithComponents } from "../ecs/SimulationEcsTypes";
import {
  ReplicationMessagingSystem,
  type AbilityStateSnapshot,
  type InputAckStateSnapshot,
  type ReplicationUser
} from "../netcode/ReplicationMessagingSystem";

interface ServerReplicationCoordinatorOptions<TUser extends ReplicationUser> {
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

export class ServerReplicationCoordinator<TUser extends ReplicationUser> {
  private readonly replicationBridge: NetReplicationBridge;
  private readonly replicationMessaging: ReplicationMessagingSystem<TUser>;

  public constructor(options: ServerReplicationCoordinatorOptions<TUser>, components: WorldWithComponents["components"]) {
    this.replicationBridge = new NetReplicationBridge(options.nearChannel, options.farChannel, components);
    this.replicationMessaging = new ReplicationMessagingSystem<TUser>({
      getTickNumber: options.getTickNumber,
      getUserById: options.getUserById,
      queueSpatialMessage: (message) => options.nearChannel.addMessage(message),
      sanitizeHotbarSlot: options.sanitizeHotbarSlot,
      getAbilityDefinitionById: options.getAbilityDefinitionById
    });
  }

  public spawnEntity(simEid: number): number {
    return this.replicationBridge.spawn(simEid);
  }

  public despawnEntity(simEid: number): void {
    this.replicationBridge.despawn(simEid);
  }

  public syncEntityFromEcs(simEid: number): void {
    this.replicationBridge.sync(simEid);
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

  public broadcastAbilityUseMessage(playerNid: number, ability: AbilityDefinition, x: number, y: number, z: number): void {
    this.replicationMessaging.broadcastAbilityUseMessage(playerNid, ability, x, y, z);
  }

  public queueIdentityMessage(user: TUser, playerNid: number): void {
    user.queueMessage({ ntype: NType.IdentityMessage, playerNid });
  }
}
