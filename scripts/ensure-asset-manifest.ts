/**
 * Purpose: This file defines or loads runtime asset metadata for reliable asset access.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RUNTIME_ASSET_BOOTSTRAP_URL } from "../src/engine/client/assets/assetManifest";
import { ASSET_CATALOG_DEFINITIONS } from "../src/game/client/assetCatalog";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

async function main(): Promise<void> {
  const needsBuild = await checkNeedsBuild();
  if (!needsBuild) {
    console.log("[assets] runtime manifest is fresh; skipping rebuild");
    return;
  }

  console.log("[assets] runtime manifest missing/stale; rebuilding...");
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "npm run assets:build:manifest"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false
    })
    : spawnSync("npm", ["run", "assets:build:manifest"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false
    });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function checkNeedsBuild(): Promise<boolean> {
  const bootstrapAbsolutePath = path.join(repoRoot, "public", normalizePublicPath(RUNTIME_ASSET_BOOTSTRAP_URL));
  const bootstrapStat = await safeStat(bootstrapAbsolutePath);
  if (!bootstrapStat) {
    return true;
  }

  const bootstrapRaw = await readFile(bootstrapAbsolutePath, "utf8");
  const bootstrap = JSON.parse(bootstrapRaw) as { manifestUrl?: unknown };
  if (typeof bootstrap.manifestUrl !== "string" || bootstrap.manifestUrl.length === 0) {
    return true;
  }

  const manifestAbsolutePath = path.join(repoRoot, "public", normalizePublicPath(bootstrap.manifestUrl));
  const manifestStat = await safeStat(manifestAbsolutePath);
  if (!manifestStat) {
    return true;
  }

  const outputMtime = Math.min(bootstrapStat.mtimeMs, manifestStat.mtimeMs);
  const inputPaths = [
    path.join(repoRoot, "scripts", "build-asset-manifest.ts"),
    path.join(repoRoot, "src", "engine", "client", "assets", "assetManifest.ts"),
    ...ASSET_CATALOG_DEFINITIONS.flatMap((entry) => getEntrySourceUrls(entry))
      .map((sourceUrl) => path.join(repoRoot, "public", normalizePublicPath(sourceUrl)))
  ];

  for (const inputPath of inputPaths) {
    const inputStat = await safeStat(inputPath);
    if (!inputStat) {
      return true;
    }
    if (inputStat.mtimeMs > outputMtime) {
      return true;
    }
  }

  return false;
}

function getEntrySourceUrls(entry: { sourceUrl?: string; sourceUrls?: string[] }): string[] {
  if (Array.isArray(entry.sourceUrls) && entry.sourceUrls.length > 0) {
    return entry.sourceUrls;
  }
  return entry.sourceUrl ? [entry.sourceUrl] : [];
}

function normalizePublicPath(value: string): string {
  if (!value.startsWith("/")) {
    throw new Error(`Expected absolute public URL path, got: ${value}`);
  }
  return value.slice(1).replace(/\\/g, "/");
}

async function safeStat(filePath: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

void main().catch((error) => {
  console.error("[assets] ensure manifest failed", error);
  process.exit(1);
});
