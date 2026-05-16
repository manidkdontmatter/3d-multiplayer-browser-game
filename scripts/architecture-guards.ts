// Architecture guard checks that enforce critical layering and determinism contracts.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

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

function listFiles(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const relativePath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      output.push(...listFiles(relativePath));
      continue;
    }
    output.push(relativePath);
  }
  return output;
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

function classifyLayer(path: string): "shared" | "client" | "server" | null {
  const normalizedPath = normalizeSlashes(path);
  if (normalizedPath.includes("/shared/")) {
    return "shared";
  }
  if (normalizedPath.includes("/client/")) {
    return "client";
  }
  if (normalizedPath.includes("/server/")) {
    return "server";
  }
  return null;
}

function classifyDomain(path: string): "engine" | "game" | null {
  const normalizedPath = normalizeSlashes(path);
  if (normalizedPath.startsWith("src/engine/")) {
    return "engine";
  }
  if (normalizedPath.startsWith("src/game/")) {
    return "game";
  }
  return null;
}

function resolveRelativeImportPath(sourceFile: string, specifier: string): string {
  return normalizeSlashes(normalize(join(dirname(sourceFile), specifier)));
}

function assertNoLayerBoundaryViolations(): void {
  const importRegex = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
  const sourceFiles = listFiles("src").filter((file) => file.endsWith(".ts") || file.endsWith(".d.ts"));

  for (const file of sourceFiles) {
    const sourceLayer = classifyLayer(file);
    if (!sourceLayer) {
      continue;
    }
    const content = read(file);
    for (const match of content.matchAll(importRegex)) {
      const specifier = match[1];
      if (!specifier || !specifier.startsWith(".")) {
        continue;
      }
      const targetLayer = classifyLayer(resolveRelativeImportPath(file, specifier));
      if (!targetLayer) {
        continue;
      }
      if (sourceLayer === "shared") {
        assert(targetLayer === "shared", `${file} must not import ${targetLayer} module '${specifier}'`);
        continue;
      }
      if (sourceLayer === "client") {
        assert(targetLayer !== "server", `${file} must not import server module '${specifier}'`);
        continue;
      }
      if (sourceLayer === "server") {
        assert(targetLayer !== "client", `${file} must not import client module '${specifier}'`);
      }
    }
  }
}

function assertNoEngineImportsGame(): void {
  const importRegex = /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
  const sourceFiles = listFiles("src").filter((file) => file.endsWith(".ts") || file.endsWith(".d.ts"));

  for (const file of sourceFiles) {
    const sourceDomain = classifyDomain(file);
    if (sourceDomain !== "engine") {
      continue;
    }
    const content = read(file);
    for (const match of content.matchAll(importRegex)) {
      const specifier = match[1];
      if (!specifier || !specifier.startsWith(".")) {
        continue;
      }
      const targetDomain = classifyDomain(resolveRelativeImportPath(file, specifier));
      assert(targetDomain !== "game", `${file} must not import game module '${specifier}'`);
    }
  }
}

function main(): void {
  assertNoLayerBoundaryViolations();
  assertNoEngineImportsGame();

  const ecsCoreFiles = [
    "src/engine/server/ecs/SimulationEcsStore.ts",
    "src/engine/server/ecs/SimulationEcsIndexRegistry.ts"
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

  const ecsFacade = read("src/engine/server/ecs/SimulationEcs.ts");
  assert(!ecsFacade.includes("Object.defineProperty"), "SimulationEcs.ts must not use property descriptor mutation");

  for (const file of ecsCoreFiles) {
    const content = read(file);
    assert(!content.includes("Object.defineProperty"), `${file} must not use property descriptor mutation`);
    assert(!content.includes("new Proxy("), `${file} must not use Proxy-based state mutation`);
  }

  const gameClientApp = read("src/engine/client/runtime/GameClientApp.ts");
  assert(
    gameClientApp.includes("yaw: this.input.getYaw()"),
    "GameClientApp.getRenderPose must source yaw from InputController"
  );
  assert(
    gameClientApp.includes("this.input.getPitch()"),
    "GameClientApp.getRenderPose must source pitch from InputController"
  );
  assert(
    !gameClientApp.includes("yaw: pose.yaw"),
    "GameClientApp render pose must not source yaw from simulation pose"
  );
  assert(
    !gameClientApp.includes("pitch: Math.max(-LOOK_PITCH_LIMIT, Math.min(LOOK_PITCH_LIMIT, pose.pitch))"),
    "GameClientApp render pose must not source pitch from simulation pose"
  );
  assert(
    gameClientApp.includes("const authoritative = this.network.getLocalPlayerPose();"),
    "GameClientApp must preserve authoritative snapshot position path for CSP-off rendering"
  );
  assert(
    gameClientApp.includes(
      "this.platformTimeline.sampleStates(this.networkOrchestrator.getRenderServerTimeSeconds(this.isCspActive()))"
    ),
    "GameClientApp must source rendered platforms from deterministic platform timeline"
  );
  assert(
    !gameClientApp.includes("this.network.getPlatforms()"),
    "GameClientApp must not source rendered platforms from snapshot platform entities"
  );
  assert(
    !gameClientApp.includes("consumeReconciliationFrame("),
    "GameClientApp must not directly consume reconciliation frames; use ClientNetworkOrchestrator"
  );
  assert(
    !gameClientApp.includes("new ReconciliationSmoother("),
    "GameClientApp must not directly construct ReconciliationSmoother"
  );

  const ackBuffer = read("src/engine/client/runtime/network/AckReconciliationBuffer.ts");
  assert(
    !ackBuffer.includes("yaw: message.yaw"),
    "AckReconciliationBuffer must not apply ack yaw to reconciliation state"
  );
  assert(
    !ackBuffer.includes("pitch: message.pitch"),
    "AckReconciliationBuffer must not apply ack pitch to reconciliation state"
  );
  assert(
    !ackBuffer.includes("platformYawDelta"),
    "AckReconciliationBuffer must not apply ack-driven platform yaw carry"
  );

  const sharedNetcode = read("src/engine/shared/netcode.ts");
  const inputAckSchemaStart = sharedNetcode.indexOf("export const inputAckMessageSchema = defineSchema({");
  const inputAckSchemaEnd = sharedNetcode.indexOf("});", inputAckSchemaStart);
  assert(inputAckSchemaStart >= 0 && inputAckSchemaEnd > inputAckSchemaStart, "Failed to locate InputAck schema");
  const inputAckSchemaBlock = sharedNetcode.slice(inputAckSchemaStart, inputAckSchemaEnd);
  const inputAckInterfaceStart = sharedNetcode.indexOf("export interface InputAckMessage {");
  const inputAckInterfaceEnd = sharedNetcode.indexOf("}", inputAckInterfaceStart);
  assert(
    inputAckInterfaceStart >= 0 && inputAckInterfaceEnd > inputAckInterfaceStart,
    "Failed to locate InputAck interface"
  );
  const inputAckInterfaceBlock = sharedNetcode.slice(inputAckInterfaceStart, inputAckInterfaceEnd);
  assert(
    !inputAckSchemaBlock.includes("yaw: Binary.Rotation32"),
    "InputAckMessage schema must not include yaw"
  );
  assert(
    !inputAckSchemaBlock.includes("pitch: Binary.Rotation32"),
    "InputAckMessage schema must not include pitch"
  );
  assert(
    !inputAckInterfaceBlock.includes("yaw: number"),
    "InputAckMessage interface must not include yaw"
  );
  assert(
    !inputAckInterfaceBlock.includes("pitch: number"),
    "InputAckMessage interface must not include pitch"
  );
  assert(
    !inputAckSchemaBlock.includes("platformYawDelta"),
    "InputAckMessage schema must not include platformYawDelta"
  );
  assert(
    !inputAckInterfaceBlock.includes("platformYawDelta: number"),
    "InputAckMessage interface must not include platformYawDelta"
  );

  const serverInputSystem = read("src/engine/server/input/InputSystem.ts");
  assert(
    !serverInputSystem.includes("LoadoutCommand"),
    "InputSystem must not parse or depend on LoadoutCommand wire types"
  );

  const gameSimulation = read("src/engine/server/GameSimulation.ts");
  assert(
    !gameSimulation.includes('from "./netcode/ReplicationMessagingSystem"'),
    "GameSimulation must not import ReplicationMessagingSystem directly"
  );
  assert(
    !gameSimulation.includes('from "./netcode/NetReplicationBridge"'),
    "GameSimulation must not import NetReplicationBridge directly"
  );
  assert(
    gameSimulation.includes("ServerReplicationCoordinator"),
    "GameSimulation must use ServerReplicationCoordinator as replication boundary"
  );
  assert(
    gameSimulation.includes("createPlayerLifecycleSystem("),
    "GameSimulation must keep player-session lifecycle wiring behind a dedicated factory method"
  );

  const networkClient = read("src/engine/client/runtime/NetworkClient.ts");
  assert(
    !networkClient.includes("LocalPhysicsWorld"),
    "NetworkClient must not import or reference LocalPhysicsWorld"
  );

  const clientOrchestrator = read("src/engine/client/runtime/network/ClientNetworkOrchestrator.ts");
  assert(
    clientOrchestrator.includes("consumeReconciliationFrame"),
    "ClientNetworkOrchestrator must own reconciliation-frame consumption"
  );

  const sharedPlatforms = read("src/engine/shared/platforms.ts");
  assert(
    sharedPlatforms.includes("injectPlatformCatalog"),
    "Shared platform definitions must be injected via injectPlatformCatalog() from game layer"
  );
  assert(
    !sharedPlatforms.includes("export const PLATFORM_DEFINITIONS: PlatformDefinition[] = ["),
    "PLATFORM_DEFINITIONS must not be a hardcoded array in src/engine/shared/platforms.ts"
  );

  const serverArchetypeCatalog = read("src/engine/server/content/ArchetypeCatalog.ts");
  assert(
    serverArchetypeCatalog.includes("PLATFORM_DEFINITIONS"),
    "Server archetype catalog must use shared PLATFORM_DEFINITIONS for platform content"
  );

  const serverArchetypes = JSON.parse(read("src/game/server/archetypes/server-archetypes.json")) as Record<string, unknown>;
  assert(
    !Object.prototype.hasOwnProperty.call(serverArchetypes, "platforms"),
    "server-archetypes.json must not duplicate platform definitions; use platform-archetypes.json"
  );

  console.log("architecture-guards passed");
}

main();
