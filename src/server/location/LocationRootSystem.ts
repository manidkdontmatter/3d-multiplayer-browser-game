// Owns authoritative prototype void-location roots and moving-location frame carry.
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  createLocationKinematicCollider,
  MOVEMENT_MODE_GROUNDED,
  sampleLocationTransform,
  VOID_LOCATION_DEFINITIONS,
  type LocationRootDefinition
} from "../../shared/index";
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
}

export interface LocationFrameActor {
  x: number;
  y: number;
  z: number;
  body: RAPIER.RigidBody;
}

export interface LocationRootSystemOptions {
  readonly world: RAPIER.World;
  readonly onLocationAdded?: (location: LocationRootEntity) => void;
  readonly onLocationUpdated?: (location: LocationRootEntity) => void;
}

export class LocationRootSystem {
  private readonly locationsByPid = new Map<number, LocationRootEntity>();

  public constructor(private readonly options: LocationRootSystemOptions) {}

  public initializeLocations(): void {
    for (const definition of VOID_LOCATION_DEFINITIONS) {
      const pose = sampleLocationTransform(definition, 0);
      const kinematic =
        definition.motion === "drift"
          ? createLocationKinematicCollider(this.options.world, definition, pose)
          : null;
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
        collider: kinematic?.collider ?? null
      };
      this.locationsByPid.set(location.pid, location);
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

  public sampleFrameCarry(actor: LocationFrameActor): { x: number; y: number; z: number; yaw: number } {
    const bodyPos = actor.body.translation();
    for (const location of this.locationsByPid.values()) {
      if (location.definition.motion === "static") {
        continue;
      }
      const dx = bodyPos.x - location.x;
      const dy = bodyPos.y - location.y;
      const dz = bodyPos.z - location.z;
      const radius = location.definition.influenceRadius;
      if (dx * dx + dy * dy + dz * dz > radius * radius) {
        continue;
      }
      return {
        x: location.x - location.prevX,
        y: location.y - location.prevY,
        z: location.z - location.prevZ,
        yaw: location.yaw - location.prevYaw
      };
    }
    return { x: 0, y: 0, z: 0, yaw: 0 };
  }
}

function yawToQuaternion(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw * 0.5), z: 0, w: Math.cos(yaw * 0.5) };
}
