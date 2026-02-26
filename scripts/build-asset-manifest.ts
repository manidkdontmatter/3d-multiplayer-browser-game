// Generates hashed runtime assets/manifests with KTX2 texture conversion, meshopt-ready model processing, and transcoder runtime files.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { encodeToKTX2 } from "ktx2-encoder";
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import {
  ASSET_CATALOG,
  type AssetCatalogDefinition,
  type RuntimeAssetDefinition,
  type RuntimeAssetManifest,
  type RuntimeManifestBootstrap
} from "../src/client/assets/assetManifest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const publicDir = path.join(repoRoot, "public");
const runtimeAssetRootDir = path.join(publicDir, "runtime-assets");
const runtimeManifestRootDir = path.join(publicDir, "runtime-manifests");
const runtimeTranscoderRootDir = path.join(publicDir, "runtime-transcoders", "basis");
const basisSourceDir = path.join(repoRoot, "node_modules", "three", "examples", "jsm", "libs", "basis");

async function main(): Promise<void> {
  await rm(runtimeAssetRootDir, { recursive: true, force: true });
  await rm(runtimeManifestRootDir, { recursive: true, force: true });
  await rm(runtimeTranscoderRootDir, { recursive: true, force: true });
  await mkdir(runtimeAssetRootDir, { recursive: true });
  await mkdir(runtimeManifestRootDir, { recursive: true });
  await mkdir(runtimeTranscoderRootDir, { recursive: true });

  await copyBasisTranscoderRuntime();

  const definitions: RuntimeAssetDefinition[] = [];
  for (const entry of ASSET_CATALOG) {
    const definition = await buildRuntimeDefinition(entry);
    definitions.push(definition);
  }

  definitions.sort((a, b) => a.id.localeCompare(b.id));

  const groups: Record<string, string[]> = {};
  for (const definition of definitions) {
    for (const groupId of definition.groups) {
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push(definition.id);
    }
  }
  for (const groupId of Object.keys(groups)) {
    groups[groupId] = [...new Set(groups[groupId] ?? [])].sort((a, b) => a.localeCompare(b));
  }

  const generatedAtIso = new Date().toISOString();
  const manifestSkeleton: RuntimeAssetManifest = {
    manifestVersion: 1,
    buildId: "pending",
    generatedAtIso,
    assets: definitions,
    groups
  };
  const manifestBuildHash = hashJson(manifestSkeleton).slice(0, 12);
  const buildId = `assets-${manifestBuildHash}`;
  const manifest: RuntimeAssetManifest = {
    ...manifestSkeleton,
    buildId
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestHash = shortHash(manifestJson);
  const manifestFileName = `assets-manifest.${manifestHash}.json`;
  const manifestPublicUrl = `/runtime-manifests/${manifestFileName}`;

  await writeFile(path.join(runtimeManifestRootDir, manifestFileName), manifestJson, "utf8");

  const bootstrap: RuntimeManifestBootstrap = {
    manifestVersion: 1,
    buildId,
    generatedAtIso,
    manifestUrl: manifestPublicUrl
  };
  await writeFile(
    path.join(runtimeManifestRootDir, "runtime-bootstrap.json"),
    `${JSON.stringify(bootstrap, null, 2)}\n`,
    "utf8"
  );

  console.log(
    `[assets] generated ${definitions.length} assets, ${Object.keys(groups).length} groups, manifest=${manifestFileName}`
  );
}

async function buildRuntimeDefinition(entry: AssetCatalogDefinition): Promise<RuntimeAssetDefinition> {
  const sourceRelativePath = normalizeSourcePath(entry.sourceUrl);
  const sourceAbsolutePath = path.join(publicDir, sourceRelativePath);
  const sourceStats = await stat(sourceAbsolutePath);
  if (!sourceStats.isFile()) {
    throw new Error(`Asset source path is not a file: ${entry.sourceUrl}`);
  }

  const sourceBytes = await readFile(sourceAbsolutePath);
  const transformed = await transformAsset(entry, sourceRelativePath, sourceBytes);
  const hash = shortHash(transformed.bytes);

  const parsed = path.parse(sourceRelativePath);
  const targetRelativePath = path.posix.join(
    "runtime-assets",
    parsed.dir,
    `${parsed.name}.${hash}${transformed.ext}`
  );
  const targetAbsolutePath = path.join(publicDir, targetRelativePath);
  await mkdir(path.dirname(targetAbsolutePath), { recursive: true });
  await writeFile(targetAbsolutePath, transformed.bytes);

  return {
    id: entry.id,
    url: toPublicUrl(targetRelativePath),
    kind: entry.kind,
    hash,
    bytes: transformed.bytes.byteLength,
    label: entry.label,
    deps: entry.deps ?? [],
    groups: entry.groups,
    priorityHint: entry.priorityHint ?? "near"
  };
}

async function transformAsset(
  entry: AssetCatalogDefinition,
  sourceRelativePath: string,
  sourceBytes: Uint8Array
): Promise<{ bytes: Uint8Array; ext: string }> {
  if (entry.kind === "texture" && isTextureSourceFile(sourceRelativePath)) {
    const ktx2 = await encodeTextureToKtx2(sourceBytes, sourceRelativePath);
    if (ktx2.byteLength >= sourceBytes.byteLength) {
      return {
        bytes: sourceBytes,
        ext: path.extname(sourceRelativePath)
      };
    }
    return {
      bytes: ktx2,
      ext: ".ktx2"
    };
  }

  if (entry.kind === "gltf" && isMeshoptConvertibleModel(sourceRelativePath, entry.id)) {
    const optimized = await meshoptOptimizeGlb(sourceBytes);
    return {
      bytes: optimized,
      ext: ".glb"
    };
  }

  return {
    bytes: sourceBytes,
    ext: path.extname(sourceRelativePath)
  };
}

async function encodeTextureToKtx2(sourceBytes: Uint8Array, sourceRelativePath: string): Promise<Uint8Array> {
  const normalMap = /normal/i.test(path.basename(sourceRelativePath));
  const encoded = await encodeToKTX2(sourceBytes, {
    isKTX2File: true,
    isUASTC: true,
    isYFlip: true,
    generateMipmap: !normalMap,
    isPerceptual: !normalMap,
    isNormalMap: normalMap,
    enableRDO: true,
    rdoQualityLevel: 1,
    uastcLDRQualityLevel: 2,
    imageDecoder: decodeImageWithSharp
  });
  return encoded;
}

async function decodeImageWithSharp(buffer: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> {
  const decoded = await sharp(buffer, { animated: false, limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: decoded.info.width,
    height: decoded.info.height,
    data: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength)
  };
}

async function meshoptOptimizeGlb(sourceBytes: Uint8Array): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression]);
  const document = await io.readBinary(sourceBytes);
  await document.transform(
    meshopt({
      encoder: MeshoptEncoder,
      level: "medium"
    })
  );
  return io.writeBinary(document);
}

async function copyBasisTranscoderRuntime(): Promise<void> {
  await copyFile(
    path.join(basisSourceDir, "basis_transcoder.js"),
    path.join(runtimeTranscoderRootDir, "basis_transcoder.js")
  );
  await copyFile(
    path.join(basisSourceDir, "basis_transcoder.wasm"),
    path.join(runtimeTranscoderRootDir, "basis_transcoder.wasm")
  );
}

function normalizeSourcePath(sourceUrl: string): string {
  if (!sourceUrl.startsWith("/")) {
    throw new Error(`Asset source url must start with '/': ${sourceUrl}`);
  }
  if (!sourceUrl.startsWith("/assets/")) {
    throw new Error(`Asset source url must be under /assets/: ${sourceUrl}`);
  }
  const normalized = sourceUrl.slice(1).replace(/\\/g, "/");
  if (normalized.includes("..")) {
    throw new Error(`Asset source url may not include parent traversal: ${sourceUrl}`);
  }
  return normalized;
}

function isTextureSourceFile(sourceRelativePath: string): boolean {
  const ext = path.extname(sourceRelativePath).toLowerCase();
  return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
}

function isMeshoptConvertibleModel(sourceRelativePath: string, assetId: string): boolean {
  const ext = path.extname(sourceRelativePath).toLowerCase();
  if (ext !== ".glb") {
    return false;
  }
  // Keep humanoid VRM path untouched; meshopt pipeline is for non-humanoid world models.
  if (assetId.startsWith("character.")) {
    return false;
  }
  return true;
}

function toPublicUrl(relativePath: string): string {
  return `/${relativePath.replace(/\\/g, "/")}`;
}

function shortHash(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 12);
}

function hashJson(value: unknown): string {
  return shortHash(JSON.stringify(value));
}

void main().catch((error) => {
  console.error("[assets] manifest generation failed", error);
  process.exit(1);
});
