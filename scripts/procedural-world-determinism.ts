// Validates deterministic procedural world outputs (terrain, biomes, static props) across seeds/configs.
import { createHash } from "node:crypto";
import {
  buildTerrainMeshData,
  generateDeterministicVisualBushes,
  generateDeterministicVisualGrass,
  generateRuntimeMapLayout,
  sampleWorldDominantBiome,
  type RuntimeMapConfig
} from "../src/shared/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function hashArray(value: Float32Array | Uint32Array): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  return hash.digest("hex");
}

function hashProps(props: ReadonlyArray<{
  kind: "tree" | "rock" | "bush";
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}>): string {
  const hash = createHash("sha256");
  for (const prop of props) {
    hash.update(prop.kind);
    hash.update(
      `${prop.x.toFixed(4)}|${prop.y.toFixed(4)}|${prop.z.toFixed(4)}|${prop.rotationY.toFixed(4)}|${prop.scale.toFixed(4)};`
    );
  }
  return hash.digest("hex");
}

function buildConfig(seed: number): RuntimeMapConfig {
  return {
    mapId: "sandbox-alpha",
    instanceId: "determinism-test",
    seed,
    groundHalfExtent: 384,
    groundHalfThickness: 0.5,
    cubeCount: 0,
    oceanBaseHeight: 2,
    oceanEdgeDepth: 10,
    oceanWaveAmplitude: 1.8,
    oceanWaveSpeed: 6,
    oceanWaveLength: 60
  };
}

function validateBiomePlacementRules(config: RuntimeMapConfig): void {
  const layout = generateRuntimeMapLayout(config);
  const trees = layout.staticProps.filter((prop) => prop.kind === "tree");
  const rocks = layout.staticProps.filter((prop) => prop.kind === "rock");
  assert(trees.length > 0, "Expected at least one procedural tree.");
  assert(rocks.length > 0, "Expected at least one procedural rock.");

  for (const tree of trees) {
    const biome = sampleWorldDominantBiome(config, tree.x, tree.z, tree.y);
    assert(biome === "grass", "Tree generated outside grass biome.");
  }

  let foundGrassRock = false;
  for (const rock of rocks) {
    const biome = sampleWorldDominantBiome(config, rock.x, rock.z, rock.y);
    assert(biome !== "snow", "Rock generated in excluded snow biome.");
    if (biome === "grass") {
      foundGrassRock = true;
    }
  }

  assert(foundGrassRock, "Expected at least one rock in grass biome.");
}

function main(): void {
  const configA = buildConfig(1337);
  const configB = buildConfig(7331);

  const layoutA1 = generateRuntimeMapLayout(configA);
  const layoutA2 = generateRuntimeMapLayout(configA);
  const terrainA1 = buildTerrainMeshData(configA);
  const terrainA2 = buildTerrainMeshData(configA);
  const terrainB = buildTerrainMeshData(configB);

  const terrainA1Hash = `${hashArray(terrainA1.vertices)}:${hashArray(terrainA1.colors)}:${hashArray(terrainA1.indices)}`;
  const terrainA2Hash = `${hashArray(terrainA2.vertices)}:${hashArray(terrainA2.colors)}:${hashArray(terrainA2.indices)}`;
  const terrainBHash = `${hashArray(terrainB.vertices)}:${hashArray(terrainB.colors)}:${hashArray(terrainB.indices)}`;
  assert(terrainA1Hash === terrainA2Hash, "Same-seed terrain mesh output is not deterministic.");
  assert(terrainA1Hash !== terrainBHash, "Different seeds produced identical terrain mesh hash.");

  const propsA1Hash = hashProps(layoutA1.staticProps);
  const propsA2Hash = hashProps(layoutA2.staticProps);
  const propsBHash = hashProps(generateRuntimeMapLayout(configB).staticProps);
  assert(propsA1Hash === propsA2Hash, "Same-seed static props output is not deterministic.");
  assert(propsA1Hash !== propsBHash, "Different seeds produced identical static props hash.");

  const bushesA1Hash = hashProps(generateDeterministicVisualBushes(configA));
  const bushesA2Hash = hashProps(generateDeterministicVisualBushes(configA));
  const bushesBHash = hashProps(generateDeterministicVisualBushes(configB));
  assert(bushesA1Hash === bushesA2Hash, "Same-seed visual bush output is not deterministic.");
  assert(bushesA1Hash !== bushesBHash, "Different seeds produced identical visual bush hash.");

  const grassA1Hash = hashProps(generateDeterministicVisualGrass(configA));
  const grassA2Hash = hashProps(generateDeterministicVisualGrass(configA));
  const grassBHash = hashProps(generateDeterministicVisualGrass(configB));
  assert(grassA1Hash === grassA2Hash, "Same-seed visual grass output is not deterministic.");
  assert(grassA1Hash !== grassBHash, "Different seeds produced identical visual grass hash.");

  validateBiomePlacementRules(configA);

  console.log("procedural-world-determinism passed");
}

main();
