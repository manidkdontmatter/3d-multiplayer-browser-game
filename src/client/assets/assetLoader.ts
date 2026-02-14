import { AudioLoader, FileLoader, LoadingManager, Texture, TextureLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetDefinition } from "./assetManifest";

export type LoadedAsset = ArrayBuffer | AudioBuffer | Texture | GLTF;

export interface AssetPreloadProgress {
  loadedCount: number;
  totalCount: number;
  ratio: number;
  activeAssetId: string | null;
  activeAssetLabel: string | null;
}

export interface AssetPreloadOptions {
  onProgress?: (progress: AssetPreloadProgress) => void;
}

const assetCache = new Map<string, LoadedAsset>();

export function getLoadedAsset<T extends LoadedAsset = LoadedAsset>(assetId: string): T | null {
  const asset = assetCache.get(assetId);
  return (asset as T | undefined) ?? null;
}

export function hasLoadedAsset(assetId: string): boolean {
  return assetCache.has(assetId);
}

export function getLoadedAssetCount(): number {
  return assetCache.size;
}

export async function preloadAssets(
  manifest: AssetDefinition[],
  options: AssetPreloadOptions = {}
): Promise<void> {
  const onProgress = options.onProgress;
  const preloadList = manifest.filter((asset) => asset.preload !== false);
  const totalCount = preloadList.length;

  const emitProgress = (loadedCount: number, active: AssetDefinition | null) => {
    onProgress?.({
      loadedCount,
      totalCount,
      ratio: totalCount === 0 ? 1 : loadedCount / totalCount,
      activeAssetId: active?.id ?? null,
      activeAssetLabel: active?.label ?? active?.id ?? null
    });
  };

  emitProgress(0, null);
  if (totalCount === 0) {
    return;
  }

  const manager = new LoadingManager();
  const textureLoader = new TextureLoader(manager);
  const audioLoader = new AudioLoader(manager);
  const gltfLoader = new GLTFLoader(manager);

  let loadedCount = 0;
  for (const asset of preloadList) {
    const loadedAsset = await loadSingleAsset(asset, {
      manager,
      textureLoader,
      audioLoader,
      gltfLoader
    });
    assetCache.set(asset.id, loadedAsset);
    loadedCount += 1;
    emitProgress(loadedCount, asset);
  }
}

interface LoaderSet {
  manager: LoadingManager;
  textureLoader: TextureLoader;
  audioLoader: AudioLoader;
  gltfLoader: GLTFLoader;
}

async function loadSingleAsset(asset: AssetDefinition, loaders: LoaderSet): Promise<LoadedAsset> {
  try {
    switch (asset.kind) {
      case "gltf":
        return await loaders.gltfLoader.loadAsync(asset.url);
      case "texture":
        return await loaders.textureLoader.loadAsync(asset.url);
      case "audio":
        return await loaders.audioLoader.loadAsync(asset.url);
      case "binary":
        return await loadBinaryAsset(loaders.manager, asset.url);
      default:
        throw new Error(`Unsupported asset kind: ${(asset as { kind: string }).kind}`);
    }
  } catch (error) {
    throw new Error(`Failed to load asset "${asset.id}" from "${asset.url}"`, {
      cause: error
    });
  }
}

async function loadBinaryAsset(manager: LoadingManager, url: string): Promise<ArrayBuffer> {
  const loader = new FileLoader(manager);
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
