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
  private readonly netBySimEid = new Map<number, NetEntity>();

  public constructor(
    private readonly spatialChannel: {
      addEntity: (entity: unknown) => void;
      removeEntity: (entity: unknown) => void;
    }
  ) {}

  public spawn(simEid: number, snapshot: ReplicatedSnapshot): number {
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
    this.netBySimEid.set(simEid, netEntity);
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
      health: snapshot.health,
      maxHealth: snapshot.maxHealth
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
      health: number;
      maxHealth: number;
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
      state.health,
      state.maxHealth
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
    health: number,
    maxHealth: number
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
    netEntity.health = health;
    netEntity.maxHealth = maxHealth;
  }

  public despawn(simEid: number): void {
    const netEntity = this.netBySimEid.get(simEid);
    if (!netEntity) {
      return;
    }
    this.spatialChannel.removeEntity(netEntity);
    this.netBySimEid.delete(simEid);
  }
}
