/**
 * Purpose: This file schedules debounced and forced settings persistence flushes.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */

export class SettingsSaveScheduler {
  private dirty = false;
  private dueAtMs = Number.POSITIVE_INFINITY;

  public constructor(private readonly debounceMs: number) {}

  public markDirty(nowMs: number): void {
    this.dirty = true;
    this.dueAtMs = Math.min(this.dueAtMs, nowMs + this.debounceMs);
  }

  public consumeShouldFlush(nowMs: number): boolean {
    if (!this.dirty) {
      return false;
    }
    if (nowMs < this.dueAtMs) {
      return false;
    }
    this.dirty = false;
    this.dueAtMs = Number.POSITIVE_INFINITY;
    return true;
  }

  public forceFlush(): boolean {
    if (!this.dirty) {
      return false;
    }
    this.dirty = false;
    this.dueAtMs = Number.POSITIVE_INFINITY;
    return true;
  }
}
