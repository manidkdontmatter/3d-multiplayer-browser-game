/**
 * Purpose: This file validates canonical hotbar payload operations for item and ability payload kinds.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import process from "node:process";
import RAPIER from "@dimforge/rapier3d-compat";
import { SimulationEcs } from "../src/engine/server/ecs/SimulationEcs";
import { ItemInventorySystem } from "../src/engine/server/items/ItemInventorySystem";
import {
  HOTBAR_PAYLOAD_KIND_ABILITY,
  HOTBAR_PAYLOAD_KIND_ITEM_INSTANCE,
  INVENTORY_MAX_SLOTS,
  INVENTORY_OP_ASSIGN_HOTBAR_SLOT,
  INVENTORY_OP_CLEAR_HOTBAR_SLOT,
  INVENTORY_OP_DROP_HOTBAR_SLOT,
  INVENTORY_OP_EXECUTE_HOTBAR_SLOT,
  INVENTORY_OP_MOVE_HOTBAR_SLOT,
  ITEM_ACTIVATION_CHANNEL_DEFAULT,
  ITEM_ACTIVATION_CHANNEL_SECONDARY,
  type InventorySnapshot,
  type ItemCommand
} from "../src/engine/shared/index";
import { initializeSharedGameData } from "../src/game/shared/index";

type TestUser = {
  id: number;
  queueMessage: (message: unknown) => void;
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  initializeSharedGameData();
  await RAPIER.init();

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const ecs = new SimulationEcs();
  const queuedMessages: unknown[] = [];
  const testUser: TestUser = {
    id: 13,
    queueMessage: (message: unknown) => {
      queuedMessages.push(message);
    }
  };

  const playerEid = ecs.createEntityFromPreset("character", {
    accountId: 42,
    position: { x: 0, y: 34, z: 0 },
    yaw: 0,
    pitch: 0,
    velocity: { x: 0, y: 0, z: 0 },
    health: 100,
    maxHealth: 100,
    modelId: 0,
    hotbarAbilityIds: new Array<number>(10).fill(0),
    unlockedAbilityIds: [],
    primaryMouseSlot: 0,
    secondaryMouseSlot: 1
  });
  const playerBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 34, 0)
  );
  const playerCollider = world.createCollider(RAPIER.ColliderDesc.capsule(0.9, 0.4), playerBody);
  ecs.registerPlayerPhysicsRefs(playerEid, playerBody, playerCollider);
  ecs.bindPlayerIndexes(testUser.id, playerEid);

  const emptyInventory: InventorySnapshot = {
    maxSlots: INVENTORY_MAX_SLOTS,
    itemInstances: [],
    equipment: {},
    hotbarSlots: []
  };

  let executedAbilityId = 0;
  const inventorySystem = new ItemInventorySystem<TestUser>({
    world,
    ecs,
    mapInstanceId: "hotbar-regression",
    replication: {
      spawnEntity: () => 11,
      despawnEntity: () => {},
      syncEntityFromEcs: () => {}
    },
    persistence: {
      loadNextInventoryItemInstanceId: () => 1,
      loadInventoryState: () => ({
        ...emptyInventory,
        itemInstances: [
          { itemInstanceId: 1, definitionId: 200, quantity: 2, slotIndex: 0 },
          { itemInstanceId: 2, definitionId: 202, quantity: 3, slotIndex: 1 }
        ]
      })
    } as never,
    getUserById: (userId) => (userId === testUser.id ? testUser : undefined),
    markPlayerCharacterDirty: () => {},
    persistInventoryMutation: () => {},
    loadPersistentPickups: () => [],
    savePersistentPickups: () => {},
    executeHotbarAbility: (_userId, abilityId) => {
      executedAbilityId = abilityId;
      return true;
    }
  });

  // Assign item instance to slot 0
  inventorySystem.applyCommand(testUser.id, {
    action: INVENTORY_OP_ASSIGN_HOTBAR_SLOT,
    itemInstanceId: 1,
    targetSlot: 0,
    payloadKind: HOTBAR_PAYLOAD_KIND_ITEM_INSTANCE
  } satisfies Partial<ItemCommand>);

  // Assign ability payload to slot 1
  inventorySystem.applyCommand(testUser.id, {
    action: INVENTORY_OP_ASSIGN_HOTBAR_SLOT,
    itemInstanceId: 2,
    targetSlot: 1,
    payloadKind: HOTBAR_PAYLOAD_KIND_ABILITY
  } satisfies Partial<ItemCommand>);

  // Move/swap slots 0 and 1
  inventorySystem.applyCommand(testUser.id, {
    action: INVENTORY_OP_MOVE_HOTBAR_SLOT,
    sourceSlot: 0,
    targetSlot: 1
  } satisfies Partial<ItemCommand>);

  // Execute ability payload from slot 0 after swap
  inventorySystem.applyCommand(testUser.id, {
    action: INVENTORY_OP_EXECUTE_HOTBAR_SLOT,
    sourceSlot: 0,
    activationChannel: ITEM_ACTIVATION_CHANNEL_SECONDARY
  } satisfies Partial<ItemCommand>);
  assert(executedAbilityId === 2, "Expected ability payload execution for refId=2.");

  // Execute item payload from slot 1 after swap
  inventorySystem.applyCommand(testUser.id, {
    action: INVENTORY_OP_EXECUTE_HOTBAR_SLOT,
    sourceSlot: 1,
    activationChannel: ITEM_ACTIVATION_CHANNEL_DEFAULT
  } satisfies Partial<ItemCommand>);

  // Drop item payload from slot 1 and clear slot
  inventorySystem.applyCommand(testUser.id, {
    action: INVENTORY_OP_DROP_HOTBAR_SLOT,
    sourceSlot: 1
  } satisfies Partial<ItemCommand>);

  // Clear ability slot 0
  inventorySystem.applyCommand(testUser.id, {
    action: INVENTORY_OP_CLEAR_HOTBAR_SLOT,
    sourceSlot: 0
  } satisfies Partial<ItemCommand>);

  const snapshot = inventorySystem.ensureInventoryLoaded(42);
  assert((snapshot.hotbarSlots[0] ?? null) === null, "Expected slot 0 cleared.");
  assert((snapshot.hotbarSlots[1] ?? null) === null, "Expected slot 1 cleared after drop.");
  assert(snapshot.itemInstances.every((item) => item.itemInstanceId !== 1), "Expected item instance #1 consumed/dropped.");
  assert(queuedMessages.length > 0, "Expected inventory updates queued.");

  console.log("[hotbar-payload-regression] PASS");
}

void main().catch((error) => {
  console.error("[hotbar-payload-regression] FAIL", error);
  process.exit(1);
});

