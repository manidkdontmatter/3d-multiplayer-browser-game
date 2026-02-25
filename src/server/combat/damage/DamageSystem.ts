// Authoritative damage application and player respawn handling for combat targets.
import RAPIER from "@dimforge/rapier3d-compat";
import { MOVEMENT_MODE_GROUNDED, type MovementMode } from "../../../shared/index";

export interface DamageablePlayerState {
  accountId: number;
  nid: number;
  health: number;
  maxHealth: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
  body: RAPIER.RigidBody;
}

export interface DamageableDummyState {
  health: number;
  maxHealth: number;
}

export type CombatTarget =
  | { kind: "player"; eid: number }
  | { kind: "dummy"; eid: number };

export interface DamageSystemOptions {
  readonly maxPlayerHealth: number;
  readonly playerBodyCenterHeight: number;
  readonly playerCameraOffsetY: number;
  readonly getSpawnPosition: () => { x: number; z: number };
  readonly markPlayerDirtyByAccountId: (
    accountId: number,
    options: { dirtyCharacter: boolean; dirtyAbilityState: boolean }
  ) => void;
  readonly getPlayerStateByEid: (eid: number) => DamageablePlayerState | null;
  readonly applyPlayerStateByEid: (eid: number, next: DamageablePlayerState) => void;
  readonly getDummyStateByEid: (eid: number) => DamageableDummyState | null;
  readonly applyDummyStateByEid: (eid: number, next: DamageableDummyState) => void;
  readonly onPlayerDamaged?: (eid: number) => void;
  readonly onDummyDamaged?: (eid: number) => void;
}

export class DamageSystem {
  private readonly targetsByColliderHandle = new Map<number, CombatTarget>();

  public constructor(private readonly options: DamageSystemOptions) {}

  public registerPlayerCollider(colliderHandle: number, eid: number): void {
    this.targetsByColliderHandle.set(colliderHandle, { kind: "player", eid });
  }

  public registerDummyCollider(colliderHandle: number, eid: number): void {
    this.targetsByColliderHandle.set(colliderHandle, { kind: "dummy", eid });
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
      const player = this.options.getPlayerStateByEid(target.eid);
      if (!player) {
        return;
      }
      player.health = Math.max(0, player.health - appliedDamage);
      this.options.markPlayerDirtyByAccountId(player.accountId, {
        dirtyCharacter: true,
        dirtyAbilityState: false
      });
      this.options.onPlayerDamaged?.(target.eid);
      if (player.health <= 0) {
        this.respawnPlayer(player);
      }
      this.options.applyPlayerStateByEid(target.eid, player);
      return;
    }
    const dummy = this.options.getDummyStateByEid(target.eid);
    if (!dummy) {
      return;
    }
    dummy.health = Math.max(0, dummy.health - appliedDamage);
    if (dummy.health <= 0) {
      dummy.health = dummy.maxHealth;
    }
    this.options.applyDummyStateByEid(target.eid, dummy);
    this.options.onDummyDamaged?.(target.eid);
  }

  private respawnPlayer(player: DamageablePlayerState): void {
    const spawn = this.options.getSpawnPosition();
    player.body.setTranslation(
      { x: spawn.x, y: this.options.playerBodyCenterHeight, z: spawn.z },
      true
    );
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.grounded = true;
    player.movementMode = MOVEMENT_MODE_GROUNDED;
    player.groundedPlatformPid = null;
    player.health = this.options.maxPlayerHealth;
    player.maxHealth = this.options.maxPlayerHealth;
    player.x = spawn.x;
    player.y = this.options.playerBodyCenterHeight + this.options.playerCameraOffsetY;
    player.z = spawn.z;
    this.options.markPlayerDirtyByAccountId(player.accountId, {
      dirtyCharacter: true,
      dirtyAbilityState: false
    });
  }
}
