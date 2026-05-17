/**
 * Purpose: This file renders or coordinates in-game UI panels and overlays.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
export type UiLayerName = "boot" | "gameplay" | "debug" | "tooltip";

const UI_ROOT_ID = "ui-root";

export class UiRuntime {
  private readonly layers = new Map<UiLayerName, HTMLDivElement>();

  private constructor(private readonly root: HTMLDivElement) {}

  public static ensureDocumentRoot(documentRef: Document): UiRuntime {
    const existingRoot = documentRef.getElementById(UI_ROOT_ID);
    if (existingRoot instanceof HTMLDivElement) {
      return UiRuntime.fromExistingRoot(existingRoot);
    }

    const root = documentRef.createElement("div");
    root.id = UI_ROOT_ID;
    for (const layerName of ["boot", "gameplay", "debug", "tooltip"] as const) {
      const layer = documentRef.createElement("div");
      layer.className = "ui-layer";
      layer.dataset.uiLayer = layerName;
      root.append(layer);
    }

    documentRef.body.append(root);
    return UiRuntime.fromExistingRoot(root);
  }

  private static fromExistingRoot(root: HTMLDivElement): UiRuntime {
    const runtime = new UiRuntime(root);
    for (const layerName of ["boot", "gameplay", "debug", "tooltip"] as const) {
      const layer = root.querySelector(`[data-ui-layer="${layerName}"]`);
      if (!(layer instanceof HTMLDivElement)) {
        throw new Error(`Missing ui layer: ${layerName}`);
      }
      runtime.layers.set(layerName, layer);
    }
    return runtime;
  }

  public getLayer(layerName: UiLayerName): HTMLDivElement {
    const layer = this.layers.get(layerName);
    if (!layer) {
      throw new Error(`Unknown ui layer: ${layerName}`);
    }
    return layer;
  }

  public moveElementToLayer(element: HTMLElement, layerName: UiLayerName): void {
    this.getLayer(layerName).append(element);
  }

  public adoptElementById(documentRef: Document, id: string, layerName: UiLayerName): void {
    const element = documentRef.getElementById(id);
    if (element instanceof HTMLElement) {
      this.moveElementToLayer(element, layerName);
    }
  }

  public setUiScale(scale: number): void {
    const normalized = Number.isFinite(scale) ? Math.max(0.5, Math.min(2, scale)) : 1;
    this.root.style.setProperty("--ui-scale", normalized.toFixed(3));
  }
}
