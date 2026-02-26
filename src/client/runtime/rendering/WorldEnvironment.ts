// Owns scene/camera/renderer setup and deterministic static world visualization for the local map.
import {
  ACESFilmicToneMapping,
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
  ShaderMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  Texture,
  Vector3 as Vec3,
  Vector3,
  WebGLRenderer
} from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import {
  buildTerrainMeshData,
  DEFAULT_VISUAL_GRASS_VARIANTS,
  generateDeterministicVisualBushes,
  generateDeterministicVisualGrass,
  getRuntimeMapLayout,
  sampleTerrainHeightAt,
  sampleOceanHeightAt,
  type RuntimeMapConfig,
  type VisualGrassInstance
} from "../../../shared/index";
import { configureAssetLoaderRenderer, ensureAsset, getLoadedAsset } from "../../assets/assetLoader";
import {
  WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID,
  WORLD_WATER_NORMALS_A_ASSET_ID,
  WORLD_WATER_NORMALS_B_ASSET_ID,
  WORLD_WATER_NORMALS_ASSET_ID
} from "../../assets/assetManifest";
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
  mesh: Mesh<BufferGeometry, ShaderMaterial | MeshStandardMaterial> | null;
  baseXZ: Float32Array;
  terrainHeights: Float32Array;
  shoreFoam: Float32Array;
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
  private readonly sunDirection = new Vector3(0.33, 0.9, 0.22).normalize();
  private skyDome: Sky | null = null;
  private sunLight: DirectionalLight | null = null;
  private oceanSurface: OceanTile | null = null;
  private groundMaterial: MeshStandardMaterial | null = null;
  private deferredTerrainCausticsPending = false;
  private deferredOceanUpgradePending = false;
  private pendingGrassInstances: VisualGrassInstance[] | null = null;
  private mapConfig: RuntimeMapConfig | null = null;
  private worldTextureRequestsIssued = false;
  private grassInstancesAdded = false;

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
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    configureAssetLoaderRenderer(this.renderer);

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
    this.maybeApplyDeferredVisuals();
    this.updateGrassLod(localPose.x, localPose.z);
    this.updateOceanSurface(renderServerTimeSeconds);
    this.renderer.render(this.scene, this.camera);
  }

  public getForwardDirection(): Vector3 {
    return this.cameraForward.set(0, 0, -1).applyEuler(this.camera.rotation).normalize();
  }

  public dispose(): void {
    this.renderer.dispose();
    this.grassCellBatches.length = 0;
    this.pendingGrassInstances = null;
  }

  private initializeScene(): void {
    const layout = getRuntimeMapLayout({
      includeStaticBlocks: !this.headlessLite,
      includeStaticProps: !this.headlessLite
    });
    this.mapConfig = layout.config;
    const ambient = new AmbientLight(0xffffff, 0.48);
    this.scene.add(ambient);

    const sun = new DirectionalLight(0xfff2d9, 1.05);
    this.sunLight = sun;
    sun.position.copy(this.sunDirection).multiplyScalar(220);
    this.scene.add(sun);
    if (!this.headlessLite) {
      this.configureSkyEnvironment();
    }

    if (!this.headlessLite) {
      this.requestWorldTextureAssets();
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
      this.groundMaterial = groundMaterial;
      this.deferredTerrainCausticsPending = !this.configureTerrainCaustics(groundMaterial, layout.config);
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
      this.pendingGrassInstances = generateDeterministicVisualGrass(layout.config);
      this.tryAddGrassInstances();
    }
  }

  private configureTerrainCaustics(material: MeshStandardMaterial, config: RuntimeMapConfig): boolean {
    const normalA =
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_A_ASSET_ID) ??
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_ASSET_ID);
    const normalB =
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_B_ASSET_ID) ??
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_ASSET_ID);
    if (!normalA || !normalB) {
      return false;
    }
    normalA.wrapS = RepeatWrapping;
    normalA.wrapT = RepeatWrapping;
    normalA.needsUpdate = true;
    normalB.wrapS = RepeatWrapping;
    normalB.wrapT = RepeatWrapping;
    normalB.needsUpdate = true;

    const uTime = { value: 0 };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCausticTime = uTime;
      shader.uniforms.uCausticTexA = { value: normalA };
      shader.uniforms.uCausticTexB = { value: normalB };
      shader.uniforms.uOceanBaseHeight = { value: config.oceanBaseHeight };
      shader.uniforms.uWaveAmplitude = { value: config.oceanWaveAmplitude };
      shader.uniforms.uWaveSpeed = { value: config.oceanWaveSpeed };
      shader.uniforms.uWaveLength = { value: config.oceanWaveLength };
      shader.uniforms.uCausticStrength = { value: 0.28 };

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
varying vec3 vCausticWorldPos;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vCausticWorldPos = worldPosition.xyz;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
varying vec3 vCausticWorldPos;
uniform float uCausticTime;
uniform sampler2D uCausticTexA;
uniform sampler2D uCausticTexB;
uniform float uOceanBaseHeight;
uniform float uWaveAmplitude;
uniform float uWaveSpeed;
uniform float uWaveLength;
uniform float uCausticStrength;

float causticComponentWave(vec2 p, vec2 dir, float ampMul, float speedMul, float lenMul, float phaseSeed, float crestMul) {
  float waveSpeed = max(0.0, uWaveSpeed);
  float baseLength = max(1.0, uWaveLength);
  float wavelength = max(1.0, baseLength * lenMul);
  float k = 6.28318530718 / wavelength;
  float omega = k * waveSpeed * speedMul;
  float phase = dot(p, dir) * k + uCausticTime * omega + phaseSeed;
  float primary = sin(phase);
  float crest = sin(phase * 2.0 + phaseSeed * 0.37) * crestMul;
  return (primary + crest) * max(0.0, uWaveAmplitude) * ampMul;
}

float sampleOceanAt(vec2 p) {
  float amplitude = max(0.0, uWaveAmplitude);
  if (amplitude <= 0.00001) return uOceanBaseHeight;
  float wave = 0.0;
  wave += causticComponentWave(p, normalize(vec2(0.92, 0.38)), 1.00, 1.00, 1.35, 0.7, 0.12);
  wave += causticComponentWave(p, normalize(vec2(-0.51, 0.86)), 0.46, 1.16, 1.05, 2.1, 0.14);
  wave += causticComponentWave(p, normalize(vec2(0.17, -0.98)), 0.18, 1.32, 0.88, 4.0, 0.18);
  return uOceanBaseHeight + wave;
}`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `float oceanY = sampleOceanAt(vCausticWorldPos.xz);
float underWater = step(vCausticWorldPos.y, oceanY - 0.05);
float depth = clamp((oceanY - vCausticWorldPos.y) / 3.0, 0.0, 1.0);
vec2 cUv = vCausticWorldPos.xz * 0.024;
float cA = texture2D(uCausticTexA, cUv + vec2(uCausticTime * 0.037, -uCausticTime * 0.026)).r;
float cB = texture2D(uCausticTexB, cUv * 1.67 + vec2(-uCausticTime * 0.031, uCausticTime * 0.039)).g;
float caustic = pow(max(0.0, cA + cB - 0.96), 2.1) * underWater * (1.0 - depth);
gl_FragColor.rgb += vec3(0.42, 0.66, 0.85) * caustic * uCausticStrength;
#include <dithering_fragment>`
      );
    };
    material.customProgramCacheKey = () => "terrain-caustics-v2";
    material.needsUpdate = true;
    this.windUniformUpdaters.push((timeSeconds) => {
      uTime.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    });
    return true;
  }

  private createOceanSurface(config: RuntimeMapConfig): void {
    const outerHalf = config.groundHalfExtent * 3.2;
    const segmentsPerAxis = 312;
    this.oceanSurface = this.createOceanTileWithCenterHole(config, outerHalf, segmentsPerAxis);
    if (this.oceanSurface.mesh) {
      this.oceanSurface.mesh.frustumCulled = false;
      this.scene.add(this.oceanSurface.mesh);
      this.deferredOceanUpgradePending = this.oceanSurface.mesh.material instanceof MeshStandardMaterial;
    }
    this.updateOceanSurface(0);
  }

  private configureSkyEnvironment(): void {
    const sky = new Sky();
    sky.scale.setScalar(450000);
    const uniforms = sky.material.uniforms as Record<string, { value: unknown } | undefined>;
    if (uniforms.turbidity) uniforms.turbidity.value = 3.6;
    if (uniforms.rayleigh) uniforms.rayleigh.value = 1.35;
    if (uniforms.mieCoefficient) uniforms.mieCoefficient.value = 0.0022;
    if (uniforms.mieDirectionalG) uniforms.mieDirectionalG.value = 0.82;
    if (uniforms.sunPosition && uniforms.sunPosition.value instanceof Vector3) {
      uniforms.sunPosition.value.copy(this.sunDirection.clone().multiplyScalar(5000));
    }
    this.skyDome = sky;
    this.scene.add(sky);

    const pmremGenerator = new PMREMGenerator(this.renderer);
    const skyScene = new Scene();
    const skyClone = sky.clone();
    skyScene.add(skyClone);
    const env = pmremGenerator.fromScene(skyScene);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.46;
    pmremGenerator.dispose();
    env.dispose();
  }

  private createOceanTileWithCenterHole(
    config: RuntimeMapConfig,
    outerHalf: number,
    segmentsPerAxis: number
  ): OceanTile {
    const segmentsX = Math.max(32, Math.floor(segmentsPerAxis));
    const segmentsZ = Math.max(32, Math.floor(segmentsPerAxis));
    const verticesX = segmentsX + 1;
    const verticesZ = segmentsZ + 1;
    const vertexCount = verticesX * verticesZ;
    const positions = new Float32Array(vertexCount * 3);
    const baseXZ = new Float32Array(vertexCount * 2);
    const terrainHeights = new Float32Array(vertexCount);
    const shoreFoam = new Float32Array(vertexCount);
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
        terrainHeights[row * verticesX + col] = terrainHeight;
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
    geometry.setAttribute("aShoreFoam", new BufferAttribute(shoreFoam, 1));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    return {
      mesh: this.createOceanWaterMesh(geometry, config),
      baseXZ,
      terrainHeights,
      shoreFoam
    };
  }

  private createOceanWaterMesh(
    geometry: BufferGeometry,
    config: RuntimeMapConfig
  ): Mesh<BufferGeometry, any> {
    const waterNormalsA =
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_A_ASSET_ID) ??
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_ASSET_ID);
    const waterNormalsB =
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_B_ASSET_ID) ??
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_ASSET_ID);
    if (!waterNormalsA || !waterNormalsB) {
      return new Mesh(
        geometry,
        new MeshStandardMaterial({
          color: 0x2e78b8,
          roughness: 0.35,
          metalness: 0.05,
          side: DoubleSide
        })
      );
    }
    waterNormalsA.wrapS = RepeatWrapping;
    waterNormalsA.wrapT = RepeatWrapping;
    waterNormalsA.needsUpdate = true;
    waterNormalsB.wrapS = RepeatWrapping;
    waterNormalsB.wrapT = RepeatWrapping;
    waterNormalsB.needsUpdate = true;
    const sceneFog = this.scene.fog as Fog | null;
    const fogColor = sceneFog?.color ?? new Color(0xb8e4ff);
    const fogNear = sceneFog?.near ?? 9_999_999;
    const fogFar = sceneFog?.far ?? 9_999_999;
    const material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOceanBaseHeight: { value: config.oceanBaseHeight },
        uWaveAmplitude: { value: config.oceanWaveAmplitude },
        uWaveSpeed: { value: config.oceanWaveSpeed },
        uWaveLength: { value: config.oceanWaveLength },
        uNormalSamplerA: { value: waterNormalsA },
        uNormalSamplerB: { value: waterNormalsB },
        uSunDirection: { value: this.sunDirection.clone() },
        uSunColor: { value: new Color(0xfff4df) },
        uSkyHorizonColor: { value: new Color(0xa2c9ea) },
        uSkyZenithColor: { value: new Color(0x4f7ca6) },
        uWaterShallowColor: { value: new Color(0x4ea3cb) },
        uWaterDeepColor: { value: new Color(0x0f3e64) },
        uNormalScale: { value: 0.44 },
        uNormalStrength: { value: 1.28 },
        uOpacity: { value: 0.74 },
        uCausticStrength: { value: 0.28 },
        uFoamColor: { value: new Color(0xe8f6ff) },
        uFoamStrength: { value: 0.33 },
        uFogColor: { value: fogColor.clone() },
        uFogNear: { value: fogNear },
        uFogFar: { value: fogFar }
      },
      vertexShader: `
        attribute float aShoreFoam;
        varying vec3 vWorldPosition;
        varying vec3 vViewPosition;
        varying float vShoreFoam;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          vShoreFoam = aShoreFoam;
          vec4 mvPosition = viewMatrix * worldPos;
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOceanBaseHeight;
        uniform float uWaveAmplitude;
        uniform float uWaveSpeed;
        uniform float uWaveLength;
        uniform sampler2D uNormalSamplerA;
        uniform sampler2D uNormalSamplerB;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uSkyHorizonColor;
        uniform vec3 uSkyZenithColor;
        uniform vec3 uWaterShallowColor;
        uniform vec3 uWaterDeepColor;
        uniform float uNormalScale;
        uniform float uNormalStrength;
        uniform float uOpacity;
        uniform float uCausticStrength;
        uniform vec3 uFoamColor;
        uniform float uFoamStrength;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        varying vec3 vWorldPosition;
        varying vec3 vViewPosition;
        varying float vShoreFoam;

        vec3 sampleNormalDetail(vec2 uv) {
          vec3 n0 = texture2D(uNormalSamplerA, uv + vec2(uTime * 0.009, uTime * 0.011)).xyz * 2.0 - 1.0;
          vec3 n1 = texture2D(uNormalSamplerB, uv * 1.27 + vec2(-uTime * 0.011, uTime * 0.008)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormalSamplerA, uv * 0.43 + vec2(uTime * 0.004, -uTime * 0.006)).xyz * 2.0 - 1.0;
          return normalize(n0 * 0.50 + n1 * 0.32 + n2 * 0.18);
        }

        float componentWave(vec2 p, vec2 dir, float ampMul, float speedMul, float lenMul, float phaseSeed, float crestMul) {
          float waveSpeed = max(0.0, uWaveSpeed);
          float baseLength = max(1.0, uWaveLength);
          float wavelength = max(1.0, baseLength * lenMul);
          float k = 6.28318530718 / wavelength;
          float omega = k * waveSpeed * speedMul;
          float phase = dot(p, dir) * k + uTime * omega + phaseSeed;
          float primary = sin(phase);
          float crest = sin(phase * 2.0 + phaseSeed * 0.37) * crestMul;
          return (primary + crest) * max(0.0, uWaveAmplitude) * ampMul;
        }

        float sampleWaveHeight(vec2 p) {
          float amplitude = max(0.0, uWaveAmplitude);
          if (amplitude <= 0.00001) {
            return uOceanBaseHeight;
          }
          float wave = 0.0;
          wave += componentWave(p, normalize(vec2(0.92, 0.38)), 1.00, 1.00, 1.35, 0.7, 0.12);
          wave += componentWave(p, normalize(vec2(-0.51, 0.86)), 0.46, 1.16, 1.05, 2.1, 0.14);
          wave += componentWave(p, normalize(vec2(0.17, -0.98)), 0.18, 1.32, 0.88, 4.0, 0.18);
          return uOceanBaseHeight + wave;
        }

        vec3 waveNormal(vec2 p) {
          float e = 2.2;
          float hL = sampleWaveHeight(p - vec2(e, 0.0));
          float hR = sampleWaveHeight(p + vec2(e, 0.0));
          float hD = sampleWaveHeight(p - vec2(0.0, e));
          float hU = sampleWaveHeight(p + vec2(0.0, e));
          float dhdx = (hR - hL) / (2.0 * e);
          float dhdz = (hU - hD) / (2.0 * e);
          return normalize(vec3(-dhdx, 1.0, -dhdz));
        }

        void main() {
          vec3 viewDir = normalize(vViewPosition);
          vec3 geomNormal = waveNormal(vWorldPosition.xz);
          vec2 uv = vWorldPosition.xz * 0.0022;
          vec3 nTex = sampleNormalDetail(uv);
          vec3 tangentNormal = normalize(vec3(nTex.x, nTex.z * 0.42, nTex.y));
          vec3 perturbed = normalize(geomNormal + tangentNormal * uNormalScale);

          float ndv = clamp(dot(perturbed, viewDir), 0.0, 1.0);
          float fresnel = 0.018 + (1.0 - 0.018) * pow(1.0 - ndv, 5.0);

          vec3 sunDir = normalize(uSunDirection);
          vec3 halfVector = normalize(viewDir + sunDir);
          float nh = max(dot(perturbed, halfVector), 0.0);
          float sunSpec = (pow(nh, 220.0) * 1.35 + pow(nh, 44.0) * 0.32) * uNormalStrength;
          float subsurface = pow(max(dot(-viewDir, sunDir), 0.0), 2.1) * (1.0 - ndv) * 0.2;

          vec3 reflectDir = reflect(-viewDir, perturbed);
          float skyMix = clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 skyReflection = mix(uSkyHorizonColor, uSkyZenithColor, pow(skyMix, 1.18));

          float absorb = clamp(1.0 - ndv, 0.0, 1.0);
          vec3 waterBody = mix(uWaterShallowColor, uWaterDeepColor, pow(absorb, 0.63));
          float forwardScatter = max(dot(perturbed, sunDir), 0.0) * 0.07;
          vec3 scatterTint = uWaterShallowColor * forwardScatter;

          vec2 cUv = vWorldPosition.xz * 0.012;
          float cA = texture2D(uNormalSamplerA, cUv + vec2(uTime * 0.026, -uTime * 0.022)).r;
          float cB = texture2D(uNormalSamplerB, cUv * 1.42 + vec2(-uTime * 0.024, uTime * 0.029)).g;
          float c = pow(max(0.0, cA + cB - 0.96), 2.2);
          float causticMask = (1.0 - fresnel) * (0.28 + absorb * 0.72);
          vec3 causticTint = uSunColor * c * uCausticStrength * causticMask;

          float crest = pow(clamp(1.0 - perturbed.y, 0.0, 1.0), 2.25);
          float foamNoise = texture2D(uNormalSamplerB, vWorldPosition.xz * 0.009 + vec2(uTime * 0.021, uTime * 0.017)).b;
          float crestFoam = smoothstep(0.62, 0.94, crest + foamNoise * 0.34);
          float shoreFoam = smoothstep(0.08, 0.92, vShoreFoam);
          float foamMask = clamp(crestFoam * 0.5 + shoreFoam * 0.9, 0.0, 1.0);
          vec3 foamTint = uFoamColor * foamMask * uFoamStrength;

          vec3 color = mix(waterBody + scatterTint, skyReflection, fresnel);
          color += uSunColor * sunSpec;
          color += uSunColor * subsurface;
          color += causticTint;
          color = mix(color, foamTint + color, foamMask * 0.46);

          float dist = length(vViewPosition);
          float fogFactor = smoothstep(uFogNear, uFogFar, dist);
          vec3 finalColor = mix(color, uFogColor, fogFactor);

          float waterAlpha = mix(0.5, uOpacity, fresnel * 0.86 + 0.14);
          gl_FragColor = vec4(finalColor, waterAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: false
    });
    return new Mesh(geometry, material);
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
    const shoreAttribute = surface.mesh.geometry.getAttribute("aShoreFoam");
    for (let i = 0, xz = 0; i < position.count; i += 1, xz += 2) {
      const x = surface.baseXZ[xz] ?? 0;
      const z = surface.baseXZ[xz + 1] ?? 0;
      const y = sampleOceanHeightAt(this.mapConfig, x, z, time);
      position.setY(i, y);
      const terrainY = surface.terrainHeights[i] ?? y;
      const depth = Math.max(0, y - terrainY);
      const shore =
        depth <= 0 ? 1 : 1 - Math.max(0, Math.min(1, (depth - 0.12) / (2.2 - 0.12)));
      surface.shoreFoam[i] = shore;
    }
    position.needsUpdate = true;
    if (shoreAttribute) {
      shoreAttribute.needsUpdate = true;
    }
    const oceanMaterial = surface.mesh.material;
    if (oceanMaterial instanceof ShaderMaterial) {
      const waterUniforms = oceanMaterial.uniforms;
      if (waterUniforms?.uTime) {
        waterUniforms.uTime.value = time;
      }
      if (waterUniforms?.uSunDirection && waterUniforms.uSunDirection.value instanceof Vector3) {
        waterUniforms.uSunDirection.value.copy(this.sunDirection);
      }
      if (waterUniforms?.uWaveAmplitude) {
        waterUniforms.uWaveAmplitude.value = this.mapConfig.oceanWaveAmplitude;
      }
      if (waterUniforms?.uWaveSpeed) {
        waterUniforms.uWaveSpeed.value = this.mapConfig.oceanWaveSpeed;
      }
      if (waterUniforms?.uWaveLength) {
        waterUniforms.uWaveLength.value = this.mapConfig.oceanWaveLength;
      }
    }
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

  private addProceduralGrassInstances(instances: readonly VisualGrassInstance[]): void {
    if (this.grassInstancesAdded) {
      return;
    }
    if (instances.length === 0) {
      return;
    }

    for (const renderVariant of GRASS_RENDER_VARIANTS) {
      const texture = getLoadedAsset<Texture>(renderVariant.assetId);
      if (!texture) {
        continue;
      }
      const variantInstances = instances.filter((instance) => instance.variantId === renderVariant.id);
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
    this.grassInstancesAdded = this.grassCellBatches.length > 0;
    this.updateGrassLod(this.camera.position.x, this.camera.position.z);
  }

  private requestWorldTextureAssets(): void {
    if (this.worldTextureRequestsIssued) {
      return;
    }
    this.worldTextureRequestsIssued = true;
    const textureAssetIds = [
      WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID,
      WORLD_WATER_NORMALS_ASSET_ID,
      WORLD_WATER_NORMALS_A_ASSET_ID,
      WORLD_WATER_NORMALS_B_ASSET_ID
    ];
    for (const assetId of textureAssetIds) {
      void ensureAsset(assetId, "near")
        .then(() => {
          this.maybeApplyDeferredVisuals();
        })
        .catch(() => {
          this.worldTextureRequestsIssued = false;
        });
    }
  }

  private maybeApplyDeferredVisuals(): void {
    this.tryApplyTerrainCaustics();
    this.tryUpgradeOceanMaterial();
    this.tryAddGrassInstances();
  }

  private tryApplyTerrainCaustics(): void {
    if (!this.deferredTerrainCausticsPending || !this.groundMaterial || !this.mapConfig) {
      return;
    }
    if (this.configureTerrainCaustics(this.groundMaterial, this.mapConfig)) {
      this.deferredTerrainCausticsPending = false;
    }
  }

  private tryUpgradeOceanMaterial(): void {
    if (!this.deferredOceanUpgradePending || !this.mapConfig || !this.oceanSurface?.mesh) {
      return;
    }
    const waterNormalsA =
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_A_ASSET_ID) ??
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_ASSET_ID);
    const waterNormalsB =
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_B_ASSET_ID) ??
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_ASSET_ID);
    if (!waterNormalsA || !waterNormalsB) {
      return;
    }
    const previousMaterial = this.oceanSurface.mesh.material;
    const upgraded = this.createOceanWaterMesh(this.oceanSurface.mesh.geometry, this.mapConfig);
    this.oceanSurface.mesh.material = upgraded.material;
    this.deferredOceanUpgradePending = this.oceanSurface.mesh.material instanceof MeshStandardMaterial;
    if (previousMaterial !== this.oceanSurface.mesh.material) {
      previousMaterial.dispose();
    }
  }

  private tryAddGrassInstances(): void {
    if (this.grassInstancesAdded || !this.pendingGrassInstances) {
      return;
    }
    const hasAllVariantTextures = GRASS_RENDER_VARIANTS.every((variant) =>
      Boolean(getLoadedAsset<Texture>(variant.assetId))
    );
    if (!hasAllVariantTextures) {
      return;
    }
    this.addProceduralGrassInstances(this.pendingGrassInstances);
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
