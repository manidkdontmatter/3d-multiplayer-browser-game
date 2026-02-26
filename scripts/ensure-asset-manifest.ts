// Ensures runtime asset manifest exists and is fresh enough for local dev; rebuilds only when needed.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ASSET_CATALOG, RUNTIME_ASSET_BOOTSTRAP_URL } from "../src/client/assets/assetManifest";

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
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["run", "assets:build:manifest"], {
    cwd: repoRoot,
    stdio: "inherit"
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
    path.join(repoRoot, "src", "client", "assets", "assetManifest.ts"),
    ...ASSET_CATALOG.map((entry) => path.join(repoRoot, "public", normalizePublicPath(entry.sourceUrl)))
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
