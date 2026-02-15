import {
  buildLoginLink,
  generateAccessKey,
  isValidAccessKey,
  storeAccessKey,
  writeAccessKeyToFragment
} from "../auth/accessKey";

export interface AuthPanelOptions {
  serverUrl: string;
  initialAccessKey: string;
}

export class AuthPanel {
  private readonly root: HTMLDivElement;
  private readonly keyInput: HTMLInputElement;
  private readonly statusNode: HTMLParagraphElement;
  private accessKey: string;

  private constructor(documentRef: Document, private readonly options: AuthPanelOptions) {
    this.accessKey = options.initialAccessKey;

    this.root = documentRef.createElement("div");
    this.root.id = "auth-panel";
    this.root.innerHTML = `
      <p class="auth-title">Access Key</p>
      <div class="auth-row">
        <input class="auth-input" maxlength="12" spellcheck="false" aria-label="Access Key" />
      </div>
      <div class="auth-row auth-actions">
        <button type="button" class="auth-button" data-action="copy-key">Copy Key</button>
        <button type="button" class="auth-button" data-action="copy-link">Copy Login Link</button>
        <button type="button" class="auth-button" data-action="new-key">New Key</button>
        <button type="button" class="auth-button auth-button-primary" data-action="use-key">Use Key</button>
      </div>
      <p class="auth-status"></p>
      <p class="auth-hint">Bookmark hint: press Ctrl+D (or Cmd+D on Mac).</p>
    `;

    const keyInput = this.root.querySelector(".auth-input");
    const statusNode = this.root.querySelector(".auth-status");
    if (!(keyInput instanceof HTMLInputElement) || !(statusNode instanceof HTMLParagraphElement)) {
      throw new Error("AuthPanel failed to initialize.");
    }
    this.keyInput = keyInput;
    this.statusNode = statusNode;
    this.keyInput.value = this.accessKey;

    this.root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const action = target.dataset.action;
      if (!action) {
        return;
      }
      void this.handleAction(action);
    });

    documentRef.body.append(this.root);
  }

  public static mount(documentRef: Document, options: AuthPanelOptions): AuthPanel {
    return new AuthPanel(documentRef, options);
  }

  public getAccessKey(): string {
    return this.accessKey;
  }

  private async handleAction(action: string): Promise<void> {
    switch (action) {
      case "copy-key":
        await this.copyToClipboard(this.accessKey, "Key copied.");
        break;
      case "copy-link":
        await this.copyToClipboard(
          buildLoginLink(this.options.serverUrl, this.accessKey),
          "Login link copied."
        );
        break;
      case "new-key": {
        const fresh = generateAccessKey();
        this.accessKey = fresh;
        this.keyInput.value = fresh;
        this.persistAccessKey(fresh);
        this.setStatus("Generated a new key.");
        break;
      }
      case "use-key":
        this.applyInputKey();
        break;
      default:
        break;
    }
  }

  private applyInputKey(): void {
    const candidate = this.keyInput.value.trim();
    if (!isValidAccessKey(candidate)) {
      this.setStatus("Key must be 12 letters/numbers.");
      return;
    }
    this.accessKey = candidate;
    this.persistAccessKey(candidate);
    this.setStatus("Key applied. Reloading...");
    window.setTimeout(() => {
      window.location.reload();
    }, 120);
  }

  private persistAccessKey(accessKey: string): void {
    writeAccessKeyToFragment(accessKey);
    storeAccessKey(this.options.serverUrl, accessKey);
  }

  private async copyToClipboard(value: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.setStatus(successMessage);
    } catch {
      this.setStatus("Clipboard blocked by browser.");
    }
  }

  private setStatus(message: string): void {
    this.statusNode.textContent = message;
  }
}
