/**
 * Purpose: This file controls what server data is replicated and how it is packaged.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { NType } from "../../shared/netcode";
import { MOVEMENT_MODE_GROUNDED, sanitizeMovementMode, type MovementMode } from "../../shared/index";
import {
  DEFAULT_MATERIAL_VARIANT_ID,
  DEFAULT_UNIFORM_SCALE_PCT,
  DEFAULT_TINT_COLOR_RGB,
  sanitizeMaterialVariantId,
  sanitizeRenderArchetypeId,
  sanitizeTintColorRgb,
  sanitizeUniformScalePct
} from "../../shared/appearance/AppearancePolicy";
import type { WorldWithComponents } from "../ecs/SimulationEcsTypes";

type NetEntity = {
  nid: number;
  ntype: NType.RuntimeEntity | NType.WorldAnchorEntity;
  x: number; y: number; z: number;
  modelId: number;
  renderArchetypeId: number;
  materialVariantId: number;
  tintColorRgb: number;
  uniformScalePct: number;
  equippedWeaponArchetypeId: number;
  equippedWeaponTintColorRgb: number;
  equippedHeadArchetypeId: number;
  equippedHeadTintColorRgb: number;
  equippedBodyArchetypeId: number;
  equippedBodyTintColorRgb: number;
  equippedLegsArchetypeId: number;
  equippedLegsTintColorRgb: number;
  equippedAccessoryArchetypeId: number;
  equippedAccessoryTintColorRgb: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  movementMode: MovementMode;
  health: number; maxHealth: number;
  pickupDefinitionId: number; itemQuantity: number;
  worldAnchorId: number;
  worldAnchorKind: number; worldAnchorArchetypeId: number;
  worldAnchorSeed: number; worldAnchorEnvironmentId: number;
  worldAnchorStreamingRadius: number; worldAnchorInfluenceRadius: number;
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
  private nearEntityCount = 0;
  private farEntityCount = 0;

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
      renderArchetypeId: sanitizeRenderArchetypeId(this.c.RenderArchetypeId.value[simEid] ?? (this.c.ModelId.value[simEid] ?? 0)),
      materialVariantId: sanitizeMaterialVariantId(this.c.MaterialVariantId.value[simEid] ?? DEFAULT_MATERIAL_VARIANT_ID),
      tintColorRgb: sanitizeTintColorRgb(this.c.TintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB),
      uniformScalePct: sanitizeUniformScalePct(this.c.UniformScalePct.value[simEid] ?? DEFAULT_UNIFORM_SCALE_PCT),
      equippedWeaponArchetypeId: sanitizeRenderArchetypeId(this.c.EquippedWeaponArchetypeId.value[simEid] ?? 0),
      equippedWeaponTintColorRgb: sanitizeTintColorRgb(this.c.EquippedWeaponTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB),
      equippedHeadArchetypeId: sanitizeRenderArchetypeId(this.c.EquippedHeadArchetypeId.value[simEid] ?? 0),
      equippedHeadTintColorRgb: sanitizeTintColorRgb(this.c.EquippedHeadTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB),
      equippedBodyArchetypeId: sanitizeRenderArchetypeId(this.c.EquippedBodyArchetypeId.value[simEid] ?? 0),
      equippedBodyTintColorRgb: sanitizeTintColorRgb(this.c.EquippedBodyTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB),
      equippedLegsArchetypeId: sanitizeRenderArchetypeId(this.c.EquippedLegsArchetypeId.value[simEid] ?? 0),
      equippedLegsTintColorRgb: sanitizeTintColorRgb(this.c.EquippedLegsTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB),
      equippedAccessoryArchetypeId: sanitizeRenderArchetypeId(this.c.EquippedAccessoryArchetypeId.value[simEid] ?? 0),
      equippedAccessoryTintColorRgb: sanitizeTintColorRgb(this.c.EquippedAccessoryTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB),
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
      worldAnchorId: this.c.LocationPid.value[simEid] ?? 0,
      worldAnchorKind: locKind,
      worldAnchorArchetypeId: locArchetypeId,
      worldAnchorSeed: this.c.LocationSeed.value[simEid] ?? 0,
      worldAnchorEnvironmentId: this.c.LocationEnvironmentId.value[simEid] ?? 0,
      worldAnchorStreamingRadius: this.c.LocationStreamingRadius.value[simEid] ?? 0,
      worldAnchorInfluenceRadius: this.c.LocationInfluenceRadius.value[simEid] ?? 0,
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
    if (isLocationRoot) {
      this.farEntityCount += 1;
    } else {
      this.nearEntityCount += 1;
    }
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
    netEntity.renderArchetypeId = sanitizeRenderArchetypeId(this.c.RenderArchetypeId.value[simEid] ?? (this.c.ModelId.value[simEid] ?? 0));
    netEntity.materialVariantId = sanitizeMaterialVariantId(this.c.MaterialVariantId.value[simEid] ?? DEFAULT_MATERIAL_VARIANT_ID);
    netEntity.tintColorRgb = sanitizeTintColorRgb(this.c.TintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB);
    netEntity.uniformScalePct = sanitizeUniformScalePct(this.c.UniformScalePct.value[simEid] ?? DEFAULT_UNIFORM_SCALE_PCT);
    netEntity.equippedWeaponArchetypeId = sanitizeRenderArchetypeId(this.c.EquippedWeaponArchetypeId.value[simEid] ?? 0);
    netEntity.equippedWeaponTintColorRgb = sanitizeTintColorRgb(this.c.EquippedWeaponTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB);
    netEntity.equippedHeadArchetypeId = sanitizeRenderArchetypeId(this.c.EquippedHeadArchetypeId.value[simEid] ?? 0);
    netEntity.equippedHeadTintColorRgb = sanitizeTintColorRgb(this.c.EquippedHeadTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB);
    netEntity.equippedBodyArchetypeId = sanitizeRenderArchetypeId(this.c.EquippedBodyArchetypeId.value[simEid] ?? 0);
    netEntity.equippedBodyTintColorRgb = sanitizeTintColorRgb(this.c.EquippedBodyTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB);
    netEntity.equippedLegsArchetypeId = sanitizeRenderArchetypeId(this.c.EquippedLegsArchetypeId.value[simEid] ?? 0);
    netEntity.equippedLegsTintColorRgb = sanitizeTintColorRgb(this.c.EquippedLegsTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB);
    netEntity.equippedAccessoryArchetypeId = sanitizeRenderArchetypeId(this.c.EquippedAccessoryArchetypeId.value[simEid] ?? 0);
    netEntity.equippedAccessoryTintColorRgb = sanitizeTintColorRgb(this.c.EquippedAccessoryTintColorRgb.value[simEid] ?? DEFAULT_TINT_COLOR_RGB);
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
    netEntity.worldAnchorId = this.c.LocationPid.value[simEid] ?? 0;
    netEntity.worldAnchorKind = this.c.LocationKind.value[simEid] ?? 0;
    netEntity.worldAnchorArchetypeId = this.c.LocationArchetypeId.value[simEid] ?? 0;
    netEntity.worldAnchorSeed = this.c.LocationSeed.value[simEid] ?? 0;
    netEntity.worldAnchorEnvironmentId = this.c.LocationEnvironmentId.value[simEid] ?? 0;
    netEntity.worldAnchorStreamingRadius = this.c.LocationStreamingRadius.value[simEid] ?? 0;
    netEntity.worldAnchorInfluenceRadius = this.c.LocationInfluenceRadius.value[simEid] ?? 0;
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
    if (channel === this.farChannel) {
      this.farEntityCount = Math.max(0, this.farEntityCount - 1);
    } else {
      this.nearEntityCount = Math.max(0, this.nearEntityCount - 1);
    }
    this.netBySimEid.delete(simEid);
    this.channelBySimEid.delete(simEid);
  }

  public getLiveReplicationCounts(): {
    nearEntities: number;
    farEntities: number;
    totalEntities: number;
  } {
    return {
      nearEntities: this.nearEntityCount,
      farEntities: this.farEntityCount,
      totalEntities: this.nearEntityCount + this.farEntityCount
    };
  }
}


