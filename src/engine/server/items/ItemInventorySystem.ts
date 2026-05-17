// Owns server-authoritative world item interaction, player inventories, equipment, and item persistence.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  INVENTORY_MAX_SLOTS,
  ITEM_COMMAND_DROP,
  ITEM_COMMAND_EQUIP,
  ITEM_COMMAND_PICKUP,
  ITEM_COMMAND_UNEQUIP,
  ITEM_COMMAND_USE,
  PHYSICS_QUERY_GROUP_CHARACTER_SOLIDS,
  STARTER_WORLD_ITEMS,
  decodeInventoryStateSnapshot,
  encodeInventoryStateSnapshot,
  equipmentSlotFromWireValue,
  getItemDefinitionById,
  type EquipmentSlot,
  type InventoryItemEntry,
  type InventoryStateSnapshot,
  type ItemArchetypeDefinition,
  type StarterWorldItemDefinition
} from "../../shared/index";
import type { ItemCommand as ItemWireCommand } from "../../shared/netcode";
import { NType } from "../../shared/netcode";
import { GUEST_ACCOUNT_ID_BASE, type PersistenceService } from "../persistence/PersistenceService";
import type { SimulationEcs } from "../ecs/SimulationEcs";

const INTERACTION_MAX_DISTANCE = 3.35;
const INTERACTION_MAX_DISTANCE_SQ = INTERACTION_MAX_DISTANCE * INTERACTION_MAX_DISTANCE;
const INTERACTION_MIN_DOT = 0.42;
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
    snapshot: InventoryStateSnapshot,
    action: number,
    eventId: string,
    eventAtMs: number
  ) => void;
}

interface MutableInventoryState {
  maxSlots: number;
  items: InventoryItemEntry[];
  equipment: Partial<Record<EquipmentSlot, number>>;
}

export class ItemInventorySystem<TUser extends { queueMessage: (message: unknown) => void }> {
  private readonly inventoriesByAccountId = new Map<number, MutableInventoryState>();
  private readonly pendingInventoryByAccountId = new Map<number, InventoryStateSnapshot>();
  private nextInventoryItemInstanceId: number;
  private criticalEventSequence = 1;

  public constructor(private readonly options: ItemInventorySystemOptions<TUser>) {
    this.nextInventoryItemInstanceId = this.options.persistence.loadNextInventoryItemInstanceId();
  }

  public initializeWorldItems(items: ReadonlyArray<StarterWorldItemDefinition> = STARTER_WORLD_ITEMS): void {
    for (const item of items) {
      const definition = getItemDefinitionById(item.archetypeId);
      if (!definition) {
        continue;
      }
      this.spawnWorldItem(definition, item.quantity, {
        x: item.x,
        y: item.y,
        z: item.z
      });
    }
  }

  public ensureInventoryLoaded(accountId: number): InventoryStateSnapshot {
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
      inventoryJson: encodeInventoryStateSnapshot(snapshot)
    });
  }

  public queuePendingInventorySnapshot(accountId: number, snapshot: InventoryStateSnapshot): void {
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
    if (action === ITEM_COMMAND_PICKUP) {
      changed = this.tryPickupWorldItem(player, command.worldItemNid);
    } else if (action === ITEM_COMMAND_DROP) {
      changed = this.tryDropInventoryItem(player, command.itemInstanceId, command.quantity);
    } else if (action === ITEM_COMMAND_USE) {
      changed = this.tryUseInventoryItem(userId, player, command.itemInstanceId);
    } else if (action === ITEM_COMMAND_EQUIP) {
      changed = this.tryEquipInventoryItem(player, command.itemInstanceId);
    } else if (action === ITEM_COMMAND_UNEQUIP) {
      changed = this.tryUnequipSlot(player, equipmentSlotFromWireValue(Number(command.equipmentSlot)));
    }

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
    const worldItemNid = this.normalizeUInt(rawWorldItemNid, 0xffff);
    const eid = this.options.ecs.getAnyEidByNid(worldItemNid);
    if (typeof eid !== "number") {
      return false;
    }

    const c = this.options.ecs.world.components;
    if ((c.WorldItemTag[eid] ?? 0) === 0) {
      return false;
    }

    const quantity = Math.max(0, Math.floor(c.ItemQuantity.value[eid] ?? 0));
    if (quantity <= 0 || !this.canPlayerInteractWithWorldItem(player, eid)) {
      return false;
    }

    const archetypeId = Math.max(0, Math.floor(c.ItemArchetypeId.value[eid] ?? 0));
    const definition = getItemDefinitionById(archetypeId);
    if (!definition) {
      return false;
    }
    const inventory = this.ensureMutableInventory(player.accountId);
    const acceptedQuantity = this.addItemToInventory(inventory, definition, quantity);
    if (acceptedQuantity <= 0) {
      return false;
    }

    const nextQuantity = quantity - acceptedQuantity;
    c.ItemQuantity.value[eid] = nextQuantity;
    if (nextQuantity <= 0) {
      this.options.replication.despawnEntity(eid);
      this.options.ecs.destroyEid(eid);
    } else {
      this.options.replication.syncEntityFromEcs(eid);
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
    const item = inventory.items.find((entry) => entry.itemInstanceId === itemInstanceId);
    if (!item) {
      return false;
    }
    const definition = getItemDefinitionById(item.archetypeId);
    if (!definition) {
      return false;
    }
    const requestedQuantity = this.normalizeUInt(rawQuantity, 0xffff);
    const dropQuantity = Math.max(1, Math.min(item.quantity, requestedQuantity > 0 ? requestedQuantity : item.quantity));
    item.quantity -= dropQuantity;
    if (item.quantity <= 0) {
      this.removeItemFromInventory(inventory, item.itemInstanceId);
    }
    this.spawnWorldItem(definition, dropQuantity, this.computeDropPosition(player));
    this.compactInventorySlots(inventory);
    return true;
  }

  private tryUseInventoryItem(
    userId: number,
    player: ItemInventoryPlayerState,
    rawItemInstanceId: unknown
  ): boolean {
    const itemInstanceId = this.normalizeUInt(rawItemInstanceId, 0x7fffffff);
    const inventory = this.ensureMutableInventory(player.accountId);
    const item = inventory.items.find((entry) => entry.itemInstanceId === itemInstanceId);
    if (!item) {
      return false;
    }
    const definition = getItemDefinitionById(item.archetypeId);
    if (!definition?.use) {
      return false;
    }
    const restoreHealth = definition.use.restoreHealth ?? 0;
    if (restoreHealth > 0 && player.health >= player.maxHealth) {
      return false;
    }
    if (restoreHealth > 0) {
      const nextHealth = Math.min(player.maxHealth, player.health + restoreHealth);
      if (this.options.ecs.setPlayerHealthByUserId(userId, nextHealth)) {
        this.options.markPlayerCharacterDirty(player.accountId);
      }
    }
    const consumeQuantity = Math.max(1, Math.floor(definition.use.consumeQuantity));
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
    const item = inventory.items.find((entry) => entry.itemInstanceId === itemInstanceId);
    if (!item) {
      return false;
    }
    const definition = getItemDefinitionById(item.archetypeId);
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

  private spawnWorldItem(
    definition: ItemArchetypeDefinition,
    rawQuantity: number,
    position: { x: number; y: number; z: number }
  ): void {
    const quantity = Math.max(1, Math.min(definition.stackMax, Math.floor(rawQuantity)));

    const eid = this.options.ecs.createEntityFromPreset("item", {
      modelId: definition.modelId,
      position: { x: position.x, y: position.y, z: position.z },
      rotation: IDENTITY_ROTATION,
      grounded: true,
      health: 0,
      maxHealth: 0,
      itemArchetypeId: definition.id,
      itemQuantity: quantity
    });
    const nid = this.options.replication.spawnEntity(eid);
    this.options.ecs.setEntityNidByEid(eid, nid);
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
    const direction = this.computeViewDirection(player.yaw, player.pitch);
    const dot = (dx * direction.x + dy * direction.y + dz * direction.z) / distance;
    if (dot < INTERACTION_MIN_DOT) {
      return false;
    }
    return this.hasLineOfSight(player, target, distance);
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
    definition: ItemArchetypeDefinition,
    rawQuantity: number
  ): number {
    let remaining = Math.max(0, Math.floor(rawQuantity));
    let accepted = 0;
    const stackMax = Math.max(1, definition.stackMax);
    if (stackMax > 1) {
      for (const item of inventory.items) {
        if (item.archetypeId !== definition.id || item.quantity >= stackMax || remaining <= 0) {
          continue;
        }
        const move = Math.min(remaining, stackMax - item.quantity);
        item.quantity += move;
        remaining -= move;
        accepted += move;
      }
    }
    while (remaining > 0 && inventory.items.length < inventory.maxSlots) {
      const move = Math.min(remaining, stackMax);
      inventory.items.push({
        itemInstanceId: this.allocateInventoryItemInstanceId(),
        archetypeId: definition.id,
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
    inventory.items = inventory.items.filter((entry) => entry.itemInstanceId !== itemInstanceId);
    for (const [slot, equippedItemInstanceId] of Object.entries(inventory.equipment)) {
      if (equippedItemInstanceId === itemInstanceId) {
        delete inventory.equipment[slot as EquipmentSlot];
      }
    }
  }

  private compactInventorySlots(inventory: MutableInventoryState): void {
    inventory.items.sort((a, b) => a.slotIndex - b.slotIndex || a.itemInstanceId - b.itemInstanceId);
    for (let index = 0; index < inventory.items.length; index += 1) {
      const item = inventory.items[index];
      if (item) {
        item.slotIndex = index;
      }
    }
  }

  private findFreeSlot(inventory: MutableInventoryState): number {
    const used = new Set(inventory.items.map((entry) => entry.slotIndex));
    for (let slot = 0; slot < inventory.maxSlots; slot += 1) {
      if (!used.has(slot)) {
        return slot;
      }
    }
    return Math.max(0, inventory.items.length);
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

  private normalizeInventory(snapshot: InventoryStateSnapshot): MutableInventoryState {
    const decoded = decodeInventoryStateSnapshot(encodeInventoryStateSnapshot(snapshot)) ?? {
      maxSlots: INVENTORY_MAX_SLOTS,
      items: [],
      equipment: {}
    };
    const inventory: MutableInventoryState = {
      maxSlots: Math.max(1, Math.min(INVENTORY_MAX_SLOTS, decoded.maxSlots || INVENTORY_MAX_SLOTS)),
      items: decoded.items
        .filter((item) => Boolean(getItemDefinitionById(item.archetypeId)))
        .slice(0, INVENTORY_MAX_SLOTS),
      equipment: {}
    };
    const liveItemIds = new Set(inventory.items.map((item) => item.itemInstanceId));
    for (const [slot, itemInstanceId] of Object.entries(decoded.equipment)) {
      const typedSlot = slot as EquipmentSlot;
      if (liveItemIds.has(Number(itemInstanceId))) {
        inventory.equipment[typedSlot] = Number(itemInstanceId);
      }
    }
    this.compactInventorySlots(inventory);
    return inventory;
  }

  private toSnapshot(inventory: MutableInventoryState): InventoryStateSnapshot {
    return {
      maxSlots: inventory.maxSlots,
      items: inventory.items.map((item) => ({ ...item })),
      equipment: { ...inventory.equipment }
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

  private rebaseNextInventoryItemInstanceId(snapshot: InventoryStateSnapshot): void {
    let maxItemInstanceId = this.nextInventoryItemInstanceId - 1;
    for (const item of snapshot.items) {
      if (item.itemInstanceId > maxItemInstanceId) {
        maxItemInstanceId = item.itemInstanceId;
      }
    }
    this.nextInventoryItemInstanceId = Math.max(this.nextInventoryItemInstanceId, maxItemInstanceId + 1);
  }

  private normalizeAction(rawAction: unknown): number {
    const action = this.normalizeUInt(rawAction, 0xff);
    if (
      action === ITEM_COMMAND_PICKUP ||
      action === ITEM_COMMAND_DROP ||
      action === ITEM_COMMAND_USE ||
      action === ITEM_COMMAND_EQUIP ||
      action === ITEM_COMMAND_UNEQUIP
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
}
