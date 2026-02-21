import {
  type AbilityDefinition
} from "../../shared/index";
import {
  type AbilityUseMessage,
  NType,
  type IdentityMessage,
  type InputAckMessage,
  type LoadoutCommand,
  ncontext
} from "../../shared/netcode";
import { SERVER_TICK_RATE } from "../../shared/config";
import type {
  MovementInput,
  PlatformState,
  ProjectileState,
  RemotePlayerState,
  TrainingDummyState,
  AbilityUseEvent
} from "./types";
import { AbilityStateStore } from "./network/AbilityStateStore";
import { AckReconciliationBuffer } from "./network/AckReconciliationBuffer";
import { InterpolationController } from "./network/InterpolationController";
import { NetTransportClient } from "./network/NetTransportClient";
import { ServerTimeSync } from "./network/ServerTimeSync";
import { SnapshotStore } from "./network/SnapshotStore";
import type {
  AbilityEventBatch,
  LoadoutState,
  NetSimulationConfig,
  QueuedLoadoutCommand,
  ReconciliationFrame,
  PendingInput
} from "./network/types";

export type { PendingInput, ReconciliationFrame, LoadoutState, AbilityEventBatch };

export class NetworkClient {
  private readonly transport: NetTransportClient;
  private readonly snapshots = new SnapshotStore();
  private readonly abilities = new AbilityStateStore();
  private readonly interpolation = new InterpolationController();
  private readonly serverTimeSync = new ServerTimeSync();
  private readonly ackBuffer: AckReconciliationBuffer;
  private readonly netSimulation = this.resolveNetSimulationConfig();
  private queuedLoadoutCommand: QueuedLoadoutCommand | null = null;
  private localPlayerNid: number | null = null;

  public constructor() {
    this.ackBuffer = new AckReconciliationBuffer((acceptedAtMs, serverTick) => {
      this.interpolation.observeAckArrival(acceptedAtMs);
      this.serverTimeSync.observeAck(serverTick, acceptedAtMs);
    });

    this.transport = new NetTransportClient(
      ncontext,
      SERVER_TICK_RATE,
      () => {
        this.snapshots.reset();
        this.abilities.reset();
        this.interpolation.reset();
        this.serverTimeSync.reset();
        this.ackBuffer.reset();
        this.queuedLoadoutCommand = null;
      },
      () => {
        // Errors are expected when server is unavailable during local-only workflows.
      }
    );
  }

  public async connect(serverUrl: string, authKey: string): Promise<void> {
    await this.transport.connect(serverUrl, authKey);
  }

  public step(
    delta: number,
    movement: MovementInput,
    orientation: { yaw: number; pitch: number },
    actions: { usePrimaryPressed: boolean; usePrimaryHeld: boolean }
  ): void {
    if (!this.transport.isConnected()) {
      return;
    }

    this.readMessages();
    this.interpolation.update(this.transport.getLatencyMs());
    this.snapshots.applyInterpolatedFrames(
      this.transport.getInterpolatedState(this.interpolation.getInterpolationDelayMs())
    );

    const { sequence, yawDelta } = this.ackBuffer.enqueueInput(delta, movement, orientation);

    const loadoutCommand = this.queuedLoadoutCommand;
    if (loadoutCommand) {
      this.transport.addCommand({
        ntype: NType.LoadoutCommand,
        applySelectedHotbarSlot: loadoutCommand.applySelectedHotbarSlot,
        selectedHotbarSlot: this.clampUnsignedInt(loadoutCommand.selectedHotbarSlot, 0xff),
        applyAssignment: loadoutCommand.applyAssignment,
        assignTargetSlot: this.clampUnsignedInt(loadoutCommand.assignTargetSlot, 0xff),
        assignAbilityId: this.clampUnsignedInt(loadoutCommand.assignAbilityId, 0xffff)
      } satisfies LoadoutCommand);
      this.queuedLoadoutCommand = null;
    }

    this.transport.addCommand({
      ntype: NType.InputCommand,
      sequence,
      forward: movement.forward,
      strafe: movement.strafe,
      jump: movement.jump,
      sprint: movement.sprint,
      usePrimaryPressed: actions.usePrimaryPressed,
      usePrimaryHeld: actions.usePrimaryHeld,
      yaw: orientation.yaw,
      yawDelta,
      pitch: orientation.pitch
    });

    this.transport.flush();
  }

  public queueLoadoutSelection(slot: number): void {
    const queued = this.queuedLoadoutCommand ?? {
      applySelectedHotbarSlot: false,
      selectedHotbarSlot: 0,
      applyAssignment: false,
      assignTargetSlot: 0,
      assignAbilityId: 0
    };
    queued.applySelectedHotbarSlot = true;
    queued.selectedHotbarSlot = slot;
    this.queuedLoadoutCommand = queued;
  }

  public queueLoadoutAssignment(slot: number, abilityId: number): void {
    const queued = this.queuedLoadoutCommand ?? {
      applySelectedHotbarSlot: false,
      selectedHotbarSlot: 0,
      applyAssignment: false,
      assignTargetSlot: 0,
      assignAbilityId: 0
    };
    queued.applyAssignment = true;
    queued.assignTargetSlot = slot;
    queued.assignAbilityId = abilityId;
    this.queuedLoadoutCommand = queued;
  }

  public consumeAbilityEvents(): AbilityEventBatch | null {
    return this.abilities.consumeAbilityEvents();
  }

  public consumeAbilityUseEvents(): AbilityUseEvent[] {
    return this.abilities.consumeAbilityUseEvents();
  }

  public getAbilityCatalog(): AbilityDefinition[] {
    return this.abilities.getAbilityCatalog();
  }

  public getAbilityById(abilityId: number): AbilityDefinition | null {
    return this.abilities.getAbilityById(abilityId);
  }

  public getRemotePlayers(): RemotePlayerState[] {
    return this.snapshots.getRemotePlayers(this.localPlayerNid);
  }

  public getLocalPlayerPose(): RemotePlayerState | null {
    return this.snapshots.getLocalPlayerPose(this.localPlayerNid);
  }

  public getPlatforms(): PlatformState[] {
    return this.snapshots.getPlatforms();
  }

  public getProjectiles(): ProjectileState[] {
    return this.snapshots.getProjectiles();
  }

  public getTrainingDummies(): TrainingDummyState[] {
    return this.snapshots.getTrainingDummies();
  }

  public getConnectionState(): "connected" | "local-only" {
    return this.transport.isConnected() ? "connected" : "local-only";
  }

  public getLocalPlayerNid(): number | null {
    return this.localPlayerNid;
  }

  public isServerGroundedOnPlatform(): boolean {
    return this.ackBuffer.getServerGroundedPlatformPid() >= 0;
  }

  public getServerGroundedPlatformPid(): number {
    return this.ackBuffer.getServerGroundedPlatformPid();
  }

  public getInterpolationDelayMs(): number {
    return this.interpolation.getInterpolationDelayMs();
  }

  public getAckJitterMs(): number {
    return this.interpolation.getAckJitterMs();
  }

  public getEstimatedServerTimeSeconds(nowMs: number = performance.now()): number | null {
    return this.serverTimeSync.getEstimatedServerTimeSeconds(nowMs);
  }

  public syncSentYaw(yaw: number): void {
    this.ackBuffer.syncSentYaw(yaw);
  }

  public shiftPendingInputYaw(deltaYaw: number): void {
    this.ackBuffer.shiftPendingInputYaw(deltaYaw);
  }

  public consumeReconciliationFrame(): ReconciliationFrame | null {
    return this.ackBuffer.consumeReconciliationFrame();
  }

  private readMessages(): void {
    const messages = this.transport.consumeMessages();
    if (messages.length === 0) {
      this.ackBuffer.processBufferedAcks();
      return;
    }

    for (const message of messages) {
      const typed = message as
        | IdentityMessage
        | InputAckMessage
        | AbilityUseMessage
        | undefined;

      if (typed?.ntype === NType.IdentityMessage) {
        this.localPlayerNid = typed.playerNid;
        continue;
      }

      if (typed?.ntype === NType.InputAckMessage) {
        this.ackBuffer.enqueueAckMessage(typed, this.netSimulation);
        continue;
      }

      this.abilities.processMessage(message);
    }

    this.ackBuffer.processBufferedAcks();
  }

  private resolveNetSimulationConfig(): NetSimulationConfig {
    const params = new URLSearchParams(window.location.search);
    const hasNetSimToggle =
      params.get("netsim") === "1" ||
      params.get("netsim") === "true" ||
      params.has("ackDrop") ||
      params.has("ackDelayMs") ||
      params.has("ackJitterMs");
    const ackDropRate = this.clampNumber(this.readQueryNumber(params, "ackDrop", 0), 0, 0.95);
    const ackDelayMs = this.clampNumber(this.readQueryNumber(params, "ackDelayMs", 0), 0, 1000);
    const ackJitterMs = this.clampNumber(this.readQueryNumber(params, "ackJitterMs", 0), 0, 1000);
    const enabled = hasNetSimToggle && (ackDropRate > 0 || ackDelayMs > 0 || ackJitterMs > 0);
    return {
      enabled,
      ackDropRate,
      ackDelayMs,
      ackJitterMs
    };
  }

  private readQueryNumber(params: URLSearchParams, key: string, fallback: number): number {
    const raw = params.get(key);
    if (raw === null) {
      return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private clampUnsignedInt(raw: number, max: number): number {
    if (!Number.isFinite(raw)) {
      return 0;
    }
    const integer = Math.floor(raw);
    return Math.max(0, Math.min(max, integer));
  }
}
