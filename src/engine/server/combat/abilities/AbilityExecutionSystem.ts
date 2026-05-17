/**
 * Purpose: This file manages ability definitions, state, or execution flow.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { clampHotbarSlotIndex } from "../../../shared/index";
import type { AbilityDefinition } from "../../../shared/index";
import { resolveProjectileProfile } from "../../../shared/index";
import type { WorldWithComponents } from "../../ecs/SimulationEcsTypes";
import { getHotbarSlot } from "../../ecs/HotbarComponents";

export interface AbilityExecutionSystemOptions {
  readonly getElapsedSeconds: () => number;
  readonly resolveAbilityById: (unlockedAbilityIds: readonly number[], abilityId: number) => AbilityDefinition | null;
  readonly broadcastAbilityUse: (playerNid: number, ability: AbilityDefinition, x: number, y: number, z: number) => void;
  readonly ecsComponents: WorldWithComponents["components"];
  readonly spawnProjectile: (request: {
    ownerNid: number; kind: number;
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    radius: number; damage: number; lifetimeSeconds: number;
    maxRange: number; gravity: number; drag: number;
    maxSpeed: number; minSpeed: number; pierceCount: number;
    despawnOnDamageableHit: boolean; despawnOnWorldHit: boolean;
  }) => void;
  readonly applyMeleeHit: (playerEid: number, meleeProfile: NonNullable<AbilityDefinition["melee"]>) => void;
}

export class AbilityExecutionSystem {
  public constructor(private readonly options: AbilityExecutionSystemOptions) {}

  public tryUsePrimaryMouseAbilityByEid(eid: number): void {
    const c = this.options.ecsComponents;
    const slot = c.PrimaryMouseSlot.value[eid] ?? 0;
    this.tryUseAbilityBySlotByEid(eid, slot);
  }

  public tryUseSecondaryMouseAbilityByEid(eid: number): void {
    const c = this.options.ecsComponents;
    const slot = c.SecondaryMouseSlot.value[eid] ?? 1;
    this.tryUseAbilityBySlotByEid(eid, slot);
  }

  public tryUseAbilityBySlotByEid(eid: number, rawSlot: number): void {
    const c = this.options.ecsComponents;
    const slot = clampHotbarSlotIndex(rawSlot);
    const abilityId = getHotbarSlot(c, eid, slot);
    const unlocked = c.UnlockedAbilityIds.value[eid] ?? [];
    const ability = this.options.resolveAbilityById(unlocked, abilityId);
    if (!ability) return;

    const pp = ability.projectile;
    const mp = ability.melee;
    const cooldown = pp?.cooldownSeconds ?? mp?.cooldownSeconds;
    if (cooldown === undefined) return;

    const elapsed = this.options.getElapsedSeconds();
    const lastFired = c.LastPrimaryFireAtSeconds.value[eid] ?? Number.NEGATIVE_INFINITY;
    if (elapsed - lastFired < cooldown) return;

    c.LastPrimaryFireAtSeconds.value[eid] = elapsed;
    const ownerNid = c.NetworkId.value[eid] ?? 0;
    const x = c.Position.x[eid] ?? 0;
    const y = c.Position.y[eid] ?? 0;
    const z = c.Position.z[eid] ?? 0;
    this.options.broadcastAbilityUse(ownerNid, ability, x, y, z);

    if (pp) {
      const yaw = c.Yaw.value[eid] ?? 0;
      const pitch = c.Pitch.value[eid] ?? 0;
      this.spawnProjectileFromEid(ownerNid, x, y, z, yaw, pitch, pp);
      return;
    }
    if (mp) {
      this.options.applyMeleeHit(eid, mp);
    }
  }

  private spawnProjectileFromEid(
    ownerNid: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    pp: NonNullable<AbilityDefinition["projectile"]>
  ): void {
    const resolved = resolveProjectileProfile(pp);
    const d = this.computeViewDirection(yaw, pitch);
    const sx = x + d.x * resolved.spawnForwardOffset;
    const sy = y + resolved.spawnVerticalOffset + d.y * resolved.spawnForwardOffset;
    const sz = z + d.z * resolved.spawnForwardOffset;
    this.options.spawnProjectile({
      ownerNid,
      kind: resolved.kind,
      x: sx, y: sy, z: sz,
      vx: d.x * resolved.speed, vy: d.y * resolved.speed, vz: d.z * resolved.speed,
      radius: resolved.radius, damage: resolved.damage,
      lifetimeSeconds: resolved.lifetimeSeconds, maxRange: resolved.maxRange,
      gravity: resolved.gravity, drag: resolved.drag,
      maxSpeed: resolved.maxSpeed, minSpeed: resolved.minSpeed,
      pierceCount: resolved.pierceCount,
      despawnOnDamageableHit: resolved.despawnOnDamageableHit,
      despawnOnWorldHit: resolved.despawnOnWorldHit
    });
  }

  private computeViewDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
    const cp = Math.cos(pitch);
    const x = -Math.sin(yaw) * cp;
    const y = Math.sin(pitch);
    const z = -Math.cos(yaw) * cp;
    const m = Math.hypot(x, y, z);
    if (m <= 1e-6) return { x: 0, y: 0, z: -1 };
    const inv = 1 / m;
    return { x: x * inv, y: y * inv, z: z * inv };
  }
}
