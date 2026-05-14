// Authoritative fixed-step movement system for kinematic characters, regardless of controller source.
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

export type CharacterCarry = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  carriedFramePid: number | null;
};

export interface CharacterMovementActor {
  movementMode: MovementMode;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  carriedFramePid: number | null;
  x: number;
  y: number;
  z: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export interface CharacterMovementSystemOptions<TCharacter extends CharacterMovementActor> {
  readonly world?: RAPIER.World;
  readonly characterController: RAPIER.KinematicCharacterController;
  readonly capsuleHalfHeight?: number;
  readonly capsuleRadius?: number;
  readonly beforeCharacterMove?: (character: TCharacter) => void;
  readonly sampleCharacterCarry: (character: TCharacter) => CharacterCarry;
  readonly resolveCharacterCarriedFramePid?: (
    character: TCharacter,
    movedBody: { x: number; y: number; z: number },
    previousCarriedFramePid: number | null
  ) => number | null;
  readonly resolveGroundSupportColliderHandle?: (
    character: TCharacter,
    groundedByQuery: boolean
  ) => GroundSupportHit;
  readonly resolvePlatformPidByColliderHandle: (colliderHandle: number) => number | null;
  readonly onCharacterStepped: (key: number, character: TCharacter) => void;
}

export class CharacterMovementSystem<TCharacter extends CharacterMovementActor> {
  public constructor(private readonly options: CharacterMovementSystemOptions<TCharacter>) {}

  public stepCharacters(
    characters: Iterable<readonly [number, TCharacter]>,
    deltaSeconds: number,
    simulationSeconds: number
  ): void {
    for (const [key, character] of characters) {
      this.options.beforeCharacterMove?.(character);
      const carry = this.options.sampleCharacterCarry(character);
      const next = stepKinematicCharacterController({
        state: {
          ...character,
          carriedFramePid: carry.carriedFramePid
        },
        deltaSeconds,
        carry,
        body: character.body,
        collider: character.collider,
        characterController: this.options.characterController,
        playerCameraOffsetY: PLAYER_CAMERA_OFFSET_Y,
        groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y,
        simulationSeconds,
        resolveGroundSupportColliderHandle: (groundedByQuery) =>
          this.resolveGroundSupportColliderHandle(character, groundedByQuery),
        resolvePlatformPidByColliderHandle: this.options.resolvePlatformPidByColliderHandle,
        resolveCarriedFramePid: (movedBody, previousCarriedFramePid) =>
          this.options.resolveCharacterCarriedFramePid?.(character, movedBody, previousCarriedFramePid) ??
          previousCarriedFramePid
      });
      character.yaw = next.yaw;
      character.grounded = next.grounded;
      character.groundedPlatformPid = next.groundedPlatformPid;
      character.carriedFramePid = next.carriedFramePid;
      character.vy = next.vy;
      character.x = next.x;
      character.y = next.y;
      character.z = next.z;
      character.position.x = next.x;
      character.position.y = next.y;
      character.position.z = next.z;
      const nextRotation = quaternionFromYawPitchRoll(character.yaw, 0);
      character.rotation.x = nextRotation.x;
      character.rotation.y = nextRotation.y;
      character.rotation.z = nextRotation.z;
      character.rotation.w = nextRotation.w;
      this.options.onCharacterStepped(key, character);
    }
  }

  private resolveGroundSupportColliderHandle(
    character: TCharacter,
    groundedByQuery: boolean
  ): GroundSupportHit {
    if (this.options.resolveGroundSupportColliderHandle) {
      return this.options.resolveGroundSupportColliderHandle(character, groundedByQuery);
    }

    const world = this.options.world;
    const capsuleHalfHeight = this.options.capsuleHalfHeight;
    const capsuleRadius = this.options.capsuleRadius;
    if (!world || !Number.isFinite(capsuleHalfHeight) || !Number.isFinite(capsuleRadius)) {
      throw new Error(
        "CharacterMovementSystem requires either resolveGroundSupportColliderHandle or world + capsule dimensions"
      );
    }

    return queryGroundSupportColliderHandle({
      groundedByQuery,
      world,
      characterController: this.options.characterController,
      body: character.body,
      collider: character.collider,
      capsuleHalfHeight: capsuleHalfHeight as number,
      capsuleRadius: capsuleRadius as number,
      groundContactMinNormalY: GROUND_CONTACT_MIN_NORMAL_Y
    });
  }
}
