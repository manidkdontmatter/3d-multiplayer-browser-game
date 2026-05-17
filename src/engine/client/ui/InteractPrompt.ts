/**
 * Purpose: This file defines the "interact prompt" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
export class InteractPrompt {
  private readonly root: HTMLDivElement;

  private constructor(parent: HTMLElement, documentRef: Document) {
    this.root = documentRef.createElement("div");
    this.root.id = "interact-prompt";
    this.root.className = "interact-prompt-hidden";
    parent.append(this.root);
  }

  public static mount(parent: HTMLElement, documentRef: Document): InteractPrompt {
    return new InteractPrompt(parent, documentRef);
  }

  public clear(): void {
    this.root.className = "interact-prompt-hidden";
    this.root.textContent = "";
  }

  public show(text: string): void {
    this.root.className = "interact-prompt-visible";
    this.root.textContent = text;
  }
}
