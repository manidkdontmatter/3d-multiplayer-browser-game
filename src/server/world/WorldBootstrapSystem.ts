import RAPIER from "@dimforge/rapier3d-compat";
import type { ChannelAABB3D } from "nengi";
import { NType, STATIC_WORLD_BLOCKS } from "../../shared/index";

export interface WorldBootstrapDummy {
  nid: number;
  ntype: NType.TrainingDummyEntity;
  x: number;
  y: number;
  z: number;
  yaw: number;
  serverTick: number;
  health: number;
  maxHealth: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface WorldBootstrapSystemOptions {
  readonly world: RAPIER.World;
  readonly spatialChannel: ChannelAABB3D;
  readonly getTickNumber: () => number;
}

export class WorldBootstrapSystem {
  public constructor(private readonly options: WorldBootstrapSystemOptions) {}

  public createStaticWorldColliders(): void {
    const groundBody = this.options.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)
    );
    this.options.world.createCollider(RAPIER.ColliderDesc.cuboid(128, 0.5, 128), groundBody);

    for (const block of STATIC_WORLD_BLOCKS) {
      const rotationZ = block.rotationZ ?? 0;
      const staticBody = this.options.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(block.x, block.y, block.z)
      );
      this.options.world.createCollider(
        RAPIER.ColliderDesc.cuboid(block.halfX, block.halfY, block.halfZ),
        staticBody
      );
      staticBody.setRotation(
        { x: 0, y: 0, z: Math.sin(rotationZ * 0.5), w: Math.cos(rotationZ * 0.5) },
        true
      );
    }
  }

  public initializeTrainingDummies(
    spawns: ReadonlyArray<{ x: number; y: number; z: number; yaw: number }>,
    capsuleHalfHeight: number,
    capsuleRadius: number,
    maxHealth: number
  ): WorldBootstrapDummy[] {
    const dummies: WorldBootstrapDummy[] = [];
    for (const spawn of spawns) {
      const body = this.options.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(spawn.x, spawn.y, spawn.z)
      );
      const collider = this.options.world.createCollider(
        RAPIER.ColliderDesc.capsule(capsuleHalfHeight, capsuleRadius),
        body
      );
      const dummy: WorldBootstrapDummy = {
        nid: 0,
        ntype: NType.TrainingDummyEntity,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        yaw: spawn.yaw,
        serverTick: this.options.getTickNumber(),
        health: maxHealth,
        maxHealth,
        body,
        collider
      };
      this.options.spatialChannel.addEntity(dummy);
      dummies.push(dummy);
    }
    return dummies;
  }
}

