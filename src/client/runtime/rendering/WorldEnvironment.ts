// Owns scene/camera/renderer setup and deterministic static world visualization for the local map.
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Texture,
  Vector3 as Vec3,
  Vector3,
  WebGLRenderer
} from "three";
import {
  buildTerrainMeshData,
  DEFAULT_VISUAL_GRASS_VARIANTS,
  generateDeterministicVisualBushes,
  generateDeterministicVisualGrass,
  getRuntimeMapLayout,
  sampleTerrainHeightAt,
  sampleOceanHeightAt,
  type RuntimeMapConfig
} from "../../../shared/index";
import { getLoadedAsset } from "../../assets/assetLoader";
import { WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID } from "../../assets/assetManifest";
import type { PlayerPose } from "../types";

const LOCAL_FIRST_PERSON_ONLY_LAYER = 11;
const LOCAL_THIRD_PERSON_ONLY_LAYER = 12;
const OCEAN_SHORE_OVERLAP_HEIGHT = 1.1;

interface StaticPropVisual {
  kind: "tree" | "rock" | "bush";
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}

interface OceanTile {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial> | null;
  baseXZ: Float32Array;
}

interface GrassRenderVariant {
  id: string;
  assetId: string;
  billboardWidth: number;
  billboardHeight: number;
  windAmplitude: number;
  windSpeed: number;
  windSpatialFrequency: number;
}

interface GrassCellBatch {
  mesh: InstancedMesh;
  centerX: number;
  centerZ: number;
  fullCount: number;
  farCount: number;
}

const GRASS_RENDER_VARIANTS: readonly GrassRenderVariant[] = [
  {
    id: DEFAULT_VISUAL_GRASS_VARIANTS[0]?.id ?? "grass.plain",
    assetId: WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID,
    billboardWidth: 1.2,
    billboardHeight: 1.1,
    windAmplitude: 0.14,
    windSpeed: 2.2,
    windSpatialFrequency: 0.085
  }
];
const GRASS_WIND_ENABLED = true;
const GRASS_DISTANCE_FADE_ENABLED = false;
const GRASS_CELL_SIZE = 48;
const GRASS_LOD_NEAR_DISTANCE = 220;
const GRASS_LOD_FAR_DISTANCE = 600;
const GRASS_FAR_DENSITY_STRIDE = 3;
const GRASS_FADE_START_DISTANCE = 90;
const GRASS_FADE_END_DISTANCE = 150;

export class WorldEnvironment {
  public readonly renderer: WebGLRenderer;
  public readonly scene: Scene;
  public readonly camera: PerspectiveCamera;
  private readonly cameraForward = new Vector3(0, 0, -1);
  private readonly tempMatrix = new Matrix4();
  private readonly tempScale = new Vec3(1, 1, 1);
  private readonly e2eMode: boolean;
  private readonly headlessLite: boolean;
  private readonly oceanMeshEnabled: boolean;
  private readonly oceanWavesEnabled: boolean;
  private readonly windUniformUpdaters: Array<(timeSeconds: number) => void> = [];
  private readonly grassCellBatches: GrassCellBatch[] = [];
  private oceanSurface: OceanTile | null = null;
  private mapConfig: RuntimeMapConfig | null = null;

  public constructor(canvas: HTMLCanvasElement) {
    const params = new URLSearchParams(window.location.search);
    this.e2eMode = params.get("e2e") === "1";
    const headlessLiteParam = params.get("headlessLite");
    this.headlessLite =
      headlessLiteParam === "0" || headlessLiteParam === "false" ? false : this.e2eMode;
    const oceanMeshParam = params.get("oceanMesh");
    this.oceanMeshEnabled =
      oceanMeshParam === "0" || oceanMeshParam === "false"
        ? false
        : !this.e2eMode && !this.headlessLite;
    const oceanWavesParam = params.get("oceanWaves");
    this.oceanWavesEnabled =
      oceanWavesParam === "0" || oceanWavesParam === "false"
        ? false
        : !this.e2eMode && this.oceanMeshEnabled;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !this.e2eMode,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(this.e2eMode ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new Scene();
    this.scene.background = new Color(0xb8e4ff);
    this.scene.fog = new Fog(0xb8e4ff, 225, 1100);

    this.camera = new PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.01, 1200);
    this.camera.layers.enable(LOCAL_FIRST_PERSON_ONLY_LAYER);
    this.camera.layers.disable(LOCAL_THIRD_PERSON_ONLY_LAYER);

    this.initializeScene();
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public render(localPose: PlayerPose, renderServerTimeSeconds: number): void {
    this.camera.position.set(localPose.x, localPose.y, localPose.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = localPose.yaw;
    this.camera.rotation.x = localPose.pitch;
    for (const updateWindUniform of this.windUniformUpdaters) {
      updateWindUniform(renderServerTimeSeconds);
    }
    this.updateGrassLod(localPose.x, localPose.z);
    this.updateOceanSurface(renderServerTimeSeconds);
    this.renderer.render(this.scene, this.camera);
  }

  public getForwardDirection(): Vector3 {
    return this.cameraForward.set(0, 0, -1).applyEuler(this.camera.rotation).normalize();
  }

  public dispose(): void {
    this.renderer.dispose();
  }

  private initializeScene(): void {
    const layout = getRuntimeMapLayout({
      includeStaticBlocks: !this.headlessLite,
      includeStaticProps: !this.headlessLite
    });
    this.mapConfig = layout.config;
    const ambient = new AmbientLight(0xffffff, 0.52);
    this.scene.add(ambient);

    const sun = new DirectionalLight(0xfff6d0, 1.15);
    sun.position.set(80, 120, 40);
    this.scene.add(sun);

    if (!this.headlessLite) {
      const groundMaterial = new MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.95,
        metalness: 0.02
      });
      const terrain = buildTerrainMeshData(layout.config);
      const groundGeometry = new BufferGeometry();
      groundGeometry.setAttribute("position", new BufferAttribute(terrain.vertices, 3));
      groundGeometry.setAttribute("color", new BufferAttribute(terrain.colors, 3));
      groundGeometry.setIndex(new BufferAttribute(terrain.indices, 1));
      groundGeometry.computeVertexNormals();
      const ground = new Mesh(groundGeometry, groundMaterial);
      ground.receiveShadow = false;
      this.scene.add(ground);
    }
    if (this.oceanMeshEnabled) {
      this.createOceanSurface(layout.config);
    }

    if (!this.headlessLite) {
      const propMaterial = new MeshStandardMaterial({
        color: 0x8ea8ba,
        roughness: 0.82,
        metalness: 0.05
      });
      for (const worldBlock of layout.staticBlocks) {
        const block = new Mesh(
          new BoxGeometry(worldBlock.halfX * 2, worldBlock.halfY * 2, worldBlock.halfZ * 2),
          propMaterial
        );
        block.position.set(worldBlock.x, worldBlock.y, worldBlock.z);
        block.rotation.y = worldBlock.rotationY ?? 0;
        this.scene.add(block);
      }

      const clientBushes = generateDeterministicVisualBushes(layout.config);
      this.addProceduralPropInstances([...layout.staticProps, ...clientBushes]);
      this.addProceduralGrassInstances(layout.config);
    }
  }

  private createOceanSurface(config: RuntimeMapConfig): void {
    const outerHalf = config.groundHalfExtent * 3.2;
    const segmentsPerAxis = 312;
    const oceanMaterial = new MeshStandardMaterial({
      color: 0x2e78b8,
      roughness: 0.28,
      metalness: 0.06,
      transparent: false,
      opacity: 1,
      side: DoubleSide
    });
    this.oceanSurface = this.createOceanTileWithCenterHole(
      config,
      outerHalf,
      segmentsPerAxis,
      oceanMaterial
    );
    if (this.oceanSurface.mesh) {
      this.oceanSurface.mesh.frustumCulled = false;
      this.scene.add(this.oceanSurface.mesh);
    }
    this.updateOceanSurface(0);
  }

  private createOceanTileWithCenterHole(
    config: RuntimeMapConfig,
    outerHalf: number,
    segmentsPerAxis: number,
    material: MeshStandardMaterial
  ): OceanTile {
    const segmentsX = Math.max(32, Math.floor(segmentsPerAxis));
    const segmentsZ = Math.max(32, Math.floor(segmentsPerAxis));
    const verticesX = segmentsX + 1;
    const verticesZ = segmentsZ + 1;
    const vertexCount = verticesX * verticesZ;
    const positions = new Float32Array(vertexCount * 3);
    const baseXZ = new Float32Array(vertexCount * 2);
    const isLandVertex = new Uint8Array(vertexCount);
    const waterCandidateCell = new Uint8Array(segmentsX * segmentsZ);
    const oceanConnectedCell = new Uint8Array(segmentsX * segmentsZ);
    const indexList: number[] = [];
    const span = outerHalf * 2;
    const shorelineThreshold = config.oceanBaseHeight + OCEAN_SHORE_OVERLAP_HEIGHT;

    let vertexWrite = 0;
    let xzWrite = 0;
    for (let row = 0; row < verticesZ; row += 1) {
      const v = row / segmentsZ;
      const z = -outerHalf + span * v;
      for (let col = 0; col < verticesX; col += 1) {
        const u = col / segmentsX;
        const x = -outerHalf + span * u;
        positions[vertexWrite] = x;
        positions[vertexWrite + 1] = 0;
        positions[vertexWrite + 2] = z;
        baseXZ[xzWrite] = x;
        baseXZ[xzWrite + 1] = z;
        const terrainHeight = sampleTerrainHeightAt(config, x, z);
        isLandVertex[row * verticesX + col] = terrainHeight > shorelineThreshold ? 1 : 0;
        vertexWrite += 3;
        xzWrite += 2;
      }
    }

    for (let row = 0; row < segmentsZ; row += 1) {
      for (let col = 0; col < segmentsX; col += 1) {
        const topLeft = row * verticesX + col;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + verticesX;
        const bottomRight = bottomLeft + 1;
        const land0 = isLandVertex[topLeft] === 1;
        const land1 = isLandVertex[topRight] === 1;
        const land2 = isLandVertex[bottomLeft] === 1;
        const land3 = isLandVertex[bottomRight] === 1;
        const cellIndex = row * segmentsX + col;
        waterCandidateCell[cellIndex] = land0 && land1 && land2 && land3 ? 0 : 1;
      }
    }

    const queueRow: number[] = [];
    const queueCol: number[] = [];
    for (let row = 0; row < segmentsZ; row += 1) {
      for (let col = 0; col < segmentsX; col += 1) {
        const onBoundary = row === 0 || col === 0 || row === segmentsZ - 1 || col === segmentsX - 1;
        if (!onBoundary) {
          continue;
        }
        const cellIndex = row * segmentsX + col;
        if (waterCandidateCell[cellIndex] !== 1 || oceanConnectedCell[cellIndex] === 1) {
          continue;
        }
        oceanConnectedCell[cellIndex] = 1;
        queueRow.push(row);
        queueCol.push(col);
      }
    }

    const neighborOffsets = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 }
    ];
    for (let q = 0; q < queueRow.length; q += 1) {
      const row = queueRow[q] ?? 0;
      const col = queueCol[q] ?? 0;
      for (const offset of neighborOffsets) {
        const nr = row + offset.dr;
        const nc = col + offset.dc;
        if (nr < 0 || nr >= segmentsZ || nc < 0 || nc >= segmentsX) {
          continue;
        }
        const neighborIndex = nr * segmentsX + nc;
        if (waterCandidateCell[neighborIndex] !== 1 || oceanConnectedCell[neighborIndex] === 1) {
          continue;
        }
        oceanConnectedCell[neighborIndex] = 1;
        queueRow.push(nr);
        queueCol.push(nc);
      }
    }

    for (let row = 0; row < segmentsZ; row += 1) {
      for (let col = 0; col < segmentsX; col += 1) {
        const cellIndex = row * segmentsX + col;
        if (oceanConnectedCell[cellIndex] !== 1) {
          continue;
        }
        const topLeft = row * verticesX + col;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + verticesX;
        const bottomRight = bottomLeft + 1;
        indexList.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
      }
    }
    const indices = new Uint32Array(indexList);

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    return {
      mesh: new Mesh(geometry, material),
      baseXZ
    };
  }

  private updateOceanSurface(renderServerTimeSeconds: number): void {
    if (!this.oceanMeshEnabled || !this.mapConfig) {
      return;
    }
    const time =
      this.oceanWavesEnabled && Number.isFinite(renderServerTimeSeconds) ? renderServerTimeSeconds : 0;
    const surface = this.oceanSurface;
    if (!surface?.mesh) {
      return;
    }
    const position = surface.mesh.geometry.getAttribute("position");
    for (let i = 0, xz = 0; i < position.count; i += 1, xz += 2) {
      const x = surface.baseXZ[xz] ?? 0;
      const z = surface.baseXZ[xz + 1] ?? 0;
      const y = sampleOceanHeightAt(this.mapConfig, x, z, time);
      position.setY(i, y);
    }
    position.needsUpdate = true;
  }

  private addProceduralPropInstances(
    props: ReadonlyArray<StaticPropVisual>
  ): void {
    if (props.length === 0) {
      return;
    }

    const trees = props.filter((prop) => prop.kind === "tree");
    const rocks = props.filter((prop) => prop.kind === "rock");
    const bushes = props.filter((prop) => prop.kind === "bush");

    if (trees.length > 0) {
      const trunkGeometry = new CylinderGeometry(0.2, 0.26, 2.25, 8, 1);
      const trunkMaterial = new MeshStandardMaterial({
        color: 0x6f4b2e,
        roughness: 0.94,
        metalness: 0.01
      });
      const trunkMesh = new InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
      trunkMesh.frustumCulled = false;

      const canopyGeometry = new ConeGeometry(1.35, 2.9, 9, 1);
      const canopyMaterial = new MeshStandardMaterial({
        color: 0x2f7838,
        roughness: 0.88,
        metalness: 0.01
      });
      const canopyMesh = new InstancedMesh(canopyGeometry, canopyMaterial, trees.length);
      canopyMesh.frustumCulled = false;

      for (let i = 0; i < trees.length; i += 1) {
        const tree = trees[i];
        const scale = tree?.scale ?? 1;
        const rotationY = tree?.rotationY ?? 0;
        const x = tree?.x ?? 0;
        const y = tree?.y ?? 0;
        const z = tree?.z ?? 0;

        this.tempMatrix.makeRotationY(rotationY);
        this.tempScale.set(scale, scale, scale);
        this.tempMatrix.scale(this.tempScale);
        this.tempMatrix.setPosition(x, y + 1.15 * scale, z);
        trunkMesh.setMatrixAt(i, this.tempMatrix);

        this.tempMatrix.makeRotationY(rotationY);
        this.tempScale.set(scale, scale, scale);
        this.tempMatrix.scale(this.tempScale);
        this.tempMatrix.setPosition(x, y + 3.15 * scale, z);
        canopyMesh.setMatrixAt(i, this.tempMatrix);
      }

      trunkMesh.instanceMatrix.needsUpdate = true;
      canopyMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(trunkMesh);
      this.scene.add(canopyMesh);
    }

    if (rocks.length > 0) {
      const rockGeometry = new DodecahedronGeometry(0.85, 0);
      const rockMaterial = new MeshStandardMaterial({
        color: 0x73777f,
        roughness: 0.93,
        metalness: 0.02
      });
      const rockMesh = new InstancedMesh(rockGeometry, rockMaterial, rocks.length);
      rockMesh.frustumCulled = false;

      for (let i = 0; i < rocks.length; i += 1) {
        const rock = rocks[i];
        const scale = rock?.scale ?? 1;
        const rotationY = rock?.rotationY ?? 0;
        const x = rock?.x ?? 0;
        const y = rock?.y ?? 0;
        const z = rock?.z ?? 0;
        this.tempMatrix.makeRotationY(rotationY);
        this.tempScale.set(scale, scale * 0.82, scale);
        this.tempMatrix.scale(this.tempScale);
        this.tempMatrix.setPosition(x, y + 0.55 * scale, z);
        rockMesh.setMatrixAt(i, this.tempMatrix);
      }

      rockMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(rockMesh);
    }

    if (bushes.length > 0) {
      const bushGeometry = new SphereGeometry(0.72, 10, 8);
      const bushMaterial = new MeshStandardMaterial({
        color: 0x3e8a45,
        roughness: 0.9,
        metalness: 0.01
      });
      const bushMesh = new InstancedMesh(bushGeometry, bushMaterial, bushes.length);
      bushMesh.frustumCulled = false;

      for (let i = 0; i < bushes.length; i += 1) {
        const bush = bushes[i];
        const scale = bush?.scale ?? 1;
        const rotationY = bush?.rotationY ?? 0;
        const x = bush?.x ?? 0;
        const y = bush?.y ?? 0;
        const z = bush?.z ?? 0;
        this.tempMatrix.makeRotationY(rotationY);
        this.tempScale.set(scale * 1.15, scale * 0.82, scale * 1.15);
        this.tempMatrix.scale(this.tempScale);
        this.tempMatrix.setPosition(x, y + 0.62 * scale, z);
        bushMesh.setMatrixAt(i, this.tempMatrix);
      }

      bushMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(bushMesh);
    }
  }

  private addProceduralGrassInstances(config: RuntimeMapConfig): void {
    const grassInstances = generateDeterministicVisualGrass(config);
    if (grassInstances.length === 0) {
      return;
    }

    for (const renderVariant of GRASS_RENDER_VARIANTS) {
      const texture = getLoadedAsset<Texture>(renderVariant.assetId);
      if (!texture) {
        continue;
      }
      const variantInstances = grassInstances.filter((instance) => instance.variantId === renderVariant.id);
      if (variantInstances.length === 0) {
        continue;
      }
      const cells = this.partitionGrassIntoCells(variantInstances);

      for (const [cellKey, cellInstances] of cells.entries()) {
        const geometry = new PlaneGeometry(
          renderVariant.billboardWidth,
          renderVariant.billboardHeight,
          1,
          4
        );
        const material = new MeshStandardMaterial({
          map: texture,
          alphaTest: 0.22,
          transparent: false,
          side: DoubleSide,
          roughness: 0.95,
          metalness: 0.01
        });
        const updateWindUniform = this.configureGrassWind(material, renderVariant);
        this.windUniformUpdaters.push(updateWindUniform);

        const sortedInstances = [...cellInstances].sort((a, b) => {
          if (a.x !== b.x) {
            return a.x - b.x;
          }
          return a.z - b.z;
        });
        const farInstances = sortedInstances.filter((_, idx) => idx % GRASS_FAR_DENSITY_STRIDE === 0);
        const orderedInstances = [...farInstances];
        for (let i = 0; i < sortedInstances.length; i += 1) {
          const candidate = sortedInstances[i];
          if (candidate && i % GRASS_FAR_DENSITY_STRIDE !== 0) {
            orderedInstances.push(candidate);
          }
        }
        const grassMesh = new InstancedMesh(geometry, material, orderedInstances.length);
        grassMesh.frustumCulled = true;

        for (let i = 0; i < orderedInstances.length; i += 1) {
          const grass = orderedInstances[i];
          const scale = grass?.scale ?? 1;
          const x = grass?.x ?? 0;
          const y = grass?.y ?? 0;
          const z = grass?.z ?? 0;
          const rotationY = grass?.rotationY ?? 0;
          this.tempMatrix.makeRotationY(rotationY);
          this.tempScale.set(scale, scale, scale);
          this.tempMatrix.scale(this.tempScale);
          this.tempMatrix.setPosition(x, y + renderVariant.billboardHeight * 0.5 * scale, z);
          grassMesh.setMatrixAt(i, this.tempMatrix);
        }

        const cellCoords = this.parseGrassCellKey(cellKey);
        grassMesh.count = orderedInstances.length;
        grassMesh.visible = true;
        grassMesh.instanceMatrix.needsUpdate = true;
        grassMesh.computeBoundingSphere();
        this.scene.add(grassMesh);
        this.grassCellBatches.push({
          mesh: grassMesh,
          centerX: (cellCoords.cellX + 0.5) * GRASS_CELL_SIZE,
          centerZ: (cellCoords.cellZ + 0.5) * GRASS_CELL_SIZE,
          fullCount: orderedInstances.length,
          farCount: Math.max(1, farInstances.length)
        });
      }
    }
    this.updateGrassLod(this.camera.position.x, this.camera.position.z);
  }

  private updateGrassLod(cameraX: number, cameraZ: number): void {
    const nearSq = GRASS_LOD_NEAR_DISTANCE * GRASS_LOD_NEAR_DISTANCE;
    const farSq = GRASS_LOD_FAR_DISTANCE * GRASS_LOD_FAR_DISTANCE;
    for (const batch of this.grassCellBatches) {
      const dx = batch.centerX - cameraX;
      const dz = batch.centerZ - cameraZ;
      const distSq = dx * dx + dz * dz;
      let desiredCount = 0;
      if (distSq <= nearSq) {
        desiredCount = batch.fullCount;
      } else if (distSq <= farSq) {
        desiredCount = batch.farCount;
      }
      if (batch.mesh.count !== desiredCount) {
        batch.mesh.count = desiredCount;
        batch.mesh.visible = desiredCount > 0;
      }
    }
  }

  private partitionGrassIntoCells(
    instances: ReadonlyArray<{ x: number; z: number; scale: number; y: number; rotationY: number }>
  ): Map<string, ReadonlyArray<{ x: number; z: number; scale: number; y: number; rotationY: number }>> {
    const cells = new Map<string, Array<{ x: number; z: number; scale: number; y: number; rotationY: number }>>();
    for (const instance of instances) {
      const cellX = Math.floor(instance.x / GRASS_CELL_SIZE);
      const cellZ = Math.floor(instance.z / GRASS_CELL_SIZE);
      const key = `${cellX},${cellZ}`;
      const list = cells.get(key);
      if (list) {
        list.push(instance);
      } else {
        cells.set(key, [instance]);
      }
    }
    return cells;
  }

  private parseGrassCellKey(key: string): { cellX: number; cellZ: number } {
    const parts = key.split(",");
    const cellX = Number(parts[0]);
    const cellZ = Number(parts[1]);
    return {
      cellX: Number.isFinite(cellX) ? cellX : 0,
      cellZ: Number.isFinite(cellZ) ? cellZ : 0
    };
  }

  private configureGrassWind(
    material: MeshStandardMaterial,
    variant: GrassRenderVariant
  ): (timeSeconds: number) => void {
    if (!GRASS_WIND_ENABLED && !GRASS_DISTANCE_FADE_ENABLED) {
      return () => {};
    }
    const windTime = { value: 0 };
    material.onBeforeCompile = (shader) => {
      if (GRASS_DISTANCE_FADE_ENABLED) {
        shader.uniforms.uGrassFadeStart = { value: GRASS_FADE_START_DISTANCE };
        shader.uniforms.uGrassFadeEnd = { value: GRASS_FADE_END_DISTANCE };
      }
      if (GRASS_WIND_ENABLED) {
        shader.uniforms.uGrassWindTime = windTime;
      }
      if (GRASS_WIND_ENABLED || GRASS_DISTANCE_FADE_ENABLED) {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <common>",
          `#include <common>
uniform float uGrassWindTime;
varying vec3 vGrassWorldPosition;`
        );
      }
      if (GRASS_WIND_ENABLED) {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 grassInstanceOffset = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
  vec3 grassInstanceOffset = vec3(0.0);
#endif
  float grassTip = clamp(uv.y, 0.0, 1.0);
  float waveA = sin((grassInstanceOffset.x + grassInstanceOffset.z) * ${variant.windSpatialFrequency.toFixed(6)} + uGrassWindTime * ${variant.windSpeed.toFixed(6)});
  float waveB = cos((grassInstanceOffset.x - grassInstanceOffset.z) * ${(variant.windSpatialFrequency * 0.77).toFixed(6)} + uGrassWindTime * ${(variant.windSpeed * 1.19).toFixed(6)});
  transformed.x += waveA * ${variant.windAmplitude.toFixed(6)} * grassTip;
  transformed.z += waveB * ${(variant.windAmplitude * 0.65).toFixed(6)} * grassTip;`
        );
      }
      if (GRASS_DISTANCE_FADE_ENABLED) {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
vGrassWorldPosition = worldPosition.xyz;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <common>",
          `#include <common>
uniform float uGrassFadeStart;
uniform float uGrassFadeEnd;
varying vec3 vGrassWorldPosition;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <alphatest_fragment>",
          `#include <alphatest_fragment>
float grassFade = 1.0 - smoothstep(uGrassFadeStart, uGrassFadeEnd, distance(cameraPosition, vGrassWorldPosition));
diffuseColor.a *= grassFade;`
        );
      }
    };
    material.customProgramCacheKey = () =>
      `grass-wind-${variant.id}-${variant.windAmplitude}-${variant.windSpeed}-${variant.windSpatialFrequency}`;
    return (timeSeconds: number) => {
      windTime.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    };
  }

}
