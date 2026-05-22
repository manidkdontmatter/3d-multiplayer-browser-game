/**
 * Purpose: This file defines canonical shared item, item-instance, inventory, and pickup data models.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use one authoritative vocabulary and schema.
 */
export type ItemCategory = "consumable" | "equipment" | "material" | "quest";
export type EquipmentSlot = "weapon" | "head" | "body" | "legs" | "accessory";
export type PickupPersistencePolicy = "persistent" | "transient_bootstrap" | "transient_runtime";

export interface ItemUseAction {
  key: string;
  label: string;
  restoreHealth?: number;
  consumeQuantity: number;
  effects?: ReadonlyArray<{
    type: "restore_health";
    amount: number;
  } | {
    type: "set_player_render_appearance";
    renderArchetypeId?: number;
    materialVariantId?: number;
    tintColorRgb?: number;
    uniformScalePct?: number;
  } | {
    type: "set_equipped_slot_tint";
    slot: EquipmentSlot;
    tintColorRgb: number;
  }>;
}

export interface ItemUseProfile {
  actions: ItemUseAction[];
}

export type HotbarPayloadKind = "item_instance" | "ability" | "action";

export interface HotbarSlotPayload {
  kind: HotbarPayloadKind;
  refId: number;
}

export interface ItemDefinition {
  id: number;
  key: string;
  name: string;
  description: string;
  category: ItemCategory;
  modelId: number;
  stackMax: number;
  equipSlot: EquipmentSlot | null;
  use: ItemUseProfile | null;
}

export interface PickupSpawnDefinition {
  definitionId: number;
  quantity: number;
  x: number;
  y: number;
  z: number;
  persistencePolicy: PickupPersistencePolicy;
}

export type CraftStationKind = "hand" | "bench";

export interface CraftRecipeIngredient {
  definitionId: number;
  quantity: number;
}

export interface CraftRecipeDefinition {
  id: number;
  key: string;
  name: string;
  description: string;
  station: CraftStationKind;
  outputDefinitionId: number;
  outputQuantity: number;
  ingredients: CraftRecipeIngredient[];
}

export interface CraftingBenchDefinition {
  id: number;
  key: string;
  name: string;
  x: number;
  y: number;
  z: number;
  interactRadius: number;
}

export interface ItemInstance {
  itemInstanceId: number;
  definitionId: number;
  quantity: number;
  slotIndex: number;
}

export interface InventorySnapshot {
  maxSlots: number;
  itemInstances: ItemInstance[];
  equipment: Partial<Record<EquipmentSlot, number>>;
  hotbarSlots: Array<HotbarSlotPayload | null>;
}

export interface PickupState {
  nid: number;
  pickupId: number;
  modelId: number;
  definitionId: number;
  quantity: number;
  persistencePolicy: PickupPersistencePolicy;
  x: number;
  y: number;
  z: number;
  rotation: { x: number; y: number; z: number; w: number };
}

export const INVENTORY_OP_PICKUP = 1;
export const INVENTORY_OP_DROP = 2;
export const INVENTORY_OP_USE = 3;
export const INVENTORY_OP_EQUIP = 4;
export const INVENTORY_OP_UNEQUIP = 5;
export const INVENTORY_OP_ASSIGN_HOTBAR_SLOT = 6;
export const INVENTORY_OP_CLEAR_HOTBAR_SLOT = 7;
export const INVENTORY_OP_MOVE_HOTBAR_SLOT = 8;
export const INVENTORY_OP_EXECUTE_HOTBAR_SLOT = 9;
export const INVENTORY_OP_DROP_HOTBAR_SLOT = 10;
export const INVENTORY_OP_CRAFT = 11;

export const ITEM_ACTIVATION_CHANNEL_DEFAULT = 0;
export const ITEM_ACTIVATION_CHANNEL_SECONDARY = 1;
export const ITEM_ACTIVATION_CHANNEL_TERTIARY = 2;
export const ITEM_ACTIVATION_CHANNEL_QUATERNARY = 3;
export const ITEM_ACTIVATION_CHANNEL_QUINARY = 4;
export const HOTBAR_PAYLOAD_KIND_NONE = 0;
export const HOTBAR_PAYLOAD_KIND_ITEM_INSTANCE = 1;
export const HOTBAR_PAYLOAD_KIND_ABILITY = 2;
export const HOTBAR_PAYLOAD_KIND_ACTION = 3;

export function hotbarPayloadKindToWireValue(kind: HotbarPayloadKind | null | undefined): number {
  if (kind === "item_instance") return HOTBAR_PAYLOAD_KIND_ITEM_INSTANCE;
  if (kind === "ability") return HOTBAR_PAYLOAD_KIND_ABILITY;
  if (kind === "action") return HOTBAR_PAYLOAD_KIND_ACTION;
  return HOTBAR_PAYLOAD_KIND_NONE;
}

export function hotbarPayloadKindFromWireValue(value: number): HotbarPayloadKind | null {
  if (!Number.isFinite(value)) return null;
  const normalized = Math.max(0, Math.floor(value));
  if (normalized === HOTBAR_PAYLOAD_KIND_ITEM_INSTANCE) return "item_instance";
  if (normalized === HOTBAR_PAYLOAD_KIND_ABILITY) return "ability";
  if (normalized === HOTBAR_PAYLOAD_KIND_ACTION) return "action";
  return null;
}

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
  starterPickupSpawns?: unknown;
  starterWorldItems?: unknown;
  craftRecipes?: unknown;
  craftingBenches?: unknown;
};

let ITEM_DEFINITIONS: ReadonlyArray<ItemDefinition> = Object.freeze([]);
let ITEM_DEFINITIONS_BY_ID = new Map<number, ItemDefinition>();
let ITEM_DEFINITIONS_BY_MODEL_ID = new Map<number, ItemDefinition>();
export let INVENTORY_MAX_SLOTS = 32;
export let STARTER_PICKUP_SPAWNS: ReadonlyArray<PickupSpawnDefinition> = Object.freeze([]);
export let CRAFT_RECIPES: ReadonlyArray<CraftRecipeDefinition> = Object.freeze([]);
export let CRAFTING_BENCHES: ReadonlyArray<CraftingBenchDefinition> = Object.freeze([]);

export function injectItemCatalog(raw: ItemCatalogRaw): void {
  const parsed = parseItemCatalog(raw);
  ITEM_DEFINITIONS = Object.freeze(parsed.items);
  ITEM_DEFINITIONS_BY_ID = new Map(parsed.items.map((item) => [item.id, item]));
  ITEM_DEFINITIONS_BY_MODEL_ID = new Map(parsed.items.map((item) => [item.modelId, item]));
  INVENTORY_MAX_SLOTS = parsed.maxSlots;
  STARTER_PICKUP_SPAWNS = Object.freeze(parsed.starterPickupSpawns);
  CRAFT_RECIPES = Object.freeze(parsed.craftRecipes);
  CRAFTING_BENCHES = Object.freeze(parsed.craftingBenches);
}

export function getAllItemDefinitions(): ReadonlyArray<ItemDefinition> {
  return ITEM_DEFINITIONS;
}

export function getItemDefinitionById(definitionId: number): ItemDefinition | null {
  if (!Number.isFinite(definitionId)) {
    return null;
  }
  return ITEM_DEFINITIONS_BY_ID.get(Math.max(0, Math.floor(definitionId))) ?? null;
}

export function getItemDefinitionByModelId(modelId: number): ItemDefinition | null {
  if (!Number.isFinite(modelId)) {
    return null;
  }
  return ITEM_DEFINITIONS_BY_MODEL_ID.get(Math.max(0, Math.floor(modelId))) ?? null;
}

export function getCraftRecipeById(recipeId: number): CraftRecipeDefinition | null {
  if (!Number.isFinite(recipeId)) {
    return null;
  }
  const normalized = Math.max(0, Math.floor(recipeId));
  for (const recipe of CRAFT_RECIPES) {
    if (recipe.id === normalized) {
      return recipe;
    }
  }
  return null;
}

export function getNearestCraftingBench(
  x: number,
  y: number,
  z: number,
  maxDistance: number
): CraftingBenchDefinition | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(maxDistance) || maxDistance <= 0) {
    return null;
  }
  const maxDistanceSq = maxDistance * maxDistance;
  let best: CraftingBenchDefinition | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const bench of CRAFTING_BENCHES) {
    const dx = bench.x - x;
    const dy = bench.y - y;
    const dz = bench.z - z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > maxDistanceSq || distanceSq > bestDistanceSq) {
      continue;
    }
    best = bench;
    bestDistanceSq = distanceSq;
  }
  return best;
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

export function encodeInventorySnapshot(snapshot: InventorySnapshot): string {
  return JSON.stringify({
    maxSlots: Math.max(0, Math.floor(snapshot.maxSlots)),
    itemInstances: snapshot.itemInstances.map((item) => ({
      itemInstanceId: Math.max(0, Math.floor(item.itemInstanceId)),
      definitionId: Math.max(0, Math.floor(item.definitionId)),
      quantity: Math.max(0, Math.floor(item.quantity)),
      slotIndex: Math.max(0, Math.floor(item.slotIndex))
    })),
    equipment: snapshot.equipment,
    hotbarSlots: Array.isArray(snapshot.hotbarSlots)
      ? snapshot.hotbarSlots.map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const kind = entry.kind;
          if (kind !== "item_instance" && kind !== "ability" && kind !== "action") {
            return null;
          }
          return {
            kind,
            refId: Math.max(0, Math.floor(Number(entry.refId) || 0))
          };
        })
      : []
  });
}

export function decodeInventorySnapshot(rawJson: string): InventorySnapshot | null {
  try {
    const parsed = JSON.parse(rawJson) as Partial<InventorySnapshot> & {
      items?: Array<Partial<ItemInstance> & { archetypeId?: number }>;
      itemInstances?: Array<Partial<ItemInstance>>;
    };
    const rawItems = Array.isArray(parsed.itemInstances)
      ? parsed.itemInstances
      : Array.isArray(parsed.items)
        ? parsed.items
        : null;
    if (!parsed || typeof parsed !== "object" || !rawItems) {
      return null;
    }
    const maxSlots = Math.max(0, Math.floor(Number(parsed.maxSlots) || INVENTORY_MAX_SLOTS));
    const itemInstances: ItemInstance[] = [];
    for (const rawItem of rawItems) {
      if (!rawItem || typeof rawItem !== "object") {
        continue;
      }
      const itemInstanceId = Math.max(0, Math.floor(Number(rawItem.itemInstanceId) || 0));
      const definitionId = Math.max(
        0,
        Math.floor(Number((rawItem as { definitionId?: number }).definitionId ?? (rawItem as { archetypeId?: number }).archetypeId) || 0)
      );
      const quantity = Math.max(0, Math.floor(Number(rawItem.quantity) || 0));
      const slotIndex = Math.max(0, Math.floor(Number(rawItem.slotIndex) || 0));
      if (itemInstanceId <= 0 || !getItemDefinitionById(definitionId) || quantity <= 0) {
        continue;
      }
      itemInstances.push({ itemInstanceId, definitionId, quantity, slotIndex });
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
    const hotbarSlots: Array<HotbarSlotPayload | null> = [];
    if (Array.isArray((parsed as { hotbarSlots?: unknown[] }).hotbarSlots)) {
      const entries = (parsed as { hotbarSlots: unknown[] }).hotbarSlots;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
          hotbarSlots.push(null);
          continue;
        }
        const typedEntry = entry as Partial<HotbarSlotPayload>;
        const kind = typedEntry.kind;
        const refId = Math.max(0, Math.floor(Number(typedEntry.refId) || 0));
        if ((kind === "item_instance" || kind === "ability" || kind === "action") && refId > 0) {
          hotbarSlots.push({ kind, refId });
        } else {
          hotbarSlots.push(null);
        }
      }
    }

    return {
      maxSlots,
      itemInstances,
      equipment,
      hotbarSlots
    };
  } catch {
    return null;
  }
}

function parseItemCatalog(raw: ItemCatalogRaw): {
  maxSlots: number;
  items: ItemDefinition[];
  starterPickupSpawns: PickupSpawnDefinition[];
  craftRecipes: CraftRecipeDefinition[];
  craftingBenches: CraftingBenchDefinition[];
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("item catalog must be an object.");
  }
  const version = parseFiniteInt(raw.version, "item-catalog.version");
  if (version !== 1) {
    throw new Error(`Unsupported item catalog version: ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error("item-catalog.items must be a non-empty array.");
  }
  const items = raw.items.map((entry, index) => parseItemDefinition(entry, `item-catalog.items[${index}]`));
  const ids = new Set<number>();
  const modelIds = new Set<number>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`item-catalog contains duplicate item id ${item.id}.`);
    }
    if (modelIds.has(item.modelId)) {
      throw new Error(`item-catalog contains duplicate item model id ${item.modelId}.`);
    }
    ids.add(item.id);
    modelIds.add(item.modelId);
  }
  const maxSlots = Math.max(1, Math.min(255, parseOptionalInt(raw.inventory?.maxSlots, 32)));
  const spawnSource = Array.isArray(raw.starterPickupSpawns)
    ? raw.starterPickupSpawns
    : Array.isArray(raw.starterWorldItems)
      ? raw.starterWorldItems
      : [];
  const starterPickupSpawns = spawnSource.map((entry, index) =>
    parseStarterPickupSpawn(entry, ids, `item-catalog.starterPickupSpawns[${index}]`)
  );
  const craftRecipes = Array.isArray(raw.craftRecipes)
    ? raw.craftRecipes.map((entry, index) => parseCraftRecipe(entry, ids, `item-catalog.craftRecipes[${index}]`))
    : [];
  const craftingBenches = Array.isArray(raw.craftingBenches)
    ? raw.craftingBenches.map((entry, index) => parseCraftingBench(entry, `item-catalog.craftingBenches[${index}]`))
    : [];
  return {
    maxSlots,
    items,
    starterPickupSpawns,
    craftRecipes,
    craftingBenches
  };
}

function parseCraftRecipe(value: unknown, itemIds: Set<number>, label: string): CraftRecipeDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const station = parseCraftStation(entry.station, `${label}.station`);
  const outputDefinitionId = parseFiniteInt(entry.outputDefinitionId, `${label}.outputDefinitionId`);
  if (!itemIds.has(outputDefinitionId)) {
    throw new Error(`${label}.outputDefinitionId references unknown item id ${outputDefinitionId}.`);
  }
  if (!Array.isArray(entry.ingredients) || entry.ingredients.length <= 0) {
    throw new Error(`${label}.ingredients must be a non-empty array.`);
  }
  const ingredients: CraftRecipeIngredient[] = entry.ingredients.map((ingredient, index) =>
    parseCraftIngredient(ingredient, itemIds, `${label}.ingredients[${index}]`)
  );
  return {
    id: parseFiniteInt(entry.id, `${label}.id`),
    key: parseString(entry.key, `${label}.key`),
    name: parseString(entry.name, `${label}.name`),
    description: parseString(entry.description, `${label}.description`),
    station,
    outputDefinitionId,
    outputQuantity: Math.max(1, parseFiniteInt(entry.outputQuantity ?? 1, `${label}.outputQuantity`)),
    ingredients
  };
}

function parseCraftIngredient(value: unknown, itemIds: Set<number>, label: string): CraftRecipeIngredient {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const definitionId = parseFiniteInt(entry.definitionId, `${label}.definitionId`);
  if (!itemIds.has(definitionId)) {
    throw new Error(`${label}.definitionId references unknown item id ${definitionId}.`);
  }
  return {
    definitionId,
    quantity: Math.max(1, parseFiniteInt(entry.quantity, `${label}.quantity`))
  };
}

function parseCraftingBench(value: unknown, label: string): CraftingBenchDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  return {
    id: parseFiniteInt(entry.id, `${label}.id`),
    key: parseString(entry.key, `${label}.key`),
    name: parseString(entry.name, `${label}.name`),
    x: parseFiniteNumber(entry.x, `${label}.x`),
    y: parseFiniteNumber(entry.y, `${label}.y`),
    z: parseFiniteNumber(entry.z, `${label}.z`),
    interactRadius: Math.max(0.5, parseFiniteNumber(entry.interactRadius ?? 4, `${label}.interactRadius`))
  };
}

function parseCraftStation(value: unknown, label: string): CraftStationKind {
  if (value === "hand" || value === "bench") {
    return value;
  }
  throw new Error(`${label} must be one of hand|bench.`);
}

function parseItemDefinition(value: unknown, label: string): ItemDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const category = parseItemCategory(entry.category, `${label}.category`);
  const stackMax = Math.max(1, Math.min(0xffff, parseFiniteInt(entry.stackMax, `${label}.stackMax`)));
  const equipSlot = entry.equipSlot === undefined || entry.equipSlot === null
    ? null
    : parseEquipmentSlot(entry.equipSlot, `${label}.equipSlot`);
  const use = entry.use === undefined || entry.use === null ? null : parseUseProfile(entry.use, `${label}.use`);
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

function parseUseProfile(value: unknown, label: string): ItemUseProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  if (Array.isArray(entry.actions)) {
    const actions: ItemUseAction[] = entry.actions
      .map((rawAction, index) => parseItemUseAction(rawAction, `${label}.actions[${index}]`))
      .filter((rawAction): rawAction is ItemUseAction => Boolean(rawAction));
    return { actions };
  }
  const consumeQuantity = entry.consumeQuantity === undefined
    ? 1
    : Math.max(1, parseFiniteInt(entry.consumeQuantity, `${label}.consumeQuantity`));
  const restoreHealth =
    entry.restoreHealth === undefined
      ? undefined
      : Math.max(0, parseFiniteNumber(entry.restoreHealth, `${label}.restoreHealth`));
  return {
    actions: [
      {
        key: "default",
        label: typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : "Use",
        consumeQuantity,
        restoreHealth
      }
    ]
  };
}

function parseItemUseAction(value: unknown, label: string): ItemUseAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const key = typeof entry.key === "string" && entry.key.trim().length > 0 ? entry.key.trim() : "";
  const actionLabel = typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : "";
  if (key.length <= 0 || actionLabel.length <= 0) {
    return null;
  }
  const consumeQuantity = Math.max(1, parseFiniteInt(entry.consumeQuantity ?? 1, `${label}.consumeQuantity`));
  const restoreHealth =
    entry.restoreHealth === undefined
      ? undefined
      : Math.max(0, parseFiniteNumber(entry.restoreHealth, `${label}.restoreHealth`));
  const effects = parseItemUseEffects(entry.effects, `${label}.effects`);
  return {
    key,
    label: actionLabel,
    consumeQuantity,
    restoreHealth,
    effects
  };
}

function parseItemUseEffects(
  value: unknown,
  label: string
): ItemUseAction["effects"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  const effects: Array<
    { type: "restore_health"; amount: number }
    | {
        type: "set_player_render_appearance";
        renderArchetypeId?: number;
        materialVariantId?: number;
        tintColorRgb?: number;
        uniformScalePct?: number;
      }
    | {
        type: "set_equipped_slot_tint";
        slot: EquipmentSlot;
        tintColorRgb: number;
      }
  > = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label}[${index}] must be an object.`);
    }
    const raw = entry as Record<string, unknown>;
    if (raw.type === "restore_health") {
      effects.push({
        type: "restore_health",
        amount: Math.max(0, parseFiniteInt(raw.amount, `${label}[${index}].amount`))
      });
      continue;
    }
    if (raw.type === "set_player_render_appearance") {
      const effect: {
        type: "set_player_render_appearance";
        renderArchetypeId?: number;
        materialVariantId?: number;
        tintColorRgb?: number;
        uniformScalePct?: number;
      } = {
        type: "set_player_render_appearance"
      };
      if (raw.renderArchetypeId !== undefined) {
        effect.renderArchetypeId = Math.max(0, parseFiniteInt(raw.renderArchetypeId, `${label}[${index}].renderArchetypeId`));
      }
      if (raw.materialVariantId !== undefined) {
        effect.materialVariantId = Math.max(0, parseFiniteInt(raw.materialVariantId, `${label}[${index}].materialVariantId`));
      }
      if (raw.tintColorRgb !== undefined) {
        effect.tintColorRgb = Math.max(0, Math.min(0xffffff, parseFiniteInt(raw.tintColorRgb, `${label}[${index}].tintColorRgb`)));
      }
      if (raw.uniformScalePct !== undefined) {
        effect.uniformScalePct = Math.max(1, Math.min(1000, parseFiniteInt(raw.uniformScalePct, `${label}[${index}].uniformScalePct`)));
      }
      effects.push(effect);
      continue;
    }
    if (raw.type === "set_equipped_slot_tint") {
      const slot = parseEquipmentSlot(raw.slot, `${label}[${index}].slot`);
      effects.push({
        type: "set_equipped_slot_tint",
        slot,
        tintColorRgb: Math.max(0, Math.min(0xffffff, parseFiniteInt(raw.tintColorRgb, `${label}[${index}].tintColorRgb`)))
      });
      continue;
    }
    throw new Error(`${label}[${index}].type must be restore_health|set_player_render_appearance|set_equipped_slot_tint.`);
  }
  return effects;
}

function parseStarterPickupSpawn(value: unknown, ids: Set<number>, label: string): PickupSpawnDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const definitionId = parseFiniteInt(
    entry.definitionId === undefined ? entry.archetypeId : entry.definitionId,
    `${label}.definitionId`
  );
  if (!ids.has(definitionId)) {
    throw new Error(`${label}.definitionId references unknown item id ${definitionId}.`);
  }
  return {
    definitionId,
    quantity: Math.max(1, parseFiniteInt(entry.quantity, `${label}.quantity`)),
    x: parseFiniteNumber(entry.x, `${label}.x`),
    y: parseFiniteNumber(entry.y, `${label}.y`),
    z: parseFiniteNumber(entry.z, `${label}.z`),
    persistencePolicy: parsePickupPersistencePolicy(entry.persistencePolicy, `${label}.persistencePolicy`, "transient_bootstrap")
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

function parsePickupPersistencePolicy(
  value: unknown,
  label: string,
  fallback: PickupPersistencePolicy
): PickupPersistencePolicy {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (value === "persistent" || value === "transient_bootstrap" || value === "transient_runtime") {
    return value;
  }
  throw new Error(`${label} must be one of persistent|transient_bootstrap|transient_runtime.`);
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
