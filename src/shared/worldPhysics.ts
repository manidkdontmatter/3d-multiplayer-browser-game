import RAPIER from "@dimforge/rapier3d-compat";
import { STATIC_WORLD_BLOCKS } from "./world";

export function createStaticWorldColliders(world: RAPIER.World): void {
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(128, 0.5, 128), groundBody);

  for (const block of STATIC_WORLD_BLOCKS) {
    const rotationZ = block.rotationZ ?? 0;
    const staticBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(block.x, block.y, block.z)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(block.halfX, block.halfY, block.halfZ),
      staticBody
    );
    staticBody.setRotation(
      { x: 0, y: 0, z: Math.sin(rotationZ * 0.5), w: Math.cos(rotationZ * 0.5) },
      true
    );
  }
}
