// Shared item archetype, inventory, equipment, and interaction helpers for client/server gameplay.
// Archetype data is injected by the game layer at startup via injectItemCatalog().

export type ItemCategory = "consumable" | "equipment" | "material" | "quest";
export type EquipmentSlot = "weapon" | "head" | "body" | "legs" | "accessory";

export interface ItemUseDefinition {
  restoreHealth?: number;
  consumeQuantity: number;
}

export interface ItemArchetypeDefinition {
  id: number;
  key: string;
  name: string;
  description: string;
  category: ItemCategory;
  modelId: number;
  stackMax: number;
  equipSlot: EquipmentSlot | null;
  use: ItemUseDefinition | null;
}

export interface StarterWorldItemDefinition {
  archetypeId: number;
  quantity: number;
  x: number;
  y: number;
  z: number;
}

export interface InventoryItemEntry {
  itemInstanceId: number;
  archetypeId: number;
  quantity: number;
  slotIndex: number;
}

export interface InventoryStateSnapshot {
  maxSlots: number;
  items: InventoryItemEntry[];
  equipment: Partial<Record<EquipmentSlot, number>>;
}

export interface WorldItemState {
  nid: number;
  modelId: number;
  itemArchetypeId: number;
  itemQuantity: number;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number; w: number };
}

export const ITEM_COMMAND_PICKUP = 1;
export const ITEM_COMMAND_DROP = 2;
export const ITEM_COMMAND_USE = 3;
export const ITEM_COMMAND_EQUIP = 4;
export const ITEM_COMMAND_UNEQUIP = 5;

export const EQUIPMENT_SLOT_WIRE_VALUE: Readonly<Record<EquipmentSlot, number>> = Object.freeze({
  weapon: 1,
  head: 2,
  body: 3,
  legs: 4,
  accessory: 5
});

const WIRE_VALUE_TO_EQUIPMENT_SLOT = new Map<number, EquipmentSlot>(
  Object.entries(EQUIPMENT_SLOT_WIRE_VALUE).map(([slot, value]) => [value, slot as EquipmentSlot])
);

export type ItemCatalogRaw = {
  version: unknown;
  inventory?: {
    maxSlots?: unknown;
  };
  items: unknown;
  starterWorldItems?: unknown;
};

// Mutable catalog — populated by injectItemCatalog() which the game layer calls at startup.
let ITEM_DEFINITIONS: ReadonlyArray<ItemArchetypeDefinition> = Object.freeze([]);
let ITEM_DEFINITIONS_BY_ID = new Map<number, ItemArchetypeDefinition>();
let ITEM_DEFINITIONS_BY_MODEL_ID = new Map<number, ItemArchetypeDefinition>();
export let INVENTORY_MAX_SLOTS = 32;
export let STARTER_WORLD_ITEMS: ReadonlyArray<StarterWorldItemDefinition> = Object.freeze([]);

export function injectItemCatalog(raw: ItemCatalogRaw): void {
  const parsed = parseItemCatalog(raw);
  ITEM_DEFINITIONS = Object.freeze(parsed.items);
  ITEM_DEFINITIONS_BY_ID = new Map(parsed.items.map((item) => [item.id, item]));
  ITEM_DEFINITIONS_BY_MODEL_ID = new Map(parsed.items.map((item) => [item.modelId, item]));
  INVENTORY_MAX_SLOTS = parsed.maxSlots;
  STARTER_WORLD_ITEMS = Object.freeze(parsed.starterWorldItems);
}

export function getAllItemDefinitions(): ReadonlyArray<ItemArchetypeDefinition> {
  return ITEM_DEFINITIONS;
}

export function getItemDefinitionById(archetypeId: number): ItemArchetypeDefinition | null {
  if (!Number.isFinite(archetypeId)) {
    return null;
  }
  return ITEM_DEFINITIONS_BY_ID.get(Math.max(0, Math.floor(archetypeId))) ?? null;
}

export function getItemDefinitionByModelId(modelId: number): ItemArchetypeDefinition | null {
  if (!Number.isFinite(modelId)) {
    return null;
  }
  return ITEM_DEFINITIONS_BY_MODEL_ID.get(Math.max(0, Math.floor(modelId))) ?? null;
}

export function equipmentSlotToWireValue(slot: EquipmentSlot | null | undefined): number {
  if (!slot) {
    return 0;
  }
  return EQUIPMENT_SLOT_WIRE_VALUE[slot] ?? 0;
}

export function equipmentSlotFromWireValue(value: number): EquipmentSlot | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  return WIRE_VALUE_TO_EQUIPMENT_SLOT.get(Math.floor(value)) ?? null;
}

export function sanitizeInventoryQuantity(quantity: number, maxQuantity: number): number {
  if (!Number.isFinite(quantity)) {
    return 0;
  }
  const max = Math.max(0, Math.floor(maxQuantity));
  return Math.max(0, Math.min(max, Math.floor(quantity)));
}

export function encodeInventoryStateSnapshot(snapshot: InventoryStateSnapshot): string {
  return JSON.stringify({
    maxSlots: Math.max(0, Math.floor(snapshot.maxSlots)),
    items: snapshot.items.map((item) => ({
      itemInstanceId: Math.max(0, Math.floor(item.itemInstanceId)),
      archetypeId: Math.max(0, Math.floor(item.archetypeId)),
      quantity: Math.max(0, Math.floor(item.quantity)),
      slotIndex: Math.max(0, Math.floor(item.slotIndex))
    })),
    equipment: snapshot.equipment
  });
}

export function decodeInventoryStateSnapshot(rawJson: string): InventoryStateSnapshot | null {
  try {
    const parsed = JSON.parse(rawJson) as Partial<InventoryStateSnapshot>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
      return null;
    }
    const maxSlots = Math.max(0, Math.floor(Number(parsed.maxSlots) || INVENTORY_MAX_SLOTS));
    const items: InventoryItemEntry[] = [];
    for (const rawItem of parsed.items) {
      if (!rawItem || typeof rawItem !== "object") {
        continue;
      }
      const entry = rawItem as Partial<InventoryItemEntry>;
      const itemInstanceId = Math.max(0, Math.floor(Number(entry.itemInstanceId) || 0));
      const archetypeId = Math.max(0, Math.floor(Number(entry.archetypeId) || 0));
      const quantity = Math.max(0, Math.floor(Number(entry.quantity) || 0));
      const slotIndex = Math.max(0, Math.floor(Number(entry.slotIndex) || 0));
      if (itemInstanceId <= 0 || !getItemDefinitionById(archetypeId) || quantity <= 0) {
        continue;
      }
      items.push({ itemInstanceId, archetypeId, quantity, slotIndex });
    }
    const equipment: Partial<Record<EquipmentSlot, number>> = {};
    if (parsed.equipment && typeof parsed.equipment === "object") {
      for (const slot of Object.keys(EQUIPMENT_SLOT_WIRE_VALUE) as EquipmentSlot[]) {
        const rawValue = parsed.equipment[slot];
        const itemInstanceId = Math.max(0, Math.floor(Number(rawValue) || 0));
        if (itemInstanceId > 0) {
          equipment[slot] = itemInstanceId;
        }
      }
    }
    return {
      maxSlots,
      items,
      equipment
    };
  } catch {
    return null;
  }
}

function parseItemCatalog(raw: ItemCatalogRaw): {
  maxSlots: number;
  items: ItemArchetypeDefinition[];
  starterWorldItems: StarterWorldItemDefinition[];
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("item-archetypes catalog must be an object.");
  }
  const version = parseFiniteInt(raw.version, "item-archetypes.version");
  if (version !== 1) {
    throw new Error(`Unsupported item-archetypes version: ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error("item-archetypes.items must be a non-empty array.");
  }
  const items = raw.items.map((entry, index) => parseItemDefinition(entry, `item-archetypes.items[${index}]`));
  const ids = new Set<number>();
  const modelIds = new Set<number>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`item-archetypes contains duplicate item id ${item.id}.`);
    }
    if (modelIds.has(item.modelId)) {
      throw new Error(`item-archetypes contains duplicate item model id ${item.modelId}.`);
    }
    ids.add(item.id);
    modelIds.add(item.modelId);
  }
  const maxSlots = Math.max(1, Math.min(255, parseOptionalInt(raw.inventory?.maxSlots, 32)));
  const starterWorldItems = Array.isArray(raw.starterWorldItems)
    ? raw.starterWorldItems.map((entry, index) => parseStarterWorldItem(entry, ids, `item-archetypes.starterWorldItems[${index}]`))
    : [];
  return {
    maxSlots,
    items,
    starterWorldItems
  };
}

function parseItemDefinition(value: unknown, label: string): ItemArchetypeDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const category = parseItemCategory(entry.category, `${label}.category`);
  const stackMax = Math.max(1, Math.min(0xffff, parseFiniteInt(entry.stackMax, `${label}.stackMax`)));
  const equipSlot = entry.equipSlot === undefined || entry.equipSlot === null
    ? null
    : parseEquipmentSlot(entry.equipSlot, `${label}.equipSlot`);
  const use = entry.use === undefined || entry.use === null ? null : parseUseDefinition(entry.use, `${label}.use`);
  if (category === "equipment" && !equipSlot) {
    throw new Error(`${label}.equipSlot is required for equipment.`);
  }
  return {
    id: parseFiniteInt(entry.id, `${label}.id`),
    key: parseString(entry.key, `${label}.key`),
    name: parseString(entry.name, `${label}.name`),
    description: parseString(entry.description, `${label}.description`),
    category,
    modelId: parseFiniteInt(entry.modelId, `${label}.modelId`),
    stackMax,
    equipSlot,
    use
  };
}

function parseUseDefinition(value: unknown, label: string): ItemUseDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  return {
    restoreHealth:
      entry.restoreHealth === undefined ? undefined : Math.max(0, parseFiniteNumber(entry.restoreHealth, `${label}.restoreHealth`)),
    consumeQuantity: Math.max(1, parseFiniteInt(entry.consumeQuantity, `${label}.consumeQuantity`))
  };
}

function parseStarterWorldItem(value: unknown, ids: Set<number>, label: string): StarterWorldItemDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const archetypeId = parseFiniteInt(entry.archetypeId, `${label}.archetypeId`);
  if (!ids.has(archetypeId)) {
    throw new Error(`${label}.archetypeId references unknown item id ${archetypeId}.`);
  }
  return {
    archetypeId,
    quantity: Math.max(1, parseFiniteInt(entry.quantity, `${label}.quantity`)),
    x: parseFiniteNumber(entry.x, `${label}.x`),
    y: parseFiniteNumber(entry.y, `${label}.y`),
    z: parseFiniteNumber(entry.z, `${label}.z`)
  };
}

function parseItemCategory(value: unknown, label: string): ItemCategory {
  if (value === "consumable" || value === "equipment" || value === "material" || value === "quest") {
    return value;
  }
  throw new Error(`${label} must be one of consumable|equipment|material|quest.`);
}

function parseEquipmentSlot(value: unknown, label: string): EquipmentSlot {
  if (value === "weapon" || value === "head" || value === "body" || value === "legs" || value === "accessory") {
    return value;
  }
  throw new Error(`${label} must be one of weapon|head|body|legs|accessory.`);
}

function parseString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function parseFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function parseFiniteInt(value: unknown, label: string): number {
  return Math.max(0, Math.floor(parseFiniteNumber(value, label)));
}

function parseOptionalInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
}
