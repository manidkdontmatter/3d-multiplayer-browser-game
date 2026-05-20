/**
 * Purpose: This file manages item inventory state and inventory-related updates, and manages shared item data or item-related runtime behavior.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { hasComponent } from "bitecs";
import {
  INVENTORY_MAX_SLOTS,
  INVENTORY_OP_DROP,
  INVENTORY_OP_DROP_HOTBAR_SLOT,
  INVENTORY_OP_EQUIP,
  INVENTORY_OP_EXECUTE_HOTBAR_SLOT,
  INVENTORY_OP_ASSIGN_HOTBAR_SLOT,
  INVENTORY_OP_CLEAR_HOTBAR_SLOT,
  INVENTORY_OP_MOVE_HOTBAR_SLOT,
  INVENTORY_OP_PICKUP,
  INVENTORY_OP_UNEQUIP,
  INVENTORY_OP_USE,
  HOTBAR_SLOT_COUNT,
  ITEM_ACTIVATION_CHANNEL_DEFAULT,
  ITEM_ACTIVATION_CHANNEL_SECONDARY,
  ITEM_ACTIVATION_CHANNEL_TERTIARY,
  ITEM_ACTIVATION_CHANNEL_QUATERNARY,
  ITEM_ACTIVATION_CHANNEL_QUINARY,
  hotbarPayloadKindFromWireValue,
  type HotbarSlotPayload,
  PHYSICS_QUERY_GROUP_CHARACTER_SOLIDS,
  STARTER_PICKUP_SPAWNS,
  decodeInventorySnapshot,
  encodeInventorySnapshot,
  equipmentSlotFromWireValue,
  getItemDefinitionById,
  type EquipmentSlot,
  type ItemInstance,
  type InventorySnapshot,
  type ItemDefinition,
  type PickupPersistencePolicy,
  type PickupSpawnDefinition
} from "../../shared/index";
import type { ItemCommand as ItemWireCommand } from "../../shared/netcode";
import { NType } from "../../shared/netcode";
import { GUEST_ACCOUNT_ID_BASE, type PersistedPickupState, type PersistenceService } from "../persistence/PersistenceService";
import type { SimulationEcs } from "../ecs/SimulationEcs";

const INTERACTION_MAX_DISTANCE = 3.35;
const INTERACTION_MAX_DISTANCE_SQ = INTERACTION_MAX_DISTANCE * INTERACTION_MAX_DISTANCE;
const DROP_FORWARD_DISTANCE = 1.35;
const DROP_VERTICAL_OFFSET = -1.0;
const WORLD_ITEM_INTERACTION_TARGET_Y_OFFSET = 0.85;
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

export interface ItemInventoryPlayerState {
  accountId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  maxHealth: number;
  collider: RAPIER.Collider;
}

export interface ItemInventorySystemOptions<TUser> {
  readonly world: RAPIER.World;
  readonly ecs: SimulationEcs;
  readonly mapInstanceId: string;
  readonly replication: {
    spawnEntity: (simEid: number) => number;
    despawnEntity: (simEid: number) => void;
    syncEntityFromEcs: (simEid: number) => void;
  };
  readonly persistence: PersistenceService;
  readonly getUserById: (userId: number) => TUser | undefined;
  readonly markPlayerCharacterDirty: (accountId: number) => void;
  readonly persistInventoryMutation: (
    accountId: number,
    snapshot: InventorySnapshot,
    action: number,
    eventId: string,
    eventAtMs: number
  ) => void;
  readonly loadPersistentPickups: (
    instanceId: string
  ) => ReadonlyArray<PersistedPickupState> | Promise<ReadonlyArray<PersistedPickupState>>;
  readonly savePersistentPickups: (
    instanceId: string,
    pickups: ReadonlyArray<PersistedPickupState>
  ) => void;
  readonly executeHotbarAbility: (userId: number, abilityId: number, activationChannel: number) => boolean;
}

interface MutableInventoryState {
  maxSlots: number;
  itemInstances: ItemInstance[];
  equipment: Partial<Record<EquipmentSlot, number>>;
  hotbarSlots: Array<HotbarSlotPayload | null>;
}

interface PickupRuntimeState {
  pickupId: number;
  persistencePolicy: PickupPersistencePolicy;
}

export class ItemInventorySystem<TUser extends { queueMessage: (message: unknown) => void }> {
  private readonly inventoriesByAccountId = new Map<number, MutableInventoryState>();
  private readonly pendingInventoryByAccountId = new Map<number, InventorySnapshot>();
  private readonly pickupRuntimeByEid = new Map<number, PickupRuntimeState>();
  private readonly mapInstanceId: string;
  private nextInventoryItemInstanceId: number;
  private nextPickupId = 1;
  private criticalEventSequence = 1;

  public constructor(private readonly options: ItemInventorySystemOptions<TUser>) {
    this.mapInstanceId = this.resolveMapInstanceId(options.mapInstanceId);
    this.nextInventoryItemInstanceId = this.options.persistence.loadNextInventoryItemInstanceId();
  }

  public initializeWorldItems(items: ReadonlyArray<PickupSpawnDefinition> = STARTER_PICKUP_SPAWNS): void {
    this.spawnStarterPickups(items);
    Promise.resolve(this.options.loadPersistentPickups(this.mapInstanceId))
      .then((pickups) => {
        this.spawnPersistentPickups(pickups);
      })
      .catch((error) => {
        console.error("[items] failed to load persistent pickups", error);
      });
  }

  public ensureInventoryLoaded(accountId: number): InventorySnapshot {
    const cached = this.inventoriesByAccountId.get(accountId);
    if (cached) {
      return this.toSnapshot(cached);
    }
    const persisted = this.options.persistence.loadInventoryState(accountId);
    const normalized = this.normalizeInventory(persisted);
    this.inventoriesByAccountId.set(accountId, normalized);
    return this.toSnapshot(normalized);
  }

  public queueInventoryStateForUser(userId: number): void {
    const user = this.options.getUserById(userId);
    const player = this.getPlayerStateByUserId(userId);
    if (!user || !player) {
      return;
    }
    const snapshot = this.ensureInventoryLoaded(player.accountId);
    user.queueMessage({
      ntype: NType.InventoryStateMessage,
      inventoryJson: encodeInventorySnapshot(snapshot)
    });
  }

  public queuePendingInventorySnapshot(accountId: number, snapshot: InventorySnapshot): void {
    if (accountId >= GUEST_ACCOUNT_ID_BASE) {
      return;
    }
    this.pendingInventoryByAccountId.set(accountId, snapshot);
    this.rebaseNextInventoryItemInstanceId(snapshot);
  }

  public applyCommand(userId: number, command: Partial<ItemWireCommand>): void {
    const player = this.getPlayerStateByUserId(userId);
    if (!player) {
      return;
    }
    const action = this.normalizeAction(command.action);
    let changed = false;
    let failureReason = "rejected";
    if (action === INVENTORY_OP_PICKUP) {
      changed = this.tryPickupWorldItem(player, command.pickupNid);
      if (!changed) failureReason = "pickup_failed";
    } else if (action === INVENTORY_OP_DROP) {
      changed = this.tryDropInventoryItem(player, command.itemInstanceId, command.quantity);
      if (!changed) failureReason = "drop_failed";
    } else if (action === INVENTORY_OP_USE) {
      changed = this.tryUseInventoryItem(userId, player, command.itemInstanceId, ITEM_ACTIVATION_CHANNEL_DEFAULT);
      if (!changed) failureReason = "use_failed";
    } else if (action === INVENTORY_OP_EQUIP) {
      changed = this.tryEquipInventoryItem(player, command.itemInstanceId);
      if (!changed) failureReason = "equip_failed";
    } else if (action === INVENTORY_OP_UNEQUIP) {
      changed = this.tryUnequipSlot(player, equipmentSlotFromWireValue(Number(command.equipmentSlot)));
      if (!changed) failureReason = "unequip_failed";
    } else if (action === INVENTORY_OP_ASSIGN_HOTBAR_SLOT) {
      changed = this.tryAssignHotbarSlot(player, command.itemInstanceId, command.targetSlot, command.payloadKind);
      if (!changed) failureReason = "assign_hotbar_failed";
    } else if (action === INVENTORY_OP_CLEAR_HOTBAR_SLOT) {
      changed = this.tryClearHotbarSlot(player, command.sourceSlot);
      if (!changed) failureReason = "clear_hotbar_failed";
    } else if (action === INVENTORY_OP_MOVE_HOTBAR_SLOT) {
      changed = this.tryMoveOrSwapHotbarSlot(player, command.sourceSlot, command.targetSlot);
      if (!changed) failureReason = "move_hotbar_failed";
    } else if (action === INVENTORY_OP_EXECUTE_HOTBAR_SLOT) {
      changed = this.tryExecuteHotbarSlot(userId, player, command.sourceSlot, command.activationChannel);
      if (!changed) failureReason = "execute_hotbar_failed";
    } else if (action === INVENTORY_OP_DROP_HOTBAR_SLOT) {
      changed = this.tryDropHotbarSlot(player, command.sourceSlot);
      if (!changed) failureReason = "drop_hotbar_failed";
    }

    this.queueInventoryActionResult(userId, action, changed, changed ? "ok" : failureReason);

    if (!changed) {
      this.queueInventoryStateForUser(userId);
      return;
    }

    const inventory = this.ensureMutableInventory(player.accountId);
    this.persistInventory(player.accountId, inventory, action);
    this.queueInventoryStateForUser(userId);
  }

  private getPlayerStateByUserId(userId: number): ItemInventoryPlayerState | null {
    const state = this.options.ecs.getPlayerRuntimeStateByUserId(userId);
    if (!state) return null;
    return {
      accountId: state.accountId,
      x: state.x,
      y: state.y,
      z: state.z,
      yaw: state.yaw,
      pitch: state.pitch,
      health: state.health,
      maxHealth: state.maxHealth,
      collider: state.collider
    };
  }

  private tryPickupWorldItem(player: ItemInventoryPlayerState, rawWorldItemNid: unknown): boolean {
    const pickupNid = this.normalizeUInt(rawWorldItemNid, 0xffff);
    const eid = this.options.ecs.getAnyEidByNid(pickupNid);
    if (typeof eid !== "number") {
      return false;
    }
    if (!this.isPickupEntity(eid)) {
      return false;
    }

    const c = this.options.ecs.world.components;
    const quantity = Math.max(0, Math.floor(c.ItemQuantity.value[eid] ?? 0));
    if (quantity <= 0 || !this.canPlayerInteractWithWorldItem(player, eid)) {
      return false;
    }

    const definitionId = Math.max(0, Math.floor(c.ItemArchetypeId.value[eid] ?? 0));
    const definition = getItemDefinitionById(definitionId);
    if (!definition) {
      return false;
    }
    const inventory = this.ensureMutableInventory(player.accountId);
    const acceptedQuantity = this.addItemToInventory(inventory, definition, quantity);
    if (acceptedQuantity <= 0) {
      return false;
    }

    const pickupRuntime = this.pickupRuntimeByEid.get(eid) ?? null;
    const pickupWasPersistent = pickupRuntime?.persistencePolicy === "persistent";
    const nextQuantity = quantity - acceptedQuantity;
    c.ItemQuantity.value[eid] = nextQuantity;
    if (nextQuantity <= 0) {
      this.pickupRuntimeByEid.delete(eid);
      this.options.replication.despawnEntity(eid);
      this.options.ecs.destroyEid(eid);
    } else {
      this.options.replication.syncEntityFromEcs(eid);
    }
    if (pickupWasPersistent) {
      this.persistPersistentPickups();
    }
    return true;
  }

  private tryDropInventoryItem(
    player: ItemInventoryPlayerState,
    rawItemInstanceId: unknown,
    rawQuantity: unknown
  ): boolean {
    const itemInstanceId = this.normalizeUInt(rawItemInstanceId, 0x7fffffff);
    const inventory = this.ensureMutableInventory(player.accountId);
    const item = inventory.itemInstances.find((entry) => entry.itemInstanceId === itemInstanceId);
    if (!item) {
      return false;
    }
    const definition = getItemDefinitionById(item.definitionId);
    if (!definition) {
      return false;
    }
    const requestedQuantity = this.normalizeUInt(rawQuantity, 0xffff);
    const dropQuantity = Math.max(1, Math.min(item.quantity, requestedQuantity > 0 ? requestedQuantity : item.quantity));
    item.quantity -= dropQuantity;
    if (item.quantity <= 0) {
      this.removeItemFromInventory(inventory, item.itemInstanceId);
    }
    this.spawnPickup(definition, dropQuantity, this.computeDropPosition(player), "persistent");
    this.persistPersistentPickups();
    this.compactInventorySlots(inventory);
    return true;
  }

  private tryUseInventoryItem(
    userId: number,
    player: ItemInventoryPlayerState,
    rawItemInstanceId: unknown,
    rawActivationChannel: unknown
  ): boolean {
    const itemInstanceId = this.normalizeUInt(rawItemInstanceId, 0x7fffffff);
    const inventory = this.ensureMutableInventory(player.accountId);
    const item = inventory.itemInstances.find((entry) => entry.itemInstanceId === itemInstanceId);
    if (!item) {
      return false;
    }
    const definition = getItemDefinitionById(item.definitionId);
    if (!definition?.use) {
      return false;
    }
    const action = this.resolveItemUseAction(definition, rawActivationChannel);
    if (!action) {
      return false;
    }
    const restoreHealth = action.restoreHealth ?? 0;
    if (restoreHealth > 0 && player.health >= player.maxHealth) {
      return false;
    }
    if (restoreHealth > 0) {
      const nextHealth = Math.min(player.maxHealth, player.health + restoreHealth);
      if (this.options.ecs.setPlayerHealthByUserId(userId, nextHealth)) {
        this.options.markPlayerCharacterDirty(player.accountId);
      }
    }
    const consumeQuantity = Math.max(1, Math.floor(action.consumeQuantity));
    item.quantity -= Math.min(item.quantity, consumeQuantity);
    if (item.quantity <= 0) {
      this.removeItemFromInventory(inventory, item.itemInstanceId);
    }
    this.compactInventorySlots(inventory);
    return true;
  }

  private tryEquipInventoryItem(player: ItemInventoryPlayerState, rawItemInstanceId: unknown): boolean {
    const itemInstanceId = this.normalizeUInt(rawItemInstanceId, 0x7fffffff);
    const inventory = this.ensureMutableInventory(player.accountId);
    const item = inventory.itemInstances.find((entry) => entry.itemInstanceId === itemInstanceId);
    if (!item) {
      return false;
    }
    const definition = getItemDefinitionById(item.definitionId);
    if (!definition?.equipSlot) {
      return false;
    }
    if (inventory.equipment[definition.equipSlot] === itemInstanceId) {
      return false;
    }
    inventory.equipment[definition.equipSlot] = itemInstanceId;
    return true;
  }

  private tryUnequipSlot(player: ItemInventoryPlayerState, slot: EquipmentSlot | null): boolean {
    if (!slot) {
      return false;
    }
    const inventory = this.ensureMutableInventory(player.accountId);
    if (!inventory.equipment[slot]) {
      return false;
    }
    delete inventory.equipment[slot];
    return true;
  }

  private spawnPickup(
    definition: ItemDefinition,
    rawQuantity: number,
    position: { x: number; y: number; z: number },
    persistencePolicy: PickupPersistencePolicy,
    pickupIdOverride?: number,
    rotation: { x: number; y: number; z: number; w: number } = IDENTITY_ROTATION
  ): number {
    const quantity = Math.max(1, Math.min(definition.stackMax, Math.floor(rawQuantity)));

    const eid = this.options.ecs.createEntityFromPreset("item", {
      modelId: definition.modelId,
      position: { x: position.x, y: position.y, z: position.z },
      rotation,
      grounded: true,
      health: 0,
      maxHealth: 0,
      pickupDefinitionId: definition.id,
      itemQuantity: quantity
    });
    const nid = this.options.replication.spawnEntity(eid);
    this.options.ecs.setEntityNidByEid(eid, nid);
    const pickupId = persistencePolicy === "persistent"
      ? this.resolvePersistentPickupId(pickupIdOverride)
      : 0;
    this.pickupRuntimeByEid.set(eid, {
      pickupId,
      persistencePolicy
    });
    return eid;
  }

  private spawnStarterPickups(spawns: ReadonlyArray<PickupSpawnDefinition>): void {
    for (const spawn of spawns) {
      const definition = getItemDefinitionById(spawn.definitionId);
      if (!definition) {
        continue;
      }
      const starterPolicy = spawn.persistencePolicy === "persistent"
        ? "transient_bootstrap"
        : spawn.persistencePolicy;
      this.spawnPickup(
        definition,
        spawn.quantity,
        { x: spawn.x, y: spawn.y, z: spawn.z },
        starterPolicy
      );
    }
  }

  private spawnPersistentPickups(pickups: ReadonlyArray<PersistedPickupState>): void {
    for (const pickup of pickups) {
      if (pickup.persistencePolicy !== "persistent") {
        continue;
      }
      const definition = getItemDefinitionById(pickup.definitionId);
      if (!definition) {
        continue;
      }
      const quantity = Math.max(1, Math.min(definition.stackMax, Math.floor(pickup.quantity)));
      this.spawnPickup(
        definition,
        quantity,
        { x: pickup.x, y: pickup.y, z: pickup.z },
        "persistent",
        pickup.pickupId,
        pickup.rotation
      );
    }
  }

  private resolvePersistentPickupId(pickupIdOverride?: number): number {
    if (typeof pickupIdOverride === "number" && Number.isFinite(pickupIdOverride) && pickupIdOverride > 0) {
      const id = Math.floor(pickupIdOverride);
      this.nextPickupId = Math.max(this.nextPickupId, id + 1);
      return id;
    }
    const id = this.nextPickupId;
    this.nextPickupId = Math.min(0x7fffffff, this.nextPickupId + 1);
    return id;
  }

  private persistPersistentPickups(): void {
    this.options.savePersistentPickups(this.mapInstanceId, this.collectPersistentPickups());
  }

  private collectPersistentPickups(): PersistedPickupState[] {
    const c = this.options.ecs.world.components;
    const pickups: PersistedPickupState[] = [];
    for (const [eid, runtime] of this.pickupRuntimeByEid.entries()) {
      if (runtime.persistencePolicy !== "persistent") {
        continue;
      }
      if (!this.isPickupEntity(eid)) {
        continue;
      }
      const definitionId = Math.max(0, Math.floor(c.ItemArchetypeId.value[eid] ?? 0));
      const definition = getItemDefinitionById(definitionId);
      if (!definition) {
        continue;
      }
      const quantity = Math.max(0, Math.floor(c.ItemQuantity.value[eid] ?? 0));
      if (quantity <= 0) {
        continue;
      }
      pickups.push({
        pickupId: runtime.pickupId,
        definitionId,
        modelId: Math.max(0, Math.floor(c.ModelId.value[eid] ?? definition.modelId)),
        quantity,
        persistencePolicy: "persistent",
        x: c.Position.x[eid] ?? 0,
        y: c.Position.y[eid] ?? 0,
        z: c.Position.z[eid] ?? 0,
        rotation: {
          x: c.Rotation.x[eid] ?? 0,
          y: c.Rotation.y[eid] ?? 0,
          z: c.Rotation.z[eid] ?? 0,
          w: c.Rotation.w[eid] ?? 1
        }
      });
    }
    pickups.sort((a, b) => a.pickupId - b.pickupId);
    return pickups;
  }

  private canPlayerInteractWithWorldItem(player: ItemInventoryPlayerState, eid: number): boolean {
    const target = this.getWorldItemInteractionPoint(eid);
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dz = target.z - player.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > INTERACTION_MAX_DISTANCE_SQ) {
      return false;
    }
    const distance = Math.sqrt(Math.max(distanceSq, 1e-8));
    if (this.hasLineOfSight(player, target, distance)) {
      return true;
    }
    // Close-range fallback avoids false negatives when pickup visuals overlap terrain.
    return distance <= 1.1;
  }

  private hasLineOfSight(
    player: ItemInventoryPlayerState,
    target: { x: number; y: number; z: number },
    distance: number
  ): boolean {
    if (distance <= 0.05) {
      return true;
    }
    const dir = {
      x: (target.x - player.x) / distance,
      y: (target.y - player.y) / distance,
      z: (target.z - player.z) / distance
    };
    const ray = new RAPIER.Ray({ x: player.x, y: player.y, z: player.z }, dir);
    const hit = this.options.world.castRay(
      ray,
      distance,
      true,
      undefined,
      PHYSICS_QUERY_GROUP_CHARACTER_SOLIDS,
      player.collider
    );
    return !hit || hit.timeOfImpact >= distance - 0.3;
  }

  private getWorldItemInteractionPoint(eid: number): { x: number; y: number; z: number } {
    const c = this.options.ecs.world.components;
    return {
      x: c.Position.x[eid] ?? 0,
      y: (c.Position.y[eid] ?? 0) + WORLD_ITEM_INTERACTION_TARGET_Y_OFFSET,
      z: c.Position.z[eid] ?? 0
    };
  }

  private addItemToInventory(
    inventory: MutableInventoryState,
    definition: ItemDefinition,
    rawQuantity: number
  ): number {
    let remaining = Math.max(0, Math.floor(rawQuantity));
    let accepted = 0;
    const stackMax = Math.max(1, definition.stackMax);
    if (stackMax > 1) {
      for (const item of inventory.itemInstances) {
        if (item.definitionId !== definition.id || item.quantity >= stackMax || remaining <= 0) {
          continue;
        }
        const move = Math.min(remaining, stackMax - item.quantity);
        item.quantity += move;
        remaining -= move;
        accepted += move;
      }
    }
    while (remaining > 0 && inventory.itemInstances.length < inventory.maxSlots) {
      const move = Math.min(remaining, stackMax);
      inventory.itemInstances.push({
        itemInstanceId: this.allocateInventoryItemInstanceId(),
        definitionId: definition.id,
        quantity: move,
        slotIndex: this.findFreeSlot(inventory)
      });
      remaining -= move;
      accepted += move;
    }
    this.compactInventorySlots(inventory);
    return accepted;
  }

  private removeItemFromInventory(inventory: MutableInventoryState, itemInstanceId: number): void {
    inventory.itemInstances = inventory.itemInstances.filter((entry) => entry.itemInstanceId !== itemInstanceId);
    for (let slot = 0; slot < inventory.hotbarSlots.length; slot += 1) {
      const payload = inventory.hotbarSlots[slot];
      if (payload?.kind === "item_instance" && payload.refId === itemInstanceId) {
        inventory.hotbarSlots[slot] = null;
      }
    }
    for (const [slot, equippedItemInstanceId] of Object.entries(inventory.equipment)) {
      if (equippedItemInstanceId === itemInstanceId) {
        delete inventory.equipment[slot as EquipmentSlot];
      }
    }
  }

  private compactInventorySlots(inventory: MutableInventoryState): void {
    inventory.itemInstances.sort((a, b) => a.slotIndex - b.slotIndex || a.itemInstanceId - b.itemInstanceId);
    for (let index = 0; index < inventory.itemInstances.length; index += 1) {
      const item = inventory.itemInstances[index];
      if (item) {
        item.slotIndex = index;
      }
    }
  }

  private findFreeSlot(inventory: MutableInventoryState): number {
    const used = new Set(inventory.itemInstances.map((entry) => entry.slotIndex));
    for (let slot = 0; slot < inventory.maxSlots; slot += 1) {
      if (!used.has(slot)) {
        return slot;
      }
    }
    return Math.max(0, inventory.itemInstances.length);
  }

  private computeDropPosition(player: ItemInventoryPlayerState): { x: number; y: number; z: number } {
    const forward = this.computeViewDirection(player.yaw, 0);
    return {
      x: player.x + forward.x * DROP_FORWARD_DISTANCE,
      y: player.y + DROP_VERTICAL_OFFSET,
      z: player.z + forward.z * DROP_FORWARD_DISTANCE
    };
  }

  private computeViewDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
    const cosPitch = Math.cos(pitch);
    const x = -Math.sin(yaw) * cosPitch;
    const y = Math.sin(pitch);
    const z = -Math.cos(yaw) * cosPitch;
    const magnitude = Math.hypot(x, y, z);
    if (magnitude <= 1e-6) {
      return { x: 0, y: 0, z: -1 };
    }
    return {
      x: x / magnitude,
      y: y / magnitude,
      z: z / magnitude
    };
  }

  private ensureMutableInventory(accountId: number): MutableInventoryState {
    let inventory = this.inventoriesByAccountId.get(accountId);
    if (!inventory) {
      const pending = this.pendingInventoryByAccountId.get(accountId);
      if (pending) {
        this.pendingInventoryByAccountId.delete(accountId);
      }
      inventory = this.normalizeInventory(pending ?? this.options.persistence.loadInventoryState(accountId));
      this.inventoriesByAccountId.set(accountId, inventory);
      this.rebaseNextInventoryItemInstanceId(this.toSnapshot(inventory));
    }
    return inventory;
  }

  private normalizeInventory(snapshot: InventorySnapshot): MutableInventoryState {
    const decoded = decodeInventorySnapshot(encodeInventorySnapshot(snapshot)) ?? {
      maxSlots: INVENTORY_MAX_SLOTS,
      itemInstances: [],
      equipment: {},
      hotbarSlots: []
    };
    const inventory: MutableInventoryState = {
      maxSlots: Math.max(1, Math.min(INVENTORY_MAX_SLOTS, decoded.maxSlots || INVENTORY_MAX_SLOTS)),
      itemInstances: decoded.itemInstances
        .filter((item) => Boolean(getItemDefinitionById(item.definitionId)))
        .slice(0, INVENTORY_MAX_SLOTS),
      equipment: {},
      hotbarSlots: this.normalizeHotbarSlots(decoded.hotbarSlots)
    };
    const liveItemIds = new Set(inventory.itemInstances.map((item) => item.itemInstanceId));
    for (const [slot, itemInstanceId] of Object.entries(decoded.equipment)) {
      const typedSlot = slot as EquipmentSlot;
      if (liveItemIds.has(Number(itemInstanceId))) {
        inventory.equipment[typedSlot] = Number(itemInstanceId);
      }
    }
    this.compactInventorySlots(inventory);
    return inventory;
  }

  private toSnapshot(inventory: MutableInventoryState): InventorySnapshot {
    return {
      maxSlots: inventory.maxSlots,
      itemInstances: inventory.itemInstances.map((item) => ({ ...item })),
      equipment: { ...inventory.equipment },
      hotbarSlots: inventory.hotbarSlots.map((entry) => (entry ? { ...entry } : null))
    };
  }

  private persistInventory(accountId: number, inventory: MutableInventoryState, action: number): void {
    const snapshot = this.toSnapshot(inventory);
    const eventAtMs = Date.now();
    this.options.persistInventoryMutation(
      accountId,
      snapshot,
      action,
      `inventory-${accountId}-${eventAtMs}-${this.criticalEventSequence++}`,
      eventAtMs
    );
  }

  private allocateInventoryItemInstanceId(): number {
    const id = this.nextInventoryItemInstanceId;
    this.nextInventoryItemInstanceId = Math.min(0x7fffffff, this.nextInventoryItemInstanceId + 1);
    return id;
  }

  private rebaseNextInventoryItemInstanceId(snapshot: InventorySnapshot): void {
    let maxItemInstanceId = this.nextInventoryItemInstanceId - 1;
    for (const item of snapshot.itemInstances) {
      if (item.itemInstanceId > maxItemInstanceId) {
        maxItemInstanceId = item.itemInstanceId;
      }
    }
    this.nextInventoryItemInstanceId = Math.max(this.nextInventoryItemInstanceId, maxItemInstanceId + 1);
  }

  private resolveMapInstanceId(rawInstanceId: unknown): string {
    const value = typeof rawInstanceId === "string" ? rawInstanceId.trim() : "";
    if (value.length <= 0) {
      return "default-1";
    }
    return value.slice(0, 96);
  }

  private normalizeAction(rawAction: unknown): number {
    const action = this.normalizeUInt(rawAction, 0xff);
    if (
      action === INVENTORY_OP_PICKUP ||
      action === INVENTORY_OP_DROP ||
      action === INVENTORY_OP_USE ||
      action === INVENTORY_OP_EQUIP ||
      action === INVENTORY_OP_UNEQUIP ||
      action === INVENTORY_OP_ASSIGN_HOTBAR_SLOT ||
      action === INVENTORY_OP_CLEAR_HOTBAR_SLOT ||
      action === INVENTORY_OP_MOVE_HOTBAR_SLOT ||
      action === INVENTORY_OP_EXECUTE_HOTBAR_SLOT ||
      action === INVENTORY_OP_DROP_HOTBAR_SLOT
    ) {
      return action;
    }
    return 0;
  }

  private normalizeUInt(rawValue: unknown, max: number): number {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      return 0;
    }
    return Math.max(0, Math.min(max, Math.floor(rawValue)));
  }

  private isPickupEntity(eid: number): boolean {
    const components = this.options.ecs.world.components;
    return hasComponent(this.options.ecs.world, eid, components.WorldItemTag);
  }

  private normalizeHotbarSlot(rawSlot: unknown): number | null {
    if (typeof rawSlot !== "number" || !Number.isFinite(rawSlot)) {
      return null;
    }
    const slot = Math.floor(rawSlot);
    if (slot < 0 || slot >= HOTBAR_SLOT_COUNT) {
      return null;
    }
    return slot;
  }

  private resolveItemUseAction(definition: ItemDefinition, rawActivationChannel: unknown): { restoreHealth?: number; consumeQuantity: number } | null {
    const profile = definition.use;
    if (!profile || !Array.isArray(profile.actions) || profile.actions.length <= 0) {
      return null;
    }
    const channel = this.normalizeUInt(rawActivationChannel, 0xff);
    const channelIndex = this.normalizeActivationChannel(channel);
    const action = profile.actions[channelIndex] ?? null;
    return action && action.consumeQuantity > 0 ? action : null;
  }

  private normalizeActivationChannel(channel: number): number {
    if (
      channel === ITEM_ACTIVATION_CHANNEL_DEFAULT ||
      channel === ITEM_ACTIVATION_CHANNEL_SECONDARY ||
      channel === ITEM_ACTIVATION_CHANNEL_TERTIARY ||
      channel === ITEM_ACTIVATION_CHANNEL_QUATERNARY ||
      channel === ITEM_ACTIVATION_CHANNEL_QUINARY
    ) {
      return channel;
    }
    return ITEM_ACTIVATION_CHANNEL_DEFAULT;
  }

  private normalizeHotbarSlots(rawSlots: ReadonlyArray<HotbarSlotPayload | null> | undefined): Array<HotbarSlotPayload | null> {
    const slots: Array<HotbarSlotPayload | null> = new Array<HotbarSlotPayload | null>(HOTBAR_SLOT_COUNT).fill(null);
    if (!Array.isArray(rawSlots)) {
      return slots;
    }
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      const entry = rawSlots[slot] ?? null;
      if (!entry || typeof entry !== "object") {
        continue;
      }
      if ((entry.kind === "item_instance" || entry.kind === "ability" || entry.kind === "action") && entry.refId > 0) {
        slots[slot] = { kind: entry.kind, refId: Math.floor(entry.refId) };
      }
    }
    return slots;
  }

  private queueInventoryActionResult(userId: number, action: number, ok: boolean, reason: string): void {
    const user = this.options.getUserById(userId);
    if (!user) {
      return;
    }
    user.queueMessage({
      ntype: NType.InventoryActionResultMessage,
      action,
      ok,
      reason
    });
  }

  private tryAssignHotbarSlot(
    player: ItemInventoryPlayerState,
    rawItemInstanceId: unknown,
    rawTargetSlot: unknown,
    rawPayloadKind: unknown
  ): boolean {
    const itemInstanceId = this.normalizeUInt(rawItemInstanceId, 0x7fffffff);
    const targetSlot = this.normalizeHotbarSlot(rawTargetSlot);
    const payloadKind = hotbarPayloadKindFromWireValue(this.normalizeUInt(rawPayloadKind, 0xff));
    if (itemInstanceId <= 0 || targetSlot === null || !payloadKind) {
      return false;
    }
    const inventory = this.ensureMutableInventory(player.accountId);
    if (payloadKind === "item_instance") {
      const hasItem = inventory.itemInstances.some((entry) => entry.itemInstanceId === itemInstanceId);
      if (!hasItem) {
        return false;
      }
    }
    inventory.hotbarSlots[targetSlot] = { kind: payloadKind, refId: itemInstanceId };
    return true;
  }

  private tryClearHotbarSlot(player: ItemInventoryPlayerState, rawSourceSlot: unknown): boolean {
    const sourceSlot = this.normalizeHotbarSlot(rawSourceSlot);
    if (sourceSlot === null) {
      return false;
    }
    const inventory = this.ensureMutableInventory(player.accountId);
    if (!inventory.hotbarSlots[sourceSlot]) {
      return false;
    }
    inventory.hotbarSlots[sourceSlot] = null;
    return true;
  }

  private tryMoveOrSwapHotbarSlot(player: ItemInventoryPlayerState, rawSourceSlot: unknown, rawTargetSlot: unknown): boolean {
    const sourceSlot = this.normalizeHotbarSlot(rawSourceSlot);
    const targetSlot = this.normalizeHotbarSlot(rawTargetSlot);
    if (sourceSlot === null || targetSlot === null || sourceSlot === targetSlot) {
      return false;
    }
    const inventory = this.ensureMutableInventory(player.accountId);
    const sourcePayload = inventory.hotbarSlots[sourceSlot] ?? null;
    if (!sourcePayload) {
      return false;
    }
    const targetPayload = inventory.hotbarSlots[targetSlot] ?? null;
    inventory.hotbarSlots[targetSlot] = sourcePayload;
    inventory.hotbarSlots[sourceSlot] = targetPayload;
    return true;
  }

  private tryExecuteHotbarSlot(
    userId: number,
    player: ItemInventoryPlayerState,
    rawSourceSlot: unknown,
    rawActivationChannel: unknown
  ): boolean {
    const sourceSlot = this.normalizeHotbarSlot(rawSourceSlot);
    if (sourceSlot === null) {
      return false;
    }
    const inventory = this.ensureMutableInventory(player.accountId);
    const payload = inventory.hotbarSlots[sourceSlot] ?? null;
    if (!payload) {
      return false;
    }
    if (payload.kind === "item_instance") {
      return this.tryUseInventoryItem(userId, player, payload.refId, rawActivationChannel);
    }
    if (payload.kind === "ability") {
      return this.options.executeHotbarAbility(userId, payload.refId, this.normalizeActivationChannel(this.normalizeUInt(rawActivationChannel, 0xff)));
    }
    return false;
  }

  private tryDropHotbarSlot(player: ItemInventoryPlayerState, rawSourceSlot: unknown): boolean {
    const sourceSlot = this.normalizeHotbarSlot(rawSourceSlot);
    if (sourceSlot === null) {
      return false;
    }
    const inventory = this.ensureMutableInventory(player.accountId);
    const payload = inventory.hotbarSlots[sourceSlot] ?? null;
    if (!payload || payload.kind !== "item_instance") {
      return false;
    }
    const dropped = this.tryDropInventoryItem(player, payload.refId, 0);
    if (!dropped) {
      return false;
    }
    inventory.hotbarSlots[sourceSlot] = null;
    return true;
  }
}
