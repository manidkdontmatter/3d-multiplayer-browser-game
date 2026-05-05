import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  type Scene
} from "three";
import {
  buildLocationTerrainConfig,
  buildTerrainMeshData,
  getLocationDefinitionByArchetypeId,
  MODEL_ID_PLATFORM_LINEAR,
  MODEL_ID_PLATFORM_ROTATING
} from "../../../shared/index";
import type { LocationRootState, PlatformState, TrainingDummyState } from "../types";

const PLATFORM_VISUALS = {
  [MODEL_ID_PLATFORM_LINEAR]: { halfX: 2.25, halfY: 0.35, halfZ: 2.25, color: 0xd8b691 },
  [MODEL_ID_PLATFORM_ROTATING]: { halfX: 2.8, halfY: 0.35, halfZ: 2.8, color: 0x9ea7d8 }
} as const;

const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;

interface LocationVisual {
  group: Group;
  lastSeenMs: number;
}

export class WorldEntityVisualSystem {
  private readonly platforms = new Map<number, Mesh>();
  private readonly trainingDummies = new Map<number, Mesh>();
  private readonly locations = new Map<number, LocationVisual>();
  private readonly quatScratch = new Quaternion();

  public constructor(private readonly scene: Scene) {}

  public syncLocationRoots(locationRoots: LocationRootState[]): void {
    const now = performance.now();
    const activeNids = new Set<number>();
    for (const root of locationRoots) {
      activeNids.add(root.nid);
      let visual = this.locations.get(root.nid);
      if (!visual) {
        const group = this.createLocationGroup(root);
        visual = { group, lastSeenMs: now };
        this.locations.set(root.nid, visual);
        this.scene.add(group);
      }
      visual.lastSeenMs = now;
      visual.group.visible = true;
      visual.group.position.set(root.x, root.y, root.z);
      this.quatScratch.set(root.rotation.x, root.rotation.y, root.rotation.z, root.rotation.w);
      visual.group.setRotationFromQuaternion(this.quatScratch);
    }

    for (const [nid, visual] of this.locations) {
      if (activeNids.has(nid)) {
        continue;
      }
      visual.group.visible = false;
      if (now - visual.lastSeenMs <= LOCATION_CACHE_TTL_MS) {
        continue;
      }
      this.scene.remove(visual.group);
      this.disposeObjectTree(visual.group);
      this.locations.delete(nid);
    }
  }

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
    for (const visual of this.locations.values()) {
      this.scene.remove(visual.group);
      this.disposeObjectTree(visual.group);
    }
    this.locations.clear();

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

  private createLocationGroup(root: LocationRootState): Group {
    const group = new Group();
    const definition = getLocationDefinitionByArchetypeId(root.locationArchetypeId);
    if (!definition) {
      return group;
    }

    if (definition.kind === "terrainIsland") {
      this.addTerrainIslandChildren(group, definition.archetypeId);
      return group;
    }
    if (definition.kind === "staticCastle") {
      this.addCastleChildren(group, 0x24222d, 0x5d526e);
      return group;
    }
    if (definition.kind === "movingCastle") {
      this.addCastleChildren(group, 0x253d55, 0x75a7c4);
      return group;
    }
    this.addArenaChildren(group);
    return group;
  }

  private addTerrainIslandChildren(group: Group, archetypeId: number): void {
    const definition = getLocationDefinitionByArchetypeId(archetypeId);
    const config = definition ? buildLocationTerrainConfig(definition) : null;
    if (!config) {
      return;
    }
    const terrain = buildTerrainMeshData(config);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(terrain.vertices, 3));
    geometry.setAttribute("color", new BufferAttribute(terrain.colors, 3));
    geometry.setIndex(new BufferAttribute(terrain.indices, 1));
    geometry.computeVertexNormals();
    group.add(
      new Mesh(
        geometry,
        new MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.95,
          metalness: 0.02
        })
      )
    );

    const bowl = new Mesh(
      new DodecahedronGeometry(config.groundHalfExtent * 0.9, 2),
      new MeshStandardMaterial({
        color: 0x8ed8ff,
        roughness: 0.08,
        metalness: 0.18,
        transparent: true,
        opacity: 0.34
      })
    );
    bowl.scale.set(1, 0.28, 1);
    bowl.position.y = -42;
    group.add(bowl);
  }

  private addCastleChildren(group: Group, baseColor: number, accentColor: number): void {
    const baseMaterial = new MeshStandardMaterial({ color: baseColor, roughness: 0.86, metalness: 0.05 });
    const accentMaterial = new MeshStandardMaterial({ color: accentColor, roughness: 0.76, metalness: 0.12 });
    this.addBox(group, 0, 0, 0, 68, 10, 48, baseMaterial);
    this.addBox(group, 0, 18, 0, 42, 16, 28, baseMaterial);
    this.addBox(group, -52, 12, -34, 12, 28, 12, accentMaterial);
    this.addBox(group, 52, 12, -34, 12, 28, 12, accentMaterial);
    this.addBox(group, -52, 12, 34, 12, 28, 12, accentMaterial);
    this.addBox(group, 52, 12, 34, 12, 28, 12, accentMaterial);
    this.addBox(group, 0, -8, 0, 92, 5, 64, accentMaterial);
  }

  private addArenaChildren(group: Group): void {
    const material = new MeshStandardMaterial({ color: 0x4e625f, roughness: 0.84, metalness: 0.08 });
    const accent = new MeshStandardMaterial({ color: 0xd8b691, roughness: 0.82, metalness: 0.1 });
    this.addBox(group, 0, 0, 0, 84, 4, 84, material);
    this.addBox(group, 0, 10, -68, 24, 12, 6, accent);
  }

  private addBox(
    group: Group,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: MeshStandardMaterial
  ): void {
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }

  private disposeObjectTree(root: Group): void {
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.geometry || !mesh.material) {
        return;
      }
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.dispose();
        }
      } else {
        material.dispose();
      }
    });
  }
}
