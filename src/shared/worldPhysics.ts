// Builds deterministic static Rapier colliders for the active runtime map configuration.
import RAPIER from "@dimforge/rapier3d-compat";
import { buildTerrainMeshData, getRuntimeMapLayout } from "./world";

export function createStaticWorldColliders(world: RAPIER.World): void {
  const layout = getRuntimeMapLayout();
  const terrain = buildTerrainMeshData(layout.config);
  const terrainBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.trimesh(terrain.vertices, terrain.indices), terrainBody);

  for (const block of layout.staticBlocks) {
    const rotationY = block.rotationY ?? 0;
    const staticBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(block.x, block.y, block.z)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(block.halfX, block.halfY, block.halfZ),
      staticBody
    );
    staticBody.setRotation(
      { x: 0, y: Math.sin(rotationY * 0.5), z: 0, w: Math.cos(rotationY * 0.5) },
      true
    );
  }

  for (const prop of layout.staticProps) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(prop.x, prop.y, prop.z)
    );
    if (prop.kind === "tree") {
      const trunkRadius = 0.24 * prop.scale;
      const trunkHalfHeight = 1.15 * prop.scale;
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(trunkRadius, trunkHalfHeight, trunkRadius),
        body
      );
    } else if (prop.kind === "rock") {
      const rockRadius = 0.65 * prop.scale;
      world.createCollider(RAPIER.ColliderDesc.ball(rockRadius), body);
    }
    body.setRotation(
      { x: 0, y: Math.sin(prop.rotationY * 0.5), z: 0, w: Math.cos(prop.rotationY * 0.5) },
      true
    );
  }
}
