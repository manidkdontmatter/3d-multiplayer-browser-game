import { HOTBAR_SLOT_COUNT } from "../../shared/index";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { SimulationEcsIndexRegistry } from "./SimulationEcsIndexRegistry";
import type { SimulationEcsStore } from "./SimulationEcsStore";

export class SimulationEcsProjectors {
  public constructor(
    private readonly store: SimulationEcsStore,
    private readonly indexes: SimulationEcsIndexRegistry
  ) {}

  public getPlayerPersistenceSnapshotByEid(eid: number): {
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
  } | null {
    const entity = this.indexes.getObjectByEid(eid);
    if (!entity) {
      return null;
    }
    const components = this.store.world.components;
    return {
      accountId: Math.max(1, Math.floor(components.AccountId.value[eid] ?? 1)),
      x: components.Position.x[eid] ?? 0,
      y: components.Position.y[eid] ?? 0,
      z: components.Position.z[eid] ?? 0,
      yaw: components.Yaw.value[eid] ?? 0,
      pitch: components.Pitch.value[eid] ?? 0,
      vx: components.Velocity.x[eid] ?? 0,
      vy: components.Velocity.y[eid] ?? 0,
      vz: components.Velocity.z[eid] ?? 0,
      health: Math.max(0, Math.floor(components.Health.value[eid] ?? 0)),
      activeHotbarSlot: Math.max(0, Math.floor(components.ActiveHotbarSlot.value[eid] ?? 0)),
      hotbarAbilityIds: this.getHotbarArray(eid)
    };
  }

  public getReplicationSnapshotByEid(eid: number): {
    nid: number;
    modelId: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    grounded: boolean;
    health: number;
    maxHealth: number;
  } {
    const c = this.store.world.components;
    return {
      nid: c.NetworkId.value[eid] ?? 0,
      modelId: c.ModelId.value[eid] ?? 0,
      position: {
        x: c.Position.x[eid] ?? 0,
        y: c.Position.y[eid] ?? 0,
        z: c.Position.z[eid] ?? 0
      },
      rotation: {
        x: c.Rotation.x[eid] ?? 0,
        y: c.Rotation.y[eid] ?? 0,
        z: c.Rotation.z[eid] ?? 0,
        w: c.Rotation.w[eid] ?? 1
      },
      grounded: (c.Grounded.value[eid] ?? 0) !== 0,
      health: c.Health.value[eid] ?? 0,
      maxHealth: c.Health.max[eid] ?? 0
    };
  }

  public getProjectileRuntimeStateByEid(eid: number): {
    ownerNid: number;
    kind: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    radius: number;
    damage: number;
    ttlSeconds: number;
    remainingRange: number;
    gravity: number;
    drag: number;
    maxSpeed: number;
    minSpeed: number;
    remainingPierces: number;
    despawnOnDamageableHit: boolean;
    despawnOnWorldHit: boolean;
  } | null {
    const c = this.store.world.components;
    const nid = c.NetworkId.value[eid];
    if (typeof nid !== "number") {
      return null;
    }
    return {
      ownerNid: c.ProjectileOwnerNid.value[eid] ?? 0,
      kind: c.ProjectileKind.value[eid] ?? 0,
      x: c.Position.x[eid] ?? 0,
      y: c.Position.y[eid] ?? 0,
      z: c.Position.z[eid] ?? 0,
      vx: c.Velocity.x[eid] ?? 0,
      vy: c.Velocity.y[eid] ?? 0,
      vz: c.Velocity.z[eid] ?? 0,
      radius: c.ProjectileRadius.value[eid] ?? 0,
      damage: c.ProjectileDamage.value[eid] ?? 0,
      ttlSeconds: c.ProjectileTtl.value[eid] ?? 0,
      remainingRange: c.ProjectileRemainingRange.value[eid] ?? 0,
      gravity: c.ProjectileGravity.value[eid] ?? 0,
      drag: c.ProjectileDrag.value[eid] ?? 0,
      maxSpeed: c.ProjectileMaxSpeed.value[eid] ?? 0,
      minSpeed: c.ProjectileMinSpeed.value[eid] ?? 0,
      remainingPierces: c.ProjectileRemainingPierces.value[eid] ?? 0,
      despawnOnDamageableHit: (c.ProjectileDespawnOnDamageableHit.value[eid] ?? 0) !== 0,
      despawnOnWorldHit: (c.ProjectileDespawnOnWorldHit.value[eid] ?? 0) !== 0
    };
  }

  public getPlayerRuntimeStateByUserId(userId: number): {
    accountId: number;
    nid: number;
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
    lastProcessedSequence: number;
    lastPrimaryFireAtSeconds: number;
    primaryHeld: boolean;
    activeHotbarSlot: number;
    hotbarAbilityIds: number[];
    unlockedAbilityIds: Set<number>;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  } | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") {
      return null;
    }
    const body = this.indexes.getPlayerBody(eid);
    const collider = this.indexes.getPlayerCollider(eid);
    if (!body || !collider) {
      return null;
    }

    const c = this.store.world.components;
    const groundedPlatformPidRaw = c.GroundedPlatformPid.value[eid] ?? -1;
    const x = c.Position.x[eid] ?? 0;
    const y = c.Position.y[eid] ?? 0;
    const z = c.Position.z[eid] ?? 0;
    return {
      accountId: Math.max(1, Math.floor(c.AccountId.value[eid] ?? 1)),
      nid: c.NetworkId.value[eid] ?? 0,
      x,
      y,
      z,
      yaw: c.Yaw.value[eid] ?? 0,
      pitch: c.Pitch.value[eid] ?? 0,
      vx: c.Velocity.x[eid] ?? 0,
      vy: c.Velocity.y[eid] ?? 0,
      vz: c.Velocity.z[eid] ?? 0,
      grounded: (c.Grounded.value[eid] ?? 0) !== 0,
      groundedPlatformPid: groundedPlatformPidRaw < 0 ? null : groundedPlatformPidRaw,
      lastProcessedSequence: c.LastProcessedSequence.value[eid] ?? 0,
      lastPrimaryFireAtSeconds: c.LastPrimaryFireAtSeconds.value[eid] ?? Number.NEGATIVE_INFINITY,
      primaryHeld: (c.PrimaryHeld.value[eid] ?? 0) !== 0,
      activeHotbarSlot: Math.max(0, Math.floor(c.ActiveHotbarSlot.value[eid] ?? 0)),
      hotbarAbilityIds: this.getHotbarArray(eid),
      unlockedAbilityIds: this.store.getUnlockedAbilities(eid),
      position: { x, y, z },
      rotation: {
        x: c.Rotation.x[eid] ?? 0,
        y: c.Rotation.y[eid] ?? 0,
        z: c.Rotation.z[eid] ?? 0,
        w: c.Rotation.w[eid] ?? 1
      },
      body,
      collider
    };
  }

  public getPlayerDamageStateByEid(eid: number): {
    accountId: number;
    nid: number;
    health: number;
    maxHealth: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    grounded: boolean;
    groundedPlatformPid: number | null;
    body: RAPIER.RigidBody;
  } | null {
    const body = this.indexes.getPlayerBody(eid);
    if (!body) {
      return null;
    }
    const c = this.store.world.components;
    const groundedPlatformPidRaw = c.GroundedPlatformPid.value[eid] ?? -1;
    return {
      accountId: Math.max(1, Math.floor(c.AccountId.value[eid] ?? 1)),
      nid: c.NetworkId.value[eid] ?? 0,
      health: c.Health.value[eid] ?? 0,
      maxHealth: c.Health.max[eid] ?? 0,
      x: c.Position.x[eid] ?? 0,
      y: c.Position.y[eid] ?? 0,
      z: c.Position.z[eid] ?? 0,
      vx: c.Velocity.x[eid] ?? 0,
      vy: c.Velocity.y[eid] ?? 0,
      vz: c.Velocity.z[eid] ?? 0,
      grounded: (c.Grounded.value[eid] ?? 0) !== 0,
      groundedPlatformPid: groundedPlatformPidRaw < 0 ? null : groundedPlatformPidRaw,
      body
    };
  }

  public getDummyDamageStateByEid(eid: number): { health: number; maxHealth: number } | null {
    if (!this.indexes.getDummyBody(eid)) {
      return null;
    }
    const c = this.store.world.components;
    return {
      health: c.Health.value[eid] ?? 0,
      maxHealth: c.Health.max[eid] ?? 0
    };
  }

  public resolveCombatTargetRuntime(target: { kind: "player" | "dummy"; eid: number }): {
    nid: number;
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
  } | null {
    const c = this.store.world.components;
    if (target.kind === "player") {
      const body = this.indexes.getPlayerBody(target.eid);
      const collider = this.indexes.getPlayerCollider(target.eid);
      if (!body || !collider) {
        return null;
      }
      return {
        nid: c.NetworkId.value[target.eid] ?? 0,
        body,
        collider
      };
    }

    const body = this.indexes.getDummyBody(target.eid);
    const collider = this.indexes.getDummyCollider(target.eid);
    if (!body || !collider) {
      return null;
    }
    return {
      nid: c.NetworkId.value[target.eid] ?? 0,
      body,
      collider
    };
  }

  public getPlayerInputAckStateByUserId(userId: number): {
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
  } | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") {
      return null;
    }
    const c = this.store.world.components;
    const groundedPlatformPidRaw = c.GroundedPlatformPid.value[eid] ?? -1;
    return {
      nid: c.NetworkId.value[eid] ?? 0,
      lastProcessedSequence: c.LastProcessedSequence.value[eid] ?? 0,
      x: c.Position.x[eid] ?? 0,
      y: c.Position.y[eid] ?? 0,
      z: c.Position.z[eid] ?? 0,
      yaw: c.Yaw.value[eid] ?? 0,
      pitch: c.Pitch.value[eid] ?? 0,
      vx: c.Velocity.x[eid] ?? 0,
      vy: c.Velocity.y[eid] ?? 0,
      vz: c.Velocity.z[eid] ?? 0,
      grounded: (c.Grounded.value[eid] ?? 0) !== 0,
      groundedPlatformPid: groundedPlatformPidRaw < 0 ? null : groundedPlatformPidRaw
    };
  }

  public getPlayerLoadoutStateByUserId(userId: number): {
    activeHotbarSlot: number;
    hotbarAbilityIds: number[];
    unlockedAbilityIds: number[];
  } | null {
    const eid = this.indexes.getPlayerEidByUserId(userId);
    if (typeof eid !== "number") {
      return null;
    }

    return {
      activeHotbarSlot: Math.max(0, Math.floor(this.store.world.components.ActiveHotbarSlot.value[eid] ?? 0)),
      hotbarAbilityIds: this.getHotbarArray(eid),
      unlockedAbilityIds: this.store.getUnlockedAbilitiesArray(eid)
    };
  }

  public getOnlinePlayerPositionsXZ(): Array<{ x: number; z: number }> {
    const occupied: Array<{ x: number; z: number }> = [];
    for (const userId of this.indexes.getOnlinePlayerUserIds()) {
      const eid = this.indexes.getPlayerEidByUserId(userId);
      if (typeof eid !== "number") {
        continue;
      }
      occupied.push({
        x: this.store.world.components.Position.x[eid] ?? 0,
        z: this.store.world.components.Position.z[eid] ?? 0
      });
    }
    return occupied;
  }

  private getHotbarArray(eid: number): number[] {
    const hotbar: number[] = new Array(HOTBAR_SLOT_COUNT);
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      hotbar[slot] = this.store.getHotbarSlot(eid, slot);
    }
    return hotbar;
  }
}
