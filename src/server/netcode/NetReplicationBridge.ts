import type { ChannelAABB3D } from "nengi";
import { NType } from "../../shared/netcode";

export interface ReplicatedSnapshot {
  nid: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  health: number;
  maxHealth: number;
}

type NetEntity = {
  nid: number;
  ntype: NType.BaseEntity;
  x: number;
  y: number;
  z: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  health: number;
  maxHealth: number;
};

export class NetReplicationBridge {
  private readonly netBySim = new WeakMap<object, NetEntity>();

  public constructor(private readonly spatialChannel: ChannelAABB3D) {}

  public spawn(simEntity: object, snapshot: ReplicatedSnapshot): number {
    const netEntity: NetEntity = {
      nid: 0,
      ntype: NType.BaseEntity,
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
      health: snapshot.health,
      maxHealth: snapshot.maxHealth
    };
    this.spatialChannel.addEntity(netEntity);
    this.netBySim.set(simEntity, netEntity);
    return netEntity.nid;
  }

  public sync(simEntity: object, snapshot: ReplicatedSnapshot): void {
    const netEntity = this.netBySim.get(simEntity);
    if (!netEntity) {
      return;
    }
    netEntity.modelId = snapshot.modelId;
    netEntity.position.x = snapshot.position.x;
    netEntity.position.y = snapshot.position.y;
    netEntity.position.z = snapshot.position.z;
    netEntity.x = snapshot.position.x;
    netEntity.y = snapshot.position.y;
    netEntity.z = snapshot.position.z;
    netEntity.rotation.x = snapshot.rotation.x;
    netEntity.rotation.y = snapshot.rotation.y;
    netEntity.rotation.z = snapshot.rotation.z;
    netEntity.rotation.w = snapshot.rotation.w;
    netEntity.grounded = snapshot.grounded;
    netEntity.health = snapshot.health;
    netEntity.maxHealth = snapshot.maxHealth;
  }

  public despawn(simEntity: object): void {
    const netEntity = this.netBySim.get(simEntity);
    if (!netEntity) {
      return;
    }
    this.spatialChannel.removeEntity(netEntity);
    this.netBySim.delete(simEntity);
  }
}
