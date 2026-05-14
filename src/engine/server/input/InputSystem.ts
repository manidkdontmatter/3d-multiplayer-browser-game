// Applies client input commands to server-authoritative player input state and action triggers.
import {
  MOVEMENT_MODE_FLYING,
  MOVEMENT_MODE_GROUNDED,
  normalizeYaw,
  PLAYER_JUMP_VELOCITY,
  SERVER_TICK_SECONDS,
  stepFlyingMovement,
  stepHorizontalMovement,
  toggleMovementMode,
  type MovementMode
} from "../../shared/index";
import type { InputCommand as InputWireCommand } from "../../shared/netcode";
import { NType } from "../../shared/netcode";

const INPUT_SEQUENCE_MODULO = 0x10000;
const INPUT_SEQUENCE_HALF_RANGE = INPUT_SEQUENCE_MODULO >>> 1;
const LOOK_PITCH_MIN = -1.45;
const LOOK_PITCH_MAX = 1.45;

export interface InputCommandActor {
  lastProcessedSequence: number;
  pitch: number;
  primaryHeld: boolean;
  secondaryHeld: boolean;
  yaw: number;
  grounded: boolean;
  movementMode: MovementMode;
  vy: number;
  groundedPlatformPid: number | null;
  vx: number;
  vz: number;
}

export interface InputSystemOptions<TPlayer extends InputCommandActor> {
  readonly onPrimaryPressed: (player: TPlayer) => void;
  readonly onSecondaryPressed: (player: TPlayer) => void;
  readonly onCastSlotPressed: (player: TPlayer, slot: number) => void;
}

export class InputSystem<TPlayer extends InputCommandActor> {
  public constructor(private readonly options: InputSystemOptions<TPlayer>) {}

  public applyCommands(player: TPlayer, commands: Partial<InputWireCommand>[]): void {
    let latestSequence = player.lastProcessedSequence;
    let hasAcceptedCommand = false;
    let mergedForward = 0;
    let mergedStrafe = 0;
    let mergedPitch = player.pitch;
    let mergedSprint = false;
    let queuedUsePrimaryPressed = false;
    let mergedUsePrimaryHeld = player.primaryHeld;
    let queuedUseSecondaryPressed = false;
    let mergedUseSecondaryHeld = player.secondaryHeld;
    let queuedCastSlot: number | null = null;
    let queuedJump = false;
    let queuedToggleFly = false;
    let mergedYaw = player.yaw;

    for (const command of commands) {
      if (command.ntype !== NType.InputCommand) {
        continue;
      }
      if (
        typeof command.forward !== "number" ||
        !Number.isFinite(command.forward) ||
        typeof command.strafe !== "number" ||
        !Number.isFinite(command.strafe) ||
        typeof command.pitch !== "number" ||
        !Number.isFinite(command.pitch)
      ) {
        continue;
      }

      const pitch = command.pitch ?? mergedPitch;
      const hasAbsoluteYaw = typeof command.yaw === "number" && Number.isFinite(command.yaw);
      const hasYawDelta = typeof command.yawDelta === "number" && Number.isFinite(command.yawDelta);
      if (!hasAbsoluteYaw && !hasYawDelta) {
        continue;
      }
      const yaw = hasAbsoluteYaw
        ? normalizeYaw(command.yaw as number)
        : normalizeYaw(mergedYaw + normalizeYaw(command.yawDelta ?? 0));
      const forward = this.clampAxis(command.forward ?? mergedForward);
      const strafe = this.clampAxis(command.strafe ?? mergedStrafe);
      const sprint = Boolean(command.sprint);
      const sequence =
        typeof command.sequence === "number" && Number.isFinite(command.sequence)
          ? (command.sequence & 0xffff)
          : ((latestSequence + 1) & 0xffff);
      if (!this.isSequenceAheadOf(latestSequence, sequence)) {
        continue;
      }

      hasAcceptedCommand = true;
      latestSequence = sequence;
      mergedForward = forward;
      mergedStrafe = strafe;
      mergedYaw = yaw;
      mergedPitch = pitch;
      mergedSprint = sprint;
      queuedUsePrimaryPressed = queuedUsePrimaryPressed || Boolean(command.usePrimaryPressed);
      mergedUsePrimaryHeld = Boolean(command.usePrimaryHeld);
      queuedUseSecondaryPressed = queuedUseSecondaryPressed || Boolean(command.useSecondaryPressed);
      mergedUseSecondaryHeld = Boolean(command.useSecondaryHeld);
      queuedJump = queuedJump || Boolean(command.jump);
      queuedToggleFly = queuedToggleFly || Boolean(command.toggleFlyPressed);
      if (Boolean(command.castSlotPressed)) {
        queuedCastSlot =
          typeof command.castSlotIndex === "number" && Number.isFinite(command.castSlotIndex)
            ? Math.max(0, Math.floor(command.castSlotIndex))
            : 0;
      }
    }

    if (!hasAcceptedCommand) {
      return;
    }

    if (queuedToggleFly) {
      player.movementMode = toggleMovementMode(player.movementMode);
      player.grounded = false;
      player.groundedPlatformPid = null;
      player.vy = 0;
    }

    if (player.movementMode === MOVEMENT_MODE_GROUNDED && queuedJump && player.grounded) {
      player.vy = PLAYER_JUMP_VELOCITY;
      player.grounded = false;
      player.groundedPlatformPid = null;
    }

    player.yaw = mergedYaw;
    const clampedPitch = Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, mergedPitch));
    if (player.movementMode === MOVEMENT_MODE_FLYING) {
      player.grounded = false;
      player.groundedPlatformPid = null;
      const directional = stepFlyingMovement(
        { vx: player.vx, vy: player.vy, vz: player.vz },
        {
          forward: mergedForward,
          strafe: mergedStrafe,
          sprint: mergedSprint,
          yaw: player.yaw,
          pitch: clampedPitch
        },
        SERVER_TICK_SECONDS
      );
      player.vx = directional.vx;
      player.vy = directional.vy;
      player.vz = directional.vz;
    } else {
      const horizontal = stepHorizontalMovement(
        { vx: player.vx, vz: player.vz },
        { forward: mergedForward, strafe: mergedStrafe, sprint: mergedSprint, yaw: player.yaw },
        player.grounded,
        SERVER_TICK_SECONDS
      );
      player.vx = horizontal.vx;
      player.vz = horizontal.vz;
    }
    player.pitch = clampedPitch;
    player.primaryHeld = mergedUsePrimaryHeld;
    player.secondaryHeld = mergedUseSecondaryHeld;
    if (queuedUsePrimaryPressed) {
      this.options.onPrimaryPressed(player);
    }
    if (queuedUseSecondaryPressed) {
      this.options.onSecondaryPressed(player);
    }
    if (queuedCastSlot !== null) {
      this.options.onCastSlotPressed(player, queuedCastSlot);
    }
    player.lastProcessedSequence = latestSequence;
  }

  private clampAxis(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(-1, Math.min(1, value));
  }

  private isSequenceAheadOf(lastSequence: number, candidateSequence: number): boolean {
    const delta = (candidateSequence - lastSequence + INPUT_SEQUENCE_MODULO) % INPUT_SEQUENCE_MODULO;
    return delta > 0 && delta < INPUT_SEQUENCE_HALF_RANGE;
  }
}
