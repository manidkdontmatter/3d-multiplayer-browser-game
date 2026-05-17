// Renders the compact connected-player and AOI counts on the gameplay HUD layer.
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
