/**
 * Purpose: This file renders a queued bottom-right alert feed with timed display and fade-out behavior.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { coerceAlertSeverity, type AlertSeverity } from "../../shared/alerts";

const ALERT_VISIBLE_MS = 5000;
const ALERT_FADE_MS = 320;
const ALERT_QUEUE_LIMIT = 5;

export class AlertFeed {
  private readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly textNode: HTMLSpanElement;
  private readonly queue: Array<{ text: string; severity: AlertSeverity }> = [];
  private displayTimeout: ReturnType<typeof setTimeout> | null = null;
  private fadeTimeout: ReturnType<typeof setTimeout> | null = null;
  private showing = false;

  private constructor(parent: HTMLElement, documentRef: Document) {
    this.root = documentRef.createElement("div");
    this.root.id = "alert-feed";
    this.root.className = "alert-feed-hidden";

    this.card = documentRef.createElement("div");
    this.card.className = "alert-feed-card alert-feed-info";
    this.textNode = documentRef.createElement("span");
    this.textNode.className = "alert-feed-text";
    this.card.append(this.textNode);

    this.root.append(this.card);
    parent.append(this.root);
  }

  public static mount(parent: HTMLElement, documentRef: Document): AlertFeed {
    return new AlertFeed(parent, documentRef);
  }

  public enqueue(message: string, severity: AlertSeverity = "info"): void {
    const normalized = message.trim();
    if (normalized.length === 0) {
      return;
    }
    const normalizedSeverity = coerceAlertSeverity(severity);
    if (!this.showing) {
      this.showNext({ text: normalized, severity: normalizedSeverity });
      return;
    }
    if (this.queue.length >= ALERT_QUEUE_LIMIT) {
      return;
    }
    this.queue.push({ text: normalized, severity: normalizedSeverity });
  }

  private showNext(alert: { text: string; severity: AlertSeverity }): void {
    this.showing = true;
    this.textNode.textContent = alert.text;
    this.card.classList.remove("alert-feed-info", "alert-feed-success", "alert-feed-warning", "alert-feed-error");
    this.card.classList.add(`alert-feed-${alert.severity}`);
    this.root.classList.remove("alert-feed-hidden", "alert-feed-fading");
    this.root.classList.add("alert-feed-visible");
    this.clearDisplayTimeout();
    this.displayTimeout = setTimeout(() => {
      this.beginFade();
    }, ALERT_VISIBLE_MS);
  }

  private beginFade(): void {
    this.root.classList.remove("alert-feed-visible");
    this.root.classList.add("alert-feed-fading");
    this.clearFadeTimeout();
    this.fadeTimeout = setTimeout(() => {
      this.finishCurrent();
    }, ALERT_FADE_MS);
  }

  private finishCurrent(): void {
    this.showing = false;
    this.root.classList.remove("alert-feed-visible", "alert-feed-fading");
    this.root.classList.add("alert-feed-hidden");
    const next = this.queue.shift();
    if (next) {
      this.showNext(next);
    }
  }

  private clearDisplayTimeout(): void {
    if (this.displayTimeout) {
      clearTimeout(this.displayTimeout);
      this.displayTimeout = null;
    }
  }

  private clearFadeTimeout(): void {
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }
  }
}
