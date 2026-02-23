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

  const gameClientApp = read("src/client/runtime/GameClientApp.ts");
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

  const ackBuffer = read("src/client/runtime/network/AckReconciliationBuffer.ts");
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

  const sharedNetcode = read("src/shared/netcode.ts");
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

  const serverInputSystem = read("src/server/input/InputSystem.ts");
  assert(
    !serverInputSystem.includes("LoadoutCommand"),
    "InputSystem must not parse or depend on LoadoutCommand wire types"
  );

  const gameSimulation = read("src/server/GameSimulation.ts");
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

  console.log("architecture-guards passed");
}

main();
