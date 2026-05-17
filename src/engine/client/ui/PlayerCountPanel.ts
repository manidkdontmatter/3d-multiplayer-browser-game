/**
 * Purpose: This file defines the "player count panel" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
export class PlayerCountPanel {
  private readonly root: HTMLDivElement;

  private constructor(parent: HTMLElement, documentRef: Document) {
    this.root = documentRef.createElement("div");
    this.root.id = "connected-players-indicator";
    this.root.textContent = "Players: 0\nAOI: 0";
    parent.append(this.root);
  }

  public static mount(parent: HTMLElement, documentRef: Document): PlayerCountPanel {
    return new PlayerCountPanel(parent, documentRef);
  }

  public update(serverPlayersLabel: string, aoiCount: number): void {
    this.root.textContent = `Players: ${serverPlayersLabel}\nAOI: ${aoiCount}`;
  }
}
