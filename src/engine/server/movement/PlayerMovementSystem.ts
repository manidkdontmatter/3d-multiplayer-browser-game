/**
 * Purpose: This file handles character/world movement rules and integration.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { GroundSupportHit } from "../../shared/index";
import type { WorldWithComponents } from "../ecs/SimulationEcsTypes";
import { EcsCharacterMotorRunner, type CharacterCarry } from "./EcsCharacterMotorRunner";

type PlayerCarry = CharacterCarry;

export interface PlayerMovementSystemOptions {
  readonly world?: RAPIER.World;
  readonly characterController: RAPIER.KinematicCharacterController;
  readonly playerCapsuleHalfHeight?: number;
  readonly playerCapsuleRadius?: number;
  readonly ecsComponents: WorldWithComponents["components"];
  readonly getBody: (eid: number) => RAPIER.RigidBody | undefined;
  readonly getCollider: (eid: number) => RAPIER.Collider | undefined;
  readonly samplePlayerPlatformCarry: (eid: number) => PlayerCarry;
  readonly resolvePlayerCarriedFramePid?: (eid: number, movedBody: { x: number; y: number; z: number }, previousCarriedFramePid: number | null) => number | null;
  readonly resolveGroundSupportColliderHandle?: (eid: number, groundedByQuery: boolean) => GroundSupportHit;
  readonly resolvePlatformPidByColliderHandle: (colliderHandle: number) => number | null;
  readonly onPlayerStepped: (userId: number, eid: number) => void;
}

export class PlayerMovementSystem {
  private readonly motor: EcsCharacterMotorRunner;

  public constructor(private readonly options: PlayerMovementSystemOptions) {
    this.motor = new EcsCharacterMotorRunner({
      world: options.world,
      characterController: options.characterController,
      capsuleHalfHeight: options.playerCapsuleHalfHeight,
      capsuleRadius: options.playerCapsuleRadius,
      ecsComponents: options.ecsComponents,
      getBody: options.getBody,
      getCollider: options.getCollider,
      sampleCarry: options.samplePlayerPlatformCarry,
      resolveCarriedFramePid: options.resolvePlayerCarriedFramePid,
      resolveGroundSupportColliderHandle: options.resolveGroundSupportColliderHandle,
      resolvePlatformPidByColliderHandle: options.resolvePlatformPidByColliderHandle
    });
  }

  public stepPlayers(
    players: Iterable<readonly [number, number]>,
    deltaSeconds: number,
    simulationSeconds: number
  ): void {
    for (const [userId, eid] of players) {
      if (this.motor.stepCharacter(eid, deltaSeconds, simulationSeconds)) {
        this.options.onPlayerStepped(userId, eid);
      }
    }
  }
}
