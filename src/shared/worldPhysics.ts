// Builds deterministic static Rapier colliders for authored void locations and terrain children.
import RAPIER from "@dimforge/rapier3d-compat";
import { buildTerrainMeshData } from "./world";
import {
  buildLocationTerrainConfig,
  sampleLocationTransform,
  VOID_LOCATION_DEFINITIONS,
  type LocationRootDefinition
} from "./worldLocations";

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
    world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, terrain.indices), terrainBody);
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
  const halfX = definition.kind === "movingCastle" ? 42 : 10;
  const halfY = definition.kind === "movingCastle" ? 9 : 4;
  const halfZ = definition.kind === "movingCastle" ? 28 : 10;
  const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ), body);
  body.setRotation(yawToQuaternion(pose.yaw), true);
  return { body, collider };
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
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ), body);
  body.setRotation(yawToQuaternion(yaw), true);
}

function yawToQuaternion(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw * 0.5), z: 0, w: Math.cos(yaw * 0.5) };
}
