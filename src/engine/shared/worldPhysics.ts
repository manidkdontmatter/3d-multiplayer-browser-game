/**
 * Purpose: This file defines world state, world helpers, or world orchestration behavior, and defines physics setup, queries, or shared collision behavior.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { buildTerrainMeshData } from "./world";
import {
  PHYSICS_GROUP_CARRIER_TRIGGER,
  PHYSICS_GROUP_SOLID
} from "./physicsCollisionGroups";
import {
  buildLocationTerrainConfig,
  sampleLocationTransform,
  VOID_LOCATION_DEFINITIONS,
  type LocationRootDefinition
} from "./worldLocations";
import type { CarrierVolumeDefinition } from "./movingReferenceFrames";

export function createStaticWorldColliders(world: RAPIER.World): void {
  for (const definition of VOID_LOCATION_DEFINITIONS) {
    if (definition.motion !== "static") {
      continue;
    }
    createStaticLocationColliders(world, definition);
  }
}

function createStaticLocationColliders(world: RAPIER.World, definition: LocationRootDefinition): void {
  const pose = sampleLocationTransform(definition, 0);
  if (definition.kind === "terrainIsland") {
    const config = buildLocationTerrainConfig(definition);
    if (!config) {
      return;
    }
    const terrain = buildTerrainMeshData(config);
    const vertices = new Float32Array(terrain.vertices.length);
    for (let i = 0; i < terrain.vertices.length; i += 3) {
      vertices[i] = (terrain.vertices[i] ?? 0) + pose.x;
      vertices[i + 1] = (terrain.vertices[i + 1] ?? 0) + pose.y;
      vertices[i + 2] = (terrain.vertices[i + 2] ?? 0) + pose.z;
    }
    const terrainBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, terrain.indices)
        .setCollisionGroups(PHYSICS_GROUP_SOLID)
        .setSolverGroups(PHYSICS_GROUP_SOLID),
      terrainBody
    );
    return;
  }

  if (definition.kind === "staticCastle") {
    createFixedCuboid(world, pose.x, pose.y, pose.z, pose.yaw, 34, 5, 24);
    createFixedCuboid(world, pose.x, pose.y + 13, pose.z, pose.yaw, 22, 8, 14);
    createFixedCuboid(world, pose.x - 26, pose.y + 12, pose.z - 18, pose.yaw, 6, 14, 6);
    createFixedCuboid(world, pose.x + 26, pose.y + 12, pose.z - 18, pose.yaw, 6, 14, 6);
    createFixedCuboid(world, pose.x - 26, pose.y + 12, pose.z + 18, pose.yaw, 6, 14, 6);
    createFixedCuboid(world, pose.x + 26, pose.y + 12, pose.z + 18, pose.yaw, 6, 14, 6);
    return;
  }

  if (definition.kind === "testArena") {
    createFixedCuboid(world, pose.x, pose.y, pose.z, pose.yaw, 42, 2, 42);
    createFixedCuboid(world, pose.x, pose.y + 10, pose.z - 34, pose.yaw, 12, 6, 3);
  }
}

export function createLocationKinematicCollider(
  world: RAPIER.World,
  definition: LocationRootDefinition,
  pose = sampleLocationTransform(definition, 0)
): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pose.x, pose.y, pose.z)
  );
  const { halfX, halfY, halfZ } = getMovingLocationCollisionHalfExtents(definition);
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
      .setCollisionGroups(PHYSICS_GROUP_SOLID)
      .setSolverGroups(PHYSICS_GROUP_SOLID),
    body
  );
  body.setRotation(yawToQuaternion(pose.yaw), true);
  return { body, collider };
}

export function createLocationCarrierSensorColliders(
  world: RAPIER.World,
  definition: LocationRootDefinition,
  body: RAPIER.RigidBody
): RAPIER.Collider[] {
  const colliders: RAPIER.Collider[] = [];
  for (const volume of definition.carrierVolumes ?? []) {
    const desc = createCarrierVolumeColliderDesc(volume);
    if (!desc) {
      continue;
    }
    desc
      .setSensor(true)
      .setCollisionGroups(PHYSICS_GROUP_CARRIER_TRIGGER)
      .setSolverGroups(PHYSICS_GROUP_CARRIER_TRIGGER)
      .setTranslation(volume.localX, volume.localY, volume.localZ)
      .setRotation(yawToQuaternion(volume.localYaw ?? 0));
    colliders.push(world.createCollider(desc, body));
  }
  return colliders;
}

function createCarrierVolumeColliderDesc(volume: CarrierVolumeDefinition): RAPIER.ColliderDesc | null {
  if (volume.shape === "sphere") {
    const radius = Math.max(0, volume.radius ?? 0);
    return radius > 0 ? RAPIER.ColliderDesc.ball(radius) : null;
  }

  const halfX = Math.max(0, volume.halfX ?? 0);
  const halfY = Math.max(0, volume.halfY ?? 0);
  const halfZ = Math.max(0, volume.halfZ ?? 0);
  if (halfX <= 0 || halfY <= 0 || halfZ <= 0) {
    return null;
  }
  return RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ);
}

let _movingLocationCollisionExtents: ReadonlyMap<string, { halfX: number; halfY: number; halfZ: number }> = new Map();

export function injectMovingLocationCollisionExtents(
  extents: ReadonlyMap<string, { halfX: number; halfY: number; halfZ: number }>
): void {
  _movingLocationCollisionExtents = extents;
}

function getMovingLocationCollisionHalfExtents(
  definition: LocationRootDefinition
): { halfX: number; halfY: number; halfZ: number } {
  const entry = _movingLocationCollisionExtents.get(definition.kind);
  if (entry) return entry;
  return { halfX: 10, halfY: 4, halfZ: 10 };
}

function createFixedCuboid(
  world: RAPIER.World,
  x: number,
  y: number,
  z: number,
  yaw: number,
  halfX: number,
  halfY: number,
  halfZ: number
): void {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
      .setCollisionGroups(PHYSICS_GROUP_SOLID)
      .setSolverGroups(PHYSICS_GROUP_SOLID),
    body
  );
  body.setRotation(yawToQuaternion(yaw), true);
}

function yawToQuaternion(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw * 0.5), z: 0, w: Math.cos(yaw * 0.5) };
}
