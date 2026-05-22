/**
 * Purpose: This file defines the "client kinematics panel" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
export interface ClientKinematicsSnapshot {
  x: number;
  y: number;
  z: number;
  renderSpeed: number;
  physicsVx: number;
  physicsVy: number;
  physicsVz: number;
  horizontalSpeed: number;
}

export class ClientKinematicsPanel {
  private readonly root: HTMLDivElement;
  private readonly coordsNode: HTMLDivElement;
  private readonly renderVelocityNode: HTMLDivElement;
  private readonly physicsVelocityNode: HTMLDivElement;
  private readonly horizontalVelocityNode: HTMLDivElement;

  private constructor(parent: HTMLElement, documentRef: Document) {
    this.root = documentRef.createElement("div");
    this.root.id = "client-kinematics-panel";
    this.root.className = "client-kinematics-hidden";
    this.coordsNode = documentRef.createElement("div");
    this.coordsNode.className = "client-kinematics-line";
    this.renderVelocityNode = documentRef.createElement("div");
    this.renderVelocityNode.className = "client-kinematics-line";
    this.physicsVelocityNode = documentRef.createElement("div");
    this.physicsVelocityNode.className = "client-kinematics-line";
    this.horizontalVelocityNode = documentRef.createElement("div");
    this.horizontalVelocityNode.className = "client-kinematics-line";
    this.root.append(
      this.coordsNode,
      this.renderVelocityNode,
      this.physicsVelocityNode,
      this.horizontalVelocityNode
    );
    parent.append(this.root);
  }

  public static mount(parent: HTMLElement, documentRef: Document): ClientKinematicsPanel {
    return new ClientKinematicsPanel(parent, documentRef);
  }

  public setVisible(visible: boolean): void {
    this.root.classList.toggle("client-kinematics-hidden", !visible);
    this.root.classList.toggle("client-kinematics-visible", visible);
  }

  public update(snapshot: ClientKinematicsSnapshot): void {
    this.coordsNode.textContent = `XYZ: ${snapshot.x.toFixed(2)}, ${snapshot.y.toFixed(2)}, ${snapshot.z.toFixed(2)}`;
    this.renderVelocityNode.textContent = `Render Velocity: ${snapshot.renderSpeed.toFixed(2)}`;
    this.physicsVelocityNode.textContent =
      `Physics VEL XYZ: ${snapshot.physicsVx.toFixed(2)}, ${snapshot.physicsVy.toFixed(2)}, ${snapshot.physicsVz.toFixed(2)}`;
    this.horizontalVelocityNode.textContent = `HVEL: ${snapshot.horizontalSpeed.toFixed(2)}`;
  }
}
