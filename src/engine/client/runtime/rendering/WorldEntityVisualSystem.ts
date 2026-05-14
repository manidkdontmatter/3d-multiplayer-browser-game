// Renders replicated world entities, deterministic platforms, and streamed location-root visuals.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  type Scene
} from "three";
import {
  buildLocationTerrainConfig,
  buildTerrainMeshData,
  getLocationDefinitionByArchetypeId,
  getItemDefinitionById,
  type WorldItemState
} from "../../../shared/index";
import type { CarrierVolumeDefinition } from "../../../shared/index";
import type { LocationRootState, NpcState, PlatformState, TrainingDummyState } from "../types";
import {
  getPlatformVisual,
  getNpcVisual,
  getItemVisual,
  getDummyVisual,
  getLocationVisual,
  type LocationVisualDef
} from "./VisualRegistry";

const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const CARRIER_VOLUME_WIREFRAME_COLOR = 0x66e0ff;

interface LocationVisual {
  group: Group;
  lastSeenMs: number;
}

export class WorldEntityVisualSystem {
  private readonly platforms = new Map<number, Mesh>();
  private readonly trainingDummies = new Map<number, Mesh>();
  private readonly npcs = new Map<number, Mesh>();
  private readonly worldItems = new Map<number, Mesh>();
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
      const platformVisual = getPlatformVisual(platform.modelId);
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
            roughness: platformVisual.roughness ?? 0.88,
            metalness: platformVisual.metalness ?? 0.06
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
        const visual = getDummyVisual();
        mesh = new Mesh(
          new CylinderGeometry(visual.radius, visual.radius, visual.height, visual.segments, 1),
          new MeshStandardMaterial({
            color: visual.color,
            roughness: visual.roughness,
            metalness: visual.metalness
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

  public syncNpcs(npcs: NpcState[]): void {
    const activeNids = new Set<number>();
    for (const npc of npcs) {
      activeNids.add(npc.nid);
      let mesh = this.npcs.get(npc.nid);
      if (!mesh) {
        const npcVisual = getNpcVisual(npc.modelId);
        const radius = npcVisual?.capsuleRadius ?? 0.35;
        const height = npcVisual?.capsuleHeight ?? 1.9;
        mesh = new Mesh(
          new CylinderGeometry(radius, radius, height, 14, 1),
          new MeshStandardMaterial({
            color: npcVisual?.color ?? 0xd89572,
            roughness: npcVisual?.roughness ?? 0.82,
            metalness: npcVisual?.metalness ?? 0.08
          })
        );
        this.npcs.set(npc.nid, mesh);
        this.scene.add(mesh);
      }
      const healthRatio =
        npc.maxHealth > 0 ? Math.max(0, Math.min(1, npc.health / npc.maxHealth)) : 1;
      const material = mesh.material as MeshStandardMaterial;
      const npcColor = getNpcVisual(npc.modelId)?.color ?? 0xd89572;
      material.color.set(npcColor).multiplyScalar(0.45 + healthRatio * 0.55);
      mesh.position.set(npc.x, npc.y, npc.z);
      this.quatScratch.set(npc.rotation.x, npc.rotation.y, npc.rotation.z, npc.rotation.w);
      mesh.setRotationFromQuaternion(this.quatScratch);
    }

    for (const [nid, mesh] of this.npcs) {
      if (activeNids.has(nid)) {
        continue;
      }
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      this.npcs.delete(nid);
    }
  }

  public syncWorldItems(items: WorldItemState[]): void {
    const activeNids = new Set<number>();
    for (const item of items) {
      const definition = getItemDefinitionById(item.itemArchetypeId);
      if (!definition) {
        continue;
      }
      activeNids.add(item.nid);
      let mesh = this.worldItems.get(item.nid);
      if (!mesh) {
        mesh = this.createWorldItemMesh(definition.modelId);
        this.worldItems.set(item.nid, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(item.x, item.y, item.z);
      this.quatScratch.set(item.rotation.x, item.rotation.y, item.rotation.z, item.rotation.w);
      mesh.setRotationFromQuaternion(this.quatScratch);
    }

    for (const [nid, mesh] of this.worldItems) {
      if (activeNids.has(nid)) {
        continue;
      }
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      this.worldItems.delete(nid);
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

    for (const mesh of this.npcs.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
    this.npcs.clear();

    for (const mesh of this.worldItems.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
    this.worldItems.clear();
  }

  private createWorldItemMesh(modelId: number): Mesh {
    const visual = getItemVisual(modelId);
    if (!visual) {
      return new Mesh(new BoxGeometry(0.22, 0.22, 0.22), new MeshStandardMaterial({ color: 0xe2d39a }));
    }
    const geometry = this.buildGeometry(visual.geometry, visual.geometryParams);
    return new Mesh(
      geometry,
      new MeshStandardMaterial({
        color: visual.color,
        roughness: visual.roughness,
        metalness: visual.metalness,
        emissive: visual.emissive ?? 0x000000,
        emissiveIntensity: visual.emissiveIntensity ?? 0
      })
    );
  }

  private buildGeometry(type: string, params: number[]): BufferGeometry {
    switch (type) {
      case "box":
        return new BoxGeometry(params[0] ?? 0.2, params[1] ?? 0.2, params[2] ?? 0.2);
      case "dodecahedron":
        return new DodecahedronGeometry(params[0] ?? 0.22, params[1] ?? 0);
      case "cylinder":
        return new CylinderGeometry(
          params[0] ?? 0.2, params[1] ?? 0.2, params[2] ?? 1, params[3] ?? 12, 1
        );
      case "sphere":
        return new SphereGeometry(params[0] ?? 0.22, params[1] ?? 12, params[2] ?? 8);
      default:
        return new BoxGeometry(0.22, 0.22, 0.22);
    }
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
      const vis = getLocationVisual("staticCastle");
      this.addCastleChildren(group, vis?.castleBaseColor ?? 0x24222d, vis?.castleAccentColor ?? 0x5d526e);
      return group;
    }
    if (definition.kind === "movingCastle") {
      const vis = getLocationVisual("movingCastle");
      this.addCastleChildren(group, vis?.castleBaseColor ?? 0x253d55, vis?.castleAccentColor ?? 0x75a7c4);
      this.addCarrierVolumeDebug(group, definition.carrierVolumes);
      return group;
    }
    if (definition.kind === "movingTestPlatform") {
      const vis = getLocationVisual("movingTestPlatform");
      this.addMovingTestPlatformChildren(group, vis);
      this.addCarrierVolumeDebug(group, definition.carrierVolumes);
      return group;
    }
    const arenaVis = getLocationVisual("testArena");
    this.addArenaChildren(group, arenaVis);
    return group;
  }

  private addTerrainIslandChildren(group: Group, archetypeId: number): void {
    const definition = getLocationDefinitionByArchetypeId(archetypeId);
    const config = definition ? buildLocationTerrainConfig(definition) : null;
    if (!config) {
      return;
    }
    const vis = getLocationVisual("terrainIsland");
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
          color: vis?.terrainColor ?? 0xffffff,
          vertexColors: true,
          roughness: vis?.terrainRoughness ?? 0.95,
          metalness: 0.02
        })
      )
    );

    const bowl = new Mesh(
      new DodecahedronGeometry(config.groundHalfExtent * 0.9, 2),
      new MeshStandardMaterial({
        color: vis?.bowlColor ?? 0x8ed8ff,
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

  private addMovingTestPlatformChildren(group: Group, vis?: LocationVisualDef): void {
    const slabMaterial = new MeshStandardMaterial({
      color: vis?.slabColor ?? 0x7fc7d9,
      roughness: 0.72,
      metalness: 0.08
    });
    const stripeMaterial = new MeshStandardMaterial({
      color: vis?.stripeColor ?? 0xf2d16b,
      roughness: 0.68,
      metalness: 0.05
    });
    this.addBox(group, 0, 0, 0, 120, 1, 70, slabMaterial);
    this.addBox(group, -40, 0.55, 0, 1.25, 0.1, 70.2, stripeMaterial);
    this.addBox(group, 40, 0.55, 0, 1.25, 0.1, 70.2, stripeMaterial);
  }

  private addArenaChildren(group: Group, vis?: LocationVisualDef): void {
    const material = new MeshStandardMaterial({ color: vis?.arenaColor ?? 0x4e625f, roughness: 0.84, metalness: 0.08 });
    const accent = new MeshStandardMaterial({ color: vis?.arenaAccentColor ?? 0xd8b691, roughness: 0.82, metalness: 0.1 });
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

  private addCarrierVolumeDebug(
    group: Group,
    volumes: readonly CarrierVolumeDefinition[] | undefined
  ): void {
    if (!volumes || volumes.length === 0) {
      return;
    }
    for (const volume of volumes) {
      const material = new MeshBasicMaterial({
        color: CARRIER_VOLUME_WIREFRAME_COLOR,
        transparent: true,
        opacity: 0.22,
        wireframe: true,
        depthWrite: false
      });
      const geometry =
        volume.shape === "sphere"
          ? new SphereGeometry(Math.max(0, volume.radius ?? 0), 24, 12)
          : new BoxGeometry(
              Math.max(0, volume.halfX ?? 0) * 2,
              Math.max(0, volume.halfY ?? 0) * 2,
              Math.max(0, volume.halfZ ?? 0) * 2
            );
      const mesh = new Mesh(geometry, material);
      mesh.name = `carrier-volume-debug.${volume.id}`;
      mesh.position.set(volume.localX, volume.localY, volume.localZ);
      mesh.rotation.y = volume.localYaw ?? 0;
      group.add(mesh);
    }
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
