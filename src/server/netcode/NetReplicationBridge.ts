// Bridges ECS replication snapshots into nengi entity create/update/despawn operations.
import { NType } from "../../shared/netcode";
import type { MovementMode } from "../../shared/index";

export interface ReplicatedSnapshot {
  nid: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  movementMode: MovementMode;
  health: number;
  maxHealth: number;
  locationKind: number;
  locationArchetypeId: number;
  locationSeed: number;
  locationEnvironmentId: number;
  locationStreamingRadius: number;
  locationInfluenceRadius: number;
}

type NetEntity = {
  nid: number;
  ntype: NType.BaseEntity | NType.LocationRootEntity;
  x: number;
  y: number;
  z: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  movementMode: MovementMode;
  health: number;
  maxHealth: number;
  locationKind: number;
  locationArchetypeId: number;
  locationSeed: number;
  locationEnvironmentId: number;
  locationStreamingRadius: number;
  locationInfluenceRadius: number;
};

type EntityChannel = {
  addEntity: (entity: unknown) => void;
  removeEntity: (entity: unknown) => void;
};

export class NetReplicationBridge {
  private readonly netBySimEid = new Map<number, NetEntity>();
  private readonly channelBySimEid = new Map<number, EntityChannel>();

  public constructor(
    private readonly nearChannel: EntityChannel,
    private readonly farChannel: EntityChannel
  ) {}

  public spawn(simEid: number, snapshot: ReplicatedSnapshot): number {
    const isLocationRoot = snapshot.locationKind > 0 && snapshot.locationArchetypeId > 0;
    const netEntity: NetEntity = {
      nid: 0,
      ntype: isLocationRoot ? NType.LocationRootEntity : NType.BaseEntity,
      x: snapshot.position.x,
      y: snapshot.position.y,
      z: snapshot.position.z,
      modelId: snapshot.modelId,
      position: {
        x: snapshot.position.x,
        y: snapshot.position.y,
        z: snapshot.position.z
      },
      rotation: {
        x: snapshot.rotation.x,
        y: snapshot.rotation.y,
        z: snapshot.rotation.z,
        w: snapshot.rotation.w
      },
      grounded: snapshot.grounded,
      movementMode: snapshot.movementMode,
      health: snapshot.health,
      maxHealth: snapshot.maxHealth,
      locationKind: snapshot.locationKind,
      locationArchetypeId: snapshot.locationArchetypeId,
      locationSeed: snapshot.locationSeed,
      locationEnvironmentId: snapshot.locationEnvironmentId,
      locationStreamingRadius: snapshot.locationStreamingRadius,
      locationInfluenceRadius: snapshot.locationInfluenceRadius
    };
    const channel = isLocationRoot ? this.farChannel : this.nearChannel;
    channel.addEntity(netEntity);
    this.netBySimEid.set(simEid, netEntity);
    this.channelBySimEid.set(simEid, channel);
    return netEntity.nid;
  }

  public sync(simEid: number, snapshot: ReplicatedSnapshot): void {
    this.syncFromState(simEid, {
      modelId: snapshot.modelId,
      x: snapshot.position.x,
      y: snapshot.position.y,
      z: snapshot.position.z,
      rx: snapshot.rotation.x,
      ry: snapshot.rotation.y,
      rz: snapshot.rotation.z,
      rw: snapshot.rotation.w,
      grounded: snapshot.grounded,
      movementMode: snapshot.movementMode,
      health: snapshot.health,
      maxHealth: snapshot.maxHealth,
      locationKind: snapshot.locationKind,
      locationArchetypeId: snapshot.locationArchetypeId,
      locationSeed: snapshot.locationSeed,
      locationEnvironmentId: snapshot.locationEnvironmentId,
      locationStreamingRadius: snapshot.locationStreamingRadius,
      locationInfluenceRadius: snapshot.locationInfluenceRadius
    });
  }

  public syncFromState(
    simEid: number,
    state: {
      modelId: number;
      x: number;
      y: number;
      z: number;
      rx: number;
      ry: number;
      rz: number;
      rw: number;
      grounded: boolean;
      movementMode: MovementMode;
      health: number;
      maxHealth: number;
      locationKind: number;
      locationArchetypeId: number;
      locationSeed: number;
      locationEnvironmentId: number;
      locationStreamingRadius: number;
      locationInfluenceRadius: number;
    }
  ): void {
    this.syncFromValues(
      simEid,
      state.modelId,
      state.x,
      state.y,
      state.z,
      state.rx,
      state.ry,
      state.rz,
      state.rw,
      state.grounded,
      state.movementMode,
      state.health,
      state.maxHealth,
      state.locationKind,
      state.locationArchetypeId,
      state.locationSeed,
      state.locationEnvironmentId,
      state.locationStreamingRadius,
      state.locationInfluenceRadius
    );
  }

  public syncFromValues(
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
    locationKind: number,
    locationArchetypeId: number,
    locationSeed: number,
    locationEnvironmentId: number,
    locationStreamingRadius: number,
    locationInfluenceRadius: number
  ): void {
    const netEntity = this.netBySimEid.get(simEid);
    if (!netEntity) {
      return;
    }
    netEntity.modelId = modelId;
    netEntity.position.x = x;
    netEntity.position.y = y;
    netEntity.position.z = z;
    netEntity.x = x;
    netEntity.y = y;
    netEntity.z = z;
    netEntity.rotation.x = rx;
    netEntity.rotation.y = ry;
    netEntity.rotation.z = rz;
    netEntity.rotation.w = rw;
    netEntity.grounded = grounded;
    netEntity.movementMode = movementMode;
    netEntity.health = health;
    netEntity.maxHealth = maxHealth;
    netEntity.locationKind = locationKind;
    netEntity.locationArchetypeId = locationArchetypeId;
    netEntity.locationSeed = locationSeed;
    netEntity.locationEnvironmentId = locationEnvironmentId;
    netEntity.locationStreamingRadius = locationStreamingRadius;
    netEntity.locationInfluenceRadius = locationInfluenceRadius;
  }

  public despawn(simEid: number): void {
    const netEntity = this.netBySimEid.get(simEid);
    if (!netEntity) {
      return;
    }
    const channel = this.channelBySimEid.get(simEid);
    if (channel) {
      channel.removeEntity(netEntity);
    }
    this.netBySimEid.delete(simEid);
    this.channelBySimEid.delete(simEid);
  }
}
