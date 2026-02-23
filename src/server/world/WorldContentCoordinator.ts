import type RAPIER from "@dimforge/rapier3d-compat";
import { PlatformSystem } from "../platform/PlatformSystem";
import {
  WorldBootstrapSystem,
  type WorldBootstrapDummy
} from "./WorldBootstrapSystem";

export interface WorldContentCoordinatorOptions {
  readonly world: RAPIER.World;
  readonly onDummyAdded?: (dummy: WorldBootstrapDummy) => void;
}

export interface TrainingDummyInitializationConfig {
  readonly spawns: ReadonlyArray<{ x: number; y: number; z: number; yaw: number }>;
  readonly capsuleHalfHeight: number;
  readonly capsuleRadius: number;
  readonly maxHealth: number;
  readonly modelId: number;
}

export interface WorldContentInitializationOptions {
  readonly platformSystem: PlatformSystem;
  readonly trainingDummies: TrainingDummyInitializationConfig;
  readonly resolveDummyEid: (dummy: WorldBootstrapDummy) => number;
  readonly registerDummyCollider: (colliderHandle: number, eid: number) => void;
}

export class WorldContentCoordinator {
  private readonly worldBootstrapSystem: WorldBootstrapSystem;

  public constructor(options: WorldContentCoordinatorOptions) {
    this.worldBootstrapSystem = new WorldBootstrapSystem({
      world: options.world,
      onDummyAdded: options.onDummyAdded
    });
  }

  public initializeWorldContent(options: WorldContentInitializationOptions): void {
    this.worldBootstrapSystem.createStaticWorldColliders();
    options.platformSystem.initializePlatforms();

    for (const dummy of this.worldBootstrapSystem.initializeTrainingDummies(
      options.trainingDummies.spawns,
      options.trainingDummies.capsuleHalfHeight,
      options.trainingDummies.capsuleRadius,
      options.trainingDummies.maxHealth,
      options.trainingDummies.modelId
    )) {
      const eid = options.resolveDummyEid(dummy);
      options.registerDummyCollider(dummy.collider.handle, eid);
    }
  }
}
