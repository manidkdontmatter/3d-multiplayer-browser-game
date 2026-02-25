// Routes network events into auth, command application, and simulation lifecycle hooks.
import { GameSimulation } from "../GameSimulation";
import { GUEST_ACCOUNT_ID_BASE, PersistenceService } from "../persistence/PersistenceService";
import { ServerNetworkHost } from "./ServerNetworkHost";
import { ServerCommandRouter } from "./ServerCommandRouter";
import type { ServerNetworkUser } from "./ServerNetworkTypes";

export class ServerNetworkEventRouter {
  private readonly commandRouter = new ServerCommandRouter<ServerNetworkUser>();
  private nextGuestAccountId = GUEST_ACCOUNT_ID_BASE;

  public constructor(
    private readonly networkHost: ServerNetworkHost,
    private readonly simulation: GameSimulation,
    private readonly persistence: PersistenceService
  ) {}

  public drainQueue(): void {
    this.networkHost.drainQueue({
      onUserConnected: (user, payload) => this.handleUserConnected(user, payload),
      onCommandSet: (user, commands) => this.handleCommandSet(user, commands),
      onUserDisconnected: (user) => this.simulation.removeUser(user)
    });
  }

  private handleCommandSet(user: ServerNetworkUser, commands: unknown[]): void {
    this.commandRouter.route(user, commands, {
      onInputCommands: (inputCommands) => this.simulation.applyInputCommands(user.id, inputCommands),
      onAbilityCommand: (commandUser, command) => this.simulation.applyAbilityCommand(commandUser, command),
      onAbilityCreatorCommand: (commandUser, command) =>
        this.simulation.applyAbilityCreatorCommand(commandUser, command)
    });
  }

  private handleUserConnected(user: ServerNetworkUser, payload: unknown): void {
    const authKey = (payload as { authKey?: unknown } | undefined)?.authKey;
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

  private disconnectUser(user: ServerNetworkUser, reason: unknown): void {
    try {
      user.networkAdapter?.disconnect?.(user, reason);
    } catch (error) {
      console.warn("[server] failed to disconnect rejected user", error);
    }
  }
}
