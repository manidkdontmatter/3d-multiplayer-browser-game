/**
 * Purpose: This file controls what server data is replicated and how it is packaged.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { NType } from "../../shared/netcode";
import { MOVEMENT_MODE_GROUNDED, sanitizeMovementMode, type MovementMode } from "../../shared/index";
import type { WorldWithComponents } from "../ecs/SimulationEcsTypes";

type NetEntity = {
  nid: number;
  ntype: NType.RuntimeEntity | NType.WorldAnchorEntity;
  x: number; y: number; z: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  movementMode: MovementMode;
  health: number; maxHealth: number;
  pickupDefinitionId: number; itemQuantity: number;
  locationPid: number;
  locationKind: number; locationArchetypeId: number;
  locationSeed: number; locationEnvironmentId: number;
  locationStreamingRadius: number; locationInfluenceRadius: number;
};

type EntityChannel = {
  addEntity: (entity: unknown) => void;
  removeEntity: (entity: unknown) => void;
};

export class NetReplicationBridge {
  private readonly netBySimEid = new Map<number, NetEntity>();
  private readonly channelBySimEid = new Map<number, EntityChannel>();
  private readonly c: WorldWithComponents["components"];

  public constructor(
    private readonly nearChannel: EntityChannel,
    private readonly farChannel: EntityChannel,
    components: WorldWithComponents["components"]
  ) {
    this.c = components;
  }

  public spawn(simEid: number): number {
    const locKind = this.c.LocationKind.value[simEid] ?? 0;
    const locArchetypeId = this.c.LocationArchetypeId.value[simEid] ?? 0;
    const isLocationRoot = locKind > 0 && locArchetypeId > 0;
    const x = this.c.Position.x[simEid] ?? 0;
    const y = this.c.Position.y[simEid] ?? 0;
    const z = this.c.Position.z[simEid] ?? 0;

    const netEntity: NetEntity = {
      nid: 0,
      ntype: isLocationRoot ? NType.WorldAnchorEntity : NType.RuntimeEntity,
      x, y, z,
      modelId: this.c.ModelId.value[simEid] ?? 0,
      position: { x, y, z },
      rotation: {
        x: this.c.Rotation.x[simEid] ?? 0,
        y: this.c.Rotation.y[simEid] ?? 0,
        z: this.c.Rotation.z[simEid] ?? 0,
        w: this.c.Rotation.w[simEid] ?? 1
      },
      grounded: (this.c.Grounded.value[simEid] ?? 0) !== 0,
      movementMode: sanitizeMovementMode(this.c.MovementMode.value[simEid], MOVEMENT_MODE_GROUNDED),
      health: this.c.Health.value[simEid] ?? 0,
      maxHealth: this.c.Health.max[simEid] ?? 0,
      pickupDefinitionId: this.c.ItemArchetypeId.value[simEid] ?? 0,
      itemQuantity: this.c.ItemQuantity.value[simEid] ?? 0,
      locationPid: this.c.LocationPid.value[simEid] ?? 0,
      locationKind: locKind,
      locationArchetypeId: locArchetypeId,
      locationSeed: this.c.LocationSeed.value[simEid] ?? 0,
      locationEnvironmentId: this.c.LocationEnvironmentId.value[simEid] ?? 0,
      locationStreamingRadius: this.c.LocationStreamingRadius.value[simEid] ?? 0,
      locationInfluenceRadius: this.c.LocationInfluenceRadius.value[simEid] ?? 0
    };
    const channel = isLocationRoot ? this.farChannel : this.nearChannel;
    channel.addEntity(netEntity);
    this.netBySimEid.set(simEid, netEntity);
    this.channelBySimEid.set(simEid, channel);
    return netEntity.nid;
  }

  public sync(simEid: number): void {
    const netEntity = this.netBySimEid.get(simEid);
    if (!netEntity) return;
    const x = this.c.Position.x[simEid] ?? 0;
    const y = this.c.Position.y[simEid] ?? 0;
    const z = this.c.Position.z[simEid] ?? 0;
    netEntity.modelId = this.c.ModelId.value[simEid] ?? 0;
    netEntity.position.x = x;
    netEntity.position.y = y;
    netEntity.position.z = z;
    netEntity.x = x;
    netEntity.y = y;
    netEntity.z = z;
    netEntity.rotation.x = this.c.Rotation.x[simEid] ?? 0;
    netEntity.rotation.y = this.c.Rotation.y[simEid] ?? 0;
    netEntity.rotation.z = this.c.Rotation.z[simEid] ?? 0;
    netEntity.rotation.w = this.c.Rotation.w[simEid] ?? 1;
    netEntity.grounded = (this.c.Grounded.value[simEid] ?? 0) !== 0;
    netEntity.movementMode = sanitizeMovementMode(this.c.MovementMode.value[simEid], MOVEMENT_MODE_GROUNDED);
    netEntity.health = this.c.Health.value[simEid] ?? 0;
    netEntity.maxHealth = this.c.Health.max[simEid] ?? 0;
    netEntity.pickupDefinitionId = this.c.ItemArchetypeId.value[simEid] ?? 0;
    netEntity.itemQuantity = this.c.ItemQuantity.value[simEid] ?? 0;
    netEntity.locationPid = this.c.LocationPid.value[simEid] ?? 0;
    netEntity.locationKind = this.c.LocationKind.value[simEid] ?? 0;
    netEntity.locationArchetypeId = this.c.LocationArchetypeId.value[simEid] ?? 0;
    netEntity.locationSeed = this.c.LocationSeed.value[simEid] ?? 0;
    netEntity.locationEnvironmentId = this.c.LocationEnvironmentId.value[simEid] ?? 0;
    netEntity.locationStreamingRadius = this.c.LocationStreamingRadius.value[simEid] ?? 0;
    netEntity.locationInfluenceRadius = this.c.LocationInfluenceRadius.value[simEid] ?? 0;
  }

  public despawn(simEid: number): void {
    const netEntity = this.netBySimEid.get(simEid);
    if (!netEntity) return;
    const channel = this.channelBySimEid.get(simEid);
    if (channel) channel.removeEntity(netEntity);
    this.netBySimEid.delete(simEid);
    this.channelBySimEid.delete(simEid);
  }
}

