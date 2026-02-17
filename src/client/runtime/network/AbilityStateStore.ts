import {
  DEFAULT_HOTBAR_ABILITY_IDS,
  abilityCategoryFromWireValue,
  clampHotbarSlotIndex,
  decodeAbilityAttributeMask,
  getAllAbilityDefinitions,
  type AbilityDefinition
} from "../../../shared/index";
import {
  NType,
  type AbilityDefinitionMessage,
  type AbilityUseMessage,
  type LoadoutStateMessage
} from "../../../shared/netcode";
import type { AbilityUseEvent } from "../types";
import type { AbilityEventBatch, LoadoutState } from "./types";

export class AbilityStateStore {
  private readonly abilityDefinitions = new Map<number, AbilityDefinition>();
  private readonly pendingAbilityDefinitions = new Map<number, AbilityDefinition>();
  private readonly pendingAbilityUseEvents: AbilityUseEvent[] = [];
  private pendingLoadoutState: LoadoutState | null = null;

  public constructor() {
    for (const ability of getAllAbilityDefinitions()) {
      this.abilityDefinitions.set(ability.id, ability);
    }
  }

  public reset(): void {
    this.pendingAbilityUseEvents.length = 0;
    this.pendingAbilityDefinitions.clear();
    this.pendingLoadoutState = null;
  }

  public processMessage(message: unknown): boolean {
    const typed = message as
      | AbilityDefinitionMessage
      | LoadoutStateMessage
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

    if (typed?.ntype === NType.LoadoutStateMessage) {
      this.pendingLoadoutState = this.toLoadoutState(typed);
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
    if (this.pendingAbilityDefinitions.size === 0 && this.pendingLoadoutState === null) {
      return null;
    }

    const definitions = Array.from(this.pendingAbilityDefinitions.values()).sort((a, b) => a.id - b.id);
    const loadout = this.pendingLoadoutState;
    this.pendingAbilityDefinitions.clear();
    this.pendingLoadoutState = null;

    return {
      definitions,
      loadout
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

  private toLoadoutState(message: LoadoutStateMessage): LoadoutState {
    return {
      selectedHotbarSlot: clampHotbarSlotIndex(message.selectedHotbarSlot),
      abilityIds: [
        message.slot0AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[0],
        message.slot1AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[1],
        message.slot2AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[2],
        message.slot3AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[3],
        message.slot4AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[4]
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
}
