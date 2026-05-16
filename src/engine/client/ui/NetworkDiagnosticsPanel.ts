// Renders a toggleable top-right overlay with live client/network diagnostics for gameplay troubleshooting.
export interface NetworkDiagnosticsSnapshot {
  connectionMode: string;
  endpoint: string;
  mapLabel: string;
  localPlayerNid: string;
  cspLabel: string;
  movementModeLabel: string;
  pingMs: string;
  interpolationDelayMs: string;
  ackJitterMs: string;
  serverClockOffsetMs: string;
  serverPlayers: string;
  aoiPlayers: string;
  locationRoots: string;
  worldEntities: string;
  projectiles: string;
  fps: string;
  lowFpsFrames: string;
}

export class NetworkDiagnosticsPanel {
  private readonly root: HTMLDivElement;
  private readonly rows = new Map<keyof NetworkDiagnosticsSnapshot, HTMLSpanElement>();

  private constructor(documentRef: Document) {
    this.root = documentRef.createElement("div");
    this.root.id = "network-diagnostics-panel";
    this.root.className = "network-diagnostics-hidden";

    const title = documentRef.createElement("div");
    title.className = "network-diagnostics-title";
    title.textContent = "Network Diagnostics";
    this.root.append(title);

    const grid = documentRef.createElement("div");
    grid.className = "network-diagnostics-grid";
    this.root.append(grid);

    this.appendRow(documentRef, grid, "connectionMode", "Connection");
    this.appendRow(documentRef, grid, "endpoint", "Endpoint");
    this.appendRow(documentRef, grid, "mapLabel", "Map");
    this.appendRow(documentRef, grid, "localPlayerNid", "Player NID");
    this.appendRow(documentRef, grid, "cspLabel", "CSP");
    this.appendRow(documentRef, grid, "movementModeLabel", "Move mode");
    this.appendRow(documentRef, grid, "pingMs", "Ping (RTT)");
    this.appendRow(documentRef, grid, "interpolationDelayMs", "Interpolation");
    this.appendRow(documentRef, grid, "ackJitterMs", "Ack jitter");
    this.appendRow(documentRef, grid, "serverClockOffsetMs", "Clock offset");
    this.appendRow(documentRef, grid, "serverPlayers", "Server players");
    this.appendRow(documentRef, grid, "aoiPlayers", "AOI players");
    this.appendRow(documentRef, grid, "locationRoots", "Locations");
    this.appendRow(documentRef, grid, "worldEntities", "World entities");
    this.appendRow(documentRef, grid, "projectiles", "Projectiles");
    this.appendRow(documentRef, grid, "fps", "FPS");
    this.appendRow(documentRef, grid, "lowFpsFrames", "Low FPS frames");

    documentRef.body.append(this.root);
  }

  public static mount(documentRef: Document): NetworkDiagnosticsPanel {
    return new NetworkDiagnosticsPanel(documentRef);
  }

  public setVisible(visible: boolean): void {
    this.root.classList.toggle("network-diagnostics-hidden", !visible);
    this.root.classList.toggle("network-diagnostics-visible", visible);
  }

  public update(snapshot: NetworkDiagnosticsSnapshot): void {
    for (const [key, valueNode] of this.rows) {
      valueNode.textContent = snapshot[key];
    }
  }

  private appendRow(
    documentRef: Document,
    parent: HTMLElement,
    key: keyof NetworkDiagnosticsSnapshot,
    label: string
  ): void {
    const labelNode = documentRef.createElement("span");
    labelNode.className = "network-diagnostics-label";
    labelNode.textContent = label;
    parent.append(labelNode);

    const valueNode = documentRef.createElement("span");
    valueNode.className = "network-diagnostics-value";
    valueNode.textContent = "--";
    parent.append(valueNode);

    this.rows.set(key, valueNode);
  }
}
