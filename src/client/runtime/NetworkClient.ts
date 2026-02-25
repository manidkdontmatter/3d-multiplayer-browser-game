// Client network facade handling commands, snapshots, interpolation, and ability-state sync.
import {
  type AbilityDefinition
} from "../../shared/index";
import {
  NType,
  type AbilityCommand,
  type AbilityCreatorCommand,
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
import { AbilityCreatorStateStore } from "./network/AbilityCreatorStateStore";
import { AckReconciliationBuffer } from "./network/AckReconciliationBuffer";
import { InterpolationController } from "./network/InterpolationController";
import { InboundMessageRouter } from "./network/InboundMessageRouter";
import { NetTransportClient } from "./network/NetTransportClient";
import { ServerTimeSync } from "./network/ServerTimeSync";
import { SnapshotStore } from "./network/SnapshotStore";
import type {
  AbilityEventBatch,
  AbilityCreatorState,
  QueuedAbilityCreatorCommand,
  AbilityState,
  NetSimulationConfig,
  QueuedAbilityCommand,
  ReconciliationFrame,
  PendingInput
} from "./network/types";

export type { PendingInput, ReconciliationFrame, AbilityState, AbilityEventBatch };

export class NetworkClient {
  private readonly transport: NetTransportClient;
  private readonly snapshots = new SnapshotStore();
  private readonly abilities = new AbilityStateStore();
  private readonly abilityCreator = new AbilityCreatorStateStore();
  private readonly interpolation = new InterpolationController();
  private readonly serverTimeSync = new ServerTimeSync();
  private readonly ackBuffer: AckReconciliationBuffer;
  private readonly inboundMessageRouter = new InboundMessageRouter();
  private readonly netSimulation = this.resolveNetSimulationConfig();
  private queuedAbilityCommand: QueuedAbilityCommand | null = null;
  private readonly queuedAbilityCreatorCommands: QueuedAbilityCreatorCommand[] = [];
  private nextAbilityCreatorSequence = 1;
  private localPlayerNid: number | null = null;
  private serverPlayerCount: number | null = null;

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
        this.abilityCreator.reset();
        this.interpolation.reset();
        this.serverTimeSync.reset();
        this.ackBuffer.reset();
        this.queuedAbilityCommand = null;
        this.queuedAbilityCreatorCommands.length = 0;
        this.nextAbilityCreatorSequence = 1;
        this.serverPlayerCount = null;
      },
      () => {
        // Errors are expected when server is unavailable during local-only workflows.
      }
    );
  }

  public async connect(serverUrl: string, authKey: string | null): Promise<void> {
    await this.transport.connect(serverUrl, authKey);
  }

  public step(
    delta: number,
    movement: MovementInput,
    orientation: { yaw: number; pitch: number },
    actions: {
      usePrimaryPressed: boolean;
      usePrimaryHeld: boolean;
      useSecondaryPressed: boolean;
      useSecondaryHeld: boolean;
      castSlotPressed: boolean;
      castSlotIndex: number;
    }
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

    const abilityCommand = this.queuedAbilityCommand;
    if (abilityCommand) {
      this.transport.addCommand({
        ntype: NType.AbilityCommand,
        applyAssignment: abilityCommand.applyAssignment,
        assignTargetSlot: this.clampUnsignedInt(abilityCommand.assignTargetSlot, 0xff),
        assignAbilityId: this.clampUnsignedInt(abilityCommand.assignAbilityId, 0xffff),
        applyPrimaryMouseSlot: abilityCommand.applyPrimaryMouseSlot,
        primaryMouseSlot: this.clampUnsignedInt(abilityCommand.primaryMouseSlot, 0xff),
        applySecondaryMouseSlot: abilityCommand.applySecondaryMouseSlot,
        secondaryMouseSlot: this.clampUnsignedInt(abilityCommand.secondaryMouseSlot, 0xff),
        applyForgetAbility: abilityCommand.applyForgetAbility,
        forgetAbilityId: this.clampUnsignedInt(abilityCommand.forgetAbilityId, 0xffff)
      } satisfies AbilityCommand);
      this.queuedAbilityCommand = null;
    }

    if (this.queuedAbilityCreatorCommands.length > 0) {
      const drained = this.queuedAbilityCreatorCommands.splice(0, this.queuedAbilityCreatorCommands.length);
      for (const creatorCommand of drained) {
        this.transport.addCommand({
          ntype: NType.AbilityCreatorCommand,
          sessionId: this.clampUnsignedInt(creatorCommand.sessionId, 0xffff),
          sequence: this.clampUnsignedInt(creatorCommand.sequence, 0xffff),
          applyName: creatorCommand.applyName,
          abilityName: creatorCommand.abilityName,
          applyType: creatorCommand.applyType,
          abilityType: this.clampUnsignedInt(creatorCommand.abilityType, 0xff),
          applyTier: creatorCommand.applyTier,
          tier: this.clampUnsignedInt(creatorCommand.tier, 0xff),
          incrementExampleStat: creatorCommand.incrementExampleStat,
          decrementExampleStat: creatorCommand.decrementExampleStat,
          applyExampleUpsideEnabled: creatorCommand.applyExampleUpsideEnabled,
          exampleUpsideEnabled: creatorCommand.exampleUpsideEnabled,
          applyExampleDownsideEnabled: creatorCommand.applyExampleDownsideEnabled,
          exampleDownsideEnabled: creatorCommand.exampleDownsideEnabled,
          applyTemplateAbilityId: creatorCommand.applyTemplateAbilityId,
          templateAbilityId: this.clampUnsignedInt(creatorCommand.templateAbilityId, 0xffff),
          submitCreate: creatorCommand.submitCreate
        } satisfies AbilityCreatorCommand);
      }
    }

    this.transport.addCommand({
      ntype: NType.InputCommand,
      sequence,
      forward: movement.forward,
      strafe: movement.strafe,
      jump: movement.jump,
      toggleFlyPressed: movement.toggleFlyPressed,
      sprint: movement.sprint,
      usePrimaryPressed: actions.usePrimaryPressed,
      usePrimaryHeld: actions.usePrimaryHeld,
      useSecondaryPressed: actions.useSecondaryPressed,
      useSecondaryHeld: actions.useSecondaryHeld,
      castSlotPressed: actions.castSlotPressed,
      castSlotIndex: this.clampUnsignedInt(actions.castSlotIndex, 0xff),
      yaw: orientation.yaw,
      yawDelta,
      pitch: orientation.pitch
    });

    this.transport.flush();
  }

  public queueHotbarAssignment(slot: number, abilityId: number): void {
    const queued = this.getOrCreateQueuedAbilityCommand();
    queued.applyAssignment = true;
    queued.assignTargetSlot = slot;
    queued.assignAbilityId = abilityId;
    this.queuedAbilityCommand = queued;
  }

  public queuePrimaryMouseSlot(slot: number): void {
    const queued = this.getOrCreateQueuedAbilityCommand();
    queued.applyPrimaryMouseSlot = true;
    queued.primaryMouseSlot = slot;
    this.queuedAbilityCommand = queued;
  }

  public queueSecondaryMouseSlot(slot: number): void {
    const queued = this.getOrCreateQueuedAbilityCommand();
    queued.applySecondaryMouseSlot = true;
    queued.secondaryMouseSlot = slot;
    this.queuedAbilityCommand = queued;
  }

  public queueForgetAbility(abilityId: number): void {
    const queued = this.getOrCreateQueuedAbilityCommand();
    queued.applyForgetAbility = true;
    queued.forgetAbilityId = abilityId;
    this.queuedAbilityCommand = queued;
  }

  public queueAbilityCreatorCommand(command: {
    applyName?: boolean;
    abilityName?: string;
    applyType?: boolean;
    abilityType?: number;
    applyTier?: boolean;
    tier?: number;
    incrementExampleStat?: boolean;
    decrementExampleStat?: boolean;
    applyExampleUpsideEnabled?: boolean;
    exampleUpsideEnabled?: boolean;
    applyExampleDownsideEnabled?: boolean;
    exampleDownsideEnabled?: boolean;
    applyTemplateAbilityId?: boolean;
    templateAbilityId?: number;
    submitCreate?: boolean;
  }): void {
    if (!this.transport.isConnected()) {
      return;
    }
    const nextSequence = this.nextAbilityCreatorSequence;
    this.nextAbilityCreatorSequence = (this.nextAbilityCreatorSequence % 0xffff) + 1;
    this.queuedAbilityCreatorCommands.push({
      sessionId: this.abilityCreator.getCurrentSessionId(),
      sequence: nextSequence,
      applyName: Boolean(command.applyName),
      abilityName: typeof command.abilityName === "string" ? command.abilityName : "",
      applyType: Boolean(command.applyType),
      abilityType: Number.isFinite(command.abilityType) ? Number(command.abilityType) : 0,
      applyTier: Boolean(command.applyTier),
      tier: Number.isFinite(command.tier) ? Number(command.tier) : 0,
      incrementExampleStat: Boolean(command.incrementExampleStat),
      decrementExampleStat: Boolean(command.decrementExampleStat),
      applyExampleUpsideEnabled: Boolean(command.applyExampleUpsideEnabled),
      exampleUpsideEnabled: Boolean(command.exampleUpsideEnabled),
      applyExampleDownsideEnabled: Boolean(command.applyExampleDownsideEnabled),
      exampleDownsideEnabled: Boolean(command.exampleDownsideEnabled),
      applyTemplateAbilityId: Boolean(command.applyTemplateAbilityId),
      templateAbilityId: Number.isFinite(command.templateAbilityId) ? Number(command.templateAbilityId) : 0,
      submitCreate: Boolean(command.submitCreate)
    });
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

  public getOwnedAbilityIds(): number[] {
    return this.abilities.getOwnedAbilityIds();
  }

  public consumeAbilityCreatorState(): AbilityCreatorState | null {
    return this.abilityCreator.consumeState();
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

  public getServerPlayerCount(): number | null {
    return this.serverPlayerCount;
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

    this.inboundMessageRouter.route(messages, {
      onIdentityMessage: (message) => {
        this.localPlayerNid = message.playerNid;
      },
      onInputAckMessage: (message) => {
        this.ackBuffer.enqueueAckMessage(message, this.netSimulation);
      },
      onServerPopulationMessage: (message) => {
        const raw = Number(message.onlinePlayers);
        this.serverPlayerCount = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : null;
      },
      onUnhandledMessage: (message) => {
        if (this.abilities.processMessage(message)) {
          return;
        }
        this.abilityCreator.processMessage(message);
      }
    });

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

  private getOrCreateQueuedAbilityCommand(): QueuedAbilityCommand {
    return (
      this.queuedAbilityCommand ?? {
        applyAssignment: false,
        assignTargetSlot: 0,
        assignAbilityId: 0,
        applyPrimaryMouseSlot: false,
        primaryMouseSlot: 0,
        applySecondaryMouseSlot: false,
        secondaryMouseSlot: 1,
        applyForgetAbility: false,
        forgetAbilityId: 0
      }
    );
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
