// Authoritative fixed-step movement for NPC characters. Reads/writes ECS components directly.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  GROUND_CONTACT_MIN_NORMAL_Y,
  type GroundSupportHit,
  MOVEMENT_MODE_GROUNDED,
  PLAYER_CAMERA_OFFSET_Y,
  quaternionFromYawPitchRoll,
  resolveGroundSupportColliderHandle as queryGroundSupportColliderHandle,
  sanitizeMovementMode,
  stepKinematicCharacterController
} from "../../shared/index";
import type { WorldWithComponents } from "../ecs/SimulationEcsTypes";

export type CharacterCarry = { x: number; y: number; z: number; yaw: number; carriedFramePid: number | null };

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
  public constructor(private readonly options: CharacterMovementSystemOptions) {}

  public stepCharacters(eids: number[], deltaSeconds: number, simulationSeconds: number): void {
    const c = this.options.ecsComponents;
    for (const eid of eids) {
      const body = this.options.getBody(eid);
      const collider = this.options.getCollider(eid);
      if (!body || !collider) continue;

      const carry = this.options.sampleCharacterCarry(eid);
      const x = c.Position.x[eid] ?? 0;
      const y = c.Position.y[eid] ?? 0;
      const z = c.Position.z[eid] ?? 0;

      const state = {
        x, y, z,
        yaw: c.Yaw.value[eid] ?? 0,
        vx: c.Velocity.x[eid] ?? 0,
        vy: c.Velocity.y[eid] ?? 0,
        vz: c.Velocity.z[eid] ?? 0,
        grounded: (c.Grounded.value[eid] ?? 0) !== 0,
        groundedPlatformPid: ((c.GroundedPlatformPid.value[eid] ?? -1) < 0 ? null : c.GroundedPlatformPid.value[eid]) as number | null,
        carriedFramePid: ((c.CarriedFramePid.value[eid] ?? -1) < 0 ? null : c.CarriedFramePid.value[eid]) as number | null,
        movementMode: sanitizeMovementMode(c.MovementMode.value[eid], MOVEMENT_MODE_GROUNDED),
        position: { x, y, z },
        rotation: { x: c.Rotation.x[eid] ?? 0, y: c.Rotation.y[eid] ?? 0, z: c.Rotation.z[eid] ?? 0, w: c.Rotation.w[eid] ?? 1 }
      };

      const next = stepKinematicCharacterController({
        state: { ...state, carriedFramePid: carry.carriedFramePid },
        deltaSeconds, carry, body, collider,
        characterController: this.options.characterController,
        playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
        groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y,
        simulationSeconds,
        resolveGroundSupportColliderHandle: (groundedByQuery) =>
          this.resolveGroundSupportColliderHandle(eid, groundedByQuery),
        resolvePlatformPidByColliderHandle: this.options.resolvePlatformPidByColliderHandle,
        resolveCarriedFramePid: (movedBody, prev) =>
          this.options.resolveCharacterCarriedFramePid?.(eid, movedBody, prev) ?? prev
      });

      c.Position.x[eid] = next.x;
      c.Position.y[eid] = next.y;
      c.Position.z[eid] = next.z;
      c.Yaw.value[eid] = next.yaw;
      c.Velocity.y[eid] = next.vy;
      c.Grounded.value[eid] = next.grounded ? 1 : 0;
      c.GroundedPlatformPid.value[eid] = next.groundedPlatformPid === null ? -1 : next.groundedPlatformPid;
      c.CarriedFramePid.value[eid] = next.carriedFramePid === null ? -1 : next.carriedFramePid;
      const rot = quaternionFromYawPitchRoll(next.yaw, 0);
      c.Rotation.x[eid] = rot.x;
      c.Rotation.y[eid] = rot.y;
      c.Rotation.z[eid] = rot.z;
      c.Rotation.w[eid] = rot.w;
    }
  }

  private resolveGroundSupportColliderHandle(eid: number, groundedByQuery: boolean): GroundSupportHit {
    if (this.options.resolveGroundSupportColliderHandle) {
      return this.options.resolveGroundSupportColliderHandle(eid, groundedByQuery);
    }
    const world = this.options.world;
    const hh = this.options.capsuleHalfHeight;
    const r = this.options.capsuleRadius;
    if (!world || !Number.isFinite(hh) || !Number.isFinite(r)) {
      throw new Error("CharacterMovementSystem requires resolveGroundSupportColliderHandle or world + capsule dimensions");
    }
    const body = this.options.getBody(eid);
    const collider = this.options.getCollider(eid);
    if (!body || !collider) return { hit: false, colliderHandle: null };
    return queryGroundSupportColliderHandle({
      groundedByQuery, world, characterController: this.options.characterController,
      body, collider, capsuleHalfHeight: hh as number, capsuleRadius: r as number,
      groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y
    });
  }
}
