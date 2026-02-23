import { GameSimulation } from "../GameSimulation";
import { PersistenceService } from "../persistence/PersistenceService";
import { ServerNetworkHost } from "./ServerNetworkHost";
import type { ServerNetworkUser } from "./ServerNetworkTypes";

export class ServerNetworkEventRouter {
  public constructor(
    private readonly networkHost: ServerNetworkHost,
    private readonly simulation: GameSimulation,
    private readonly persistence: PersistenceService
  ) {}

  public drainQueue(): void {
    this.networkHost.drainQueue({
      onUserConnected: (user, payload) => this.handleUserConnected(user, payload),
      onCommandSet: (user, commands) => this.simulation.applyCommands(user, commands),
      onUserDisconnected: (user) => this.simulation.removeUser(user)
    });
  }

  private handleUserConnected(user: ServerNetworkUser, payload: unknown): void {
    const authKey = (payload as { authKey?: unknown } | undefined)?.authKey;
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
