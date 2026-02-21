import { normalizeYaw } from "../../../shared/index";
import type { InputAckMessage } from "../../../shared/netcode";
import type { MovementInput } from "../types";
import type { NetSimulationConfig, PendingInput, ReconciliationAck, ReconciliationFrame } from "./types";

const INPUT_SEQUENCE_MODULO = 0x10000;
const INPUT_SEQUENCE_HALF_RANGE = INPUT_SEQUENCE_MODULO >>> 1;
const ACK_SIMULATION_BUFFER_LIMIT = 64;

interface BufferedAck {
  readyAtMs: number;
  message: InputAckMessage;
}

export class AckReconciliationBuffer {
  private nextCommandSequence = 0;
  private readonly pendingInputs: PendingInput[] = [];
  private readonly bufferedAcks: BufferedAck[] = [];
  private latestAck: ReconciliationAck | null = null;
  private lastAckSequence: number | null = null;
  private serverGroundedPlatformPid = -1;
  private lastSentYaw = 0;
  private hasSentYaw = false;

  public constructor(
    private readonly onAckAccepted: (acceptedAtMs: number, serverTick: number) => void,
    private readonly nowMs: () => number = () => performance.now()
  ) {}

  public reset(): void {
    this.nextCommandSequence = 0;
    this.pendingInputs.length = 0;
    this.bufferedAcks.length = 0;
    this.latestAck = null;
    this.lastAckSequence = null;
    this.serverGroundedPlatformPid = -1;
    this.lastSentYaw = 0;
    this.hasSentYaw = false;
  }

  public enqueueInput(
    delta: number,
    movement: MovementInput,
    orientation: { yaw: number; pitch: number }
  ): { sequence: number; yawDelta: number } {
    this.nextCommandSequence = (this.nextCommandSequence + 1) & 0xffff;
    const sequence = this.nextCommandSequence;
    const yawDelta = this.hasSentYaw ? normalizeYaw(orientation.yaw - this.lastSentYaw) : orientation.yaw;
    this.lastSentYaw = orientation.yaw;
    this.hasSentYaw = true;

    this.pendingInputs.push({
      sequence,
      delta,
      movement: { ...movement },
      orientation: { ...orientation }
    });

    return { sequence, yawDelta };
  }

  public enqueueAckMessage(message: InputAckMessage, netSimulation: NetSimulationConfig): void {
    if (!netSimulation.enabled) {
      this.applyAckMessage(message);
      return;
    }

    if (Math.random() < netSimulation.ackDropRate) {
      return;
    }

    const jitterOffset =
      netSimulation.ackJitterMs > 0 ? (Math.random() * 2 - 1) * netSimulation.ackJitterMs : 0;
    const readyAtMs = this.nowMs() + Math.max(0, netSimulation.ackDelayMs + jitterOffset);
    this.bufferedAcks.push({
      readyAtMs,
      message: { ...message }
    });

    if (this.bufferedAcks.length > ACK_SIMULATION_BUFFER_LIMIT) {
      this.bufferedAcks.shift();
    }
  }

  public processBufferedAcks(): void {
    if (this.bufferedAcks.length === 0) {
      return;
    }

    const now = this.nowMs();
    const due: BufferedAck[] = [];
    const pending: BufferedAck[] = [];
    for (const buffered of this.bufferedAcks) {
      if (buffered.readyAtMs <= now) {
        due.push(buffered);
      } else {
        pending.push(buffered);
      }
    }
    this.bufferedAcks.length = 0;
    this.bufferedAcks.push(...pending);

    due.sort((a, b) => a.readyAtMs - b.readyAtMs);
    for (const buffered of due) {
      this.applyAckMessage(buffered.message);
    }
  }

  public consumeReconciliationFrame(): ReconciliationFrame | null {
    if (!this.latestAck) {
      return null;
    }
    const frame: ReconciliationFrame = {
      ack: { ...this.latestAck },
      replay: this.pendingInputs.map((entry) => ({
        sequence: entry.sequence,
        delta: entry.delta,
        movement: { ...entry.movement },
        orientation: { ...entry.orientation }
      }))
    };
    this.latestAck = null;
    return frame;
  }

  public syncSentYaw(yaw: number): void {
    this.lastSentYaw = yaw;
    this.hasSentYaw = true;
  }

  public shiftPendingInputYaw(deltaYaw: number): void {
    if (!Number.isFinite(deltaYaw) || Math.abs(deltaYaw) <= 1e-6) {
      return;
    }
    for (const entry of this.pendingInputs) {
      entry.orientation.yaw = normalizeYaw(entry.orientation.yaw + deltaYaw);
    }
  }

  public getServerGroundedPlatformPid(): number {
    return this.serverGroundedPlatformPid;
  }

  private applyAckMessage(message: InputAckMessage): void {
    if (this.lastAckSequence !== null && !this.isSequenceAheadOf(this.lastAckSequence, message.sequence)) {
      return;
    }
    this.lastAckSequence = message.sequence;
    this.onAckAccepted(this.nowMs(), message.serverTick);

    this.latestAck = {
      sequence: message.sequence,
      serverTick: message.serverTick,
      x: message.x,
      y: message.y,
      z: message.z,
      vx: message.vx,
      vy: message.vy,
      vz: message.vz,
      grounded: message.grounded,
      groundedPlatformPid: message.groundedPlatformPid
    };

    this.serverGroundedPlatformPid = message.groundedPlatformPid;
    this.trimPendingInputs(message.sequence);
  }

  private trimPendingInputs(ackedSequence: number): void {
    while (this.pendingInputs.length > 0) {
      const first = this.pendingInputs[0];
      if (!first) {
        break;
      }
      if (this.isAckForOrAheadOf(first.sequence, ackedSequence)) {
        this.pendingInputs.shift();
      } else {
        break;
      }
    }
  }

  private isAckForOrAheadOf(candidateSequence: number, ackedSequence: number): boolean {
    const delta = (ackedSequence - candidateSequence + INPUT_SEQUENCE_MODULO) % INPUT_SEQUENCE_MODULO;
    return delta === 0 || delta < INPUT_SEQUENCE_HALF_RANGE;
  }

  private isSequenceAheadOf(lastSequence: number, candidateSequence: number): boolean {
    const delta = (candidateSequence - lastSequence + INPUT_SEQUENCE_MODULO) % INPUT_SEQUENCE_MODULO;
    return delta > 0 && delta < INPUT_SEQUENCE_HALF_RANGE;
  }
}
