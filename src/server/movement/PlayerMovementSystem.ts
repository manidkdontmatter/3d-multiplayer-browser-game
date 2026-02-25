// Authoritative fixed-step movement system that advances player kinematic controller state.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  GROUND_CONTACT_MIN_NORMAL_Y,
  type GroundSupportHit,
  type MovementMode,
  PLAYER_CAMERA_OFFSET_Y,
  quaternionFromYawPitchRoll,
  resolveGroundSupportColliderHandle as queryGroundSupportColliderHandle,
  stepKinematicCharacterController
} from "../../shared/index";

type PlatformCarry = { x: number; y: number; z: number; yaw: number };

export interface PlayerMovementActor {
  movementMode: MovementMode;
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
  readonly world?: RAPIER.World;
  readonly characterController: RAPIER.KinematicCharacterController;
  readonly playerCapsuleHalfHeight?: number;
  readonly playerCapsuleRadius?: number;
  readonly beforePlayerMove?: (player: TPlayer) => void;
  readonly samplePlayerPlatformCarry: (player: TPlayer) => PlatformCarry;
  readonly resolveGroundSupportColliderHandle?: (player: TPlayer, groundedByQuery: boolean) => GroundSupportHit;
  readonly resolvePlatformPidByColliderHandle: (colliderHandle: number) => number | null;
  readonly onPlayerStepped: (userId: number, player: TPlayer) => void;
}

export class PlayerMovementSystem<TPlayer extends PlayerMovementActor> {
  public constructor(private readonly options: PlayerMovementSystemOptions<TPlayer>) {}

  public stepPlayers(players: Iterable<readonly [number, TPlayer]>, deltaSeconds: number): void {
    for (const [userId, player] of players) {
      this.options.beforePlayerMove?.(player);
      const carry = this.options.samplePlayerPlatformCarry(player);
      const next = stepKinematicCharacterController({
        state: player,
        deltaSeconds,
        carry,
        body: player.body,
        collider: player.collider,
        characterController: this.options.characterController,
        playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
        groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y,
        resolveGroundSupportColliderHandle: (groundedByQuery) =>
          this.resolveGroundSupportColliderHandle(player, groundedByQuery),
        resolvePlatformPidByColliderHandle: this.options.resolvePlatformPidByColliderHandle
      });
      player.yaw = next.yaw;
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

  private resolveGroundSupportColliderHandle(
    player: TPlayer,
    groundedByQuery: boolean
  ): GroundSupportHit {
    if (this.options.resolveGroundSupportColliderHandle) {
      return this.options.resolveGroundSupportColliderHandle(player, groundedByQuery);
    }

    const world = this.options.world;
    const capsuleHalfHeight = this.options.playerCapsuleHalfHeight;
    const capsuleRadius = this.options.playerCapsuleRadius;
    if (!world || !Number.isFinite(capsuleHalfHeight) || !Number.isFinite(capsuleRadius)) {
      throw new Error(
        "PlayerMovementSystem requires either resolveGroundSupportColliderHandle or world + capsule dimensions"
      );
    }

    const resolvedCapsuleHalfHeight = capsuleHalfHeight as number;
    const resolvedCapsuleRadius = capsuleRadius as number;

    return queryGroundSupportColliderHandle({
      groundedByQuery,
      world,
      characterController: this.options.characterController,
      body: player.body,
      collider: player.collider,
      capsuleHalfHeight: resolvedCapsuleHalfHeight,
      capsuleRadius: resolvedCapsuleRadius,
      groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y
    });
  }
}
