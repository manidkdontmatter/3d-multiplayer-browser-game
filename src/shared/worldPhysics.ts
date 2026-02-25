// Builds deterministic static Rapier colliders for the active runtime map configuration.
import RAPIER from "@dimforge/rapier3d-compat";
import { getRuntimeMapLayout } from "./world";

export function createStaticWorldColliders(world: RAPIER.World): void {
  const layout = getRuntimeMapLayout();
  const groundHalfExtent = layout.config.groundHalfExtent;
  const groundHalfThickness = layout.config.groundHalfThickness;
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -groundHalfThickness, 0)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(groundHalfExtent, groundHalfThickness, groundHalfExtent),
    groundBody
  );

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
}
