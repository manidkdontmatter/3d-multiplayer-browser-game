/**
 * Purpose: This file defines world state, world helpers, or world orchestration behavior, and defines physics setup, queries, or shared collision behavior.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { buildTerrainMeshData } from "./world";
import {
  PHYSICS_GROUP_CARRIER_SENSOR,
  PHYSICS_GROUP_SOLID
} from "./physicsCollisionGroups";
import {
  getWorldAnchorReferenceFrameVolumes,
  buildWorldAnchorTerrainConfig,
  sampleWorldAnchorTransform,
  WORLD_ANCHOR_DEFINITIONS,
  type WorldAnchorDefinition
} from "./worldLocations";
import type { ReferenceFrameVolumeDefinition } from "./movingReferenceFrames";

export function createStaticWorldColliders(world: RAPIER.World): void {
  const mapInstanceId = resolveRuntimeMapInstanceId();
  for (const definition of WORLD_ANCHOR_DEFINITIONS) {
    if (definition.mapInstanceIds && definition.mapInstanceIds.length > 0) {
      if (mapInstanceId !== null && !definition.mapInstanceIds.includes(mapInstanceId)) {
        continue;
      }
    }
    if (definition.motion !== "static") {
      continue;
    }
    createStaticLocationColliders(world, definition);
  }
}

function resolveRuntimeMapInstanceId(): string | null {
  if (typeof process === "undefined" || !process?.env) {
    return null;
  }
  const value = process.env.MAP_INSTANCE_ID;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createStaticLocationColliders(world: RAPIER.World, definition: WorldAnchorDefinition): void {
  const pose = sampleWorldAnchorTransform(definition, 0);
  if (definition.terrain) {
    const config = buildWorldAnchorTerrainConfig(definition);
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

  const collisionVolumes = definition.staticCollisionVolumes ?? [];
  for (const volume of collisionVolumes) {
    createFixedCuboid(
      world,
      pose.x + volume.localCenterX,
      pose.y + volume.localCenterY,
      pose.z + volume.localCenterZ,
      pose.yaw,
      volume.halfX,
      volume.halfY,
      volume.halfZ
    );
  }
}

export function createLocationKinematicCollider(
  world: RAPIER.World,
  definition: WorldAnchorDefinition,
  pose = sampleWorldAnchorTransform(definition, 0)
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

export function createLocationReferenceFrameSensorColliders(
  world: RAPIER.World,
  definition: WorldAnchorDefinition,
  body: RAPIER.RigidBody
): RAPIER.Collider[] {
  const colliders: RAPIER.Collider[] = [];
  for (const volume of getWorldAnchorReferenceFrameVolumes(definition)) {
    const desc = createReferenceFrameVolumeColliderDesc(volume);
    if (!desc) {
      continue;
    }
    desc
      .setSensor(true)
      .setCollisionGroups(PHYSICS_GROUP_CARRIER_SENSOR)
      .setSolverGroups(PHYSICS_GROUP_CARRIER_SENSOR)
      .setActiveCollisionTypes(
        RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC
      )
      .setTranslation(volume.localX, volume.localY, volume.localZ)
      .setRotation(yawToQuaternion(volume.localYaw ?? 0));
    colliders.push(world.createCollider(desc, body));
  }
  return colliders;
}

function createReferenceFrameVolumeColliderDesc(volume: ReferenceFrameVolumeDefinition): RAPIER.ColliderDesc | null {
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
  definition: WorldAnchorDefinition
): { halfX: number; halfY: number; halfZ: number } {
  const perAnchor = definition.movingCollisionHalfExtents;
  if (perAnchor) {
    return {
      halfX: Math.max(0.05, perAnchor.halfX),
      halfY: Math.max(0.05, perAnchor.halfY),
      halfZ: Math.max(0.05, perAnchor.halfZ)
    };
  }
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
