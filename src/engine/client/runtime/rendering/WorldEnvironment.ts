/**
 * Purpose: This file defines world state, world helpers, or world orchestration behavior.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CubeTexture,
  CylinderGeometry,
  DodecahedronGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  Vector4,
  WebGLRenderer
} from "three";
import {
  buildTerrainMeshData,
  DEFAULT_VISUAL_GRASS_VARIANTS,
  ENVIRONMENT_PRESET_SKY_BLUE_DAY,
  ENVIRONMENT_PRESET_VOID_ARCANE,
  ENVIRONMENT_PRESET_VOID_DEEP,
  ENVIRONMENT_PRESET_VOID_INFERNAL,
  ENVIRONMENT_PRESET_VOID_NEUTRAL,
  ENVIRONMENT_PRIORITY_LOCATION,
  getLocationDefinitionByArchetypeId,
  getEnvironmentVolumeWeight,
  generateDeterministicVisualBushes,
  generateDeterministicVisualGrass,
  VOID_ENVIRONMENT_VOLUME_DEFINITIONS,
  type EnvironmentVolumeDefinition,
  type VisualGrassInstance
} from "../../../shared/index";
import { configureAssetLoaderRenderer, ensureAsset, getLoadedAsset } from "../../assets/assetLoader";
import { getPropColors } from "./VisualRegistry";
import {
  WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID,
  WORLD_SKYBOX_1_ASSET_ID,
  WORLD_SKYBOX_2_ASSET_ID,
  WORLD_SKYBOX_3_ASSET_ID,
  WORLD_SKYBOX_4_ASSET_ID,
  WORLD_SKYBOX_5_ASSET_ID
} from "../../assets/assetManifest";
import type { LocationEnvironmentVolumeDefinition } from "../../../shared/index";
import type { LocationRootState, PlayerPose } from "../types";

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

type EnvironmentVfxLayerId = "voidStars" | "heavenMist" | "infernalNebula" | "arcaneMotes";

type EnvironmentVfxWeights = Record<EnvironmentVfxLayerId, number>;

type VoidSkyLayerId = "skybox1" | "skybox2" | "skybox3" | "skybox4" | "skybox5";

type VoidSkyWeights = Record<VoidSkyLayerId, number>;

export interface EnvironmentPreset {
  background: Color;
  fogColor: Color;
  fogNear: number;
  fogFar: number;
  ambientColor: Color;
  ambientIntensity: number;
  sunColor: Color;
  sunIntensity: number;
  exposure: number;
  vfx: EnvironmentVfxWeights;
  sky: VoidSkyWeights;
}

interface EnvironmentInfluence {
  readonly priority: number;
  readonly weight: number;
  readonly preset: EnvironmentPreset;
}

interface EnvironmentVfxLayerVisual {
  readonly group: Group;
  readonly materials: MeshBasicMaterial[];
  readonly anchorsToCamera: boolean;
}

interface VoidSkyLayerDefinition {
  readonly id: VoidSkyLayerId;
  readonly assetId: string;
  readonly uniformName: "skybox0" | "skybox1" | "skybox2" | "skybox3" | "skybox4";
  readonly weightIndex: 0 | 1 | 2 | 3 | 4;
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
const DEFAULT_ENVIRONMENT_PRESET_ID = ENVIRONMENT_PRESET_VOID_NEUTRAL;
const ZERO_VFX_WEIGHTS: EnvironmentVfxWeights = {
  voidStars: 0,
  heavenMist: 0,
  infernalNebula: 0,
  arcaneMotes: 0
};
const ZERO_SKY_WEIGHTS: VoidSkyWeights = {
  skybox1: 0,
  skybox2: 0,
  skybox3: 0,
  skybox4: 0,
  skybox5: 0
};
const VOID_SKY_RENDER_ORDER = -1000;
const ENVIRONMENT_VFX_RENDER_ORDER = -900;

const VOID_SKY_LAYERS: readonly VoidSkyLayerDefinition[] = [
  {
    id: "skybox1",
    assetId: WORLD_SKYBOX_1_ASSET_ID,
    uniformName: "skybox0",
    weightIndex: 0
  },
  {
    id: "skybox2",
    assetId: WORLD_SKYBOX_2_ASSET_ID,
    uniformName: "skybox1",
    weightIndex: 1
  },
  {
    id: "skybox3",
    assetId: WORLD_SKYBOX_3_ASSET_ID,
    uniformName: "skybox2",
    weightIndex: 2
  },
  {
    id: "skybox4",
    assetId: WORLD_SKYBOX_4_ASSET_ID,
    uniformName: "skybox3",
    weightIndex: 3
  },
  {
    id: "skybox5",
    assetId: WORLD_SKYBOX_5_ASSET_ID,
    uniformName: "skybox4",
    weightIndex: 4
  }
];

const VOID_SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldDirection;

#include <common>

void main() {
  vWorldDirection = transformDirection(position, modelMatrix);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z = gl_Position.w;
}
`;

const VOID_SKY_FRAGMENT_SHADER = /* glsl */ `
uniform samplerCube skybox0;
uniform samplerCube skybox1;
uniform samplerCube skybox2;
uniform samplerCube skybox3;
uniform samplerCube skybox4;
uniform vec4 skyWeights0123;
uniform float skyWeight4;
uniform float skyIntensity;

varying vec3 vWorldDirection;

vec3 sampleSkybox(samplerCube skybox, vec3 direction) {
  return textureCube(skybox, vec3(-direction.x, direction.y, direction.z)).rgb;
}

void main() {
  vec3 direction = normalize(vWorldDirection);
  vec4 weights0123 = max(skyWeights0123, vec4(0.0));
  float weight4 = max(skyWeight4, 0.0);
  float totalWeight = dot(weights0123, vec4(1.0)) + weight4;

  vec3 color =
    sampleSkybox(skybox0, direction) * weights0123.x +
    sampleSkybox(skybox1, direction) * weights0123.y +
    sampleSkybox(skybox2, direction) * weights0123.z +
    sampleSkybox(skybox3, direction) * weights0123.w +
    sampleSkybox(skybox4, direction) * weight4;

  if (totalWeight <= 0.0001) {
    color = sampleSkybox(skybox4, direction);
  } else {
    color /= totalWeight;
  }

  gl_FragColor = vec4(color * skyIntensity, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Environment presets — injected by the game layer at startup via injectEnvironmentPresets().
let ENVIRONMENT_PRESETS = new Map<number, EnvironmentPreset>();

export function injectEnvironmentPresets(presets: Map<number, EnvironmentPreset>): void {
  ENVIRONMENT_PRESETS = presets;
}


export class WorldEnvironment {
  public readonly renderer: WebGLRenderer;
  public readonly scene: Scene;
  public readonly camera: PerspectiveCamera;
  private readonly skyScene = new Scene();
  private readonly cameraForward = new Vector3(0, 0, -1);
  private readonly tempMatrix = new Matrix4();
  private readonly tempScale = new Vector3(1, 1, 1);
  private readonly e2eMode: boolean;
  private readonly headlessLite: boolean;
  private readonly windUniformUpdaters: Array<(timeSeconds: number) => void> = [];
  private readonly grassCellBatches: GrassCellBatch[] = [];
  private readonly sunDirection = new Vector3(0.33, 0.9, 0.22).normalize();
  private readonly currentEnvironment = cloneEnvironmentPreset(
    requireEnvironmentPreset(DEFAULT_ENVIRONMENT_PRESET_ID)
  );
  private readonly targetEnvironment = cloneEnvironmentPreset(
    requireEnvironmentPreset(DEFAULT_ENVIRONMENT_PRESET_ID)
  );
  private readonly environmentVfxLayers = new Map<EnvironmentVfxLayerId, EnvironmentVfxLayerVisual>();
  private readonly skyboxLayerTextures = new Map<VoidSkyLayerId, CubeTexture>();
  private readonly fallbackSkybox = createSolidCubeTexture(0x020407);
  private skyboxMesh: Mesh<BoxGeometry, ShaderMaterial> | null = null;
  private skyboxMaterial: ShaderMaterial | null = null;
  private ambientLight: AmbientLight | null = null;
  private sunLight: DirectionalLight | null = null;
  private pendingGrassInstances: VisualGrassInstance[] | null = null;
  private worldTextureRequestsIssued = false;
  private skyboxRequestsIssued = false;
  private grassInstancesAdded = false;

  public constructor(canvas: HTMLCanvasElement) {
    const params = new URLSearchParams(window.location.search);
    this.e2eMode = params.get("e2e") === "1";
    const headlessLiteParam = params.get("headlessLite");
    this.headlessLite =
      headlessLiteParam === "0" || headlessLiteParam === "false" ? false : this.e2eMode;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !this.e2eMode,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(this.e2eMode ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.currentEnvironment.exposure;
    this.renderer.autoClear = false;
    configureAssetLoaderRenderer(this.renderer);

    this.scene = new Scene();
    this.scene.background = this.currentEnvironment.background.clone();
    this.scene.fog = new Fog(
      this.currentEnvironment.fogColor.clone(),
      this.currentEnvironment.fogNear,
      this.currentEnvironment.fogFar
    );

    this.camera = new PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.01, 5000);
    this.camera.layers.enable(LOCAL_FIRST_PERSON_ONLY_LAYER);
    this.camera.layers.disable(LOCAL_THIRD_PERSON_ONLY_LAYER);

    this.initializeScene();
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public render(
    localPose: PlayerPose,
    renderServerTimeSeconds: number,
    locationRoots: readonly LocationRootState[]
  ): void {
    this.camera.position.set(localPose.x, localPose.y, localPose.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = localPose.yaw;
    this.camera.rotation.x = localPose.pitch;
    for (const updateWindUniform of this.windUniformUpdaters) {
      updateWindUniform(renderServerTimeSeconds);
    }
    this.maybeApplyDeferredVisuals();
    this.updateGrassLod(localPose.x, localPose.z);
    this.updateEnvironment(localPose, locationRoots);
    this.updateVoidSkyPosition();
    this.updateAnchoredEnvironmentVfx();
    this.renderer.clear(true, true, true);
    if (!this.headlessLite) {
      this.renderer.render(this.skyScene, this.camera);
      this.renderer.clearDepth();
    }
    this.renderer.render(this.scene, this.camera);
  }

  public getForwardDirection(): Vector3 {
    return this.cameraForward.set(0, 0, -1).applyEuler(this.camera.rotation).normalize();
  }

  public dispose(): void {
    this.skyboxMesh?.geometry.dispose();
    this.skyboxMaterial?.dispose();
    this.fallbackSkybox.dispose();
    this.renderer.dispose();
    this.grassCellBatches.length = 0;
    this.pendingGrassInstances = null;
  }

  private initializeScene(): void {
    const ambient = new AmbientLight(
      this.currentEnvironment.ambientColor,
      this.currentEnvironment.ambientIntensity
    );
    this.ambientLight = ambient;
    this.scene.add(ambient);

    const sun = new DirectionalLight(
      this.currentEnvironment.sunColor,
      this.currentEnvironment.sunIntensity
    );
    this.sunLight = sun;
    sun.position.copy(this.sunDirection).multiplyScalar(220);
    this.scene.add(sun);

    if (!this.headlessLite) {
      this.addVoidSkyboxRenderer();
      this.applyVoidSky(this.currentEnvironment.sky);
      this.requestSkyboxAssets();
      this.addEnvironmentVfxLayers();
      this.applyEnvironmentVfx(this.currentEnvironment.vfx);
    }
  }

  private addVoidSkyboxRenderer(): void {
    const material = new ShaderMaterial({
      name: "VoidCubemapBlendSkyMaterial",
      uniforms: {
        skybox0: { value: this.fallbackSkybox },
        skybox1: { value: this.fallbackSkybox },
        skybox2: { value: this.fallbackSkybox },
        skybox3: { value: this.fallbackSkybox },
        skybox4: { value: this.fallbackSkybox },
        skyWeights0123: { value: new Vector4(0, 0, 0, 0) },
        skyWeight4: { value: 1 },
        skyIntensity: { value: 1 }
      },
      vertexShader: VOID_SKY_VERTEX_SHADER,
      fragmentShader: VOID_SKY_FRAGMENT_SHADER,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false
    });
    material.toneMapped = true;

    const geometry = new BoxGeometry(1, 1, 1);
    geometry.deleteAttribute("normal");
    geometry.deleteAttribute("uv");
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = VOID_SKY_RENDER_ORDER;
    this.skyScene.add(mesh);
    this.skyboxMesh = mesh;
    this.skyboxMaterial = material;
  }

  private addEnvironmentVfxLayers(): void {
    this.environmentVfxLayers.set("voidStars", this.createVoidReferenceStars());
    this.environmentVfxLayers.set("heavenMist", this.createHeavenMistLayer());
    this.environmentVfxLayers.set("infernalNebula", this.createInfernalNebulaLayer());
    this.environmentVfxLayers.set("arcaneMotes", this.createArcaneMotesLayer());
    for (const layer of this.environmentVfxLayers.values()) {
      this.skyScene.add(layer.group);
    }
  }

  private createVoidReferenceStars(): EnvironmentVfxLayerVisual {
    const group = new Group();
    const starMaterial = new MeshBasicMaterial({
      color: 0xb7d7ff,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const geometry = new DodecahedronGeometry(1.8, 0);
    for (let i = 0; i < 90; i += 1) {
      const t = i * 12.9898;
      const radius = 520 + (i % 17) * 34;
      const theta = (Math.sin(t) * 0.5 + 0.5) * Math.PI * 2;
      const phi = (Math.cos(t * 0.47) * 0.5 + 0.5) * Math.PI;
      const star = new Mesh(geometry, starMaterial);
      star.renderOrder = ENVIRONMENT_VFX_RENDER_ORDER;
      star.position.set(
        Math.cos(theta) * Math.sin(phi) * radius,
        Math.cos(phi) * radius * 0.55 + 120,
        Math.sin(theta) * Math.sin(phi) * radius
      );
      star.scale.setScalar(0.7 + (i % 5) * 0.18);
      group.add(star);
    }
    return {
      group,
      materials: [starMaterial],
      anchorsToCamera: true
    };
  }

  private createHeavenMistLayer(): EnvironmentVfxLayerVisual {
    const group = new Group();
    const material = new MeshBasicMaterial({
      color: 0xd9f2ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending
    });
    const geometry = new SphereGeometry(1, 20, 12);
    for (let i = 0; i < 9; i += 1) {
      const mist = new Mesh(geometry, material);
      mist.renderOrder = ENVIRONMENT_VFX_RENDER_ORDER;
      const angle = i * 0.698 + 0.2;
      mist.position.set(Math.cos(angle) * 360, 110 + (i % 3) * 52, Math.sin(angle) * 420);
      mist.scale.set(180 + (i % 4) * 35, 34 + (i % 2) * 12, 86 + (i % 5) * 18);
      group.add(mist);
    }
    return {
      group,
      materials: [material],
      anchorsToCamera: true
    };
  }

  private createInfernalNebulaLayer(): EnvironmentVfxLayerVisual {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    const geometry = new DodecahedronGeometry(1, 1);
    const colors = [0xff2f16, 0xff7a1f, 0x8b1024];
    for (let i = 0; i < 14; i += 1) {
      const material = new MeshBasicMaterial({
        color: colors[i % colors.length] ?? 0xff2f16,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        wireframe: i % 3 === 0
      });
      materials.push(material);
      const cloud = new Mesh(geometry, material);
      cloud.renderOrder = ENVIRONMENT_VFX_RENDER_ORDER;
      const angle = i * 0.921 + 1.4;
      const radius = 430 + (i % 5) * 65;
      cloud.position.set(Math.cos(angle) * radius, 45 + (i % 6) * 42, Math.sin(angle) * radius);
      cloud.rotation.set(i * 0.31, angle, i * 0.17);
      cloud.scale.set(70 + (i % 4) * 22, 42 + (i % 3) * 16, 118 + (i % 5) * 28);
      group.add(cloud);
    }
    return {
      group,
      materials,
      anchorsToCamera: true
    };
  }

  private createArcaneMotesLayer(): EnvironmentVfxLayerVisual {
    const group = new Group();
    const material = new MeshBasicMaterial({
      color: 0x69f6ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending
    });
    const geometry = new DodecahedronGeometry(0.8, 0);
    for (let i = 0; i < 120; i += 1) {
      const t = i * 8.314;
      const radius = 260 + (i % 23) * 24;
      const theta = (Math.sin(t) * 0.5 + 0.5) * Math.PI * 2;
      const phi = (Math.cos(t * 0.63) * 0.5 + 0.5) * Math.PI;
      const mote = new Mesh(geometry, material);
      mote.renderOrder = ENVIRONMENT_VFX_RENDER_ORDER;
      mote.position.set(
        Math.cos(theta) * Math.sin(phi) * radius,
        Math.cos(phi) * radius * 0.44 + 120,
        Math.sin(theta) * Math.sin(phi) * radius
      );
      mote.scale.setScalar(1.2 + (i % 6) * 0.22);
      group.add(mote);
    }
    return {
      group,
      materials: [material],
      anchorsToCamera: true
    };
  }

  private updateEnvironment(
    localPose: PlayerPose,
    locationRoots: readonly LocationRootState[]
  ): void {
    copyEnvironmentPreset(this.targetEnvironment, requireEnvironmentPreset(DEFAULT_ENVIRONMENT_PRESET_ID));
    const influences: EnvironmentInfluence[] = [];

    for (const volume of VOID_ENVIRONMENT_VOLUME_DEFINITIONS) {
      const preset = ENVIRONMENT_PRESETS.get(volume.environmentPresetId);
      const weight = getEnvironmentVolumeWeight(volume, localPose);
      if (!preset || weight <= 0) {
        continue;
      }
      influences.push({
        priority: volume.priority,
        weight,
        preset
      });
    }

    for (const root of locationRoots) {
      const definition = getLocationDefinitionByArchetypeId(root.locationArchetypeId);
      for (const childVolume of definition?.environmentVolumes ?? []) {
        const volume = transformLocationEnvironmentVolume(root, childVolume);
        const preset = ENVIRONMENT_PRESETS.get(volume.environmentPresetId);
        const weight = getEnvironmentVolumeWeight(volume, localPose);
        if (!preset || weight <= 0) {
          continue;
        }
        influences.push({
          priority: volume.priority,
          weight,
          preset
        });
      }
    }

    applyPrioritizedEnvironmentInfluences(this.targetEnvironment, influences);
    copyEnvironmentPreset(this.currentEnvironment, this.targetEnvironment);

    if (this.headlessLite) {
      if (this.scene.background instanceof Color) {
        this.scene.background.copy(this.currentEnvironment.background);
      } else {
        this.scene.background = this.currentEnvironment.background.clone();
      }
    } else {
      this.scene.background = null;
    }

    if (this.scene.fog instanceof Fog) {
      this.scene.fog.color.copy(this.currentEnvironment.fogColor);
      this.scene.fog.near = this.currentEnvironment.fogNear;
      this.scene.fog.far = this.currentEnvironment.fogFar;
    } else {
      this.scene.fog = new Fog(
        this.currentEnvironment.fogColor.clone(),
        this.currentEnvironment.fogNear,
        this.currentEnvironment.fogFar
      );
    }

    if (this.ambientLight) {
      this.ambientLight.color.copy(this.currentEnvironment.ambientColor);
      this.ambientLight.intensity = this.currentEnvironment.ambientIntensity;
    }
    if (this.sunLight) {
      this.sunLight.color.copy(this.currentEnvironment.sunColor);
      this.sunLight.intensity = this.currentEnvironment.sunIntensity;
    }
    this.renderer.toneMappingExposure = this.currentEnvironment.exposure;
    this.applyVoidSky(this.currentEnvironment.sky);
    this.applyEnvironmentVfx(this.currentEnvironment.vfx);
  }

  private applyVoidSky(weights: VoidSkyWeights): void {
    if (!this.skyboxMaterial || !this.skyboxMesh) {
      return;
    }
    const skyWeights0123 = this.skyboxMaterial.uniforms.skyWeights0123?.value;
    if (skyWeights0123 instanceof Vector4) {
      skyWeights0123.set(
        Math.max(0, weights.skybox1),
        Math.max(0, weights.skybox2),
        Math.max(0, weights.skybox3),
        Math.max(0, weights.skybox4)
      );
    }
    const skyWeight4 = this.skyboxMaterial.uniforms.skyWeight4;
    if (skyWeight4) {
      skyWeight4.value = Math.max(0, weights.skybox5);
    }
    this.skyboxMesh.visible =
      Math.max(
        weights.skybox1,
        weights.skybox2,
        weights.skybox3,
        weights.skybox4,
        weights.skybox5
      ) > 0.001;
  }

  private updateVoidSkyPosition(): void {
    if (this.skyboxMesh) {
      this.skyboxMesh.position.copy(this.camera.position);
    }
  }

  private requestSkyboxAssets(): void {
    if (this.skyboxRequestsIssued) {
      return;
    }
    this.skyboxRequestsIssued = true;
    for (const layer of VOID_SKY_LAYERS) {
      void ensureAsset(layer.assetId, "near")
        .then((asset) => {
          if (isCubeTextureAsset(asset)) {
            this.applySkyboxTexture(layer, asset);
          }
        })
        .catch((error) => {
          console.warn(`[skybox] failed to load ${layer.assetId}`, error);
        });
    }
  }

  private applySkyboxTexture(layer: VoidSkyLayerDefinition, texture: CubeTexture): void {
    this.skyboxLayerTextures.set(layer.id, texture);
    if (!this.skyboxMaterial) {
      return;
    }
    const uniform = this.skyboxMaterial.uniforms[layer.uniformName];
    if (uniform) {
      uniform.value = texture;
    }
  }

  private updateAnchoredEnvironmentVfx(): void {
    for (const layer of this.environmentVfxLayers.values()) {
      if (layer.anchorsToCamera) {
        layer.group.position.copy(this.camera.position);
      }
    }
  }

  private applyEnvironmentVfx(weights: EnvironmentVfxWeights): void {
    for (const [id, layer] of this.environmentVfxLayers.entries()) {
      const weight = Math.max(0, Math.min(1, weights[id]));
      layer.group.visible = weight > 0.01;
      for (const material of layer.materials) {
        material.opacity = weight;
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

    const propColors = getPropColors();

    if (trees.length > 0) {
      const trunkGeometry = new CylinderGeometry(0.2, 0.26, 2.25, 8, 1);
      const trunkMaterial = new MeshStandardMaterial({
        color: propColors.treeTrunk,
        roughness: 0.94,
        metalness: 0.01
      });
      const trunkMesh = new InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
      trunkMesh.frustumCulled = false;

      const canopyGeometry = new ConeGeometry(1.35, 2.9, 9, 1);
      const canopyMaterial = new MeshStandardMaterial({
        color: propColors.treeCanopy,
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
        color: propColors.rock,
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
        color: propColors.bush,
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
    const textureAssetIds = [WORLD_FOLIAGE_GRASS_PLAIN_ASSET_ID];
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
    this.tryAddGrassInstances();
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

// Neutral fallback — replaced by injectEnvironmentPresets() at startup under normal operation.
const FALLBACK_PRESET: EnvironmentPreset = {
  background: new Color(0x000000),
  fogColor: new Color(0x111111),
  fogNear: 400,
  fogFar: 1600,
  ambientColor: new Color(0x444444),
  ambientIntensity: 0.4,
  sunColor: new Color(0x666666),
  sunIntensity: 0.6,
  exposure: 0.8,
  vfx: { voidStars: 0.5, heavenMist: 0, infernalNebula: 0, arcaneMotes: 0 },
  sky: { skybox1: 0, skybox2: 0, skybox3: 0, skybox4: 0, skybox5: 0 }
};

function requireEnvironmentPreset(id: number): EnvironmentPreset {
  const preset = ENVIRONMENT_PRESETS.get(id);
  return preset ?? ENVIRONMENT_PRESETS.get(DEFAULT_ENVIRONMENT_PRESET_ID) ?? FALLBACK_PRESET;
}

function transformLocationEnvironmentVolume(
  root: LocationRootState,
  childVolume: LocationEnvironmentVolumeDefinition
): EnvironmentVolumeDefinition {
  return {
    id: `${root.nid}:${childVolume.id}`,
    kind: "location",
    priority: ENVIRONMENT_PRIORITY_LOCATION,
    environmentPresetId: childVolume.environmentPresetId,
    x: root.x + childVolume.localX,
    y: root.y + childVolume.localY,
    z: root.z + childVolume.localZ,
    halfX: childVolume.halfX,
    halfY: childVolume.halfY,
    halfZ: childVolume.halfZ,
    blendDistance: childVolume.blendDistance
  };
}

function cloneEnvironmentPreset(preset: EnvironmentPreset): EnvironmentPreset {
  return {
    background: preset.background.clone(),
    fogColor: preset.fogColor.clone(),
    fogNear: preset.fogNear,
    fogFar: preset.fogFar,
    ambientColor: preset.ambientColor.clone(),
    ambientIntensity: preset.ambientIntensity,
    sunColor: preset.sunColor.clone(),
    sunIntensity: preset.sunIntensity,
    exposure: preset.exposure,
    vfx: cloneVfxWeights(preset.vfx),
    sky: cloneSkyWeights(preset.sky)
  };
}

function copyEnvironmentPreset(target: EnvironmentPreset, source: EnvironmentPreset): void {
  target.background.copy(source.background);
  target.fogColor.copy(source.fogColor);
  target.fogNear = source.fogNear;
  target.fogFar = source.fogFar;
  target.ambientColor.copy(source.ambientColor);
  target.ambientIntensity = source.ambientIntensity;
  target.sunColor.copy(source.sunColor);
  target.sunIntensity = source.sunIntensity;
  target.exposure = source.exposure;
  copyVfxWeights(target.vfx, source.vfx);
  copySkyWeights(target.sky, source.sky);
}

function applyPrioritizedEnvironmentInfluences(
  target: EnvironmentPreset,
  influences: readonly EnvironmentInfluence[]
): void {
  const orderedInfluences = [...influences].sort((a, b) => a.priority - b.priority);
  let index = 0;
  while (index < orderedInfluences.length) {
    const priority = orderedInfluences[index]?.priority ?? 0;
    const groupInfluences: EnvironmentInfluence[] = [];
    index += 1;
    const firstInfluence = orderedInfluences[index - 1];
    if (firstInfluence) {
      groupInfluences.push(firstInfluence);
    }
    while (index < orderedInfluences.length && orderedInfluences[index]?.priority === priority) {
      const influence = orderedInfluences[index];
      if (influence) {
        groupInfluences.push(influence);
      }
      index += 1;
    }
    const groupBlend = createWeightedEnvironmentBlend(groupInfluences);
    if (groupBlend) {
      blendEnvironment(target, target, groupBlend.preset, groupBlend.coverage);
    }
  }
}

function createWeightedEnvironmentBlend(
  influences: readonly EnvironmentInfluence[]
): { preset: EnvironmentPreset; coverage: number } | null {
  const weightedInfluences = influences
    .map((influence) => ({
      preset: influence.preset,
      weight: Math.max(0, Math.min(1, influence.weight))
    }))
    .filter((influence) => influence.weight > 0);
  const totalWeight = weightedInfluences.reduce((sum, influence) => sum + influence.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  const invTotalWeight = 1 / totalWeight;
  const firstPreset = weightedInfluences[0]?.preset ?? requireEnvironmentPreset(DEFAULT_ENVIRONMENT_PRESET_ID);
  const preset = cloneEnvironmentPreset(firstPreset);
  preset.background.setRGB(0, 0, 0);
  preset.fogColor.setRGB(0, 0, 0);
  preset.fogNear = 0;
  preset.fogFar = 0;
  preset.ambientColor.setRGB(0, 0, 0);
  preset.ambientIntensity = 0;
  preset.sunColor.setRGB(0, 0, 0);
  preset.sunIntensity = 0;
  preset.exposure = 0;
  copyVfxWeights(preset.vfx, ZERO_VFX_WEIGHTS);
  copySkyWeights(preset.sky, ZERO_SKY_WEIGHTS);

  for (const influence of weightedInfluences) {
    const weight = influence.weight * invTotalWeight;
    addWeightedColor(preset.background, influence.preset.background, weight);
    addWeightedColor(preset.fogColor, influence.preset.fogColor, weight);
    preset.fogNear += influence.preset.fogNear * weight;
    preset.fogFar += influence.preset.fogFar * weight;
    addWeightedColor(preset.ambientColor, influence.preset.ambientColor, weight);
    preset.ambientIntensity += influence.preset.ambientIntensity * weight;
    addWeightedColor(preset.sunColor, influence.preset.sunColor, weight);
    preset.sunIntensity += influence.preset.sunIntensity * weight;
    preset.exposure += influence.preset.exposure * weight;
    addWeightedVfxWeights(preset.vfx, influence.preset.vfx, weight);
    addWeightedSkyWeights(preset.sky, influence.preset.sky, weight);
  }

  return {
    preset,
    coverage: Math.max(0, Math.min(1, totalWeight))
  };
}

function addWeightedColor(out: Color, color: Color, weight: number): void {
  out.r += color.r * weight;
  out.g += color.g * weight;
  out.b += color.b * weight;
}

function blendEnvironment(
  out: EnvironmentPreset,
  a: EnvironmentPreset,
  b: EnvironmentPreset,
  t: number
): void {
  const alpha = Math.max(0, Math.min(1, t));
  out.background.copy(a.background).lerp(b.background, alpha);
  out.fogColor.copy(a.fogColor).lerp(b.fogColor, alpha);
  out.fogNear = lerpNumber(a.fogNear, b.fogNear, alpha);
  out.fogFar = lerpNumber(a.fogFar, b.fogFar, alpha);
  out.ambientColor.copy(a.ambientColor).lerp(b.ambientColor, alpha);
  out.ambientIntensity = lerpNumber(
    a.ambientIntensity,
    b.ambientIntensity,
    alpha
  );
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, alpha);
  out.sunIntensity = lerpNumber(a.sunIntensity, b.sunIntensity, alpha);
  out.exposure = lerpNumber(a.exposure, b.exposure, alpha);
  blendVfxWeights(out.vfx, a.vfx, b.vfx, alpha);
  blendSkyWeights(out.sky, a.sky, b.sky, alpha);
}

function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cloneVfxWeights(weights: EnvironmentVfxWeights): EnvironmentVfxWeights {
  return {
    ...ZERO_VFX_WEIGHTS,
    ...weights
  };
}

function copyVfxWeights(target: EnvironmentVfxWeights, source: EnvironmentVfxWeights): void {
  for (const id of Object.keys(ZERO_VFX_WEIGHTS) as EnvironmentVfxLayerId[]) {
    target[id] = source[id] ?? 0;
  }
}

function blendVfxWeights(
  out: EnvironmentVfxWeights,
  a: EnvironmentVfxWeights,
  b: EnvironmentVfxWeights,
  t: number
): void {
  for (const id of Object.keys(ZERO_VFX_WEIGHTS) as EnvironmentVfxLayerId[]) {
    out[id] = lerpNumber(a[id] ?? 0, b[id] ?? 0, t);
  }
}

function addWeightedVfxWeights(
  out: EnvironmentVfxWeights,
  source: EnvironmentVfxWeights,
  weight: number
): void {
  for (const id of Object.keys(ZERO_VFX_WEIGHTS) as EnvironmentVfxLayerId[]) {
    out[id] += (source[id] ?? 0) * weight;
  }
}

function cloneSkyWeights(weights: VoidSkyWeights): VoidSkyWeights {
  return {
    ...ZERO_SKY_WEIGHTS,
    ...weights
  };
}

function copySkyWeights(target: VoidSkyWeights, source: VoidSkyWeights): void {
  for (const id of Object.keys(ZERO_SKY_WEIGHTS) as VoidSkyLayerId[]) {
    target[id] = source[id] ?? 0;
  }
}

function blendSkyWeights(
  out: VoidSkyWeights,
  a: VoidSkyWeights,
  b: VoidSkyWeights,
  t: number
): void {
  for (const id of Object.keys(ZERO_SKY_WEIGHTS) as VoidSkyLayerId[]) {
    out[id] = lerpNumber(a[id] ?? 0, b[id] ?? 0, t);
  }
}

function addWeightedSkyWeights(
  out: VoidSkyWeights,
  source: VoidSkyWeights,
  weight: number
): void {
  for (const id of Object.keys(ZERO_SKY_WEIGHTS) as VoidSkyLayerId[]) {
    out[id] += (source[id] ?? 0) * weight;
  }
}

function createSolidCubeTexture(hexColor: number): CubeTexture {
  const color = new Color(hexColor);
  const images = Array.from({ length: 6 }, () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(
        color.b * 255
      )})`;
      context.fillRect(0, 0, 1, 1);
    }
    return canvas;
  });
  const texture = new CubeTexture(images);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function isCubeTextureAsset(value: unknown): value is CubeTexture {
  return Boolean(value && typeof value === "object" && (value as { isCubeTexture?: unknown }).isCubeTexture === true);
}
