// Client network facade handling commands, snapshots, interpolation, and ability-state sync.
import {
  coerceRuntimeMapConfig,
  ITEM_COMMAND_DROP,
  ITEM_COMMAND_EQUIP,
  ITEM_COMMAND_PICKUP,
  ITEM_COMMAND_UNEQUIP,
  ITEM_COMMAND_USE,
  equipmentSlotToWireValue,
  type RuntimeMapConfig,
  type AbilityDefinition,
  type EquipmentSlot
} from "../../shared/index";
import {
  NType,
  type AbilityCommand,
  type CreatorCommandWire,
  type ItemCommand,
  type MapTransferCommand,
  ncontext
} from "../../shared/netcode";
import { SERVER_TICK_RATE } from "../../shared/config";
import type {
  LocationRootState,
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
  InventoryState,
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
  private pendingMapTransferInstruction: MapTransferInstruction | null = null;

  public constructor() {
    this.ackBuffer = new AckReconciliationBuffer((acceptedAtMs, _serverTick) => {
      this.interpolation.observeAckArrival(acceptedAtMs);
    });

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
        this.pendingMapTransferInstruction = null;
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

  public queuePickupWorldItem(worldItemNid: number): void {
    this.queueItemCommand({
      action: ITEM_COMMAND_PICKUP,
      worldItemNid,
      itemInstanceId: 0,
      quantity: 0,
      equipmentSlot: 0
    });
  }

  public queueDropInventoryItem(itemInstanceId: number, quantity = 0): void {
    this.queueItemCommand({
      action: ITEM_COMMAND_DROP,
      worldItemNid: 0,
      itemInstanceId,
      quantity,
      equipmentSlot: 0
    });
  }

  public queueUseInventoryItem(itemInstanceId: number): void {
    this.queueItemCommand({
      action: ITEM_COMMAND_USE,
      worldItemNid: 0,
      itemInstanceId,
      quantity: 0,
      equipmentSlot: 0
    });
  }

  public queueEquipInventoryItem(itemInstanceId: number): void {
    this.queueItemCommand({
      action: ITEM_COMMAND_EQUIP,
      worldItemNid: 0,
      itemInstanceId,
      quantity: 0,
      equipmentSlot: 0
    });
  }

  public queueUnequipInventorySlot(slot: EquipmentSlot): void {
    this.queueItemCommand({
      action: ITEM_COMMAND_UNEQUIP,
      worldItemNid: 0,
      itemInstanceId: 0,
      quantity: 0,
      equipmentSlot: equipmentSlotToWireValue(slot)
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

  public consumeInventoryState(): InventoryState | null {
    return this.inventory.consumeState();
  }

  public getInventoryState(): InventoryState {
    return this.inventory.getState();
  }

  public getRemotePlayers(): RemotePlayerState[] {
    return this.snapshots.getRemotePlayers(this.localPlayerNid);
  }

  public getLocalPlayerPose(): RemotePlayerState | null {
    return this.snapshots.getLocalPlayerPose(this.localPlayerNid);
  }

  public getLocationRoots(): LocationRootState[] {
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

  public getLocalPlayerNid(): number | null {
    return this.localPlayerNid;
  }

  public getServerPlayerCount(): number | null {
    return this.serverPlayerCount;
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

  public getInterpolationDelayMs(): number {
    return this.interpolation.getInterpolationDelayMs();
  }

  public getAckJitterMs(): number {
    return this.interpolation.getAckJitterMs();
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
      worldItemNid: this.clampUnsignedInt(command.worldItemNid, 0xffff),
      itemInstanceId: this.clampUnsignedInt(command.itemInstanceId, 0xffffffff),
      quantity: this.clampUnsignedInt(command.quantity, 0xffff),
      equipmentSlot: this.clampUnsignedInt(command.equipmentSlot, 0xff)
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
}
