import RAPIER from "@dimforge/rapier3d-compat";
import {
  GRAVITY,
  normalizeYaw,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_GROUND_STICK_VELOCITY
} from "../../shared/index";

type PlatformCarry = { x: number; y: number; z: number; yaw: number };

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
  serverTick: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface PlayerMovementSystemOptions<TPlayer extends PlayerMovementActor> {
  readonly characterController: RAPIER.KinematicCharacterController;
  readonly getTickNumber: () => number;
  readonly beforePlayerMove?: (player: TPlayer) => void;
  readonly samplePlayerPlatformCarry: (player: TPlayer) => PlatformCarry;
  readonly findGroundedPlatformPid: (
    bodyX: number,
    bodyY: number,
    bodyZ: number,
    preferredPid: number | null
  ) => number | null;
  readonly onPlayerStepped: (userId: number, player: TPlayer, platformYawDelta: number) => void;
}

export class PlayerMovementSystem<TPlayer extends PlayerMovementActor> {
  public constructor(private readonly options: PlayerMovementSystemOptions<TPlayer>) {}

  public stepPlayers(playersByUserId: ReadonlyMap<number, TPlayer>, deltaSeconds: number): void {
    for (const [userId, player] of playersByUserId.entries()) {
      this.options.beforePlayerMove?.(player);
      const carry = this.options.samplePlayerPlatformCarry(player);
      player.yaw = normalizeYaw(player.yaw + carry.yaw);
      const attachedToPlatformForSolve = player.groundedPlatformPid !== null;
      const solveVerticalVelocity = attachedToPlatformForSolve
        ? 0
        : player.grounded && player.vy <= 0
          ? PLAYER_GROUND_STICK_VELOCITY
          : player.vy;
      const desired = {
        x: player.vx * deltaSeconds + carry.x,
        y: solveVerticalVelocity * deltaSeconds + carry.y,
        z: player.vz * deltaSeconds + carry.z
      };
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
      const canAttachToPlatform =
        groundedByQuery || player.groundedPlatformPid !== null || player.vy <= 0;
      const groundedPlatformPid = canAttachToPlatform
        ? this.options.findGroundedPlatformPid(moved.x, moved.y, moved.z, player.groundedPlatformPid)
        : null;
      player.grounded = groundedByQuery || groundedPlatformPid !== null;
      player.groundedPlatformPid = player.grounded ? groundedPlatformPid : null;
      const attachedToPlatform = player.grounded && player.groundedPlatformPid !== null;
      if (attachedToPlatform) {
        // While attached to a platform, platform Y carry drives vertical motion directly.
        player.vy = 0;
      } else if (player.grounded) {
        if (player.vy < 0) {
          player.vy = 0;
        }
      } else {
        // Apply gravity after this-step grounding resolution.
        player.vy += GRAVITY * deltaSeconds;
      }

      player.x = moved.x;
      player.y = moved.y + PLAYER_CAMERA_OFFSET_Y;
      player.z = moved.z;
      player.serverTick = this.options.getTickNumber();
      this.options.onPlayerStepped(userId, player, carry.yaw);
    }
  }
}

