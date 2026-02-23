import { normalizeYaw, PLAYER_JUMP_VELOCITY, SERVER_TICK_SECONDS, stepHorizontalMovement } from "../../shared/index";
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
  yaw: number;
  grounded: boolean;
  vy: number;
  groundedPlatformPid: number | null;
  vx: number;
  vz: number;
}

export interface InputSystemOptions<TPlayer extends InputCommandActor> {
  readonly onPrimaryPressed: (player: TPlayer) => void;
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
    let queuedJump = false;
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
      queuedJump = queuedJump || Boolean(command.jump);
    }

    if (!hasAcceptedCommand) {
      return;
    }

    if (queuedJump && player.grounded) {
      player.vy = PLAYER_JUMP_VELOCITY;
      player.grounded = false;
      player.groundedPlatformPid = null;
    }

    player.yaw = mergedYaw;
    const horizontal = stepHorizontalMovement(
      { vx: player.vx, vz: player.vz },
      { forward: mergedForward, strafe: mergedStrafe, sprint: mergedSprint, yaw: player.yaw },
      player.grounded,
      SERVER_TICK_SECONDS
    );
    player.vx = horizontal.vx;
    player.vz = horizontal.vz;
    player.pitch = Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, mergedPitch));
    player.primaryHeld = mergedUsePrimaryHeld;
    if (queuedUsePrimaryPressed) {
      this.options.onPrimaryPressed(player);
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
