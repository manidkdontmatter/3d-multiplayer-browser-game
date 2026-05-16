// Routes network events into auth, command application, and simulation lifecycle hooks.
import { GameSimulation } from "../GameSimulation";
import type { InventoryStateSnapshot } from "../../shared/items";
import { NType } from "../../shared/netcode";
import { MapProcessIpcChannel } from "../ipc/MapProcessIpcChannel";
import { GUEST_ACCOUNT_ID_BASE, PersistenceService, type PlayerSnapshot } from "../persistence/PersistenceService";
import { ServerNetworkHost } from "./ServerNetworkHost";
import { ServerCommandRouter } from "./ServerCommandRouter";
import type { ServerNetworkUser } from "./ServerNetworkTypes";

const MAP_TRANSFER_DISCONNECT_DELAY_MS = 800;
const MAX_CREATOR_COMMAND_JSON_BYTES = 16384;
const MAX_MAP_TRANSFER_TARGET_ID_CHARS = 256;

export class ServerNetworkEventRouter {
  private readonly commandRouter = new ServerCommandRouter<ServerNetworkUser>();
  private nextGuestAccountId = GUEST_ACCOUNT_ID_BASE;
  private readonly transferDisconnectTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly connectedUsersByAccountId = new Map<number, ServerNetworkUser>();

  public constructor(
    private readonly networkHost: ServerNetworkHost,
    private readonly simulation: GameSimulation,
    private readonly persistence: PersistenceService,
    private readonly ipcChannel: MapProcessIpcChannel | null = null
  ) {}

  public drainQueue(): void {
    this.networkHost.drainQueue({
      onUserConnected: (user, payload) => this.handleUserConnected(user, payload),
      onCommandSet: (user, commands) => this.handleCommandSet(user, commands),
      onUserDisconnected: (user) => {
        this.clearTransferDisconnectTimer(user.id);
        if (typeof user.accountId === "number" && Number.isFinite(user.accountId)) {
          const existing = this.connectedUsersByAccountId.get(user.accountId);
          if (existing?.id === user.id) {
            this.connectedUsersByAccountId.delete(user.accountId);
          }
        }
        user.pendingTransferId = null;
        this.simulation.removeUser(user);
      }
    });
  }

  private handleCommandSet(user: ServerNetworkUser, commands: unknown[]): void {
    this.commandRouter.route(user, commands, {
      onInputCommands: (inputCommands) => this.simulation.applyInputCommands(user.id, inputCommands),
      onAbilityCommand: (commandUser, command) => this.simulation.applyAbilityCommand(commandUser, command),
      onItemCommand: (commandUser, command) =>
        this.simulation.applyItemCommand(commandUser, command),
      onMapTransferCommand: (commandUser, command) =>
        void this.handleMapTransferCommand(commandUser, command.targetMapInstanceId),
      onCreatorCommand: (commandUser, command) => {
        if (typeof command.commandJson !== "string" || command.commandJson.length > MAX_CREATOR_COMMAND_JSON_BYTES) {
          console.warn("[server] creator command too large, dropped");
          return;
        }
        try {
          const payload = JSON.parse(command.commandJson) as {
            sessionId: number;
            sequence: number;
            actions: Array<Record<string, unknown>>;
          };
          const cmd: Record<string, unknown> = {
            sessionId: payload.sessionId,
            sequence: payload.sequence
          };
          for (const action of payload.actions) {
            if (action.kind === "apply_name") { cmd.applyName = true; cmd.name = action.name; }
            if (action.kind === "select_base_archetype") { cmd.selectBaseArchetype = true; cmd.baseArchetypeId = action.archetypeId; }
            if (action.kind === "allocate_stat") { cmd.allocateStat = true; cmd.statId = action.statId; cmd.statDelta = action.delta; }
            if (action.kind === "toggle_trait") { cmd.toggleTrait = true; cmd.traitId = action.traitId; }
            if (action.kind === "submit_create") { cmd.submitCreate = true; }
            if (action.kind === "forget") { cmd.forgetArchetypeId = action.archetypeId; }
          }
          this.simulation.applyCreatorCommand(commandUser, cmd as {
            sessionId: number;
            sequence: number;
            applyName?: boolean;
            name?: string;
            selectBaseArchetype?: boolean;
            baseArchetypeId?: number;
            allocateStat?: boolean;
            statId?: string;
            statDelta?: number;
            toggleTrait?: boolean;
            traitId?: string;
            submitCreate?: boolean;
            forgetArchetypeId?: number;
          });
        } catch (error) {
          console.warn("[server] malformed creator command:", error);
        }
      }
    });
  }

  private handleUserConnected(user: ServerNetworkUser, payload: unknown): void {
    const authKey = (payload as { authKey?: unknown } | undefined)?.authKey;
    const payloadAccountId = (payload as { accountId?: unknown } | undefined)?.accountId;
    const payloadSnapshot = (payload as { playerSnapshot?: unknown } | undefined)?.playerSnapshot;
    const payloadInventory = (payload as { inventoryState?: unknown } | undefined)?.inventoryState;
    const payloadTransferId = (payload as { transferId?: unknown } | undefined)?.transferId;
    if (typeof authKey === "string") {
      user.authKey = authKey;
    }
    if (typeof payloadAccountId === "number" && Number.isFinite(payloadAccountId)) {
      user.accountId = Math.max(1, Math.floor(payloadAccountId));
      this.connectedUsersByAccountId.set(user.accountId, user);
      const snapshot = this.normalizePlayerSnapshot(payloadSnapshot, user.accountId);
      if (snapshot) {
        this.simulation.injectPendingLoginSnapshot(user.accountId, snapshot);
      }
      const inventoryState = this.normalizeInventorySnapshot(payloadInventory);
      if (inventoryState) {
        this.simulation.injectPendingInventorySnapshot(user.accountId, inventoryState);
      }
      this.simulation.addUser(user);
      if (typeof payloadTransferId === "string" && payloadTransferId.length > 0) {
        void this.reportTransferCompleted(payloadTransferId);
      }
      return;
    }
    const allowGuestAuth = process.env.SERVER_ALLOW_GUEST_AUTH !== "0";
    if ((typeof authKey !== "string" || authKey.length === 0) && allowGuestAuth) {
      user.accountId = this.nextGuestAccountId++;
      this.connectedUsersByAccountId.set(user.accountId, user);
      this.simulation.addUser(user);
      return;
    }

    const auth = this.persistence.authenticateOrCreate(authKey, user.remoteAddress);
    if (!auth.ok || !auth.accountId) {
      this.disconnectUser(user, {
        code: auth.code,
        retryAfterMs: auth.retryAfterMs
      });
      return;
    }

    user.accountId = auth.accountId;
    this.connectedUsersByAccountId.set(user.accountId, user);
    this.simulation.addUser(user);
  }

  private async handleMapTransferCommand(user: ServerNetworkUser, targetMapRaw: unknown): Promise<void> {
    const targetMapInstanceId =
      typeof targetMapRaw === "string" ? targetMapRaw.trim() : "";
    if (targetMapInstanceId.length === 0 || targetMapInstanceId.length > MAX_MAP_TRANSFER_TARGET_ID_CHARS) {
      return;
    }
    const fromMapInstanceId = process.env.MAP_INSTANCE_ID ?? "default-1";
    if (targetMapInstanceId === fromMapInstanceId) {
      return;
    }
    if (!this.ipcChannel?.isAvailable()) {
      return;
    }
    const accountId = user.accountId;
    if (typeof accountId !== "number" || !Number.isFinite(accountId)) {
      return;
    }
    const snapshot = this.simulation.getPlayerSnapshotByUserId(user.id);
    const inventoryState = this.simulation.getInventorySnapshotByAccountId(accountId);
    const transfer = await this.ipcChannel.request("RequestTransfer", {
        authKey: user.authKey ?? null,
        accountId,
        fromMapInstanceId,
        toMapInstanceId: targetMapInstanceId,
        playerSnapshot: snapshot,
        inventoryState
      });
    if (!transfer.ok || !transfer.wsUrl || !transfer.joinTicket || !transfer.mapConfig) {
      return;
    }
    if (typeof transfer.transferId === "string" && transfer.transferId.length > 0) {
      user.pendingTransferId = transfer.transferId;
    }
    user.queueMessage({
      ntype: NType.MapTransferMessage,
      wsUrl: transfer.wsUrl,
      joinTicket: transfer.joinTicket,
      mapId: transfer.mapConfig.mapId,
      instanceId: transfer.mapConfig.instanceId,
      seed: transfer.mapConfig.seed,
      groundHalfExtent: transfer.mapConfig.groundHalfExtent,
      groundHalfThickness: transfer.mapConfig.groundHalfThickness,
      cubeCount: transfer.mapConfig.cubeCount
    });
    this.scheduleTransferDisconnect(user, targetMapInstanceId);
  }

  private normalizePlayerSnapshot(raw: unknown, fallbackAccountId: number): PlayerSnapshot | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const value = raw as Record<string, unknown>;
    const readNumber = (key: string, fallback = 0): number => {
      const v = value[key];
      return typeof v === "number" && Number.isFinite(v) ? v : fallback;
    };
    const hotbarRaw = Array.isArray(value.hotbarAbilityIds) ? value.hotbarAbilityIds : [];
    const hotbarAbilityIds = hotbarRaw.map((entry) =>
      typeof entry === "number" && Number.isFinite(entry) ? Math.max(0, Math.floor(entry)) : 0
    );
    return {
      accountId:
        typeof value.accountId === "number" && Number.isFinite(value.accountId)
          ? Math.max(1, Math.floor(value.accountId))
          : fallbackAccountId,
      x: readNumber("x"),
      y: readNumber("y"),
      z: readNumber("z"),
      yaw: readNumber("yaw"),
      pitch: readNumber("pitch"),
      vx: readNumber("vx"),
      vy: readNumber("vy"),
      vz: readNumber("vz"),
      health: Math.max(0, Math.floor(readNumber("health", 100))),
      primaryMouseSlot: Math.max(0, Math.floor(readNumber("primaryMouseSlot", 0))),
      secondaryMouseSlot: Math.max(0, Math.floor(readNumber("secondaryMouseSlot", 1))),
      hotbarAbilityIds
    };
  }

  private normalizeInventorySnapshot(raw: unknown): InventoryStateSnapshot | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const value = raw as InventoryStateSnapshot;
    if (!Array.isArray(value.items)) {
      return null;
    }
    return value;
  }

  private disconnectUser(user: ServerNetworkUser, reason: unknown): void {
    try {
      user.networkAdapter?.disconnect?.(user, reason);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text.includes("Invalid access of closed uWS.WebSocket/SSLWebSocket")) {
        return;
      }
      console.warn("[server] failed to disconnect rejected user", error);
    }
  }

  private scheduleTransferDisconnect(user: ServerNetworkUser, targetMapInstanceId: string): void {
    this.clearTransferDisconnectTimer(user.id);
    const timer = setTimeout(() => {
      this.clearTransferDisconnectTimer(user.id);
      this.disconnectUser(user, {
        code: "map_transfer",
        toMapInstanceId: targetMapInstanceId
      });
    }, MAP_TRANSFER_DISCONNECT_DELAY_MS);
    this.transferDisconnectTimers.set(user.id, timer);
  }

  private clearTransferDisconnectTimer(userId: number): void {
    const timer = this.transferDisconnectTimers.get(userId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.transferDisconnectTimers.delete(userId);
  }

  private async reportTransferCompleted(transferId: string): Promise<void> {
    if (!this.ipcChannel?.isAvailable()) {
      return;
    }
    try {
      this.ipcChannel.emit("TransferCompleted", {
        transferId,
        instanceId: process.env.MAP_INSTANCE_ID ?? "default-1"
      });
    } catch (error) {
      console.warn("[server] transfer completion report failed", error);
    }
  }

  public releaseAuthorityForTransfer(accountId: number, transferId: string): boolean {
    const user = this.connectedUsersByAccountId.get(Math.max(1, Math.floor(accountId)));
    if (!user) {
      return true;
    }
    this.clearTransferDisconnectTimer(user.id);
    user.pendingTransferId = transferId;
    this.connectedUsersByAccountId.delete(accountId);
    this.simulation.removeUser(user);
    this.disconnectUser(user, {
      code: "map_transfer_release",
      transferId
    });
    return true;
  }
}
