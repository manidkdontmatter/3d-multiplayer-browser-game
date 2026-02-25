// Server-side wire message helpers for ability state, acks, and ability-use events.
import {
  ABILITY_ID_NONE,
  HOTBAR_SLOT_COUNT,
  MOVEMENT_MODE_GROUNDED,
  abilityCategoryToWireValue,
  encodeAbilityAttributeMask,
  NType
} from "../../shared/index";
import type { AbilityDefinition, MovementMode } from "../../shared/index";
import type { AbilityCreatorSessionSnapshot } from "../../shared/index";

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
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
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
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
}

export interface AbilityStateSnapshot {
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
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
      groundedPlatformPid: state.groundedPlatformPid ?? -1,
      movementMode: state.movementMode ?? MOVEMENT_MODE_GROUNDED
    });
  }

  public sendInitialAbilityStateFromSnapshot(user: TUser, snapshot: AbilityStateSnapshot): void {
    for (const abilityId of snapshot.unlockedAbilityIds) {
      const ability = this.options.getAbilityDefinitionById(abilityId);
      if (!ability) {
        continue;
      }
      this.queueAbilityDefinitionMessage(user, ability);
    }
    this.queueAbilityOwnershipMessage(user, snapshot.unlockedAbilityIds);
    this.queueAbilityStateMessageFromSnapshot(user, snapshot);
  }

  public queueAbilityStateMessageFromSnapshot(user: TUser, snapshot: AbilityStateSnapshot): void {
    const ids: number[] = new Array(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      ids[slot] = snapshot.hotbarAbilityIds[slot] ?? ABILITY_ID_NONE;
    }

    user.queueMessage({
      ntype: NType.AbilityStateMessage,
      primaryMouseSlot: this.options.sanitizeHotbarSlot(snapshot.primaryMouseSlot, 0),
      secondaryMouseSlot: this.options.sanitizeHotbarSlot(snapshot.secondaryMouseSlot, 1),
      slot0AbilityId: ids[0],
      slot1AbilityId: ids[1],
      slot2AbilityId: ids[2],
      slot3AbilityId: ids[3],
      slot4AbilityId: ids[4],
      slot5AbilityId: ids[5],
      slot6AbilityId: ids[6],
      slot7AbilityId: ids[7],
      slot8AbilityId: ids[8],
      slot9AbilityId: ids[9]
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

  public queueAbilityDefinitionMessage(user: TUser, ability: AbilityDefinition): void {
    const projectile = ability.projectile;
    const melee = ability.melee;
    const damage = projectile?.damage ?? melee?.damage ?? 0;
    const radius = projectile?.radius ?? melee?.radius ?? 0;
    const cooldownSeconds = projectile?.cooldownSeconds ?? melee?.cooldownSeconds ?? 0;
    const creatorTier = ability.creator?.tier ?? 0;
    const creatorCoreExampleStat = ability.creator?.coreExampleStat ?? 0;
    const creatorFlags =
      (ability.creator?.exampleUpsideEnabled ? 1 << 0 : 0) |
      (ability.creator?.exampleDownsideEnabled ? 1 << 1 : 0);
    user.queueMessage({
      ntype: NType.AbilityDefinitionMessage,
      abilityId: ability.id,
      name: ability.name,
      category: abilityCategoryToWireValue(ability.category),
      creatorTier,
      creatorCoreExampleStat,
      creatorFlags,
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

  public queueAbilityOwnershipMessage(user: TUser, unlockedAbilityIds: ReadonlyArray<number>): void {
    const normalized = Array.from(
      new Set(
        unlockedAbilityIds
          .map((abilityId) => Math.max(0, Math.floor(Number.isFinite(abilityId) ? abilityId : 0)))
          .filter((abilityId) => abilityId !== ABILITY_ID_NONE)
      )
    ).sort((a, b) => a - b);
    user.queueMessage({
      ntype: NType.AbilityOwnershipMessage,
      unlockedAbilityIdsCsv: normalized.join(",")
    });
  }

  public queueAbilityCreatorStateMessage(
    user: TUser,
    snapshot: AbilityCreatorSessionSnapshot
  ): void {
    user.queueMessage({
      ntype: NType.AbilityCreatorStateMessage,
      sessionId: Math.max(0, Math.floor(snapshot.sessionId)),
      ackSequence: Math.max(0, Math.floor(snapshot.ackSequence)),
      maxCreatorTier: Math.max(1, Math.floor(snapshot.maxCreatorTier)),
      selectedTier: Math.max(1, Math.floor(snapshot.draft.tier)),
      selectedType: abilityCategoryToWireValue(snapshot.draft.type),
      abilityName: snapshot.draft.name,
      coreExampleStat: Math.max(0, Math.floor(snapshot.draft.coreExampleStat)),
      exampleUpsideEnabled: Boolean(snapshot.draft.exampleUpsideEnabled),
      exampleDownsideEnabled: Boolean(snapshot.draft.exampleDownsideEnabled),
      usingTemplate: Math.max(0, Math.floor(snapshot.draft.templateAbilityId)) > 0,
      templateAbilityId: Math.max(0, Math.floor(snapshot.draft.templateAbilityId)),
      totalPointBudget: Math.max(0, Math.floor(snapshot.capacity.totalPointBudget)),
      spentPoints: Math.max(0, Math.floor(snapshot.capacity.spentPoints)),
      remainingPoints: Math.max(0, Math.floor(snapshot.capacity.remainingPoints)),
      upsideSlots: Math.max(0, Math.floor(snapshot.capacity.upsideSlots)),
      downsideMax: Math.max(0, Math.floor(snapshot.capacity.downsideMax)),
      usedUpsideSlots: Math.max(0, Math.floor(snapshot.capacity.usedUpsideSlots)),
      usedDownsideSlots: Math.max(0, Math.floor(snapshot.capacity.usedDownsideSlots)),
      derivedExamplePower: snapshot.derived.examplePower,
      derivedExampleStability: snapshot.derived.exampleStability,
      derivedExampleComplexity: snapshot.derived.exampleComplexity,
      isValid: snapshot.validation.valid,
      validationMessage: snapshot.validation.message,
      ownedAbilityCount: Math.max(0, Math.floor(snapshot.ownedAbilityCount))
    });
  }
}
