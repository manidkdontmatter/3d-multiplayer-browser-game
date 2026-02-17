import { clampHotbarSlotIndex } from "../../../shared/index";
import type { AbilityDefinition } from "../../../shared/index";
import { resolveProjectileProfile } from "../../../shared/index";

export interface AbilityExecutionPlayer {
  nid: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  activeHotbarSlot: number;
  hotbarAbilityIds: number[];
  lastPrimaryFireAtSeconds: number;
}

export interface AbilityExecutionSystemOptions<TPlayer extends AbilityExecutionPlayer> {
  readonly getElapsedSeconds: () => number;
  readonly resolveSelectedAbility: (player: TPlayer) => AbilityDefinition | null;
  readonly broadcastAbilityUse: (player: TPlayer, ability: AbilityDefinition) => void;
  readonly spawnProjectile: (request: {
    ownerNid: number;
    kind: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    radius: number;
    damage: number;
    lifetimeSeconds: number;
    maxRange: number;
    gravity: number;
    drag: number;
    maxSpeed: number;
    minSpeed: number;
    pierceCount: number;
    despawnOnDamageableHit: boolean;
    despawnOnWorldHit: boolean;
  }) => void;
  readonly applyMeleeHit: (player: TPlayer, meleeProfile: NonNullable<AbilityDefinition["melee"]>) => void;
}

export class AbilityExecutionSystem<TPlayer extends AbilityExecutionPlayer> {
  public constructor(private readonly options: AbilityExecutionSystemOptions<TPlayer>) {}

  public tryUsePrimaryAbility(player: TPlayer): void {
    const ability = this.options.resolveSelectedAbility(player);
    if (!ability) {
      return;
    }
    const projectileProfile = ability.projectile;
    const meleeProfile = ability.melee;
    const activeCooldownSeconds = projectileProfile?.cooldownSeconds ?? meleeProfile?.cooldownSeconds;
    if (activeCooldownSeconds === undefined) {
      return;
    }

    const secondsSinceLastFire = this.options.getElapsedSeconds() - player.lastPrimaryFireAtSeconds;
    if (secondsSinceLastFire < activeCooldownSeconds) {
      return;
    }
    player.lastPrimaryFireAtSeconds = this.options.getElapsedSeconds();
    this.options.broadcastAbilityUse(player, ability);

    if (projectileProfile) {
      this.spawnProjectileFromAbility(player, projectileProfile);
      return;
    }
    if (meleeProfile) {
      this.options.applyMeleeHit(player, meleeProfile);
    }
  }

  public resolveActiveHotbarSlot(player: TPlayer): number {
    return clampHotbarSlotIndex(player.activeHotbarSlot);
  }

  private spawnProjectileFromAbility(
    player: TPlayer,
    projectileProfile: NonNullable<AbilityDefinition["projectile"]>
  ): void {
    const resolved = resolveProjectileProfile(projectileProfile);
    const direction = this.computeViewDirection(player.yaw, player.pitch);
    const dirX = direction.x;
    const dirY = direction.y;
    const dirZ = direction.z;

    const spawnX = player.x + dirX * resolved.spawnForwardOffset;
    const spawnY =
      player.y + resolved.spawnVerticalOffset + dirY * resolved.spawnForwardOffset;
    const spawnZ = player.z + dirZ * resolved.spawnForwardOffset;

    this.options.spawnProjectile({
      ownerNid: player.nid,
      kind: resolved.kind,
      x: spawnX,
      y: spawnY,
      z: spawnZ,
      vx: dirX * resolved.speed,
      vy: dirY * resolved.speed,
      vz: dirZ * resolved.speed,
      radius: resolved.radius,
      damage: resolved.damage,
      lifetimeSeconds: resolved.lifetimeSeconds,
      maxRange: resolved.maxRange,
      gravity: resolved.gravity,
      drag: resolved.drag,
      maxSpeed: resolved.maxSpeed,
      minSpeed: resolved.minSpeed,
      pierceCount: resolved.pierceCount,
      despawnOnDamageableHit: resolved.despawnOnDamageableHit,
      despawnOnWorldHit: resolved.despawnOnWorldHit
    });
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
    const invMagnitude = 1 / magnitude;
    return {
      x: x * invMagnitude,
      y: y * invMagnitude,
      z: z * invMagnitude
    };
  }
}
