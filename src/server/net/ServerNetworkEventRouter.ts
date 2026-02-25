// Routes network events into auth, command application, and simulation lifecycle hooks.
import { GameSimulation } from "../GameSimulation";
import { NType } from "../../shared/netcode";
import type { TransferResponse } from "../../shared/orchestrator";
import { GUEST_ACCOUNT_ID_BASE, PersistenceService, type PlayerSnapshot } from "../persistence/PersistenceService";
import { ServerNetworkHost } from "./ServerNetworkHost";
import { ServerCommandRouter } from "./ServerCommandRouter";
import type { ServerNetworkUser } from "./ServerNetworkTypes";

export class ServerNetworkEventRouter {
  private readonly commandRouter = new ServerCommandRouter<ServerNetworkUser>();
  private nextGuestAccountId = GUEST_ACCOUNT_ID_BASE;
  private readonly transferDisconnectTimers = new Map<number, ReturnType<typeof setTimeout>>();

  public constructor(
    private readonly networkHost: ServerNetworkHost,
    private readonly simulation: GameSimulation,
    private readonly persistence: PersistenceService
  ) {}

  public drainQueue(): void {
    this.networkHost.drainQueue({
      onUserConnected: (user, payload) => this.handleUserConnected(user, payload),
      onCommandSet: (user, commands) => this.handleCommandSet(user, commands),
      onUserDisconnected: (user) => {
        this.clearTransferDisconnectTimer(user.id);
        this.simulation.removeUser(user);
      }
    });
  }

  private handleCommandSet(user: ServerNetworkUser, commands: unknown[]): void {
    this.commandRouter.route(user, commands, {
      onInputCommands: (inputCommands) => this.simulation.applyInputCommands(user.id, inputCommands),
      onAbilityCommand: (commandUser, command) => this.simulation.applyAbilityCommand(commandUser, command),
      onAbilityCreatorCommand: (commandUser, command) =>
        this.simulation.applyAbilityCreatorCommand(commandUser, command),
      onMapTransferCommand: (commandUser, command) =>
        void this.handleMapTransferCommand(commandUser, command.targetMapInstanceId)
    });
  }

  private handleUserConnected(user: ServerNetworkUser, payload: unknown): void {
    const authKey = (payload as { authKey?: unknown } | undefined)?.authKey;
    const payloadAccountId = (payload as { accountId?: unknown } | undefined)?.accountId;
    const payloadSnapshot = (payload as { playerSnapshot?: unknown } | undefined)?.playerSnapshot;
    if (typeof authKey === "string") {
      user.authKey = authKey;
    }
    if (typeof payloadAccountId === "number" && Number.isFinite(payloadAccountId)) {
      user.accountId = Math.max(1, Math.floor(payloadAccountId));
      const snapshot = this.normalizePlayerSnapshot(payloadSnapshot, user.accountId);
      if (snapshot) {
        this.simulation.injectPendingLoginSnapshot(user.accountId, snapshot);
      }
      this.simulation.addUser(user);
      return;
    }
    const allowGuestAuth = process.env.SERVER_ALLOW_GUEST_AUTH !== "0";
    if ((typeof authKey !== "string" || authKey.length === 0) && allowGuestAuth) {
      user.accountId = this.nextGuestAccountId++;
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
    this.simulation.addUser(user);
  }

  private async handleMapTransferCommand(user: ServerNetworkUser, targetMapRaw: unknown): Promise<void> {
    const targetMapInstanceId =
      typeof targetMapRaw === "string" ? targetMapRaw.trim() : "";
    if (targetMapInstanceId.length === 0) {
      return;
    }
    const fromMapInstanceId = process.env.MAP_INSTANCE_ID ?? "default-1";
    if (targetMapInstanceId === fromMapInstanceId) {
      return;
    }
    const orchestratorUrl = process.env.ORCHESTRATOR_INTERNAL_URL;
    const orchestratorSecret = process.env.ORCH_INTERNAL_RPC_SECRET;
    if (!orchestratorUrl || !orchestratorSecret) {
      return;
    }
    const accountId = user.accountId;
    if (typeof accountId !== "number" || !Number.isFinite(accountId)) {
      return;
    }
    const snapshot = this.simulation.getPlayerSnapshotByUserId(user.id);
    const response = await fetch(`${orchestratorUrl}/orch/request-transfer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orch-secret": orchestratorSecret
      },
      body: JSON.stringify({
        authKey: user.authKey ?? null,
        accountId,
        fromMapInstanceId,
        toMapInstanceId: targetMapInstanceId,
        playerSnapshot: snapshot
      })
    });
    if (!response.ok) {
      return;
    }
    const transfer = (await response.json()) as TransferResponse;
    if (!transfer.ok || !transfer.wsUrl || !transfer.joinTicket || !transfer.mapConfig) {
      return;
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
    }, 200);
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
}
