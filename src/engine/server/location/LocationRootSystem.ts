/**
 * Purpose: This file manages large world location roots and their replicated identity.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  createLocationReferenceFrameSensorColliders,
  getWorldAnchorReferenceFrameVolumes,
  createLocationKinematicCollider,
  getReferenceFrameCarryDelta,
  hasReferenceFrameVolumesContainingPoint,
  MOVEMENT_MODE_GROUNDED,
  sampleWorldAnchorTransform,
  WORLD_ANCHOR_DEFINITIONS,
  getWorldAnchorCraftBenchSockets,
  getWorldAnchorPilotConsoleSockets,
  resolveWorldAnchorAttachmentPoint,
  type WorldAnchorDefinition
} from "../../shared/index";
import type { ReferenceFrameVolumeDefinition } from "../../shared/index";
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
  definition: WorldAnchorDefinition;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  referenceFrameSensorColliders: RAPIER.Collider[];
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

export interface ReferenceFrameVolumeMembershipRef {
  framePid: number;
  volumeId: string;
}

export interface PilotConsoleInteractionRef {
  framePid: number;
  consoleId: string;
  volumeId: string;
}

export interface CraftBenchInteractionRef {
  framePid: number;
  benchId: string;
  interactRadius: number;
  sessionId: string;
}

const REFERENCE_FRAME_STICKY_MARGIN = 0.25;

export interface LocationRootSystemOptions {
  readonly world: RAPIER.World;
  readonly onLocationAdded?: (location: LocationRootEntity) => void;
  readonly onLocationUpdated?: (location: LocationRootEntity) => void;
}

export class LocationRootSystem {
  private readonly locationsByPid = new Map<number, LocationRootEntity>();
  private readonly locationPidByReferenceFrameSensorHandle = new Map<number, number>();
  private readonly referenceFrameMembershipBySensorHandle = new Map<number, ReferenceFrameVolumeMembershipRef>();
  private readonly pilotOffsetByFramePid = new Map<number, { x: number; y: number; z: number; yaw: number }>();
  private readonly previousPilotOffsetByFramePid = new Map<number, { x: number; y: number; z: number; yaw: number }>();

  public constructor(private readonly options: LocationRootSystemOptions) {}

  public initializeLocations(): void {
    const mapInstanceId = (process.env.MAP_INSTANCE_ID ?? "").trim();
    for (const definition of WORLD_ANCHOR_DEFINITIONS) {
      if (definition.mapInstanceIds && definition.mapInstanceIds.length > 0) {
        if (mapInstanceId.length <= 0 || !definition.mapInstanceIds.includes(mapInstanceId)) {
          continue;
        }
      }
      const pose = sampleWorldAnchorTransform(definition, 0);
      const kinematic =
        definition.motion === "drift"
          ? createLocationKinematicCollider(this.options.world, definition, pose)
          : null;
      const referenceFrameSensorColliders =
        kinematic?.body && definition.motion !== "static"
          ? createLocationReferenceFrameSensorColliders(this.options.world, definition, kinematic.body)
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
        referenceFrameSensorColliders
      };
      this.locationsByPid.set(location.pid, location);
      const referenceFrameVolumes = getWorldAnchorReferenceFrameVolumes(definition);
      let sensorIndex = 0;
      for (let i = 0; i < referenceFrameVolumes.length; i += 1) {
        const volume = referenceFrameVolumes[i];
        if (!volume || !isReferenceFrameVolumeColliderValid(volume)) {
          continue;
        }
        const sensor = referenceFrameSensorColliders[sensorIndex];
        sensorIndex += 1;
        if (!sensor) continue;
        this.locationPidByReferenceFrameSensorHandle.set(sensor.handle, location.pid);
        const volumeId = volume.id;
        if (typeof volumeId === "string" && volumeId.length > 0) {
          this.referenceFrameMembershipBySensorHandle.set(sensor.handle, {
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
      const previous = sampleWorldAnchorTransform(location.definition, previousSeconds);
      const current = sampleWorldAnchorTransform(location.definition, seconds);
      const offset = this.pilotOffsetByFramePid.get(location.pid) ?? null;
      const previousOffset = this.previousPilotOffsetByFramePid.get(location.pid) ?? offset;
      if (previousOffset) {
        previous.x += previousOffset.x;
        previous.y += previousOffset.y;
        previous.z += previousOffset.z;
        previous.yaw += previousOffset.yaw;
      }
      if (offset) {
        current.x += offset.x;
        current.y += offset.y;
        current.z += offset.z;
        current.yaw += offset.yaw;
      }
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
    this.previousPilotOffsetByFramePid.clear();
  }

  public sampleFrameCarry(actor: LocationFrameActor): LocationFrameCarry {
    const bodyPos = actor.body.translation();
    const previousLocation =
      actor.carriedFramePid === null ? null : this.locationsByPid.get(actor.carriedFramePid) ?? null;
    if (previousLocation && previousLocation.definition.motion !== "static") {
      const carry = this.sampleLocationCarryFromPreviousFrame(
        previousLocation,
        bodyPos,
        REFERENCE_FRAME_STICKY_MARGIN
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
      this.containsPointInCurrentFrame(previousLocation, point, REFERENCE_FRAME_STICKY_MARGIN)
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
      const locationPid = this.resolveLocationPidByReferenceFrameSensorHandle(otherCollider.handle);
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

  public resolveLocationPidByReferenceFrameSensorHandle(colliderHandle: number): number | null {
    return this.locationPidByReferenceFrameSensorHandle.get(colliderHandle) ?? null;
  }

  public collectReferenceFrameVolumeMembershipsForCollider(collider: RAPIER.Collider): ReferenceFrameVolumeMembershipRef[] {
    const memberships: ReferenceFrameVolumeMembershipRef[] = [];
    this.options.world.intersectionPairsWith(collider, (otherCollider) => {
      const membership = this.referenceFrameMembershipBySensorHandle.get(otherCollider.handle);
      if (!membership) {
        return;
      }
      memberships.push(membership);
    });
    return memberships;
  }

  public applyPilotControlIntent(
    framePid: number,
    intent: { forward: number; strafe: number; ascend: number; yawDelta: number; sprint: boolean },
    deltaSeconds: number
  ): void {
    const location = this.locationsByPid.get(framePid);
    if (!location || location.definition.motion === "static") {
      return;
    }
    const dt = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    if (dt <= 0) {
      return;
    }
    const speed = intent.sprint ? 22 : 14;
    const yawRate = 1.85;
    const base = this.pilotOffsetByFramePid.get(framePid) ?? { x: 0, y: 0, z: 0, yaw: 0 };
    const prior = this.previousPilotOffsetByFramePid.get(framePid);
    if (!prior) {
      this.previousPilotOffsetByFramePid.set(framePid, { ...base });
    }
    const effectiveYaw = location.yaw;
    const cosYaw = Math.cos(effectiveYaw);
    const sinYaw = Math.sin(effectiveYaw);
    const forward = Math.max(-1, Math.min(1, intent.forward));
    const strafe = Math.max(-1, Math.min(1, intent.strafe));
    const ascend = Math.max(-1, Math.min(1, intent.ascend));
    const yawDelta = Math.max(-1, Math.min(1, intent.yawDelta));
    const dx = (-sinYaw * forward + cosYaw * strafe) * speed * dt;
    const dz = (-cosYaw * forward - sinYaw * strafe) * speed * dt;
    const dy = ascend * speed * 0.65 * dt;
    base.x += dx;
    base.y += dy;
    base.z += dz;
    base.yaw += yawDelta * yawRate * dt;
    this.pilotOffsetByFramePid.set(framePid, base);
  }

  public findNearbyPilotConsole(
    point: { x: number; y: number; z: number },
    maxDistance: number
  ): PilotConsoleInteractionRef | null {
    const maxDistanceSq = Math.max(0, maxDistance) * Math.max(0, maxDistance);
    let best: PilotConsoleInteractionRef | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const location of this.locationsByPid.values()) {
      if (location.definition.motion === "static") {
        continue;
      }
      const sockets = getWorldAnchorPilotConsoleSockets(location.definition);
      if (sockets.length <= 0) {
        continue;
      }
      for (const socket of sockets) {
        const world = resolveWorldAnchorAttachmentPoint(
          { x: location.x, y: location.y, z: location.z, yaw: location.yaw },
          { x: socket.localX, y: socket.localY, z: socket.localZ }
        );
        const dx = world.x - point.x;
        const dy = world.y - point.y;
        const dz = world.z - point.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        const socketDistance = Math.max(0.25, socket.interactRadius);
        const allowed = Math.min(maxDistanceSq, socketDistance * socketDistance);
        if (distanceSq > allowed || distanceSq >= bestDistanceSq) {
          continue;
        }
        const volumeId = this.resolveReferenceFrameVolumeId(location, socket.preferredReferenceFrameVolumeId);
        if (!volumeId) {
          continue;
        }
        best = {
          framePid: location.pid,
          consoleId: socket.id,
          volumeId
        };
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }

  public findNearbyCraftBench(
    point: { x: number; y: number; z: number },
    maxDistance: number
  ): CraftBenchInteractionRef | null {
    const maxDistanceSq = Math.max(0, maxDistance) * Math.max(0, maxDistance);
    let best: CraftBenchInteractionRef | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const location of this.locationsByPid.values()) {
      const sockets = getWorldAnchorCraftBenchSockets(location.definition);
      if (sockets.length <= 0) {
        continue;
      }
      for (const socket of sockets) {
        const world = resolveWorldAnchorAttachmentPoint(
          { x: location.x, y: location.y, z: location.z, yaw: location.yaw },
          { x: socket.localX, y: socket.localY, z: socket.localZ }
        );
        const dx = world.x - point.x;
        const dy = world.y - point.y;
        const dz = world.z - point.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        const socketDistance = Math.max(0.25, socket.interactRadius);
        const allowed = Math.min(maxDistanceSq, socketDistance * socketDistance);
        if (distanceSq > allowed || distanceSq >= bestDistanceSq) {
          continue;
        }
        best = {
          framePid: location.pid,
          benchId: socket.id,
          interactRadius: socketDistance,
          sessionId: this.buildCraftBenchSessionId(location.pid, socket.id)
        };
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }

  public isPointWithinCraftBenchSession(
    point: { x: number; y: number; z: number },
    sessionId: string,
    extraSlack: number
  ): boolean {
    const parsed = this.parseCraftBenchSessionId(sessionId);
    if (!parsed) {
      return false;
    }
    const location = this.locationsByPid.get(parsed.framePid);
    if (!location) {
      return false;
    }
    const socket = getWorldAnchorCraftBenchSockets(location.definition).find((entry) => entry.id === parsed.benchId);
    if (!socket) {
      return false;
    }
    const world = resolveWorldAnchorAttachmentPoint(
      { x: location.x, y: location.y, z: location.z, yaw: location.yaw },
      { x: socket.localX, y: socket.localY, z: socket.localZ }
    );
    const dx = world.x - point.x;
    const dy = world.y - point.y;
    const dz = world.z - point.z;
    const maxDistance = Math.max(0.5, Math.max(0.25, socket.interactRadius) + Math.max(0, extraSlack));
    return dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance;
  }

  public getMaxCraftBenchInteractRadius(extraSlack: number): number {
    let max = 0;
    for (const location of this.locationsByPid.values()) {
      const sockets = getWorldAnchorCraftBenchSockets(location.definition);
      for (const socket of sockets) {
        max = Math.max(max, Math.max(0.25, socket.interactRadius) + Math.max(0, extraSlack));
      }
    }
    return max;
  }

  private resolveReferenceFrameVolumeId(location: LocationRootEntity, preferredVolumeId?: string): string | null {
    const volumes = getWorldAnchorReferenceFrameVolumes(location.definition);
    if (volumes.length <= 0) {
      return null;
    }
    if (preferredVolumeId && volumes.some((volume) => volume.id === preferredVolumeId)) {
      return preferredVolumeId;
    }
    for (const volume of volumes) {
      if (typeof volume.id === "string" && volume.id.length > 0) {
        return volume.id;
      }
    }
    return null;
  }

  private sampleLocationCarryFromPreviousFrame(
    location: LocationRootEntity,
    bodyPos: { x: number; y: number; z: number },
    margin: number
  ): LocationFrameCarry | null {
    const previous = { x: location.prevX, y: location.prevY, z: location.prevZ, yaw: location.prevYaw };
    if (!hasReferenceFrameVolumesContainingPoint(getWorldAnchorReferenceFrameVolumes(location.definition), previous, bodyPos, margin)) {
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
    return hasReferenceFrameVolumesContainingPoint(getWorldAnchorReferenceFrameVolumes(location.definition), current, point, margin);
  }

  private buildCraftBenchSessionId(framePid: number, benchId: string): string {
    return `${framePid}:${benchId}`;
  }

  private parseCraftBenchSessionId(sessionId: string): { framePid: number; benchId: string } | null {
    const pivot = sessionId.indexOf(":");
    if (pivot <= 0 || pivot >= sessionId.length - 1) {
      return null;
    }
    const framePid = Math.floor(Number(sessionId.slice(0, pivot)));
    const benchId = sessionId.slice(pivot + 1);
    if (!Number.isFinite(framePid) || framePid <= 0 || benchId.length <= 0) {
      return null;
    }
    return { framePid, benchId };
  }
}

function yawToQuaternion(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw * 0.5), z: 0, w: Math.cos(yaw * 0.5) };
}

function isReferenceFrameVolumeColliderValid(volume: ReferenceFrameVolumeDefinition): boolean {
  if (volume.shape === "sphere") {
    return Math.max(0, volume.radius ?? 0) > 0;
  }
  const halfX = Math.max(0, volume.halfX ?? 0);
  const halfY = Math.max(0, volume.halfY ?? 0);
  const halfZ = Math.max(0, volume.halfZ ?? 0);
  return halfX > 0 && halfY > 0 && halfZ > 0;
}
