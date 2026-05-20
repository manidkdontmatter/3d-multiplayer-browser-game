/**
 * Purpose: This file manages large world location roots and their replicated identity.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  createLocationCarrierSensorColliders,
  createLocationKinematicCollider,
  getReferenceFrameCarryDelta,
  hasCarrierVolumesContainingPoint,
  MOVEMENT_MODE_GROUNDED,
  sampleLocationTransform,
  VOID_LOCATION_DEFINITIONS,
  type LocationRootDefinition
} from "../../shared/index";
import type { CarrierVolumeDefinition } from "../../shared/index";
import type { MovementMode } from "../../shared/index";

export interface LocationRootEntity {
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
  pid: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  prevYaw: number;
  definition: LocationRootDefinition;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  carrierSensorColliders: RAPIER.Collider[];
}

export interface LocationFrameActor {
  x: number;
  y: number;
  z: number;
  carriedFramePid: number | null;
  body: RAPIER.RigidBody;
  collider?: RAPIER.Collider;
}

export interface LocationFrameCarry {
  x: number;
  y: number;
  z: number;
  yaw: number;
  carriedFramePid: number | null;
}

export interface CarrierVolumeMembershipRef {
  framePid: number;
  volumeId: string;
}

const CARRIER_FRAME_STICKY_MARGIN = 0.25;

export interface LocationRootSystemOptions {
  readonly world: RAPIER.World;
  readonly onLocationAdded?: (location: LocationRootEntity) => void;
  readonly onLocationUpdated?: (location: LocationRootEntity) => void;
}

export class LocationRootSystem {
  private readonly locationsByPid = new Map<number, LocationRootEntity>();
  private readonly locationPidByCarrierSensorHandle = new Map<number, number>();
  private readonly carrierMembershipBySensorHandle = new Map<number, CarrierVolumeMembershipRef>();

  public constructor(private readonly options: LocationRootSystemOptions) {}

  public initializeLocations(): void {
    const mapInstanceId = (process.env.MAP_INSTANCE_ID ?? "").trim();
    for (const definition of VOID_LOCATION_DEFINITIONS) {
      if (definition.mapInstanceIds && definition.mapInstanceIds.length > 0) {
        if (mapInstanceId.length <= 0 || !definition.mapInstanceIds.includes(mapInstanceId)) {
          continue;
        }
      }
      const pose = sampleLocationTransform(definition, 0);
      const kinematic =
        definition.motion === "drift"
          ? createLocationKinematicCollider(this.options.world, definition, pose)
          : null;
      const carrierSensorColliders =
        kinematic?.body && definition.motion !== "static"
          ? createLocationCarrierSensorColliders(this.options.world, definition, kinematic.body)
          : [];
      const location: LocationRootEntity = {
        nid: 0,
        modelId: definition.modelId,
        position: { x: pose.x, y: pose.y, z: pose.z },
        rotation: yawToQuaternion(pose.yaw),
        grounded: false,
        movementMode: MOVEMENT_MODE_GROUNDED,
        health: 0,
        maxHealth: 0,
        locationKind: definition.kindId,
        locationArchetypeId: definition.archetypeId,
        locationSeed: definition.seed ?? 0,
        locationEnvironmentId: definition.environmentPresetId,
        locationStreamingRadius: definition.streamingRadius,
        locationInfluenceRadius: definition.influenceRadius,
        pid: definition.pid,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        prevX: pose.x,
        prevY: pose.y,
        prevZ: pose.z,
        prevYaw: pose.yaw,
        definition,
        body: kinematic?.body ?? null,
        collider: kinematic?.collider ?? null,
        carrierSensorColliders
      };
      this.locationsByPid.set(location.pid, location);
      const carrierVolumes = definition.carrierVolumes ?? [];
      let sensorIndex = 0;
      for (let i = 0; i < carrierVolumes.length; i += 1) {
        const volume = carrierVolumes[i];
        if (!volume || !isCarrierVolumeColliderValid(volume)) {
          continue;
        }
        const sensor = carrierSensorColliders[sensorIndex];
        sensorIndex += 1;
        if (!sensor) continue;
        this.locationPidByCarrierSensorHandle.set(sensor.handle, location.pid);
        const volumeId = volume.id;
        if (typeof volumeId === "string" && volumeId.length > 0) {
          this.carrierMembershipBySensorHandle.set(sensor.handle, {
            framePid: location.pid,
            volumeId
          });
        }
      }
      this.options.onLocationAdded?.(location);
    }
  }

  public updateLocations(previousSeconds: number, seconds: number): void {
    for (const location of this.locationsByPid.values()) {
      const previous = sampleLocationTransform(location.definition, previousSeconds);
      const current = sampleLocationTransform(location.definition, seconds);
      location.prevX = previous.x;
      location.prevY = previous.y;
      location.prevZ = previous.z;
      location.prevYaw = previous.yaw;
      location.x = current.x;
      location.y = current.y;
      location.z = current.z;
      location.yaw = current.yaw;
      location.position.x = current.x;
      location.position.y = current.y;
      location.position.z = current.z;
      location.rotation = yawToQuaternion(current.yaw);
      if (location.body) {
        location.body.setTranslation({ x: current.x, y: current.y, z: current.z }, true);
        location.body.setRotation(location.rotation, true);
      }
      this.options.onLocationUpdated?.(location);
    }
  }

  public sampleFrameCarry(actor: LocationFrameActor): LocationFrameCarry {
    const bodyPos = actor.body.translation();
    const previousLocation =
      actor.carriedFramePid === null ? null : this.locationsByPid.get(actor.carriedFramePid) ?? null;
    if (previousLocation && previousLocation.definition.motion !== "static") {
      const carry = this.sampleLocationCarryFromPreviousFrame(
        previousLocation,
        bodyPos,
        CARRIER_FRAME_STICKY_MARGIN
      );
      if (carry) {
        return carry;
      }
    }

    for (const location of this.locationsByPid.values()) {
      if (location.definition.motion === "static") {
        continue;
      }
      const carry = this.sampleLocationCarryFromPreviousFrame(location, bodyPos, 0);
      if (carry) {
        return carry;
      }
    }
    return { x: 0, y: 0, z: 0, yaw: 0, carriedFramePid: null };
  }

  public resolveCarriedFramePid(actor: LocationFrameActor): number | null {
    return this.resolveCarriedFramePidForPoint(actor.body.translation(), actor.carriedFramePid);
  }

  public resolveCarriedFramePidForPoint(
    point: { x: number; y: number; z: number },
    previousCarriedFramePid: number | null
  ): number | null {
    const previousLocation =
      previousCarriedFramePid === null ? null : this.locationsByPid.get(previousCarriedFramePid) ?? null;
    if (
      previousLocation &&
      previousLocation.definition.motion !== "static" &&
      this.containsPointInCurrentFrame(previousLocation, point, CARRIER_FRAME_STICKY_MARGIN)
    ) {
      return previousLocation.pid;
    }

    for (const location of this.locationsByPid.values()) {
      if (location.definition.motion === "static") {
        continue;
      }
      if (this.containsPointInCurrentFrame(location, point, 0)) {
        return location.pid;
      }
    }
    return null;
  }

  public sampleDynamicBodyFrameCarry(actor: Required<LocationFrameActor>): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    carriedFramePid: number | null;
  } {
    const bodyPos = actor.body.translation();
    let carriedLocationPid: number | null = null;
    this.options.world.intersectionPairsWith(actor.collider, (otherCollider) => {
      const locationPid = this.resolveLocationPidByCarrierSensorHandle(otherCollider.handle);
      if (locationPid === null) {
        return;
      }
      const location = this.locationsByPid.get(locationPid);
      if (!location || location.definition.motion === "static") {
        return;
      }
      carriedLocationPid = location.pid;
    });

    const carriedLocation =
      carriedLocationPid === null ? null : this.locationsByPid.get(carriedLocationPid) ?? null;
    if (carriedLocation === null) {
      return this.sampleFrameCarry(actor);
    }

    const carry = getReferenceFrameCarryDelta(
      {
        x: carriedLocation.prevX,
        y: carriedLocation.prevY,
        z: carriedLocation.prevZ,
        yaw: carriedLocation.prevYaw
      },
      {
        x: carriedLocation.x,
        y: carriedLocation.y,
        z: carriedLocation.z,
        yaw: carriedLocation.yaw
      },
      bodyPos
    );
    return { ...carry, carriedFramePid: carriedLocation.pid };
  }

  public resolveLocationPidByCarrierSensorHandle(colliderHandle: number): number | null {
    return this.locationPidByCarrierSensorHandle.get(colliderHandle) ?? null;
  }

  public collectCarrierVolumeMembershipsForCollider(collider: RAPIER.Collider): CarrierVolumeMembershipRef[] {
    const memberships: CarrierVolumeMembershipRef[] = [];
    this.options.world.intersectionPairsWith(collider, (otherCollider) => {
      const membership = this.carrierMembershipBySensorHandle.get(otherCollider.handle);
      if (!membership) {
        return;
      }
      memberships.push(membership);
    });
    return memberships;
  }

  private sampleLocationCarryFromPreviousFrame(
    location: LocationRootEntity,
    bodyPos: { x: number; y: number; z: number },
    margin: number
  ): LocationFrameCarry | null {
    const previous = { x: location.prevX, y: location.prevY, z: location.prevZ, yaw: location.prevYaw };
    if (!hasCarrierVolumesContainingPoint(location.definition.carrierVolumes, previous, bodyPos, margin)) {
      return null;
    }
    const current = { x: location.x, y: location.y, z: location.z, yaw: location.yaw };
    const carry = getReferenceFrameCarryDelta(previous, current, bodyPos);
    return { ...carry, carriedFramePid: location.pid };
  }

  private containsPointInCurrentFrame(
    location: LocationRootEntity,
    point: { x: number; y: number; z: number },
    margin: number
  ): boolean {
    const current = { x: location.x, y: location.y, z: location.z, yaw: location.yaw };
    return hasCarrierVolumesContainingPoint(location.definition.carrierVolumes, current, point, margin);
  }
}

function yawToQuaternion(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw * 0.5), z: 0, w: Math.cos(yaw * 0.5) };
}

function isCarrierVolumeColliderValid(volume: CarrierVolumeDefinition): boolean {
  if (volume.shape === "sphere") {
    return Math.max(0, volume.radius ?? 0) > 0;
  }
  const halfX = Math.max(0, volume.halfX ?? 0);
  const halfY = Math.max(0, volume.halfY ?? 0);
  const halfZ = Math.max(0, volume.halfZ ?? 0);
  return halfX > 0 && halfY > 0 && halfZ > 0;
}
