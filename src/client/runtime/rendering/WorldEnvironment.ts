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
  FrontSide,
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
  OCEAN_WAVE_COMPONENTS,
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
interface StaticPropVisual {
  kind: "tree" | "rock" | "bush";
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}

interface OceanSurface {
  mesh: Mesh<BufferGeometry, ShaderMaterial | MeshStandardMaterial>;
  snapSize: number;
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
const OCEAN_RING_LEVELS = [
  { innerHalf: 0, outerHalf: 180, radialSegments: 60 },
  { innerHalf: 180, outerHalf: 440, radialSegments: 44 },
  { innerHalf: 440, outerHalf: 920, radialSegments: 28 },
  { innerHalf: 920, outerHalf: 1720, radialSegments: 16 }
] as const;
const OCEAN_RING_ANGULAR_SEGMENTS = 192;
const OCEAN_GLSL_COMPONENT_LINES = OCEAN_WAVE_COMPONENTS.map(
  (component) =>
    `wave += componentWave(p, vec2(${component.dirX.toFixed(6)}, ${component.dirZ.toFixed(6)}), ${component.ampMul.toFixed(6)}, ${component.speedMul.toFixed(6)}, ${component.lengthMul.toFixed(6)}, ${component.phase.toFixed(6)}, ${component.crestMul.toFixed(6)}, timeSeconds, waveAmplitude, waveSpeed, waveLength);`
).join("\n  ");
const OCEAN_GLSL_WAVE_FUNCTIONS = `
float componentWave(
  vec2 p,
  vec2 dir,
  float ampMul,
  float speedMul,
  float lenMul,
  float phaseSeed,
  float crestMul,
  float timeSeconds,
  float waveAmplitude,
  float waveSpeed,
  float waveLength
) {
  float wavelength = max(1.0, waveLength * lenMul);
  float k = 6.28318530718 / wavelength;
  float omega = k * waveSpeed * speedMul;
  float projection = dot(p, dir);
  float phase = projection * k + timeSeconds * omega + phaseSeed;
  float primary = sin(phase);
  float crest = sin(phase * 2.0 + phaseSeed * 0.37) * crestMul;
  return (primary + crest) * waveAmplitude * ampMul;
}

float sampleWaveHeightAt(vec2 p, float baseHeight, float waveAmplitude, float waveSpeed, float waveLength, float timeSeconds) {
  if (waveAmplitude <= 0.00001) {
    return baseHeight;
  }
  float wave = 0.0;
  ${OCEAN_GLSL_COMPONENT_LINES}
  return baseHeight + wave;
}`;

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
  private oceanSurface: OceanSurface | null = null;
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
${OCEAN_GLSL_WAVE_FUNCTIONS}`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `float oceanY = sampleWaveHeightAt(
vCausticWorldPos.xz,
uOceanBaseHeight,
max(0.0, uWaveAmplitude),
max(0.0, uWaveSpeed),
max(1.0, uWaveLength),
uCausticTime
);
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
    const material = this.createOceanWaterMaterial(config);
    const geometry = this.createOceanRingGeometry();
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const firstLevel = OCEAN_RING_LEVELS[0];
    const radialStep = firstLevel
      ? Math.max(1, (firstLevel.outerHalf - firstLevel.innerHalf) / Math.max(1, firstLevel.radialSegments))
      : 4;
    this.oceanSurface = {
      mesh,
      snapSize: radialStep
    };
    this.deferredOceanUpgradePending = material instanceof MeshStandardMaterial;
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

  private createOceanRingGeometry(): BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const angularSegments = Math.max(16, OCEAN_RING_ANGULAR_SEGMENTS);
    const fullTurn = Math.PI * 2;

    let firstBandOuterStart = -1;
    let firstBandOuterStride = 0;

    for (let levelIndex = 0; levelIndex < OCEAN_RING_LEVELS.length; levelIndex += 1) {
      const level = OCEAN_RING_LEVELS[levelIndex];
      if (!level) {
        continue;
      }
      const innerRadius = Math.max(0, level.innerHalf);
      const outerRadius = Math.max(innerRadius + 0.001, level.outerHalf);
      const radialSegments = Math.max(1, Math.floor(level.radialSegments));
      const vertexBase = positions.length / 3;
      const stride = angularSegments + 1;

      if (innerRadius <= 0.0001) {
        positions.push(0, 0, 0);
        uvs.push(0.5, 0.5);
        const centerIndex = vertexBase;
        for (let radial = 1; radial <= radialSegments; radial += 1) {
          const radialT = radial / radialSegments;
          const radius = outerRadius * radialT;
          for (let angular = 0; angular <= angularSegments; angular += 1) {
            const angularT = angular / angularSegments;
            const theta = angularT * fullTurn;
            const x = Math.cos(theta) * radius;
            const z = Math.sin(theta) * radius;
            positions.push(x, 0, z);
            uvs.push(angularT, radialT);
          }
        }

        const firstRingStart = centerIndex + 1;
        for (let angular = 0; angular < angularSegments; angular += 1) {
          const a = firstRingStart + angular;
          const b = firstRingStart + angular + 1;
          indices.push(centerIndex, b, a);
        }
        for (let radial = 1; radial < radialSegments; radial += 1) {
          const ringA = firstRingStart + (radial - 1) * stride;
          const ringB = firstRingStart + radial * stride;
          for (let angular = 0; angular < angularSegments; angular += 1) {
            const a = ringA + angular;
            const b = ringA + angular + 1;
            const c = ringB + angular;
            const d = ringB + angular + 1;
            indices.push(a, b, c, b, d, c);
          }
        }
        firstBandOuterStart = firstRingStart + (radialSegments - 1) * stride;
        firstBandOuterStride = stride;
        continue;
      }

      for (let radial = 0; radial <= radialSegments; radial += 1) {
        const radialT = radial / radialSegments;
        const radius = innerRadius + (outerRadius - innerRadius) * radialT;
        for (let angular = 0; angular <= angularSegments; angular += 1) {
          const angularT = angular / angularSegments;
          const theta = angularT * fullTurn;
          const x = Math.cos(theta) * radius;
          const z = Math.sin(theta) * radius;
          positions.push(x, 0, z);
          uvs.push(angularT, radialT);
        }
      }
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const ringA = vertexBase + radial * stride;
        const ringB = vertexBase + (radial + 1) * stride;
        for (let angular = 0; angular < angularSegments; angular += 1) {
          const a = ringA + angular;
          const b = ringA + angular + 1;
          const c = ringB + angular;
          const d = ringB + angular + 1;
          indices.push(a, b, c, b, d, c);
        }
      }
    }

    if (firstBandOuterStart >= 0 && firstBandOuterStride > 0) {
      const seamRadius = OCEAN_RING_LEVELS[0]?.outerHalf ?? 0;
      const epsilon = Math.max(0.2, seamRadius * 0.00025);
      const skirtBase = positions.length / 3;
      for (let angular = 0; angular <= angularSegments; angular += 1) {
        const sourceIndex = firstBandOuterStart + angular;
        const x = positions[sourceIndex * 3] ?? 0;
        const y = positions[sourceIndex * 3 + 1] ?? 0;
        const z = positions[sourceIndex * 3 + 2] ?? 0;
        const len = Math.hypot(x, z) || 1;
        const ox = (x / len) * (len + epsilon);
        const oz = (z / len) * (len + epsilon);
        positions.push(ox, y, oz);
        uvs.push((angular / angularSegments), 1);
      }
      for (let angular = 0; angular < angularSegments; angular += 1) {
        const innerA = firstBandOuterStart + angular;
        const innerB = firstBandOuterStart + angular + 1;
        const outerA = skirtBase + angular;
        const outerB = skirtBase + angular + 1;
        indices.push(innerA, innerB, outerA, innerB, outerB, outerA);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    const indexArray =
      positions.length / 3 > 65_535 ? new Uint32Array(indices) : new Uint16Array(indices);
    geometry.setIndex(new BufferAttribute(indexArray, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }

  private createOceanWaterMaterial(
    config: RuntimeMapConfig
  ): ShaderMaterial | MeshStandardMaterial {
    const waterNormalsA =
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_A_ASSET_ID) ??
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_ASSET_ID);
    const waterNormalsB =
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_B_ASSET_ID) ??
      getLoadedAsset<Texture>(WORLD_WATER_NORMALS_ASSET_ID);
    if (!waterNormalsA || !waterNormalsB) {
      return new MeshStandardMaterial({
        color: 0x2e78b8,
        roughness: 0.35,
        metalness: 0.05,
        side: FrontSide
      });
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
        uniform float uTime;
        uniform float uOceanBaseHeight;
        uniform float uWaveAmplitude;
        uniform float uWaveSpeed;
        uniform float uWaveLength;
        varying vec3 vWorldPosition;
        varying vec3 vViewPosition;
        ${OCEAN_GLSL_WAVE_FUNCTIONS}

        void main() {
          vec4 worldBasePos = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);
          float waveY = sampleWaveHeightAt(
            worldBasePos.xz,
            uOceanBaseHeight,
            max(0.0, uWaveAmplitude),
            max(0.0, uWaveSpeed),
            max(1.0, uWaveLength),
            uTime
          );
          vec4 worldPos = vec4(worldBasePos.x, waveY, worldBasePos.z, 1.0);
          vWorldPosition = worldPos.xyz;
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

        vec3 sampleNormalDetail(vec2 uv) {
          vec3 n0 = texture2D(uNormalSamplerA, uv + vec2(uTime * 0.009, uTime * 0.011)).xyz * 2.0 - 1.0;
          vec3 n1 = texture2D(uNormalSamplerB, uv * 1.27 + vec2(-uTime * 0.011, uTime * 0.008)).xyz * 2.0 - 1.0;
          return normalize(n0 * 0.62 + n1 * 0.38);
        }

        void main() {
          vec3 viewDir = normalize(vViewPosition);
          vec3 dpdx = dFdx(vWorldPosition);
          vec3 dpdy = dFdy(vWorldPosition);
          vec3 geomNormal = normalize(cross(dpdx, dpdy));
          if (!gl_FrontFacing) {
            geomNormal = -geomNormal;
          }
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
          float foamMask = clamp(crestFoam * 0.72, 0.0, 1.0);
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
      side: FrontSide,
      fog: false
    });
    return material;
  }

  private updateOceanSurface(renderServerTimeSeconds: number): void {
    if (!this.oceanMeshEnabled || !this.mapConfig) {
      return;
    }
    const time =
      this.oceanWavesEnabled && Number.isFinite(renderServerTimeSeconds) ? renderServerTimeSeconds : 0;
    const surface = this.oceanSurface;
    if (!surface) {
      return;
    }
    const snapToGrid = (value: number, snap: number): number => {
      const step = Math.max(0.001, snap);
      return Math.round(value / step) * step;
    };
    surface.mesh.position.set(
      snapToGrid(this.camera.position.x, surface.snapSize),
      0,
      snapToGrid(this.camera.position.z, surface.snapSize)
    );
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
    if (!this.deferredOceanUpgradePending || !this.mapConfig || !this.oceanSurface) {
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
    const upgradedMaterial = this.createOceanWaterMaterial(this.mapConfig);
    this.oceanSurface.mesh.material = upgradedMaterial;
    this.deferredOceanUpgradePending = upgradedMaterial instanceof MeshStandardMaterial;
    if (previousMaterial !== upgradedMaterial) {
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
