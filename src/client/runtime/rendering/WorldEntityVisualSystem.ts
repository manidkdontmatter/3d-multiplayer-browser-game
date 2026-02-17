import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  type Scene
} from "three";
import type { PlatformState, TrainingDummyState } from "../types";

export class WorldEntityVisualSystem {
  private readonly platforms = new Map<number, Mesh>();
  private readonly trainingDummies = new Map<number, Mesh>();

  public constructor(private readonly scene: Scene) {}

  public syncPlatforms(platformStates: PlatformState[]): void {
    const activeNids = new Set<number>();
    for (const platform of platformStates) {
      activeNids.add(platform.nid);
      let mesh = this.platforms.get(platform.nid);
      if (!mesh) {
        mesh = new Mesh(
          new BoxGeometry(platform.halfX * 2, platform.halfY * 2, platform.halfZ * 2),
          new MeshStandardMaterial({
            color: platform.kind === 2 ? 0x9ea7d8 : 0xd8b691,
            roughness: 0.88,
            metalness: 0.06
          })
        );
        this.platforms.set(platform.nid, mesh);
        this.scene.add(mesh);
      }

      mesh.position.set(platform.x, platform.y, platform.z);
      mesh.rotation.y = platform.yaw;
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
      mesh.rotation.y = dummy.yaw;
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
