// Applies client input commands to server-authoritative player ECS state. Mutates ECS components directly.
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
import type { WorldWithComponents } from "../ecs/SimulationEcsTypes";

const INPUT_SEQUENCE_MODULO = 0x10000;
const INPUT_SEQUENCE_HALF_RANGE = INPUT_SEQUENCE_MODULO >>> 1;
const LOOK_PITCH_MIN = -1.45;
const LOOK_PITCH_MAX = 1.45;

export interface InputSystemOptions {
  readonly ecsComponents: WorldWithComponents["components"];
  readonly onPrimaryPressed: (eid: number) => void;
  readonly onSecondaryPressed: (eid: number) => void;
  readonly onCastSlotPressed: (eid: number, slot: number) => void;
}

export class InputSystem {
  public constructor(private readonly options: InputSystemOptions) {}

  public applyCommands(eid: number, commands: Partial<InputWireCommand>[]): void {
    const c = this.options.ecsComponents;
    let latestSequence = c.LastProcessedSequence.value[eid] ?? 0;
    let hasAcceptedCommand = false;
    let mergedForward = 0;
    let mergedStrafe = 0;
    let mergedPitch = c.Pitch.value[eid] ?? 0;
    let mergedSprint = false;
    let queuedUsePrimaryPressed = false;
    let mergedUsePrimaryHeld = (c.PrimaryHeld.value[eid] ?? 0) !== 0;
    let queuedUseSecondaryPressed = false;
    let mergedUseSecondaryHeld = (c.SecondaryHeld.value[eid] ?? 0) !== 0;
    let queuedCastSlot: number | null = null;
    let queuedJump = false;
    let queuedToggleFly = false;
    let mergedYaw = c.Yaw.value[eid] ?? 0;

    for (const command of commands) {
      if (command.ntype !== NType.InputCommand) continue;
      if (
        typeof command.forward !== "number" || !Number.isFinite(command.forward) ||
        typeof command.strafe !== "number" || !Number.isFinite(command.strafe) ||
        typeof command.pitch !== "number" || !Number.isFinite(command.pitch)
      ) continue;

      const pitch = command.pitch ?? mergedPitch;
      const hasAbsYaw = typeof command.yaw === "number" && Number.isFinite(command.yaw);
      const hasYawDelta = typeof command.yawDelta === "number" && Number.isFinite(command.yawDelta);
      if (!hasAbsYaw && !hasYawDelta) continue;

      const yaw = hasAbsYaw
        ? normalizeYaw(command.yaw as number)
        : normalizeYaw(mergedYaw + normalizeYaw(command.yawDelta ?? 0));
      const forward = this.clampAxis(command.forward ?? mergedForward);
      const strafe = this.clampAxis(command.strafe ?? mergedStrafe);
      const sprint = Boolean(command.sprint);
      const sequence = typeof command.sequence === "number" && Number.isFinite(command.sequence)
        ? (command.sequence & 0xffff) : ((latestSequence + 1) & 0xffff);
      if (!this.isSequenceAheadOf(latestSequence, sequence)) continue;

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
        queuedCastSlot = typeof command.castSlotIndex === "number" && Number.isFinite(command.castSlotIndex)
          ? Math.max(0, Math.floor(command.castSlotIndex)) : 0;
      }
    }

    if (!hasAcceptedCommand) return;

    let movementMode = (c.MovementMode.value[eid] ?? MOVEMENT_MODE_GROUNDED) as MovementMode;
    let grounded = (c.Grounded.value[eid] ?? 0) !== 0;
    let groundedPlatformPid = c.GroundedPlatformPid.value[eid] ?? -1;
    let vy = c.Velocity.y[eid] ?? 0;
    let vx = c.Velocity.x[eid] ?? 0;
    let vz = c.Velocity.z[eid] ?? 0;

    if (queuedToggleFly) {
      movementMode = toggleMovementMode(movementMode);
      grounded = false;
      groundedPlatformPid = -1;
      vy = 0;
    }

    if (movementMode === MOVEMENT_MODE_GROUNDED && queuedJump && grounded) {
      vy = PLAYER_JUMP_VELOCITY;
      grounded = false;
      groundedPlatformPid = -1;
    }

    const clampedPitch = Math.max(LOOK_PITCH_MIN, Math.min(LOOK_PITCH_MAX, mergedPitch));
    if (movementMode === MOVEMENT_MODE_FLYING) {
      grounded = false;
      groundedPlatformPid = -1;
      const d = stepFlyingMovement(
        { vx, vy, vz },
        { forward: mergedForward, strafe: mergedStrafe, sprint: mergedSprint, yaw: mergedYaw, pitch: clampedPitch },
        SERVER_TICK_SECONDS
      );
      vx = d.vx; vy = d.vy; vz = d.vz;
    } else {
      const h = stepHorizontalMovement(
        { vx, vz },
        { forward: mergedForward, strafe: mergedStrafe, sprint: mergedSprint, yaw: mergedYaw },
        grounded, SERVER_TICK_SECONDS
      );
      vx = h.vx; vz = h.vz;
    }

    c.Yaw.value[eid] = mergedYaw;
    c.Pitch.value[eid] = clampedPitch;
    c.MovementMode.value[eid] = movementMode;
    c.Grounded.value[eid] = grounded ? 1 : 0;
    c.GroundedPlatformPid.value[eid] = groundedPlatformPid;
    c.Velocity.x[eid] = vx;
    c.Velocity.y[eid] = vy;
    c.Velocity.z[eid] = vz;
    c.PrimaryHeld.value[eid] = mergedUsePrimaryHeld ? 1 : 0;
    c.SecondaryHeld.value[eid] = mergedUseSecondaryHeld ? 1 : 0;

    if (queuedUsePrimaryPressed) {
      this.options.onPrimaryPressed(eid);
    }
    if (queuedUseSecondaryPressed) {
      this.options.onSecondaryPressed(eid);
    }
    if (queuedCastSlot !== null) {
      this.options.onCastSlotPressed(eid, queuedCastSlot);
    }
    c.LastProcessedSequence.value[eid] = latestSequence;
  }

  private clampAxis(value: number): number {
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  }

  private isSequenceAheadOf(last: number, candidate: number): boolean {
    const delta = (candidate - last + INPUT_SEQUENCE_MODULO) % INPUT_SEQUENCE_MODULO;
    return delta > 0 && delta < INPUT_SEQUENCE_HALF_RANGE;
  }
}
