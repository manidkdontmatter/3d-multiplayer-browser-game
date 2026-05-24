/**
 * Purpose: This file coordinates client-side behavior and presentation, and handles network transport, message flow, or network state.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  alertSeverityFromWireValue,
  coercePlayerSettings,
  coerceRuntimeMapConfig,
  INVENTORY_OP_DROP,
  INVENTORY_OP_DROP_HOTBAR_SLOT,
  INVENTORY_OP_EQUIP,
  INVENTORY_OP_EXECUTE_HOTBAR_SLOT,
  INVENTORY_OP_ASSIGN_HOTBAR_SLOT,
  INVENTORY_OP_CLEAR_HOTBAR_SLOT,
  INVENTORY_OP_MOVE_HOTBAR_SLOT,
  INVENTORY_OP_PICKUP,
  INVENTORY_OP_UNEQUIP,
  INVENTORY_OP_USE,
  hotbarPayloadKindToWireValue,
  equipmentSlotToWireValue,
  upsertItemDefinition,
  type RuntimeMapConfig,
  type AbilityDefinition,
  type EquipmentSlot
} from "../../shared/index";
import {
  NType,
  type AbilityCommand,
  type ReferenceFrameVolumeEnteredMessage,
  type ReferenceFrameVolumeExitedMessage,
  type CreatorCommandWire,
  type CreatorActionResultMessage,
  type ItemCommand,
  type MapTransferCommand,
  type PlayerSettingsCommand,
  type ServerAlertMessage,
  type ServerNetDiagnosticsMessage,
  ncontext
} from "../../shared/netcode";
import { SERVER_TICK_RATE } from "../../shared/config";
import type {
  WorldAnchorState,
  MovementInput,
  ProjectileState,
  RemotePlayerState,
  WorldEntityState,
  AbilityUseEvent
} from "./types";
import { AbilityStateStore } from "./network/AbilityStateStore";
import { CreatorNetworkBridge } from "./network/CreatorNetworkBridge";
import type { CreatorClientState } from "./network/CreatorStateStore";
import type { CreatorPanelCommand } from "../ui/CreatorPanel";
import { InventoryStateStore } from "./network/InventoryStateStore";
import { AckReconciliationBuffer } from "./network/AckReconciliationBuffer";
import { InterpolationController } from "./network/InterpolationController";
import { InboundMessageRouter } from "./network/InboundMessageRouter";
import { NetTransportClient } from "./network/NetTransportClient";
import { SnapshotStore } from "./network/SnapshotStore";
import type {
  AbilityEventBatch,
  AbilityState,
  CreatorActionResultState,
  InventoryActionFeedback,
  InventoryState,
  SettingsState,
  ServerAlertState,
  NetSimulationConfig,
  QueuedAbilityCommand,
  ReconciliationFrame,
  PendingInput,
  MapTransferInstruction
} from "./network/types";

export type { PendingInput, ReconciliationFrame, AbilityState, AbilityEventBatch };

export class NetworkClient {
  private readonly transport: NetTransportClient;
  private readonly snapshots = new SnapshotStore();
  private readonly abilities = new AbilityStateStore();
  private readonly creatorBridge = new CreatorNetworkBridge();
  private readonly inventory = new InventoryStateStore();
  private readonly interpolation = new InterpolationController();
  private readonly ackBuffer: AckReconciliationBuffer;
  private readonly inboundMessageRouter = new InboundMessageRouter();
  private readonly netSimulation = this.resolveNetSimulationConfig();
  private queuedAbilityCommand: QueuedAbilityCommand | null = null;
  private localPlayerNid: number | null = null;
  private serverPlayerCount: number | null = null;
  private serverNetDiagnostics: ServerNetDiagnosticsMessage | null = null;
  private pendingMapTransferInstruction: MapTransferInstruction | null = null;
  private readonly pendingInventoryActionFeedback: InventoryActionFeedback[] = [];
  private readonly pendingCreatorActionResults: CreatorActionResultState[] = [];
  private readonly pendingSettingsState: SettingsState[] = [];
  private readonly pendingServerAlerts: ServerAlertState[] = [];
  private readonly activeReferenceFrameVolumeMembershipKeys = new Set<string>();

  public constructor() {
    this.ackBuffer = new AckReconciliationBuffer((_acceptedAtMs, _serverTick) => {});

    this.transport = new NetTransportClient(
      ncontext,
      SERVER_TICK_RATE,
      () => {
        this.snapshots.reset();
        this.abilities.reset();
        this.creatorBridge.reset();
        this.inventory.reset();
        this.interpolation.reset();
        this.ackBuffer.reset();
        this.queuedAbilityCommand = null;
        this.serverPlayerCount = null;
        this.serverNetDiagnostics = null;
        this.pendingMapTransferInstruction = null;
        this.pendingInventoryActionFeedback.length = 0;
        this.pendingCreatorActionResults.length = 0;
        this.pendingSettingsState.length = 0;
        this.pendingServerAlerts.length = 0;
        this.activeReferenceFrameVolumeMembershipKeys.clear();
      },
      () => {
        // Errors are expected when server is unavailable during local-only workflows.
      }
    );
  }

  public async connect(
    serverUrl: string,
    authKey: string | null,
    options?: { joinTicket?: string | null }
  ): Promise<void> {
    await this.transport.connect(serverUrl, authKey, options);
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

    // Drain generalized creator commands and send as NType 23
    const sessionId = this.creatorBridge.getStateStore().getCurrentSessionId();
    const creatorPayloads = this.creatorBridge.drainCommands(sessionId);
    for (const payload of creatorPayloads) {
      this.transport.addCommand({
        ntype: NType.CreatorCommand,
        commandJson: payload
      } satisfies CreatorCommandWire);
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

  public updateInterpolatedSnapshots(): void {
    if (!this.transport.isConnected()) {
      return;
    }
    this.readMessages();
    this.interpolation.update(this.transport.getLatencyMs());
    const appliedChanges = this.snapshots.applyInterpolatedFrames(
      this.transport.getInterpolatedState(this.interpolation.getInterpolationDelayMs())
    );
    if (appliedChanges > 0) {
      this.interpolation.observeSnapshotArrival(performance.now());
    }
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

  public queueMapTransfer(targetMapInstanceId: string): void {
    if (!this.transport.isConnected()) {
      return;
    }
    const normalized = typeof targetMapInstanceId === "string" ? targetMapInstanceId.trim() : "";
    if (normalized.length === 0) {
      return;
    }
    this.transport.addCommand({
      ntype: NType.MapTransferCommand,
      targetMapInstanceId: normalized
    } satisfies MapTransferCommand);
    this.transport.flush();
  }

  public queuePlayerSettings(settingsJson: string): void {
    if (!this.transport.isConnected()) {
      return;
    }
    this.transport.addCommand({
      ntype: NType.PlayerSettingsCommand,
      settingsJson
    } satisfies PlayerSettingsCommand);
    this.transport.flush();
  }

  public queuePickupWorldItem(pickupNid: number, interactSlot = 0): void {
    this.queueItemCommand({
      action: INVENTORY_OP_PICKUP,
      pickupNid,
      itemInstanceId: 0,
      quantity: 0,
      equipmentSlot: 0,
      sourceSlot: 0,
      targetSlot: 0,
      activationChannel: 0,
      payloadKind: Math.max(0, Math.floor(interactSlot))
    });
  }

  public queueDropInventoryItem(itemInstanceId: number, quantity = 0): void {
    this.queueItemCommand({
      action: INVENTORY_OP_DROP,
      pickupNid: 0,
      itemInstanceId,
      quantity,
      equipmentSlot: 0,
      sourceSlot: 0,
      targetSlot: 0,
      activationChannel: 0,
      payloadKind: 0
    });
  }

  public queueUseInventoryItem(itemInstanceId: number): void {
    this.queueUseInventoryItemWithChannel(itemInstanceId, 0);
  }

  public queueUseInventoryItemWithChannel(itemInstanceId: number, activationChannel: number): void {
    this.queueItemCommand({
      action: INVENTORY_OP_USE,
      pickupNid: 0,
      itemInstanceId,
      quantity: 0,
      equipmentSlot: 0,
      sourceSlot: 0,
      targetSlot: 0,
      activationChannel,
      payloadKind: 0
    });
  }

  public queueEquipInventoryItem(itemInstanceId: number): void {
    this.queueItemCommand({
      action: INVENTORY_OP_EQUIP,
      pickupNid: 0,
      itemInstanceId,
      quantity: 0,
      equipmentSlot: 0,
      sourceSlot: 0,
      targetSlot: 0,
      activationChannel: 0,
      payloadKind: 0
    });
  }

  public queueUnequipInventorySlot(slot: EquipmentSlot): void {
    this.queueItemCommand({
      action: INVENTORY_OP_UNEQUIP,
      pickupNid: 0,
      itemInstanceId: 0,
      quantity: 0,
      equipmentSlot: equipmentSlotToWireValue(slot),
      sourceSlot: 0,
      targetSlot: 0,
      activationChannel: 0,
      payloadKind: 0
    });
  }

  public queueAssignHotbarItemSlot(targetSlot: number, itemInstanceId: number): void {
    this.queueAssignHotbarPayload(targetSlot, "item_instance", itemInstanceId);
  }

  public queueAssignHotbarAbilitySlot(targetSlot: number, abilityId: number): void {
    this.queueAssignHotbarPayload(targetSlot, "ability", abilityId);
  }

  private queueAssignHotbarPayload(targetSlot: number, kind: "item_instance" | "ability" | "action", refId: number): void {
    this.queueItemCommand({
      action: INVENTORY_OP_ASSIGN_HOTBAR_SLOT,
      pickupNid: 0,
      itemInstanceId: refId,
      quantity: 0,
      equipmentSlot: 0,
      sourceSlot: 0,
      targetSlot,
      activationChannel: 0,
      payloadKind: hotbarPayloadKindToWireValue(kind)
    });
  }

  public queueClearHotbarSlot(sourceSlot: number): void {
    this.queueItemCommand({
      action: INVENTORY_OP_CLEAR_HOTBAR_SLOT,
      pickupNid: 0,
      itemInstanceId: 0,
      quantity: 0,
      equipmentSlot: 0,
      sourceSlot,
      targetSlot: 0,
      activationChannel: 0,
      payloadKind: 0
    });
  }

  public queueMoveHotbarSlot(sourceSlot: number, targetSlot: number): void {
    this.queueItemCommand({
      action: INVENTORY_OP_MOVE_HOTBAR_SLOT,
      pickupNid: 0,
      itemInstanceId: 0,
      quantity: 0,
      equipmentSlot: 0,
      sourceSlot,
      targetSlot,
      activationChannel: 0,
      payloadKind: 0
    });
  }

  public queueExecuteHotbarSlot(sourceSlot: number, activationChannel: number): void {
    this.queueItemCommand({
      action: INVENTORY_OP_EXECUTE_HOTBAR_SLOT,
      pickupNid: 0,
      itemInstanceId: 0,
      quantity: 0,
      equipmentSlot: 0,
      sourceSlot,
      targetSlot: 0,
      activationChannel,
      payloadKind: 0
    });
  }

  public queueDropHotbarSlot(sourceSlot: number): void {
    this.queueItemCommand({
      action: INVENTORY_OP_DROP_HOTBAR_SLOT,
      pickupNid: 0,
      itemInstanceId: 0,
      quantity: 0,
      equipmentSlot: 0,
      sourceSlot,
      targetSlot: 0,
      activationChannel: 0,
      payloadKind: 0
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

  public queueCreatorCommand(command: CreatorPanelCommand): void {
    const csid = this.creatorBridge.getStateStore().getCurrentSessionId();
    this.creatorBridge.queueCommand(command, csid);
  }

  public consumeCreatorState(): CreatorClientState | null {
    return this.creatorBridge.consumeState();
  }

  public getCreatorBridge(): CreatorNetworkBridge {
    return this.creatorBridge;
  }

  public getLatestCreatorState(): CreatorClientState | null {
    return this.creatorBridge.getStateStore().getLatestState();
  }

  public consumeInventoryState(): InventoryState | null {
    return this.inventory.consumeState();
  }

  public consumeInventoryActionFeedback(): InventoryActionFeedback[] {
    if (this.pendingInventoryActionFeedback.length <= 0) {
      return [];
    }
    const next = this.pendingInventoryActionFeedback.slice();
    this.pendingInventoryActionFeedback.length = 0;
    return next;
  }

  public consumeCreatorActionResults(): CreatorActionResultState[] {
    if (this.pendingCreatorActionResults.length <= 0) {
      return [];
    }
    const next = this.pendingCreatorActionResults.slice();
    this.pendingCreatorActionResults.length = 0;
    return next;
  }

  public getInventoryState(): InventoryState {
    return this.inventory.getState();
  }

  public consumeSettingsState(): SettingsState | null {
    if (this.pendingSettingsState.length <= 0) {
      return null;
    }
    return this.pendingSettingsState.shift() ?? null;
  }

  public consumeServerAlerts(): ServerAlertState[] {
    if (this.pendingServerAlerts.length <= 0) {
      return [];
    }
    const next = this.pendingServerAlerts.slice();
    this.pendingServerAlerts.length = 0;
    return next;
  }

  public getRemotePlayers(): RemotePlayerState[] {
    return this.snapshots.getRemotePlayers(this.localPlayerNid);
  }

  public getLocalPlayerPose(): RemotePlayerState | null {
    return this.snapshots.getLocalPlayerPose(this.localPlayerNid);
  }

  public getWorldAnchors(): WorldAnchorState[] {
    return this.snapshots.getWorldAnchors();
  }

  public getLocationRoots(): WorldAnchorState[] {
    return this.snapshots.getLocationRoots();
  }

  public getProjectiles(): ProjectileState[] {
    return this.snapshots.getProjectiles();
  }

  public getWorldEntities(): WorldEntityState[] {
    return this.snapshots.getWorldEntities();
  }

  public getConnectionState(): "connected" | "local-only" {
    return this.transport.isConnected() ? "connected" : "local-only";
  }

  public disconnect(reason = "client-stop"): void {
    this.transport.disconnect(reason);
  }

  public getLocalPlayerNid(): number | null {
    return this.localPlayerNid;
  }

  public getServerPlayerCount(): number | null {
    return this.serverPlayerCount;
  }

  public getServerNetDiagnostics(): ServerNetDiagnosticsMessage | null {
    return this.serverNetDiagnostics;
  }

  public consumeMapTransferInstruction(): MapTransferInstruction | null {
    const pending = this.pendingMapTransferInstruction;
    this.pendingMapTransferInstruction = null;
    return pending;
  }

  public isServerGroundedOnPlatform(): boolean {
    return this.ackBuffer.getServerGroundedPlatformPid() >= 0;
  }

  public getServerGroundedPlatformPid(): number {
    return this.ackBuffer.getServerGroundedPlatformPid();
  }

  public getServerCarriedFramePid(): number {
    return this.ackBuffer.getServerCarriedFramePid();
  }

  public getActiveCarrierFramePids(): number[] {
    if (this.activeReferenceFrameVolumeMembershipKeys.size === 0) {
      return [];
    }
    const framePids = new Set<number>();
    for (const key of this.activeReferenceFrameVolumeMembershipKeys) {
      const separator = key.indexOf(":");
      if (separator <= 0) continue;
      const framePid = Number(key.slice(0, separator));
      if (!Number.isFinite(framePid)) continue;
      framePids.add(Math.floor(framePid));
    }
    return Array.from(framePids).sort((a, b) => a - b);
  }

  public getInterpolationDelayMs(): number {
    return this.interpolation.getInterpolationDelayMs();
  }

  public getAckJitterMs(): number {
    return this.interpolation.getAckJitterMs();
  }

  public getInterpolationTuning(): {
    minMs: number;
    maxMs: number;
    baseTicks: number;
    holdMs: number;
    stepMs: number;
  } {
    return this.interpolation.getTuning();
  }

  public setInterpolationTuning(
    tuning: Partial<{ minMs: number; maxMs: number; baseTicks: number; holdMs: number; stepMs: number }>
  ): void {
    this.interpolation.setTuning(tuning);
  }

  public getLatencyMs(): number {
    return this.transport.getLatencyMs();
  }

  public getServerClockOffsetMs(): number {
    return this.transport.getAverageTimeDifferenceMs();
  }

  public getCurrentServerUrl(): string | null {
    return this.transport.getCurrentServerUrl();
  }

  public getEstimatedServerTimeSeconds(nowMs: number = performance.now()): number | null {
    const diff = this.transport.getAverageTimeDifferenceMs();
    if (!Number.isFinite(diff)) {
      return null;
    }
    return Math.max(0, (nowMs - diff) / 1000);
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
      onServerNetDiagnosticsMessage: (message) => {
        this.serverNetDiagnostics = {
          ...message,
          connectedPlayers: this.clampUnsignedInt(message.connectedPlayers, 0xffff),
          windowSeconds: this.clampUnsignedInt(message.windowSeconds, 0xff),
          avgInboundBytesPerSecond: this.sanitizeFiniteMetric(message.avgInboundBytesPerSecond),
          avgOutboundBytesPerSecond: this.sanitizeFiniteMetric(message.avgOutboundBytesPerSecond),
          avgInboundMessagesPerSecond: this.sanitizeFiniteMetric(message.avgInboundMessagesPerSecond),
          avgOutboundMessagesPerSecond: this.sanitizeFiniteMetric(message.avgOutboundMessagesPerSecond),
          p95InboundBytesPerSecond: this.sanitizeFiniteMetric(message.p95InboundBytesPerSecond),
          p95OutboundBytesPerSecond: this.sanitizeFiniteMetric(message.p95OutboundBytesPerSecond),
          p95InboundMessagesPerSecond: this.sanitizeFiniteMetric(message.p95InboundMessagesPerSecond),
          p95OutboundMessagesPerSecond: this.sanitizeFiniteMetric(message.p95OutboundMessagesPerSecond),
          warningMask: this.clampUnsignedInt(message.warningMask, 0xff)
        };
        this.serverPlayerCount = this.serverNetDiagnostics.connectedPlayers;
      },
      onMapTransferMessage: (message) => {
        const wsUrl = typeof message.wsUrl === "string" ? message.wsUrl : "";
        const joinTicket = typeof message.joinTicket === "string" ? message.joinTicket : "";
        if (wsUrl.length === 0 || joinTicket.length === 0) {
          return;
        }
        const mapConfig: RuntimeMapConfig = coerceRuntimeMapConfig({
          mapId: message.mapId,
          instanceId: message.instanceId,
          seed: message.seed,
          groundHalfExtent: message.groundHalfExtent,
          groundHalfThickness: message.groundHalfThickness,
          cubeCount: message.cubeCount
        });
        this.pendingMapTransferInstruction = {
          wsUrl,
          joinTicket,
          mapConfig
        };
      },
      onInventoryStateMessage: (message) => {
        this.inventory.processInventoryJson(message.inventoryJson);
      },
      onItemDefinitionMessage: (message) => {
        if (this.clampUnsignedInt((message as { version?: number }).version ?? 0, 0xff) !== 1) {
          return;
        }
        try {
          const parsed = JSON.parse(message.itemJson) as unknown;
          upsertItemDefinition(parsed);
        } catch {
          // Ignore malformed item definition messages.
        }
      },
      onReferenceFrameVolumeEnteredMessage: (message) => {
        this.applyReferenceFrameVolumeEntered(message);
      },
      onReferenceFrameVolumeExitedMessage: (message) => {
        this.applyReferenceFrameVolumeExited(message);
      },
      onInventoryActionResultMessage: (message) => {
        this.pendingInventoryActionFeedback.push({
          action: this.clampUnsignedInt(message.action, 0xff),
          ok: Boolean(message.ok),
          reason: typeof message.reason === "string" ? message.reason : "unknown"
        });
      },
      onCreatorActionResultMessage: (message: CreatorActionResultMessage) => {
        if (this.clampUnsignedInt((message as { version?: number }).version ?? 0, 0xff) !== 1) {
          return;
        }
        this.pendingCreatorActionResults.push({
          ok: Boolean(message.ok),
          message: typeof message.message === "string" ? message.message : "",
          createdBlueprintId: this.clampUnsignedInt(message.createdBlueprintId, 0xffff),
          createdItemInstanceId: this.clampUnsignedInt(message.createdItemInstanceId, 0x7fffffff)
        });
      },
      onPlayerSettingsMessage: (message) => {
        try {
          this.pendingSettingsState.push({
            settings: coercePlayerSettings(JSON.parse(message.settingsJson))
          });
        } catch {
          this.pendingSettingsState.push({
            settings: coercePlayerSettings(null)
          });
        }
      },
      onServerAlertMessage: (message: ServerAlertMessage) => {
        const text = typeof message.text === "string" ? message.text.trim() : "";
        if (text.length <= 0) {
          return;
        }
        this.pendingServerAlerts.push({
          text,
          severity: alertSeverityFromWireValue(message.severity)
        });
      },
      onUnhandledMessage: (message) => {
        if (this.abilities.processMessage(message)) {
          return;
        }
        this.creatorBridge.processMessage(message);
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

  private queueItemCommand(command: Omit<ItemCommand, "ntype">): void {
    if (!this.transport.isConnected()) {
      return;
    }
    this.transport.addCommand({
      ntype: NType.ItemCommand,
      action: this.clampUnsignedInt(command.action, 0xff),
      pickupNid: this.clampUnsignedInt(command.pickupNid, 0xffff),
      itemInstanceId: this.clampUnsignedInt(command.itemInstanceId, 0xffffffff),
      quantity: this.clampUnsignedInt(command.quantity, 0xffff),
      equipmentSlot: this.clampUnsignedInt(command.equipmentSlot, 0xff),
      sourceSlot: this.clampUnsignedInt(command.sourceSlot, 0xff),
      targetSlot: this.clampUnsignedInt(command.targetSlot, 0xff),
      activationChannel: this.clampUnsignedInt(command.activationChannel, 0xff),
      payloadKind: this.clampUnsignedInt(command.payloadKind, 0xff)
    } satisfies ItemCommand);
    this.transport.flush();
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

  private sanitizeFiniteMetric(raw: number): number {
    if (!Number.isFinite(raw)) {
      return 0;
    }
    return Math.max(0, raw);
  }

  private applyReferenceFrameVolumeEntered(message: ReferenceFrameVolumeEnteredMessage): void {
    const framePid = Math.floor(Number(message.framePid));
    const volumeId = typeof message.volumeId === "string" ? message.volumeId : "";
    if (!Number.isFinite(framePid) || volumeId.length === 0) {
      return;
    }
    this.activeReferenceFrameVolumeMembershipKeys.add(`${framePid}:${volumeId}`);
  }

  private applyReferenceFrameVolumeExited(message: ReferenceFrameVolumeExitedMessage): void {
    const framePid = Math.floor(Number(message.framePid));
    const volumeId = typeof message.volumeId === "string" ? message.volumeId : "";
    if (!Number.isFinite(framePid) || volumeId.length === 0) {
      return;
    }
    this.activeReferenceFrameVolumeMembershipKeys.delete(`${framePid}:${volumeId}`);
  }
}

