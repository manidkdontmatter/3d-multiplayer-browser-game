/**
 * Purpose: This file applies damage rules and health impact resolution.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { MOVEMENT_MODE_GROUNDED, type MovementMode } from "../../../shared/index";
import type { EventBus } from "../../events/EventBus";
import { GameEvent, type DamageDealtPayload, type HealthChangedPayload } from "../../events/GameEvents";

export interface DamageableCharacterState {
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
  carriedFramePid: number | null;
  body: RAPIER.RigidBody;
}

export interface DamageableDummyState {
  health: number;
  maxHealth: number;
}

export type CombatTarget =
  | { kind: "character"; eid: number }
  | { kind: "player"; eid: number }
  | { kind: "dummy"; eid: number };

export interface DamageSystemOptions {
  readonly maxPlayerHealth: number;
  readonly playerBodyCenterHeight: number;
  readonly playerCameraOffsetY: number;
  readonly getSpawnPosition: () => { x: number; z: number };
  readonly getSpawnBodyY: (x: number, z: number) => number;
  readonly markCharacterDirtyByAccountId: (
    accountId: number,
    options: { dirtyCharacter: boolean; dirtyAbilityState: boolean }
  ) => void;
  readonly getCharacterStateByEid: (eid: number) => DamageableCharacterState | null;
  readonly applyCharacterStateByEid: (eid: number, next: DamageableCharacterState) => void;
  readonly getDummyStateByEid: (eid: number) => DamageableDummyState | null;
  readonly applyDummyStateByEid: (eid: number, next: DamageableDummyState) => void;
  readonly events: EventBus;
}

export class DamageSystem {
  private readonly targetsByColliderHandle = new Map<number, CombatTarget>();

  public constructor(private readonly options: DamageSystemOptions) {}

  public registerPlayerCollider(colliderHandle: number, eid: number): void {
    this.registerCharacterCollider(colliderHandle, eid);
  }

  public registerCharacterCollider(colliderHandle: number, eid: number): void {
    this.targetsByColliderHandle.set(colliderHandle, { kind: "character", eid });
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

  public applyDamage(target: CombatTarget, damage: number, sourceEid: number | null = null): void {
    const appliedDamage = Math.max(0, Math.floor(damage));
    if (appliedDamage <= 0) return;

    if (target.kind === "character" || target.kind === "player") {
      const character = this.options.getCharacterStateByEid(target.eid);
      if (!character) return;
      const previousHealth = character.health;
      character.health = Math.max(0, character.health - appliedDamage);
      if (character.accountId > 0) {
        this.options.markCharacterDirtyByAccountId(character.accountId, {
          dirtyCharacter: true, dirtyAbilityState: false
        });
      }
      this.options.events.emit<DamageDealtPayload>(GameEvent.DAMAGE_DEALT, {
        sourceEid, targetEid: target.eid, amount: appliedDamage,
        kind: sourceEid !== null ? "melee" : "environment"
      });
      this.options.events.emit<HealthChangedPayload>(GameEvent.HEALTH_CHANGED, {
        eid: target.eid, previous: previousHealth,
        current: character.health, max: character.maxHealth
      });
      if (character.health <= 0) {
        this.resolveZeroHealth(character);
      }
      this.options.applyCharacterStateByEid(target.eid, character);
      return;
    }
    const dummy = this.options.getDummyStateByEid(target.eid);
    if (!dummy) return;
    const prevDummyHp = dummy.health;
    dummy.health = Math.max(0, dummy.health - appliedDamage);
    if (dummy.health <= 0) {
      dummy.health = dummy.maxHealth;
    }
    this.options.events.emit<HealthChangedPayload>(GameEvent.HEALTH_CHANGED, {
      eid: target.eid, previous: prevDummyHp, current: dummy.health, max: dummy.maxHealth
    });
    this.options.applyDummyStateByEid(target.eid, dummy);
  }

  private resolveZeroHealth(character: DamageableCharacterState): void {
    if (character.accountId <= 0) {
      character.health = character.maxHealth;
      return;
    }
    const spawn = this.options.getSpawnPosition();
    const spawnBodyY = this.options.getSpawnBodyY(spawn.x, spawn.z);
    character.body.setTranslation(
      { x: spawn.x, y: spawnBodyY, z: spawn.z },
      true
    );
    character.vx = 0;
    character.vy = 0;
    character.vz = 0;
    character.grounded = true;
    character.movementMode = MOVEMENT_MODE_GROUNDED;
    character.groundedPlatformPid = null;
    character.carriedFramePid = null;
    character.health = this.options.maxPlayerHealth;
    character.maxHealth = this.options.maxPlayerHealth;
    character.x = spawn.x;
    character.y = spawnBodyY + this.options.playerCameraOffsetY;
    character.z = spawn.z;
    this.options.markCharacterDirtyByAccountId(character.accountId, {
      dirtyCharacter: true,
      dirtyAbilityState: false
    });
  }
}
