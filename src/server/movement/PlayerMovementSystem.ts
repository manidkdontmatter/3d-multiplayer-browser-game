import RAPIER from "@dimforge/rapier3d-compat";
import {
  applyPlatformCarryYaw,
  buildDesiredCharacterTranslation,
  GROUND_CONTACT_MIN_NORMAL_Y,
  PLAYER_CAMERA_OFFSET_Y,
  quaternionFromYawPitchRoll,
  resolveGroundedPlatformPid,
  resolveKinematicPostStepState,
  resolveVerticalVelocityForSolve
} from "../../shared/index";

type PlatformCarry = { x: number; y: number; z: number; yaw: number };
type GroundSupportHit = { hit: boolean; colliderHandle: number | null };

export interface PlayerMovementActor {
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  x: number;
  y: number;
  z: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface PlayerMovementSystemOptions<TPlayer extends PlayerMovementActor> {
  readonly characterController: RAPIER.KinematicCharacterController;
  readonly beforePlayerMove?: (player: TPlayer) => void;
  readonly samplePlayerPlatformCarry: (player: TPlayer) => PlatformCarry;
  readonly resolveGroundSupportColliderHandle: (player: TPlayer, groundedByQuery: boolean) => GroundSupportHit;
  readonly resolvePlatformPidByColliderHandle: (colliderHandle: number) => number | null;
  readonly onPlayerStepped: (userId: number, player: TPlayer) => void;
}

export class PlayerMovementSystem<TPlayer extends PlayerMovementActor> {
  public constructor(private readonly options: PlayerMovementSystemOptions<TPlayer>) {}

  public stepPlayers(players: Iterable<readonly [number, TPlayer]>, deltaSeconds: number): void {
    for (const [userId, player] of players) {
      this.options.beforePlayerMove?.(player);
      const carry = this.options.samplePlayerPlatformCarry(player);
      player.yaw = applyPlatformCarryYaw(player.yaw, carry.yaw);
      const solveVerticalVelocity = resolveVerticalVelocityForSolve(player);
      const desired = buildDesiredCharacterTranslation(
        player.vx,
        player.vz,
        deltaSeconds,
        solveVerticalVelocity,
        carry
      );
      this.options.characterController.computeColliderMovement(
        player.collider,
        desired,
        undefined,
        undefined,
        (collider) => collider.handle !== player.collider.handle
      );
      const corrected = this.options.characterController.computedMovement();

      const current = player.body.translation();
      player.body.setTranslation(
        {
          x: current.x + corrected.x,
          y: current.y + corrected.y,
          z: current.z + corrected.z
        },
        true
      );

      const moved = player.body.translation();
      const groundedByQuery = this.options.characterController.computedGrounded();
      const supportHit = this.options.resolveGroundSupportColliderHandle(player, groundedByQuery);
      const groundedPlatformPid = this.resolveGroundedPlatformPidFromComputedCollisions(
        groundedByQuery,
        player.groundedPlatformPid,
        supportHit
      );
      const next = resolveKinematicPostStepState({
        previous: player,
        movedBody: moved,
        groundedByQuery,
        groundedPlatformPid,
        deltaSeconds,
        playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y
      });
      player.grounded = next.grounded;
      player.groundedPlatformPid = next.groundedPlatformPid;
      player.vy = next.vy;
      player.x = next.x;
      player.y = next.y;
      player.z = next.z;
      player.position.x = next.x;
      player.position.y = next.y;
      player.position.z = next.z;
      const nextRotation = quaternionFromYawPitchRoll(player.yaw, 0);
      player.rotation.x = nextRotation.x;
      player.rotation.y = nextRotation.y;
      player.rotation.z = nextRotation.z;
      player.rotation.w = nextRotation.w;
      this.options.onPlayerStepped(userId, player);
    }
  }

  private resolveGroundedPlatformPidFromComputedCollisions(
    groundedByQuery: boolean,
    previousGroundedPlatformPid: number | null,
    supportHit: GroundSupportHit
  ): number | null {
    if (groundedByQuery && supportHit.hit) {
      const supportPid =
        supportHit.colliderHandle !== null
          ? this.options.resolvePlatformPidByColliderHandle(supportHit.colliderHandle)
          : null;
      return typeof supportPid === "number" ? supportPid : null;
    }

    const collisionPlatformPids: number[] = [];
    const collisionCount = this.options.characterController.numComputedCollisions();
    for (let i = 0; i < collisionCount; i += 1) {
      const collision = this.options.characterController.computedCollision(i);
      const collider = collision?.collider;
      if (!collision || !collider) {
        continue;
      }
      if (!Number.isFinite(collision.normal1.y) || collision.normal1.y < GROUND_CONTACT_MIN_NORMAL_Y) {
        continue;
      }
      const pid = this.options.resolvePlatformPidByColliderHandle(collider.handle);
      if (typeof pid !== "number") {
        continue;
      }
      if (!collisionPlatformPids.includes(pid)) {
        collisionPlatformPids.push(pid);
      }
    }
    return resolveGroundedPlatformPid({
      groundedByQuery,
      previousGroundedPlatformPid,
      collisionPlatformPids
    });
  }
}
