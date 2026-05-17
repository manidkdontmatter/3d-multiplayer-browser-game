/**
 * Purpose: This file provides publish/subscribe event flow between decoupled systems.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
export type EventHandler<T> = (payload: T) => void;

interface Subscription<T> {
  handler: EventHandler<T>;
  once: boolean;
}

export class EventBus {
  private readonly subscribers = new Map<string, Subscription<unknown>[]>();

  public on<T>(event: string, handler: EventHandler<T>): void {
    const list = this.subscribers.get(event) ?? [];
    list.push({ handler: handler as EventHandler<unknown>, once: false });
    this.subscribers.set(event, list);
  }

  public once<T>(event: string, handler: EventHandler<T>): void {
    const list = this.subscribers.get(event) ?? [];
    list.push({ handler: handler as EventHandler<unknown>, once: true });
    this.subscribers.set(event, list);
  }

  public off<T>(event: string, handler: EventHandler<T>): void {
    const list = this.subscribers.get(event);
    if (!list) return;
    const idx = list.findIndex((s) => s.handler === (handler as EventHandler<unknown>));
    if (idx >= 0) list.splice(idx, 1);
  }

  public emit<T>(event: string, payload: T): void {
    const list = this.subscribers.get(event);
    if (!list || list.length === 0) return;
    // Iterate backwards so once-removal doesn't break iteration
    for (let i = list.length - 1; i >= 0; i--) {
      const sub = list[i];
      if (!sub) continue;
      sub.handler(payload);
      if (sub.once) list.splice(i, 1);
    }
  }

  public clear(): void {
    this.subscribers.clear();
  }

  public subscriberCount(event: string): number {
    return this.subscribers.get(event)?.length ?? 0;
  }
}
