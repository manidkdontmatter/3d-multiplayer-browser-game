// Client-side authoritative ability state cache populated from server messages.
import {
  ABILITY_CREATOR_EXAMPLE_DOWNSIDE_KEY,
  ABILITY_CREATOR_EXAMPLE_UPSIDE_KEY,
  abilityCategoryToCreatorType,
  DEFAULT_HOTBAR_ABILITY_IDS,
  DEFAULT_PRIMARY_MOUSE_SLOT,
  DEFAULT_SECONDARY_MOUSE_SLOT,
  abilityCategoryFromWireValue,
  clampHotbarSlotIndex,
  decodeAbilityAttributeMask,
  getAllAbilityDefinitions,
  type AbilityDefinition
} from "../../../shared/index";
import {
  NType,
  type AbilityDefinitionMessage,
  type AbilityOwnershipMessage,
  type AbilityStateMessage,
  type AbilityUseMessage
} from "../../../shared/netcode";
import type { AbilityUseEvent } from "../types";
import type { AbilityEventBatch, AbilityState } from "./types";

export class AbilityStateStore {
  private readonly abilityDefinitions = new Map<number, AbilityDefinition>();
  private readonly pendingAbilityDefinitions = new Map<number, AbilityDefinition>();
  private readonly pendingAbilityUseEvents: AbilityUseEvent[] = [];
  private pendingAbilityState: AbilityState | null = null;
  private ownedAbilityIds = new Set<number>();
  private pendingOwnedAbilityIds: number[] | null = null;

  public constructor() {
    for (const ability of getAllAbilityDefinitions()) {
      this.abilityDefinitions.set(ability.id, ability);
    }
  }

  public reset(): void {
    this.pendingAbilityUseEvents.length = 0;
    this.pendingAbilityDefinitions.clear();
    this.pendingAbilityState = null;
    this.pendingOwnedAbilityIds = null;
    this.ownedAbilityIds = new Set<number>();
  }

  public processMessage(message: unknown): boolean {
    const typed = message as
      | AbilityDefinitionMessage
      | AbilityOwnershipMessage
      | AbilityStateMessage
      | AbilityUseMessage
      | undefined;

    if (typed?.ntype === NType.AbilityDefinitionMessage) {
      const ability = this.toAbilityDefinition(typed);
      if (!ability) {
        return true;
      }
      this.abilityDefinitions.set(ability.id, ability);
      this.pendingAbilityDefinitions.set(ability.id, ability);
      return true;
    }

    if (typed?.ntype === NType.AbilityStateMessage) {
      this.pendingAbilityState = this.toAbilityState(typed);
      return true;
    }

    if (typed?.ntype === NType.AbilityOwnershipMessage) {
      const ids = this.parseOwnershipCsv(typed.unlockedAbilityIdsCsv);
      this.ownedAbilityIds = new Set<number>(ids);
      this.pendingOwnedAbilityIds = ids;
      return true;
    }

    if (typed?.ntype === NType.AbilityUseMessage) {
      const category = abilityCategoryFromWireValue(typed.category);
      if (!category) {
        return true;
      }
      this.pendingAbilityUseEvents.push({
        ownerNid: this.clampUnsignedInt(typed.ownerNid, 0xffff),
        abilityId: this.clampUnsignedInt(typed.abilityId, 0xffff),
        category,
        serverTick: this.clampUnsignedInt(typed.serverTick, 0xffffffff)
      });
      return true;
    }

    return false;
  }

  public consumeAbilityEvents(): AbilityEventBatch | null {
    if (
      this.pendingAbilityDefinitions.size === 0 &&
      this.pendingAbilityState === null &&
      this.pendingOwnedAbilityIds === null
    ) {
      return null;
    }

    const definitions = Array.from(this.pendingAbilityDefinitions.values()).sort((a, b) => a.id - b.id);
    const abilityState = this.pendingAbilityState;
    const ownedAbilityIds = this.pendingOwnedAbilityIds ? this.pendingOwnedAbilityIds.slice() : null;
    this.pendingAbilityDefinitions.clear();
    this.pendingAbilityState = null;
    this.pendingOwnedAbilityIds = null;

    return {
      definitions,
      abilityState,
      ownedAbilityIds
    };
  }

  public consumeAbilityUseEvents(): AbilityUseEvent[] {
    if (this.pendingAbilityUseEvents.length === 0) {
      return [];
    }
    const events = this.pendingAbilityUseEvents.slice();
    this.pendingAbilityUseEvents.length = 0;
    return events;
  }

  public getAbilityCatalog(): AbilityDefinition[] {
    return Array.from(this.abilityDefinitions.values()).sort((a, b) => a.id - b.id);
  }

  public getAbilityById(abilityId: number): AbilityDefinition | null {
    return this.abilityDefinitions.get(abilityId) ?? null;
  }

  public getOwnedAbilityIds(): number[] {
    return Array.from(this.ownedAbilityIds.values()).sort((a, b) => a - b);
  }

  private toAbilityDefinition(message: AbilityDefinitionMessage): AbilityDefinition | null {
    const category = abilityCategoryFromWireValue(message.category);
    if (!category) {
      return null;
    }
    const id = this.clampUnsignedInt(message.abilityId, 0xffff);
    const points = {
      power: this.clampUnsignedInt(message.pointsPower, 255),
      velocity: this.clampUnsignedInt(message.pointsVelocity, 255),
      efficiency: this.clampUnsignedInt(message.pointsEfficiency, 255),
      control: this.clampUnsignedInt(message.pointsControl, 255)
    };
    const attributes = decodeAbilityAttributeMask(this.clampUnsignedInt(message.attributeMask, 0xffff));
    const creatorCategory = abilityCategoryFromWireValue(message.category);
    const creatorType = creatorCategory ? abilityCategoryToCreatorType(creatorCategory) : null;
    const hasProjectile =
      category === "projectile" &&
      this.clampUnsignedInt(message.kind, 0xff) > 0 &&
      message.speed > 0 &&
      message.damage > 0;
    const hasMelee =
      category === "melee" &&
      message.damage > 0 &&
      message.radius > 0 &&
      message.cooldownSeconds > 0 &&
      message.meleeRange > 0 &&
      message.meleeArcDegrees > 0;

    return {
      id,
      key: `runtime-${id}`,
      name: typeof message.name === "string" && message.name.trim() ? message.name.trim() : `Ability ${id}`,
      description: `${category} | attrs: ${attributes.length > 0 ? attributes.join(", ") : "none"}`,
      category,
      points,
      attributes,
      creator: creatorType
        ? {
            type: creatorType,
            tier: this.clampUnsignedInt(message.creatorTier, 255),
            coreExampleStat: this.clampUnsignedInt(message.creatorCoreExampleStat, 255),
            exampleUpsideEnabled:
              (this.clampUnsignedInt(message.creatorFlags, 0xff) & (1 << 0)) !== 0 ||
              attributes.includes(ABILITY_CREATOR_EXAMPLE_UPSIDE_KEY),
            exampleDownsideEnabled:
              (this.clampUnsignedInt(message.creatorFlags, 0xff) & (1 << 1)) !== 0 ||
              attributes.includes(ABILITY_CREATOR_EXAMPLE_DOWNSIDE_KEY)
          }
        : undefined,
      projectile: hasProjectile
        ? {
            kind: this.clampUnsignedInt(message.kind, 0xff),
            speed: message.speed,
            damage: message.damage,
            radius: message.radius,
            cooldownSeconds: message.cooldownSeconds,
            lifetimeSeconds: message.lifetimeSeconds,
            spawnForwardOffset: message.spawnForwardOffset,
            spawnVerticalOffset: message.spawnVerticalOffset
          }
        : undefined,
      melee: hasMelee
        ? {
            damage: message.damage,
            radius: message.radius,
            cooldownSeconds: message.cooldownSeconds,
            range: message.meleeRange,
            arcDegrees: message.meleeArcDegrees
          }
        : undefined
    };
  }

  private toAbilityState(message: AbilityStateMessage): AbilityState {
    return {
      primaryMouseSlot: clampHotbarSlotIndex(message.primaryMouseSlot ?? DEFAULT_PRIMARY_MOUSE_SLOT),
      secondaryMouseSlot: clampHotbarSlotIndex(message.secondaryMouseSlot ?? DEFAULT_SECONDARY_MOUSE_SLOT),
      hotbarAbilityIds: [
        message.slot0AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[0],
        message.slot1AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[1],
        message.slot2AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[2],
        message.slot3AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[3],
        message.slot4AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[4],
        message.slot5AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[5],
        message.slot6AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[6],
        message.slot7AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[7],
        message.slot8AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[8],
        message.slot9AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[9]
      ]
    };
  }

  private clampUnsignedInt(raw: number, max: number): number {
    if (!Number.isFinite(raw)) {
      return 0;
    }
    const integer = Math.floor(raw);
    return Math.max(0, Math.min(max, integer));
  }

  private parseOwnershipCsv(csv: unknown): number[] {
    if (typeof csv !== "string" || csv.length === 0) {
      return [];
    }
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const part of csv.split(",")) {
      if (!part) {
        continue;
      }
      const parsed = Number.parseInt(part, 10);
      if (!Number.isFinite(parsed)) {
        continue;
      }
      const normalized = this.clampUnsignedInt(parsed, 0xffff);
      if (normalized <= 0 || seen.has(normalized)) {
        continue;
      }
      ids.push(normalized);
      seen.add(normalized);
    }
    ids.sort((a, b) => a - b);
    return ids;
  }
}
