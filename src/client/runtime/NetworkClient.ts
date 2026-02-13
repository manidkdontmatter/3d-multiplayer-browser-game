import { Client, Interpolator } from "nengi";
import { WebSocketClientAdapter } from "nengi-websocket-client-adapter";
import { normalizeYaw } from "../../shared/index";
import { NType, type IdentityMessage, type InputAckMessage, ncontext } from "../../shared/netcode";
import { SERVER_TICK_RATE } from "../../shared/config";
import type { MovementInput, PlatformState, RemotePlayerState } from "./types";

export interface PendingInput {
  sequence: number;
  delta: number;
  movement: MovementInput;
  orientation: { yaw: number; pitch: number };
}

export interface ReconciliationFrame {
  ack: {
    sequence: number;
    serverTick: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    vx: number;
    vy: number;
    vz: number;
    grounded: boolean;
    groundedPlatformPid: number;
    platformYawDelta: number;
  };
  replay: PendingInput[];
}

const INPUT_SEQUENCE_MODULO = 0x10000;
const INPUT_SEQUENCE_HALF_RANGE = INPUT_SEQUENCE_MODULO >>> 1;

export class NetworkClient {
  private readonly client = new Client(ncontext, WebSocketClientAdapter, SERVER_TICK_RATE);
  private readonly interpolator = new Interpolator(this.client);
  private readonly entities = new Map<number, Record<string, unknown>>();
  private localPlayerNid: number | null = null;
  private connected = false;
  private nextCommandSequence = 0;
  private readonly pendingInputs: PendingInput[] = [];
  private latestAck: ReconciliationFrame["ack"] | null = null;
  private lastAckSequence: number | null = null;
  private serverGroundedPlatformPid = -1;
  private lastSentYaw = 0;
  private hasSentYaw = false;

  public constructor() {
    this.client.setDisconnectHandler(() => {
      this.connected = false;
      this.pendingInputs.length = 0;
      this.latestAck = null;
      this.lastAckSequence = null;
      this.serverGroundedPlatformPid = -1;
      this.lastSentYaw = 0;
      this.hasSentYaw = false;
    });
    this.client.setWebsocketErrorHandler(() => {
      // Errors are expected when server is unavailable during local-only workflows.
    });
  }

  public async connect(serverUrl: string): Promise<void> {
    try {
      const timeoutMs = 1500;
      await Promise.race([
        this.client.connect(serverUrl, { token: "dev-token" }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error(`connect timeout after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
      this.connected = true;
      console.log(`[client] connected to ${serverUrl}`);
    } catch (error) {
      this.connected = false;
      console.warn("[client] network unavailable, running local-only mode", error);
    }
  }

  public step(
    delta: number,
    movement: MovementInput,
    orientation: { yaw: number; pitch: number }
  ): void {
    if (!this.connected) {
      return;
    }

    this.readMessages();

    this.applyInterpolatedFrames(this.interpolator.getInterpolatedState(100));

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

    this.client.addCommand({
      ntype: NType.InputCommand,
      sequence,
      forward: movement.forward,
      strafe: movement.strafe,
      jump: movement.jump,
      sprint: movement.sprint,
      yawDelta,
      pitch: orientation.pitch,
      delta
    });
    this.client.flush();
  }

  public getRemotePlayers(): RemotePlayerState[] {
    const output: RemotePlayerState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.PlayerEntity) {
        continue;
      }
      const player = this.toPlayerState(rawEntity);
      if (!player) {
        continue;
      }
      if (player.nid === this.localPlayerNid) {
        continue;
      }
      output.push(player);
    }
    return output;
  }

  public getLocalPlayerPose(): RemotePlayerState | null {
    if (this.localPlayerNid === null) {
      return null;
    }
    const rawEntity = this.entities.get(this.localPlayerNid);
    if (!rawEntity || rawEntity.ntype !== NType.PlayerEntity) {
      return null;
    }
    return this.toPlayerState(rawEntity);
  }

  public getPlatforms(): PlatformState[] {
    const output: PlatformState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.PlatformEntity) {
        continue;
      }
      const platform = this.toPlatformState(rawEntity);
      if (!platform) {
        continue;
      }
      output.push(platform);
    }
    return output;
  }

  public getConnectionState(): "connected" | "local-only" {
    return this.connected ? "connected" : "local-only";
  }

  public getLocalPlayerNid(): number | null {
    return this.localPlayerNid;
  }

  public isServerGroundedOnPlatform(): boolean {
    return this.serverGroundedPlatformPid >= 0;
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

  private readMessages(): void {
    const messages = (this.client.network as { messages?: unknown[] }).messages;
    if (!messages || messages.length === 0) {
      return;
    }

    const messageCount = messages.length;
    for (let i = 0; i < messageCount; i++) {
      const message = messages[i] as IdentityMessage | InputAckMessage | undefined;
      if (message?.ntype === NType.IdentityMessage) {
        this.localPlayerNid = message.playerNid;
        continue;
      }
      if (message?.ntype === NType.InputAckMessage) {
        if (this.lastAckSequence !== null && message.sequence === this.lastAckSequence) {
          continue;
        }
        this.lastAckSequence = message.sequence;
        const platformYawDelta = Number.isFinite(message.platformYawDelta)
          ? message.platformYawDelta
          : 0;
        let accumulatedPlatformYawDelta = platformYawDelta;
        if (
          this.latestAck &&
          this.latestAck.groundedPlatformPid >= 0 &&
          this.latestAck.groundedPlatformPid === message.groundedPlatformPid
        ) {
          accumulatedPlatformYawDelta = normalizeYaw(
            this.latestAck.platformYawDelta + platformYawDelta
          );
        }
        this.latestAck = {
          sequence: message.sequence,
          serverTick: message.serverTick,
          x: message.x,
          y: message.y,
          z: message.z,
          yaw: message.yaw,
          pitch: message.pitch,
          vx: message.vx,
          vy: message.vy,
          vz: message.vz,
          grounded: message.grounded,
          groundedPlatformPid: message.groundedPlatformPid,
          platformYawDelta: accumulatedPlatformYawDelta
        };
        this.serverGroundedPlatformPid = message.groundedPlatformPid;
        this.trimPendingInputs(message.sequence);
      }
    }

    // Drain processed messages without allocating a new array in this hot path.
    messages.length = 0;
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

  private applyInterpolatedFrames(rawFrames: unknown): void {
    if (!Array.isArray(rawFrames)) {
      return;
    }

    for (const rawFrame of rawFrames) {
      const frame = rawFrame as {
        createEntities?: unknown[];
        updateEntities?: unknown[];
        deleteEntities?: unknown[];
      };

      for (const rawEntity of frame.createEntities ?? []) {
        if (!rawEntity || typeof rawEntity !== "object") {
          continue;
        }
        const entity = rawEntity as Record<string, unknown>;
        const nid = entity.nid;
        if (typeof nid !== "number") {
          continue;
        }
        this.entities.set(nid, { ...entity });
      }

      for (const rawPatch of frame.updateEntities ?? []) {
        if (!rawPatch || typeof rawPatch !== "object") {
          continue;
        }
        const patch = rawPatch as { nid?: unknown; prop?: unknown; value?: unknown };
        if (typeof patch.nid !== "number" || typeof patch.prop !== "string") {
          continue;
        }
        const entity = this.entities.get(patch.nid) ?? { nid: patch.nid, ntype: NType.PlayerEntity };
        entity[patch.prop] = patch.value;
        this.entities.set(patch.nid, entity);
      }

      for (const rawNid of frame.deleteEntities ?? []) {
        if (typeof rawNid === "number") {
          this.entities.delete(rawNid);
        }
      }
    }
  }

  private toPlayerState(raw: Record<string, unknown>): RemotePlayerState | null {
    const nid = raw.nid;
    const x = raw.x;
    const y = raw.y;
    const z = raw.z;
    const yaw = raw.yaw;
    const pitch = raw.pitch;

    if (
      typeof nid !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof yaw !== "number" ||
      typeof pitch !== "number"
    ) {
      return null;
    }

    return {
      nid,
      x,
      y,
      z,
      yaw,
      pitch
    };
  }

  private toPlatformState(raw: Record<string, unknown>): PlatformState | null {
    const nid = raw.nid;
    const pid = raw.pid;
    const kind = raw.kind;
    const x = raw.x;
    const y = raw.y;
    const z = raw.z;
    const yaw = raw.yaw;
    const halfX = raw.halfX;
    const halfY = raw.halfY;
    const halfZ = raw.halfZ;

    if (
      typeof nid !== "number" ||
      typeof pid !== "number" ||
      typeof kind !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof yaw !== "number" ||
      typeof halfX !== "number" ||
      typeof halfY !== "number" ||
      typeof halfZ !== "number"
    ) {
      return null;
    }

    return {
      nid,
      pid,
      kind,
      x,
      y,
      z,
      yaw,
      halfX,
      halfY,
      halfZ
    };
  }
}
