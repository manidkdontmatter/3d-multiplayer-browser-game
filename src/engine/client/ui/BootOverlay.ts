const BOOT_HIDDEN_CLASS = "boot-overlay-hidden";
const BOOT_ERROR_CLASS = "boot-overlay-error";

export class BootOverlay {
  private constructor(
    private readonly root: HTMLElement,
    private readonly stageNode: HTMLElement,
    private readonly detailNode: HTMLElement,
    private readonly progressFillNode: HTMLElement,
    private readonly progressLabelNode: HTMLElement
  ) {}

  public static fromDocument(doc: Document): BootOverlay {
    const root = doc.getElementById("boot-overlay");
    const stageNode = doc.getElementById("boot-stage");
    const detailNode = doc.getElementById("boot-detail");
    const progressFillNode = doc.getElementById("boot-progress-fill");
    const progressLabelNode = doc.getElementById("boot-progress-label");

    if (!(root instanceof HTMLElement)) {
      throw new Error("Missing #boot-overlay");
    }
    if (!(stageNode instanceof HTMLElement)) {
      throw new Error("Missing #boot-stage");
    }
    if (!(detailNode instanceof HTMLElement)) {
      throw new Error("Missing #boot-detail");
    }
    if (!(progressFillNode instanceof HTMLElement)) {
      throw new Error("Missing #boot-progress-fill");
    }
    if (!(progressLabelNode instanceof HTMLElement)) {
      throw new Error("Missing #boot-progress-label");
    }

    return new BootOverlay(root, stageNode, detailNode, progressFillNode, progressLabelNode);
  }

  public setStage(text: string): void {
    this.stageNode.textContent = text;
  }

  public setDetail(text: string): void {
    this.detailNode.textContent = text;
  }

  public setProgress(ratio: number): void {
    const clampedRatio = clamp01(ratio);
    const percent = Math.round(clampedRatio * 100);
    this.progressFillNode.style.width = `${percent}%`;
    this.progressLabelNode.textContent = `${percent}%`;
  }

  public complete(): void {
    this.root.classList.remove(BOOT_ERROR_CLASS);
    this.root.classList.add(BOOT_HIDDEN_CLASS);
  }

  public fail(message: string): void {
    this.root.classList.remove(BOOT_HIDDEN_CLASS);
    this.root.classList.add(BOOT_ERROR_CLASS);
    this.setStage("Startup failed");
    this.setDetail(message);
    this.setProgress(1);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
