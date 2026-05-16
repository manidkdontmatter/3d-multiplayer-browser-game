// Executes authoritative ability usage, cooldown checks, and spawned combat effects.
import { clampHotbarSlotIndex } from "../../../shared/index";
import type { AbilityDefinition } from "../../../shared/index";
import { resolveProjectileProfile } from "../../../shared/index";

export interface AbilityExecutionSystemOptions {
  readonly getElapsedSeconds: () => number;
  readonly resolveAbilityById: (unlockedAbilityIds: Set<number>, abilityId: number) => AbilityDefinition | null;
  readonly broadcastAbilityUse: (playerNid: number, ability: AbilityDefinition, x: number, y: number, z: number) => void;
  readonly spawnProjectile: (request: {
    ownerNid: number; kind: number;
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    radius: number; damage: number; lifetimeSeconds: number;
    maxRange: number; gravity: number; drag: number;
    maxSpeed: number; minSpeed: number; pierceCount: number;
    despawnOnDamageableHit: boolean; despawnOnWorldHit: boolean;
  }) => void;
  readonly applyMeleeHit: (playerNid: number, meleeProfile: NonNullable<AbilityDefinition["melee"]>) => void;
}

export interface AbilityUseContext {
  nid: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  hotbarAbilityIds: number[];
  unlockedAbilityIds: Set<number>;
  lastPrimaryFireAtSeconds: number;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
}

export class AbilityExecutionSystem {
  public constructor(private readonly options: AbilityExecutionSystemOptions) {}

  public tryUsePrimaryMouseAbility(ctx: AbilityUseContext): void {
    this.tryUseAbilityBySlot(ctx, ctx.primaryMouseSlot);
  }

  public tryUseSecondaryMouseAbility(ctx: AbilityUseContext): void {
    this.tryUseAbilityBySlot(ctx, ctx.secondaryMouseSlot);
  }

  public tryUseAbilityBySlot(ctx: AbilityUseContext, rawSlot: number): void {
    const slot = clampHotbarSlotIndex(rawSlot);
    const abilityId = ctx.hotbarAbilityIds[slot] ?? 0;
    const ability = this.options.resolveAbilityById(ctx.unlockedAbilityIds, abilityId);
    if (!ability) return;

    const pp = ability.projectile;
    const mp = ability.melee;
    const cooldown = pp?.cooldownSeconds ?? mp?.cooldownSeconds;
    if (cooldown === undefined) return;

    const elapsed = this.options.getElapsedSeconds();
    if (elapsed - ctx.lastPrimaryFireAtSeconds < cooldown) return;

    ctx.lastPrimaryFireAtSeconds = elapsed;
    this.options.broadcastAbilityUse(ctx.nid, ability, ctx.x, ctx.y, ctx.z);

    if (pp) {
      this.spawnProjectileFromContext(ctx, pp);
      return;
    }
    if (mp) {
      this.options.applyMeleeHit(ctx.nid, mp);
    }
  }

  private spawnProjectileFromContext(
    ctx: { nid: number; x: number; y: number; z: number; yaw: number; pitch: number },
    pp: NonNullable<AbilityDefinition["projectile"]>
  ): void {
    const resolved = resolveProjectileProfile(pp);
    const d = this.computeViewDirection(ctx.yaw, ctx.pitch);
    const sx = ctx.x + d.x * resolved.spawnForwardOffset;
    const sy = ctx.y + resolved.spawnVerticalOffset + d.y * resolved.spawnForwardOffset;
    const sz = ctx.z + d.z * resolved.spawnForwardOffset;
    this.options.spawnProjectile({
      ownerNid: ctx.nid,
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
