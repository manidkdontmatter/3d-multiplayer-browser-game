// Shared ECS character motor runner used by authoritative player and NPC movement wrappers.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  GROUND_CONTACT_MIN_NORMAL_Y,
  MOVEMENT_MODE_GROUNDED,
  PLAYER_CAMERA_OFFSET_Y,
  quaternionFromYawPitchRoll,
  resolveGroundSupportColliderHandle as queryGroundSupportColliderHandle,
  sanitizeMovementMode,
  stepKinematicCharacterController,
  type GroundSupportHit
} from "../../shared/index";
import type { WorldWithComponents } from "../ecs/SimulationEcsTypes";

export type CharacterCarry = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  carriedFramePid: number | null;
};

export interface EcsCharacterMotorRunnerOptions {
  readonly world?: RAPIER.World;
  readonly characterController: RAPIER.KinematicCharacterController;
  readonly capsuleHalfHeight?: number;
  readonly capsuleRadius?: number;
  readonly ecsComponents: WorldWithComponents["components"];
  readonly getBody: (eid: number) => RAPIER.RigidBody | undefined;
  readonly getCollider: (eid: number) => RAPIER.Collider | undefined;
  readonly sampleCarry: (eid: number) => CharacterCarry;
  readonly resolveCarriedFramePid?: (
    eid: number,
    movedBody: { x: number; y: number; z: number },
    previousCarriedFramePid: number | null
  ) => number | null;
  readonly resolveGroundSupportColliderHandle?: (eid: number, groundedByQuery: boolean) => GroundSupportHit;
  readonly resolvePlatformPidByColliderHandle: (colliderHandle: number) => number | null;
}

export class EcsCharacterMotorRunner {
  public constructor(private readonly options: EcsCharacterMotorRunnerOptions) {}

  public stepCharacter(eid: number, deltaSeconds: number, simulationSeconds: number): boolean {
    const body = this.options.getBody(eid);
    const collider = this.options.getCollider(eid);
    if (!body || !collider) return false;

    const c = this.options.ecsComponents;
    const carry = this.options.sampleCarry(eid);
    const gp = c.GroundedPlatformPid.value[eid] ?? -1;
    const cf = c.CarriedFramePid.value[eid] ?? -1;
    const next = stepKinematicCharacterController({
      state: {
        yaw: c.Yaw.value[eid] ?? 0,
        vx: c.Velocity.x[eid] ?? 0,
        vy: c.Velocity.y[eid] ?? 0,
        vz: c.Velocity.z[eid] ?? 0,
        grounded: (c.Grounded.value[eid] ?? 0) !== 0,
        groundedPlatformPid: gp < 0 ? null : gp,
        carriedFramePid: carry.carriedFramePid,
        movementMode: sanitizeMovementMode(c.MovementMode.value[eid], MOVEMENT_MODE_GROUNDED)
      },
      deltaSeconds,
      carry,
      body,
      collider,
      characterController: this.options.characterController,
      playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
      groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y,
      simulationSeconds,
      resolveGroundSupportColliderHandle: (groundedByQuery) =>
        this.resolveGroundSupportColliderHandle(eid, groundedByQuery),
      resolvePlatformPidByColliderHandle: this.options.resolvePlatformPidByColliderHandle,
      resolveCarriedFramePid: (movedBody, prev) =>
        this.options.resolveCarriedFramePid?.(eid, movedBody, prev) ?? prev ?? (cf < 0 ? null : cf)
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
    return true;
  }

  private resolveGroundSupportColliderHandle(eid: number, groundedByQuery: boolean): GroundSupportHit {
    if (this.options.resolveGroundSupportColliderHandle) {
      return this.options.resolveGroundSupportColliderHandle(eid, groundedByQuery);
    }
    const world = this.options.world;
    const hh = this.options.capsuleHalfHeight;
    const r = this.options.capsuleRadius;
    if (!world || !Number.isFinite(hh) || !Number.isFinite(r)) {
      throw new Error("EcsCharacterMotorRunner requires resolveGroundSupportColliderHandle or world + capsule dimensions");
    }
    const body = this.options.getBody(eid);
    const collider = this.options.getCollider(eid);
    if (!body || !collider) return { hit: false, colliderHandle: null };
    return queryGroundSupportColliderHandle({
      groundedByQuery,
      world,
      characterController: this.options.characterController,
      body,
      collider,
      capsuleHalfHeight: hh as number,
      capsuleRadius: r as number,
      groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y
    });
  }
}
