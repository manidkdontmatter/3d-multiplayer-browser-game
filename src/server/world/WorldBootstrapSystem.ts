import RAPIER from "@dimforge/rapier3d-compat";
import {
  createStaticWorldColliders,
  IDENTITY_QUATERNION,
  quaternionFromYaw
} from "../../shared/index";

export interface WorldBootstrapDummy {
  nid: number;
  modelId: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  maxHealth: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface WorldBootstrapSystemOptions {
  readonly world: RAPIER.World;
  readonly onDummyAdded?: (dummy: WorldBootstrapDummy) => void;
}

export class WorldBootstrapSystem {
  public constructor(private readonly options: WorldBootstrapSystemOptions) {}

  public createStaticWorldColliders(): void {
    createStaticWorldColliders(this.options.world);
  }

  public initializeTrainingDummies(
    spawns: ReadonlyArray<{ x: number; y: number; z: number; yaw: number }>,
    capsuleHalfHeight: number,
    capsuleRadius: number,
    maxHealth: number,
    modelId: number
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
        modelId,
        position: {
          x: spawn.x,
          y: spawn.y,
          z: spawn.z
        },
        rotation: {
          ...IDENTITY_QUATERNION
        },
        grounded: false,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        yaw: spawn.yaw,
        health: maxHealth,
        maxHealth,
        body,
        collider
      };
      const quat = quaternionFromYaw(spawn.yaw);
      dummy.rotation.x = quat.x;
      dummy.rotation.y = quat.y;
      dummy.rotation.z = quat.z;
      dummy.rotation.w = quat.w;
      this.options.onDummyAdded?.(dummy);
      dummies.push(dummy);
    }
    return dummies;
  }
}
