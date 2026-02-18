import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  type Scene
} from "three";
import {
  MODEL_ID_PLATFORM_LINEAR,
  MODEL_ID_PLATFORM_ROTATING
} from "../../../shared/index";
import type { PlatformState, TrainingDummyState } from "../types";

const PLATFORM_VISUALS = {
  [MODEL_ID_PLATFORM_LINEAR]: { halfX: 2.25, halfY: 0.35, halfZ: 2.25, color: 0xd8b691 },
  [MODEL_ID_PLATFORM_ROTATING]: { halfX: 2.8, halfY: 0.35, halfZ: 2.8, color: 0x9ea7d8 }
} as const;

export class WorldEntityVisualSystem {
  private readonly platforms = new Map<number, Mesh>();
  private readonly trainingDummies = new Map<number, Mesh>();
  private readonly quatScratch = new Quaternion();

  public constructor(private readonly scene: Scene) {}

  public syncPlatforms(platformStates: PlatformState[]): void {
    const activeNids = new Set<number>();
    for (const platform of platformStates) {
      const platformVisual =
        PLATFORM_VISUALS[platform.modelId as keyof typeof PLATFORM_VISUALS];
      if (!platformVisual) {
        continue;
      }
      activeNids.add(platform.nid);
      let mesh = this.platforms.get(platform.nid);
      if (!mesh) {
        mesh = new Mesh(
          new BoxGeometry(
            platformVisual.halfX * 2,
            platformVisual.halfY * 2,
            platformVisual.halfZ * 2
          ),
          new MeshStandardMaterial({
            color: platformVisual.color,
            roughness: 0.88,
            metalness: 0.06
          })
        );
        this.platforms.set(platform.nid, mesh);
        this.scene.add(mesh);
      }

      mesh.position.set(platform.x, platform.y, platform.z);
      this.quatScratch.set(
        platform.rotation.x,
        platform.rotation.y,
        platform.rotation.z,
        platform.rotation.w
      );
      mesh.setRotationFromQuaternion(this.quatScratch);
    }

    for (const [nid, mesh] of this.platforms) {
      if (!activeNids.has(nid)) {
        this.scene.remove(mesh);
        this.platforms.delete(nid);
      }
    }
  }

  public syncTrainingDummies(dummies: TrainingDummyState[]): void {
    const activeNids = new Set<number>();
    for (const dummy of dummies) {
      activeNids.add(dummy.nid);
      let mesh = this.trainingDummies.get(dummy.nid);
      if (!mesh) {
        mesh = new Mesh(
          new CylinderGeometry(0.42, 0.42, 1.9, 12, 1),
          new MeshStandardMaterial({
            color: 0xa6c9d8,
            roughness: 0.88,
            metalness: 0.08
          })
        );
        this.trainingDummies.set(dummy.nid, mesh);
        this.scene.add(mesh);
      }
      const healthRatio =
        dummy.maxHealth > 0 ? Math.max(0, Math.min(1, dummy.health / dummy.maxHealth)) : 1;
      const material = mesh.material as MeshStandardMaterial;
      material.color.setHSL(0.06 + healthRatio * 0.38, 0.42, 0.52);
      mesh.position.set(dummy.x, dummy.y, dummy.z);
      this.quatScratch.set(
        dummy.rotation.x,
        dummy.rotation.y,
        dummy.rotation.z,
        dummy.rotation.w
      );
      mesh.setRotationFromQuaternion(this.quatScratch);
    }

    for (const [nid, mesh] of this.trainingDummies) {
      if (!activeNids.has(nid)) {
        this.scene.remove(mesh);
        this.trainingDummies.delete(nid);
      }
    }
  }

  public dispose(): void {
    for (const mesh of this.platforms.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
    this.platforms.clear();

    for (const mesh of this.trainingDummies.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
    this.trainingDummies.clear();
  }
}
