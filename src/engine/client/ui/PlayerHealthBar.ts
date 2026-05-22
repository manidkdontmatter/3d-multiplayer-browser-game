/**
 * Purpose: This file defines the "player health bar" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
const PLAYER_HEALTH_BAR_TUNING = {
  smoothSeconds: 1,
  desktopWidth: "min(24.8vw, 336px)",
  mobileWidth: "min(38.4vw, 336px)",
  frameHeightPx: 20,
  frameRadiusPx: 10,
  frameBorderPx: 4,
  frameBorderColor: "#b8831f",
  frameGradientTop: "rgba(74, 18, 18, 0.96)",
  frameGradientBottom: "rgba(30, 8, 8, 0.98)",
  fillGradientTop: "#ff5f61",
  fillGradientMid: "#e31f2d",
  fillGradientBottom: "#aa0816",
  goldSheenDurationSeconds: 2.8
} as const;

export class PlayerHealthBar {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private smoothedRatio = 1;
  private initialized = false;

  private constructor(parent: HTMLElement, documentRef: Document) {
    this.root = documentRef.createElement("div");
    this.root.id = "player-health-bar";
    this.root.className = "player-health-bar-hidden";

    const frame = documentRef.createElement("div");
    frame.className = "player-health-bar-frame";
    this.fill = documentRef.createElement("div");
    this.fill.className = "player-health-bar-fill";
    this.root.style.setProperty("--player-health-width-desktop", PLAYER_HEALTH_BAR_TUNING.desktopWidth);
    this.root.style.setProperty("--player-health-width-mobile", PLAYER_HEALTH_BAR_TUNING.mobileWidth);
    this.root.style.setProperty("--player-health-frame-height", `${PLAYER_HEALTH_BAR_TUNING.frameHeightPx}px`);
    this.root.style.setProperty("--player-health-frame-radius", `${PLAYER_HEALTH_BAR_TUNING.frameRadiusPx}px`);
    this.root.style.setProperty("--player-health-frame-border", `${PLAYER_HEALTH_BAR_TUNING.frameBorderPx}px`);
    this.root.style.setProperty("--player-health-frame-border-color", PLAYER_HEALTH_BAR_TUNING.frameBorderColor);
    this.root.style.setProperty("--player-health-frame-gradient-top", PLAYER_HEALTH_BAR_TUNING.frameGradientTop);
    this.root.style.setProperty("--player-health-frame-gradient-bottom", PLAYER_HEALTH_BAR_TUNING.frameGradientBottom);
    this.root.style.setProperty("--player-health-fill-gradient-top", PLAYER_HEALTH_BAR_TUNING.fillGradientTop);
    this.root.style.setProperty("--player-health-fill-gradient-mid", PLAYER_HEALTH_BAR_TUNING.fillGradientMid);
    this.root.style.setProperty("--player-health-fill-gradient-bottom", PLAYER_HEALTH_BAR_TUNING.fillGradientBottom);
    this.root.style.setProperty("--player-health-gold-sheen-duration", `${PLAYER_HEALTH_BAR_TUNING.goldSheenDurationSeconds}s`);
    frame.append(this.fill);
    this.root.append(frame);
    parent.append(this.root);
  }

  public static mount(parent: HTMLElement, documentRef: Document): PlayerHealthBar {
    return new PlayerHealthBar(parent, documentRef);
  }

  public update(currentHealth: number | null, maxHealth: number | null, deltaSeconds: number): void {
    if (
      typeof currentHealth !== "number" ||
      typeof maxHealth !== "number" ||
      !Number.isFinite(currentHealth) ||
      !Number.isFinite(maxHealth) ||
      maxHealth <= 0
    ) {
      this.root.className = "player-health-bar-hidden";
      this.initialized = false;
      this.smoothedRatio = 1;
      this.fill.style.width = "100%";
      return;
    }

    const targetRatio = Math.max(0, Math.min(1, currentHealth / maxHealth));
    if (!this.initialized) {
      this.smoothedRatio = targetRatio;
      this.initialized = true;
    } else {
      const alpha = Math.max(0, Math.min(1, deltaSeconds / PLAYER_HEALTH_BAR_TUNING.smoothSeconds));
      this.smoothedRatio += (targetRatio - this.smoothedRatio) * alpha;
    }

    this.root.className = "player-health-bar-visible";
    this.fill.style.width = `${(this.smoothedRatio * 100).toFixed(3)}%`;
  }
}
