/**
 * Purpose: This file handles character/world movement rules and integration.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { GroundSupportHit } from "../../shared/index";
import type { WorldWithComponents } from "../ecs/SimulationEcsTypes";
import { EcsCharacterMotorRunner, type CharacterCarry } from "./EcsCharacterMotorRunner";

export type { CharacterCarry };

export interface CharacterMovementSystemOptions {
  readonly world?: RAPIER.World;
  readonly characterController: RAPIER.KinematicCharacterController;
  readonly capsuleHalfHeight?: number;
  readonly capsuleRadius?: number;
  readonly ecsComponents: WorldWithComponents["components"];
  readonly getBody: (eid: number) => RAPIER.RigidBody | undefined;
  readonly getCollider: (eid: number) => RAPIER.Collider | undefined;
  readonly sampleCharacterCarry: (eid: number) => CharacterCarry;
  readonly resolveCharacterCarriedFramePid?: (eid: number, movedBody: { x: number; y: number; z: number }, prev: number | null) => number | null;
  readonly resolveGroundSupportColliderHandle?: (eid: number, groundedByQuery: boolean) => GroundSupportHit;
  readonly resolvePlatformPidByColliderHandle: (colliderHandle: number) => number | null;
}

export class CharacterMovementSystem {
  private readonly motor: EcsCharacterMotorRunner;

  public constructor(private readonly options: CharacterMovementSystemOptions) {
    this.motor = new EcsCharacterMotorRunner({
      world: options.world,
      characterController: options.characterController,
      capsuleHalfHeight: options.capsuleHalfHeight,
      capsuleRadius: options.capsuleRadius,
      ecsComponents: options.ecsComponents,
      getBody: options.getBody,
      getCollider: options.getCollider,
      sampleCarry: options.sampleCharacterCarry,
      resolveCarriedFramePid: options.resolveCharacterCarriedFramePid,
      resolveGroundSupportColliderHandle: options.resolveGroundSupportColliderHandle,
      resolvePlatformPidByColliderHandle: options.resolvePlatformPidByColliderHandle
    });
  }

  public stepCharacters(eids: number[], deltaSeconds: number, simulationSeconds: number): void {
    for (const eid of eids) {
      this.motor.stepCharacter(eid, deltaSeconds, simulationSeconds);
    }
  }
}
