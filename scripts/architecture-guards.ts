import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoForbiddenImports(path: string, forbidden: readonly string[]): void {
  const content = read(path);
  for (const token of forbidden) {
    assert(!content.includes(token), `${path} must not reference '${token}'`);
  }
}

function main(): void {
  const ecsCoreFiles = [
    "src/server/ecs/SimulationEcsStore.ts",
    "src/server/ecs/SimulationEcsIndexRegistry.ts",
    "src/server/ecs/SimulationEcsProjectors.ts"
  ] as const;

  const forbiddenCrossLayerTokens = [
    "../netcode",
    "./netcode",
    "../persistence",
    "./persistence",
    "../lifecycle",
    "./lifecycle",
    "from \"nengi\""
  ] as const;

  for (const file of ecsCoreFiles) {
    assertNoForbiddenImports(file, forbiddenCrossLayerTokens);
  }

  const ecsFacade = read("src/server/ecs/SimulationEcs.ts");
  assert(!ecsFacade.includes("Object.defineProperty"), "SimulationEcs.ts must not use property descriptor mutation");

  for (const file of ecsCoreFiles) {
    const content = read(file);
    assert(!content.includes("Object.defineProperty"), `${file} must not use property descriptor mutation`);
    assert(!content.includes("new Proxy("), `${file} must not use Proxy-based state mutation`);
  }

  console.log("architecture-guards passed");
}

main();
