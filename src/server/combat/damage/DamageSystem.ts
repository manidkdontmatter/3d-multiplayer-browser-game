import RAPIER from "@dimforge/rapier3d-compat";

export interface DamageablePlayerEntity {
  nid: number;
  health: number;
  serverTick: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface DamageableDummyEntity {
  nid: number;
  health: number;
  maxHealth: number;
  serverTick: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export type CombatTarget =
  | { kind: "player"; player: DamageablePlayerEntity }
  | { kind: "dummy"; dummy: DamageableDummyEntity };

export interface DamageSystemOptions {
  readonly maxPlayerHealth: number;
  readonly playerBodyCenterHeight: number;
  readonly playerCameraOffsetY: number;
  readonly getTickNumber: () => number;
  readonly getSpawnPosition: () => { x: number; z: number };
  readonly markPlayerDirty: (
    player: DamageablePlayerEntity,
    options: { dirtyCharacter: boolean; dirtyAbilityState: boolean }
  ) => void;
}

export class DamageSystem {
  private readonly targetsByColliderHandle = new Map<number, CombatTarget>();

  public constructor(private readonly options: DamageSystemOptions) {}

  public registerPlayer(player: DamageablePlayerEntity): void {
    this.targetsByColliderHandle.set(player.collider.handle, { kind: "player", player });
  }

  public registerDummy(dummy: DamageableDummyEntity): void {
    this.targetsByColliderHandle.set(dummy.collider.handle, { kind: "dummy", dummy });
  }

  public unregisterCollider(colliderHandle: number): void {
    this.targetsByColliderHandle.delete(colliderHandle);
  }

  public resolveTargetByColliderHandle(colliderHandle: number): CombatTarget | null {
    return this.targetsByColliderHandle.get(colliderHandle) ?? null;
  }

  public getTargets(): Iterable<CombatTarget> {
    return this.targetsByColliderHandle.values();
  }

  public applyDamage(target: CombatTarget, damage: number): void {
    const appliedDamage = Math.max(0, Math.floor(damage));
    if (appliedDamage <= 0) {
      return;
    }
    if (target.kind === "player") {
      const player = target.player;
      player.health = Math.max(0, player.health - appliedDamage);
      this.options.markPlayerDirty(player, {
        dirtyCharacter: true,
        dirtyAbilityState: false
      });
      if (player.health <= 0) {
        this.respawnPlayer(player);
      }
      return;
    }
    const dummy = target.dummy;
    dummy.health = Math.max(0, dummy.health - appliedDamage);
    dummy.serverTick = this.options.getTickNumber();
    if (dummy.health <= 0) {
      dummy.health = dummy.maxHealth;
    }
  }

  private respawnPlayer(player: DamageablePlayerEntity): void {
    const spawn = this.options.getSpawnPosition();
    player.body.setTranslation(
      { x: spawn.x, y: this.options.playerBodyCenterHeight, z: spawn.z },
      true
    );
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.grounded = true;
    player.groundedPlatformPid = null;
    player.health = this.options.maxPlayerHealth;
    player.x = spawn.x;
    player.y = this.options.playerBodyCenterHeight + this.options.playerCameraOffsetY;
    player.z = spawn.z;
    player.serverTick = this.options.getTickNumber();
    this.options.markPlayerDirty(player, {
      dirtyCharacter: true,
      dirtyAbilityState: false
    });
  }
}

