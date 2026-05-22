/**
 * Purpose: This file defines world state, world helpers, or world orchestration behavior, and maps gameplay/network state to renderable visual objects.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
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
  Vector3,
  SphereGeometry,
  type Scene
} from "three";
import {
  buildLocationTerrainConfig,
  getLocationCraftBenchSockets,
  buildTerrainMeshData,
  getLocationDefinitionByArchetypeId,
  getLocationPilotConsoleSockets,
  getLocationReferenceFrameVolumes
} from "../../../shared/index";
import type { ReferenceFrameVolumeDefinition } from "../../../shared/index";
import type { LocationRootState, WorldEntityState } from "../types";
import {
  getRenderArchetype,
  getLocationVisual
} from "./VisualRegistry";

const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const CARRIER_VOLUME_WIREFRAME_COLOR = 0x66e0ff;
let LOCATION_PRESENTATION_SMOOTH_RATE = 39;
let LOCATION_PRESENTATION_SNAP_DISTANCE = 24;
let LOCATION_PRESENTATION_SNAP_DOT = -0.25;
let LOCATION_PRESENTATION_SMOOTH_ENABLED = true;

interface LocationVisual {
  group: Group;
  worldAnchorId: number;
  lastSeenMs: number;
}

export class WorldEntityVisualSystem {
  private readonly worldEntities = new Map<number, Group>();
  private readonly locations = new Map<number, LocationVisual>();
  private readonly renderedLocationByPid = new Map<
    number,
    { x: number; y: number; z: number; rotation: { x: number; y: number; z: number; w: number } }
  >();
  private readonly quatScratch = new Quaternion();
  private readonly vectorScratch = new Vector3();

  public constructor(private readonly scene: Scene) {}

  public syncLocationRoots(locationRoots: LocationRootState[], frameDeltaSeconds: number): void {
    const now = performance.now();
    const activeNids = new Set<number>();
    this.renderedLocationByPid.clear();
    const dt = Math.max(0, Number.isFinite(frameDeltaSeconds) ? frameDeltaSeconds : 0);
    const alpha = dt > 0 ? 1 - Math.exp(-LOCATION_PRESENTATION_SMOOTH_RATE * dt) : 1;
    for (const root of locationRoots) {
      activeNids.add(root.nid);
      let visual = this.locations.get(root.nid);
      if (!visual) {
        const group = this.createLocationGroup(root);
        group.position.set(root.x, root.y, root.z);
        this.quatScratch.set(root.rotation.x, root.rotation.y, root.rotation.z, root.rotation.w);
        group.setRotationFromQuaternion(this.quatScratch);
        visual = { group, worldAnchorId: root.worldAnchorId, lastSeenMs: now };
        this.locations.set(root.nid, visual);
        this.scene.add(group);
      }
      visual.worldAnchorId = root.worldAnchorId;
      visual.lastSeenMs = now;
      visual.group.visible = true;
      this.quatScratch.set(root.rotation.x, root.rotation.y, root.rotation.z, root.rotation.w);
      this.vectorScratch.set(root.x, root.y, root.z);
      const snapDistance = visual.group.position.distanceTo(this.vectorScratch);
      const snapRotation = visual.group.quaternion.dot(this.quatScratch) < LOCATION_PRESENTATION_SNAP_DOT;
      if (
        !LOCATION_PRESENTATION_SMOOTH_ENABLED ||
        snapDistance >= LOCATION_PRESENTATION_SNAP_DISTANCE ||
        snapRotation ||
        alpha >= 1
      ) {
        visual.group.position.copy(this.vectorScratch);
        visual.group.quaternion.copy(this.quatScratch);
      } else {
        visual.group.position.lerp(this.vectorScratch, alpha);
        visual.group.quaternion.slerp(this.quatScratch, alpha);
      }
      this.renderedLocationByPid.set(visual.worldAnchorId, {
        x: visual.group.position.x,
        y: visual.group.position.y,
        z: visual.group.position.z,
        rotation: {
          x: visual.group.quaternion.x,
          y: visual.group.quaternion.y,
          z: visual.group.quaternion.z,
          w: visual.group.quaternion.w
        }
      });
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

  public getRenderedLocationRootByLocationPid(locationPid: number): {
    x: number;
    y: number;
    z: number;
    rotation: { x: number; y: number; z: number; w: number };
  } | null {
    const cached = this.renderedLocationByPid.get(locationPid);
    if (cached) {
      return cached;
    }
    for (const visual of this.locations.values()) {
      if (visual.worldAnchorId !== locationPid || !visual.group.visible) {
        continue;
      }
      return {
        x: visual.group.position.x,
        y: visual.group.position.y,
        z: visual.group.position.z,
        rotation: {
          x: visual.group.quaternion.x,
          y: visual.group.quaternion.y,
          z: visual.group.quaternion.z,
          w: visual.group.quaternion.w
        }
      };
    }
    return null;
  }

  public getRenderedLocationFrameSnapshot(): ReadonlyMap<
    number,
    { x: number; y: number; z: number; rotation: { x: number; y: number; z: number; w: number } }
  > {
    return this.renderedLocationByPid;
  }

  public getLocationPresentationTuning(): {
    enabled: boolean;
    smoothRate: number;
    snapDistance: number;
    snapDot: number;
  } {
    return {
      enabled: LOCATION_PRESENTATION_SMOOTH_ENABLED,
      smoothRate: LOCATION_PRESENTATION_SMOOTH_RATE,
      snapDistance: LOCATION_PRESENTATION_SNAP_DISTANCE,
      snapDot: LOCATION_PRESENTATION_SNAP_DOT
    };
  }

  public setLocationPresentationTuning(
    tuning: Partial<{ enabled: boolean; smoothRate: number; snapDistance: number; snapDot: number }>
  ): void {
    if (typeof tuning.enabled === "boolean") {
      LOCATION_PRESENTATION_SMOOTH_ENABLED = tuning.enabled;
    }
    if (typeof tuning.smoothRate === "number" && Number.isFinite(tuning.smoothRate)) {
      LOCATION_PRESENTATION_SMOOTH_RATE = Math.max(0, tuning.smoothRate);
    }
    if (typeof tuning.snapDistance === "number" && Number.isFinite(tuning.snapDistance)) {
      LOCATION_PRESENTATION_SNAP_DISTANCE = Math.max(0, tuning.snapDistance);
    }
    if (typeof tuning.snapDot === "number" && Number.isFinite(tuning.snapDot)) {
      LOCATION_PRESENTATION_SNAP_DOT = Math.max(-1, Math.min(1, tuning.snapDot));
    }
  }

  public syncWorldEntities(entities: WorldEntityState[]): void {
    const activeNids = new Set<number>();
    for (const entity of entities) {
      const archetype = getRenderArchetype(entity.renderArchetypeId);
      if (!archetype) {
        continue;
      }
      activeNids.add(entity.nid);
      let group = this.worldEntities.get(entity.nid);
      if (!group) {
        group = this.buildRuntimeEntityVisualGroup(entity);
        this.worldEntities.set(entity.nid, group);
        this.scene.add(group);
      }
      if (entity.health > 0 && entity.maxHealth > 0) {
        const healthRatio = Math.max(0, Math.min(1, entity.health / entity.maxHealth));
        const tintMultiplier = 0.45 + healthRatio * 0.55;
        this.applyRuntimeEntityTint(group, entity.tintColorRgb, tintMultiplier);
      } else {
        this.applyRuntimeEntityTint(group, entity.tintColorRgb, 1);
      }
      group.position.set(entity.x, entity.y, entity.z);
      this.quatScratch.set(entity.rotationX, entity.rotationY, entity.rotationZ, entity.rotationW);
      group.setRotationFromQuaternion(this.quatScratch);
      const uniformScale = Math.max(0.01, entity.uniformScalePct / 100);
      group.scale.set(uniformScale, uniformScale, uniformScale);
    }

    for (const [nid, group] of this.worldEntities) {
      if (activeNids.has(nid)) {
        continue;
      }
      this.scene.remove(group);
      this.disposeObjectTree(group);
      this.worldEntities.delete(nid);
    }
  }

  public dispose(): void {
    for (const visual of this.locations.values()) {
      this.scene.remove(visual.group);
      this.disposeObjectTree(visual.group);
    }
    this.locations.clear();

    for (const group of this.worldEntities.values()) {
      this.scene.remove(group);
      this.disposeObjectTree(group);
    }
    this.worldEntities.clear();
  }

  private buildRuntimeEntityVisualGroup(entity: WorldEntityState): Group {
    const group = new Group();
    const archetype = getRenderArchetype(entity.renderArchetypeId);
    if (!archetype || archetype.nodes.length <= 0) {
      return group;
    }
    this.addRenderArchetypeChildren(group, archetype.id);
    return group;
  }

  private applyRuntimeEntityTint(group: Group, tintColorRgb: number, scalar: number): void {
    const tint = Math.max(0, Math.min(0xffffff, Math.floor(tintColorRgb)));
    group.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.material) {
        return;
      }
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) {
          if ("color" in material) {
            (material as MeshStandardMaterial).color.setHex(tint).multiplyScalar(scalar);
          }
        }
        return;
      }
      const material = mesh.material as MeshStandardMaterial;
      if ("color" in material) {
        material.color.setHex(tint).multiplyScalar(scalar);
      }
    });
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
    const definition = getLocationDefinitionByArchetypeId(root.worldAnchorArchetypeId);
    if (!definition) {
      return group;
    }

    if (definition.kind === "terrainIsland") {
      this.addTerrainIslandChildren(group, definition.archetypeId);
      this.addCraftBenchPlaceholders(group, definition);
      return group;
    }
    if (definition.kind === "staticCastle") {
      this.addRenderArchetypeChildren(group, definition.modelId);
      this.addCraftBenchPlaceholders(group, definition);
      return group;
    }
    if (definition.kind === "movingCastle") {
      this.addRenderArchetypeChildren(group, definition.modelId);
      this.addReferenceFrameVolumeDebug(group, getLocationReferenceFrameVolumes(definition));
      this.addCraftBenchPlaceholders(group, definition);
      return group;
    }
    if (definition.kind === "movingTestPlatform") {
      this.addRenderArchetypeChildren(group, definition.modelId, definition.renderArchetypeScalePct ?? 100);
      this.addReferenceFrameVolumeDebug(group, getLocationReferenceFrameVolumes(definition));
      this.addPilotConsolePlaceholder(group, definition);
      this.addCraftBenchPlaceholders(group, definition);
      return group;
    }
    this.addRenderArchetypeChildren(group, definition.modelId);
    this.addCraftBenchPlaceholders(group, definition);
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

  private addRenderArchetypeChildren(group: Group, renderArchetypeId: number, scalePct = 100): void {
    const archetype = getRenderArchetype(renderArchetypeId);
    if (!archetype || archetype.nodes.length <= 0) {
      return;
    }
    const nodeScale = Math.max(0.01, Math.min(10, scalePct / 100));
    for (const node of archetype.nodes) {
      const material = new MeshStandardMaterial({
        color: node.color,
        roughness: node.roughness,
        metalness: node.metalness,
        emissive: node.emissive ?? 0x000000,
        emissiveIntensity: node.emissiveIntensity ?? 0
      });
      const mesh = new Mesh(this.buildGeometry(node.geometry, node.geometryParams), material);
      mesh.position.set(
        (node.localPosition?.x ?? 0) * nodeScale,
        (node.localPosition?.y ?? 0) * nodeScale,
        (node.localPosition?.z ?? 0) * nodeScale
      );
      mesh.scale.set(nodeScale, nodeScale, nodeScale);
      group.add(mesh);
    }
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

  private addReferenceFrameVolumeDebug(
    group: Group,
    volumes: readonly ReferenceFrameVolumeDefinition[] | undefined
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
      mesh.name = `reference-frame-volume-debug.${volume.id}`;
      mesh.position.set(volume.localX, volume.localY, volume.localZ);
      mesh.rotation.y = volume.localYaw ?? 0;
      group.add(mesh);
    }
  }

  private addPilotConsolePlaceholder(
    group: Group,
    definition: NonNullable<ReturnType<typeof getLocationDefinitionByArchetypeId>>
  ): void {
    const sockets = getLocationPilotConsoleSockets(definition);
    for (const socket of sockets) {
      const marker = socket.visualMarker;
      if (!marker || marker.geometry !== "box") {
        continue;
      }
      const base = new Mesh(
        new BoxGeometry(marker.sizeX, marker.sizeY, marker.sizeZ),
        new MeshStandardMaterial({
          color: marker.color,
          roughness: marker.roughness ?? 0.45,
          metalness: marker.metalness ?? 0.15
        })
      );
      base.position.set(socket.localX, socket.localY, socket.localZ);
      base.name = `pilot-console-placeholder.${socket.id}`;
      group.add(base);
    }
  }

  private addCraftBenchPlaceholders(
    group: Group,
    definition: NonNullable<ReturnType<typeof getLocationDefinitionByArchetypeId>>
  ): void {
    const sockets = getLocationCraftBenchSockets(definition);
    if (sockets.length <= 0) {
      return;
    }
    for (const socket of sockets) {
      const marker = socket.visualMarker;
      if (!marker || marker.geometry !== "box") {
        continue;
      }
      const base = new Mesh(
        new BoxGeometry(marker.sizeX, marker.sizeY, marker.sizeZ),
        new MeshStandardMaterial({
          color: marker.color,
          roughness: marker.roughness ?? 0.55,
          metalness: marker.metalness ?? 0.08
        })
      );
      base.position.set(socket.localX, socket.localY, socket.localZ);
      base.name = `craft-bench-placeholder.${socket.id}`;
      group.add(base);
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
