/**
 * Purpose: This file dispatches server-authored alert messages to one or more connected users.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { alertSeverityToWireValue, coerceAlertSeverity, type AlertSeverity } from "../../shared/alerts";
import { NType } from "../../shared/netcode";

export interface AlertDispatchUser {
  id: number;
  accountId?: number;
  queueMessage: (message: unknown) => void;
}

export class ServerAlertDispatcher<TUser extends AlertDispatchUser> {
  public constructor(private readonly getUsers: () => Iterable<TUser>) {}

  public queueForUserId(userId: number, text: string, severity: AlertSeverity = "info"): void {
    if (!Number.isFinite(userId)) {
      return;
    }
    const targetUserId = Math.max(0, Math.floor(userId));
    for (const user of this.getUsers()) {
      if (user.id !== targetUserId) {
        continue;
      }
      this.queueToUser(user, text, severity);
      return;
    }
  }

  public queueForAccountId(accountId: number, text: string, severity: AlertSeverity = "info"): void {
    if (!Number.isFinite(accountId)) {
      return;
    }
    const targetAccountId = Math.max(1, Math.floor(accountId));
    for (const user of this.getUsers()) {
      if (user.accountId !== targetAccountId) {
        continue;
      }
      this.queueToUser(user, text, severity);
      return;
    }
  }

  public broadcast(text: string, severity: AlertSeverity = "info"): void {
    for (const user of this.getUsers()) {
      this.queueToUser(user, text, severity);
    }
  }

  private queueToUser(user: TUser, text: string, severity: AlertSeverity): void {
    const normalizedText = typeof text === "string" ? text.trim() : "";
    if (normalizedText.length <= 0) {
      return;
    }
    const normalizedSeverity = coerceAlertSeverity(severity);
    user.queueMessage({
      ntype: NType.ServerAlertMessage,
      text: normalizedText,
      severity: alertSeverityToWireValue(normalizedSeverity)
    });
  }
}
