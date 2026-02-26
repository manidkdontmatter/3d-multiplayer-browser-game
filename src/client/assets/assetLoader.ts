// Centralized client asset manager with runtime manifest loading, request deduplication, and prioritized on-demand fetches.
import { AudioLoader, FileLoader, Group, LoadingManager, Texture, TextureLoader, type WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "meshoptimizer";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin } from "@pixiv/three-vrm-animation";
import {
  ASSET_GROUP_CORE,
  type AssetPriorityHint,
  RUNTIME_ASSET_BOOTSTRAP_URL,
  type RuntimeAssetDefinition,
  type RuntimeAssetManifest,
  type RuntimeManifestBootstrap
} from "./assetManifest";

export type LoadedAsset = ArrayBuffer | AudioBuffer | Texture | GLTF | Group;
export type AssetLoadPriority = AssetPriorityHint;

export interface AssetPreloadProgress {
  loadedCount: number;
  totalCount: number;
  ratio: number;
  activeAssetId: string | null;
  activeAssetLabel: string | null;
}

export interface AssetPreloadOptions {
  onProgress?: (progress: AssetPreloadProgress) => void;
  priority?: AssetLoadPriority;
}

type AssetStatus = "unloaded" | "loading" | "ready" | "failed";

interface AssetRecord {
  definition: RuntimeAssetDefinition;
  status: AssetStatus;
  loaded: LoadedAsset | null;
  error: Error | null;
  inFlight: Promise<LoadedAsset> | null;
}

class AssetManager {
  private readonly records = new Map<string, AssetRecord>();
  private readonly groupIndex = new Map<string, string[]>();
  private readonly loaderManager = new LoadingManager();
  private readonly textureLoader = new TextureLoader(this.loaderManager);
  private readonly ktx2Loader = new KTX2Loader(this.loaderManager);
  private readonly audioLoader = new AudioLoader(this.loaderManager);
  private readonly gltfLoader = new GLTFLoader(this.loaderManager);
  private ktx2Configured = false;
  private manifest: RuntimeAssetManifest | null = null;
  private initPromise: Promise<RuntimeAssetManifest> | null = null;

  public constructor() {
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    this.gltfLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    this.ktx2Loader.setTranscoderPath("/runtime-transcoders/basis/");
  }

  public configureRendererCapabilities(renderer: WebGLRenderer): void {
    if (this.ktx2Configured) {
      return;
    }
    this.ktx2Loader.detectSupport(renderer);
    this.ktx2Configured = true;
  }

  public async initialize(): Promise<RuntimeAssetManifest> {
    if (this.manifest) {
      return this.manifest;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.loadManifest();
    try {
      this.manifest = await this.initPromise;
      return this.manifest;
    } finally {
      this.initPromise = null;
    }
  }

  public getLoadedAsset<T extends LoadedAsset = LoadedAsset>(assetId: string): T | null {
    const loaded = this.records.get(assetId)?.loaded;
    return (loaded as T | null | undefined) ?? null;
  }

  public hasLoadedAsset(assetId: string): boolean {
    return this.records.get(assetId)?.status === "ready";
  }

  public getLoadedAssetCount(): number {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.status === "ready") {
        count += 1;
      }
    }
    return count;
  }

  public async preloadCoreAssets(options: AssetPreloadOptions = {}): Promise<void> {
    await this.preloadGroup(ASSET_GROUP_CORE, options);
  }

  public async preloadGroup(groupId: string, options: AssetPreloadOptions = {}): Promise<void> {
    await this.initialize();
    const assetIds = this.groupIndex.get(groupId) ?? [];
    const totalCount = assetIds.length;
    const emitProgress = (loadedCount: number, activeAssetId: string | null) => {
      const activeLabel =
        activeAssetId === null
          ? null
          : this.records.get(activeAssetId)?.definition.label ?? activeAssetId;
      options.onProgress?.({
        loadedCount,
        totalCount,
        ratio: totalCount === 0 ? 1 : loadedCount / totalCount,
        activeAssetId,
        activeAssetLabel: activeLabel
      });
    };

    emitProgress(0, null);
    if (totalCount === 0) {
      return;
    }

    let loadedCount = 0;
    for (const assetId of assetIds) {
      await this.ensureAsset(assetId, options.priority ?? "near");
      loadedCount += 1;
      emitProgress(loadedCount, assetId);
    }
  }

  public async ensureAsset(
    assetId: string,
    priority: AssetLoadPriority = "near"
  ): Promise<LoadedAsset> {
    await this.initialize();
    const record = this.records.get(assetId);
    if (!record) {
      throw new Error(`Unknown asset id: "${assetId}"`);
    }
    if (record.status === "ready" && record.loaded) {
      return record.loaded;
    }
    if (record.inFlight) {
      return record.inFlight;
    }

    record.status = "loading";
    record.error = null;
    const inFlight = this.loadSingleAsset(record.definition, priority)
      .then((loaded) => {
        record.loaded = loaded;
        record.status = "ready";
        record.error = null;
        return loaded;
      })
      .catch((error) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        record.status = "failed";
        record.error = normalized;
        throw normalized;
      })
      .finally(() => {
        record.inFlight = null;
      });

    record.inFlight = inFlight;
    return inFlight;
  }

  private async loadManifest(): Promise<RuntimeAssetManifest> {
    const bootstrapResponse = await fetch(RUNTIME_ASSET_BOOTSTRAP_URL, { cache: "no-cache" });
    if (!bootstrapResponse.ok) {
      throw new Error(`Runtime asset bootstrap request failed (${bootstrapResponse.status})`);
    }
    const bootstrap = (await bootstrapResponse.json()) as RuntimeManifestBootstrap;
    if (
      bootstrap.manifestVersion !== 1 ||
      typeof bootstrap.manifestUrl !== "string" ||
      bootstrap.manifestUrl.length === 0
    ) {
      throw new Error("Runtime asset bootstrap payload malformed.");
    }

    const manifestResponse = await fetch(bootstrap.manifestUrl, { cache: "no-cache" });
    if (!manifestResponse.ok) {
      throw new Error(`Runtime asset manifest request failed (${manifestResponse.status})`);
    }
    const manifest = (await manifestResponse.json()) as RuntimeAssetManifest;
    if (manifest.manifestVersion !== 1 || !Array.isArray(manifest.assets)) {
      throw new Error("Runtime asset manifest payload malformed.");
    }

    this.records.clear();
    this.groupIndex.clear();
    for (const asset of manifest.assets) {
      const definition = this.normalizeDefinition(asset);
      this.records.set(definition.id, {
        definition,
        status: "unloaded",
        loaded: null,
        error: null,
        inFlight: null
      });
      for (const groupId of definition.groups) {
        const list = this.groupIndex.get(groupId);
        if (list) {
          list.push(definition.id);
        } else {
          this.groupIndex.set(groupId, [definition.id]);
        }
      }
    }

    for (const [groupId, assetIds] of this.groupIndex.entries()) {
      const sorted = [...new Set(assetIds)].sort((a, b) => {
        const aPriority = this.records.get(a)?.definition.priorityHint ?? "near";
        const bPriority = this.records.get(b)?.definition.priorityHint ?? "near";
        return comparePriority(aPriority, bPriority);
      });
      this.groupIndex.set(groupId, sorted);
    }

    return manifest;
  }

  private normalizeDefinition(raw: RuntimeAssetDefinition): RuntimeAssetDefinition {
    if (
      typeof raw.id !== "string" ||
      raw.id.length === 0 ||
      typeof raw.url !== "string" ||
      raw.url.length === 0
    ) {
      throw new Error("Runtime asset definition missing id/url.");
    }
    return {
      ...raw,
      deps: Array.isArray(raw.deps) ? raw.deps.filter((dep) => typeof dep === "string") : [],
      groups: Array.isArray(raw.groups) ? raw.groups.filter((group) => typeof group === "string") : [],
      priorityHint:
        raw.priorityHint === "critical" || raw.priorityHint === "background" ? raw.priorityHint : "near"
    };
  }

  private async loadSingleAsset(
    definition: RuntimeAssetDefinition,
    priority: AssetLoadPriority
  ): Promise<LoadedAsset> {
    try {
      for (const depId of definition.deps) {
        await this.ensureAsset(depId, priority);
      }

      switch (definition.kind) {
        case "gltf":
        case "vrma":
          return await this.gltfLoader.loadAsync(definition.url);
        case "texture":
          if (definition.url.toLowerCase().endsWith(".ktx2")) {
            return await this.ktx2Loader.loadAsync(definition.url);
          }
          return await this.textureLoader.loadAsync(definition.url);
        case "audio":
          return await this.audioLoader.loadAsync(definition.url);
        case "binary":
          return await this.loadBinaryAsset(definition.url);
        default:
          throw new Error(`Unsupported asset kind: ${(definition as { kind: string }).kind}`);
      }
    } catch (error) {
      throw new Error(`Failed to load asset "${definition.id}" from "${definition.url}"`, {
        cause: error
      });
    }
  }

  private async loadBinaryAsset(url: string): Promise<ArrayBuffer> {
    const loader = new FileLoader(this.loaderManager);
    loader.setResponseType("arraybuffer");
    const data = await loader.loadAsync(url);
    if (data instanceof ArrayBuffer) {
      return data;
    }
    if (ArrayBuffer.isView(data)) {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const copy = new Uint8Array(data.byteLength);
      copy.set(bytes);
      return copy.buffer;
    }
    throw new Error(`Expected binary ArrayBuffer for "${url}"`);
  }
}

function comparePriority(a: AssetPriorityHint, b: AssetPriorityHint): number {
  return priorityRank(a) - priorityRank(b);
}

function priorityRank(priority: AssetPriorityHint): number {
  switch (priority) {
    case "critical":
      return 0;
    case "near":
      return 1;
    default:
      return 2;
  }
}

const MANAGER = new AssetManager();

export function configureAssetLoaderRenderer(renderer: WebGLRenderer): void {
  MANAGER.configureRendererCapabilities(renderer);
}

export async function initializeAssetManager(): Promise<void> {
  await MANAGER.initialize();
}

export async function preloadCoreAssets(options: AssetPreloadOptions = {}): Promise<void> {
  await MANAGER.preloadCoreAssets(options);
}

export async function preloadAssetGroup(groupId: string, options: AssetPreloadOptions = {}): Promise<void> {
  await MANAGER.preloadGroup(groupId, options);
}

export async function ensureAsset(assetId: string, priority: AssetLoadPriority = "near"): Promise<LoadedAsset> {
  return await MANAGER.ensureAsset(assetId, priority);
}

export function getLoadedAsset<T extends LoadedAsset = LoadedAsset>(assetId: string): T | null {
  return MANAGER.getLoadedAsset<T>(assetId);
}

export function hasLoadedAsset(assetId: string): boolean {
  return MANAGER.hasLoadedAsset(assetId);
}

export function getLoadedAssetCount(): number {
  return MANAGER.getLoadedAssetCount();
}
