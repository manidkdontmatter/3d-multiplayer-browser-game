/**
 * Purpose: This file validates authoritative pickup-to-inventory flow for a nearby pickup.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import process from "node:process";
import RAPIER from "@dimforge/rapier3d-compat";
import { SimulationEcs } from "../src/engine/server/ecs/SimulationEcs";
import { ItemInventorySystem } from "../src/engine/server/items/ItemInventorySystem";
import {
  INVENTORY_MAX_SLOTS,
  INVENTORY_OP_PICKUP,
  PHYSICS_GROUP_CHARACTER,
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
    id: 7,
    queueMessage: (message: unknown) => {
      queuedMessages.push(message);
    }
  };

  const playerEid = ecs.createEntityFromPreset("character", {
    accountId: 1,
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
  const playerCollider = world.createCollider(
    RAPIER.ColliderDesc.capsule(0.9, 0.4).setCollisionGroups(PHYSICS_GROUP_CHARACTER),
    playerBody
  );
  ecs.registerPlayerPhysicsRefs(playerEid, playerBody, playerCollider);
  ecs.setEntityNidByEid(playerEid, 1);
  ecs.bindPlayerIndexes(testUser.id, playerEid);

  let nextNid = 10;
  let pickupNid = 0;
  const replication = {
    spawnEntity: (_simEid: number): number => {
      const nid = nextNid++;
      pickupNid = nid;
      return nid;
    },
    despawnEntity: (_simEid: number): void => {},
    syncEntityFromEcs: (_simEid: number): void => {}
  };

  const emptyInventory: InventorySnapshot = {
    maxSlots: INVENTORY_MAX_SLOTS,
    itemInstances: [],
    equipment: {},
    hotbarSlots: []
  };

  const inventorySystem = new ItemInventorySystem<TestUser>({
    world,
    ecs,
    mapInstanceId: "pickup-regression",
    replication,
    persistence: {
      loadNextInventoryItemInstanceId: () => 1,
      loadInventoryState: () => emptyInventory
    } as never,
    getUserById: (userId) => (userId === testUser.id ? testUser : undefined),
    markPlayerCharacterDirty: () => {},
    persistInventoryMutation: () => {},
    loadPersistentPickups: () => [],
    savePersistentPickups: () => {}
  });

  inventorySystem.initializeWorldItems([
    {
      definitionId: 200,
      quantity: 1,
      x: 1,
      y: 34,
      z: 0,
      persistencePolicy: "transient_bootstrap"
    }
  ]);
  await Promise.resolve();

  assert(pickupNid > 0, "Expected pickup spawn nid to be assigned.");

  inventorySystem.applyCommand(testUser.id, {
    action: INVENTORY_OP_PICKUP,
    pickupNid,
    itemInstanceId: 0,
    quantity: 0,
    equipmentSlot: 0,
    sourceSlot: 0,
    targetSlot: 0,
    activationChannel: 0,
    payloadKind: 0
  } satisfies Partial<ItemCommand>);

  const snapshot = inventorySystem.ensureInventoryLoaded(1);
  if (snapshot.itemInstances.length !== 1) {
    const pickupEid = ecs.getAnyEidByNid(pickupNid);
    const c = ecs.world.components;
    const playerRuntime = ecs.getPlayerRuntimeStateByUserId(testUser.id);
    const diagnostics = {
      pickupNid,
      pickupEid,
      pickupQuantity: typeof pickupEid === "number" ? c.ItemQuantity.value[pickupEid] : null,
      pickupDefinitionId: typeof pickupEid === "number" ? c.ItemArchetypeId.value[pickupEid] : null,
      pickupWorldItemTag: typeof pickupEid === "number" ? c.WorldItemTag[pickupEid] : null,
      pickupPosition: typeof pickupEid === "number"
        ? { x: c.Position.x[pickupEid], y: c.Position.y[pickupEid], z: c.Position.z[pickupEid] }
        : null,
      playerRuntime: playerRuntime
        ? {
            x: playerRuntime.x,
            y: playerRuntime.y,
            z: playerRuntime.z,
            yaw: playerRuntime.yaw,
            pitch: playerRuntime.pitch,
            accountId: playerRuntime.accountId
          }
        : null
    };
    throw new Error(`Expected 1 inventory item, got ${snapshot.itemInstances.length}. Diagnostics=${JSON.stringify(diagnostics)}`);
  }
  assert(snapshot.itemInstances[0]?.definitionId === 200, "Expected picked-up item definition id 200.");
  assert(snapshot.itemInstances[0]?.quantity === 1, "Expected picked-up item quantity 1.");
  assert(typeof ecs.getAnyEidByNid(pickupNid) !== "number", "Expected pickup entity to be removed from ECS.");
  assert(queuedMessages.length >= 1, "Expected inventory state update message queued to player.");

  console.log("[item-pickup-regression] PASS");
}

void main().catch((error) => {
  console.error("[item-pickup-regression] FAIL", error);
  process.exit(1);
});
