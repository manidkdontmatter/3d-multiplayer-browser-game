import {
  ABILITY_ID_NONE,
  abilityCategoryToWireValue,
  encodeAbilityAttributeMask,
  NType
} from "../../shared/index";
import type { AbilityDefinition } from "../../shared/index";

export interface ReplicationUser {
  id: number;
  queueMessage: (message: unknown) => void;
  view?: { x: number; y: number; z: number };
}

export interface ReplicationPlayer {
  nid: number;
  lastProcessedSequence: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: Set<number>;
}

export interface InputAckStateSnapshot {
  lastProcessedSequence: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
}

export interface LoadoutStateSnapshot {
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: number[];
}

export interface ReplicationMessagingSystemOptions<
  TUser extends ReplicationUser,
  TPlayer extends ReplicationPlayer
> {
  readonly getTickNumber: () => number;
  readonly getUserById: (userId: number) => TUser | undefined;
  readonly queueSpatialMessage: (message: unknown) => void;
  readonly sanitizeHotbarSlot: (rawSlot: unknown, fallbackSlot: number) => number;
  readonly getAbilityDefinitionById: (abilityId: number) => AbilityDefinition | null;
}

export class ReplicationMessagingSystem<
  TUser extends ReplicationUser,
  TPlayer extends ReplicationPlayer
> {
  public constructor(private readonly options: ReplicationMessagingSystemOptions<TUser, TPlayer>) {}

  public syncUserView(userId: number, player: TPlayer): void {
    this.syncUserViewPosition(userId, player.x, player.y, player.z);
  }

  public syncUserViewPosition(userId: number, x: number, y: number, z: number): void {
    const user = this.options.getUserById(userId);
    if (!user?.view) {
      return;
    }
    user.view.x = x;
    user.view.y = y;
    user.view.z = z;
  }

  public queueInputAck(userId: number, player: TPlayer): void {
    this.queueInputAckFromState(userId, player);
  }

  public queueInputAckFromState(userId: number, state: InputAckStateSnapshot): void {
    const user = this.options.getUserById(userId);
    if (!user) {
      return;
    }
    user.queueMessage({
      ntype: NType.InputAckMessage,
      sequence: state.lastProcessedSequence,
      serverTick: this.options.getTickNumber(),
      x: state.x,
      y: state.y,
      z: state.z,
      vx: state.vx,
      vy: state.vy,
      vz: state.vz,
      grounded: state.grounded,
      groundedPlatformPid: state.groundedPlatformPid ?? -1
    });
  }

  public sendInitialAbilityStateFromSnapshot(user: TUser, snapshot: LoadoutStateSnapshot): void {
    for (const abilityId of snapshot.unlockedAbilityIds) {
      const ability = this.options.getAbilityDefinitionById(abilityId);
      if (!ability) {
        continue;
      }
      this.queueAbilityDefinitionMessage(user, ability);
    }
    this.queueLoadoutStateMessageFromSnapshot(user, snapshot);
  }

  public queueLoadoutStateMessageFromSnapshot(user: TUser, snapshot: LoadoutStateSnapshot): void {
    user.queueMessage({
      ntype: NType.LoadoutStateMessage,
      selectedHotbarSlot: this.options.sanitizeHotbarSlot(snapshot.activeHotbarSlot, 0),
      slot0AbilityId: snapshot.hotbarAbilityIds[0] ?? ABILITY_ID_NONE,
      slot1AbilityId: snapshot.hotbarAbilityIds[1] ?? ABILITY_ID_NONE,
      slot2AbilityId: snapshot.hotbarAbilityIds[2] ?? ABILITY_ID_NONE,
      slot3AbilityId: snapshot.hotbarAbilityIds[3] ?? ABILITY_ID_NONE,
      slot4AbilityId: snapshot.hotbarAbilityIds[4] ?? ABILITY_ID_NONE
    });
  }

  public broadcastAbilityUseMessage(player: TPlayer, ability: AbilityDefinition): void {
    const abilityId = Math.max(0, Math.min(0xffff, Math.floor(ability.id)));
    const category = abilityCategoryToWireValue(ability.category);
    this.options.queueSpatialMessage({
      ntype: NType.AbilityUseMessage,
      ownerNid: player.nid,
      abilityId,
      category,
      serverTick: this.options.getTickNumber(),
      x: player.x,
      y: player.y,
      z: player.z
    });
  }

  private queueAbilityDefinitionMessage(user: TUser, ability: AbilityDefinition): void {
    const projectile = ability.projectile;
    const melee = ability.melee;
    const damage = projectile?.damage ?? melee?.damage ?? 0;
    const radius = projectile?.radius ?? melee?.radius ?? 0;
    const cooldownSeconds = projectile?.cooldownSeconds ?? melee?.cooldownSeconds ?? 0;
    user.queueMessage({
      ntype: NType.AbilityDefinitionMessage,
      abilityId: ability.id,
      name: ability.name,
      category: abilityCategoryToWireValue(ability.category),
      pointsPower: ability.points.power,
      pointsVelocity: ability.points.velocity,
      pointsEfficiency: ability.points.efficiency,
      pointsControl: ability.points.control,
      attributeMask: encodeAbilityAttributeMask(ability.attributes),
      kind: projectile?.kind ?? 0,
      speed: projectile?.speed ?? 0,
      damage,
      radius,
      cooldownSeconds,
      lifetimeSeconds: projectile?.lifetimeSeconds ?? 0,
      spawnForwardOffset: projectile?.spawnForwardOffset ?? 0,
      spawnVerticalOffset: projectile?.spawnVerticalOffset ?? 0,
      meleeRange: melee?.range ?? 0,
      meleeArcDegrees: melee?.arcDegrees ?? 0
    });
  }

}
