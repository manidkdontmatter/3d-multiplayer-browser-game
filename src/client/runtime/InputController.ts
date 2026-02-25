// Collects keyboard/mouse input and exposes deterministic sampled actions for the game loop.
import type { MovementInput } from "./types";

export type MouseBindingTarget = "primary" | "secondary";

export interface MouseBindingIntent {
  slot: number;
  target: MouseBindingTarget;
}

export class InputController {
  private readonly heldKeys = new Set<string>();
  private readonly queuedBindingIntents: MouseBindingIntent[] = [];
  private jumpQueued = false;
  private toggleFlyQueued = false;
  private cameraFreezeToggleQueued = false;
  private cspToggleQueued = false;
  private mainMenuToggleQueued = false;
  private primaryActionHeld = false;
  private primaryActionQueued = false;
  private secondaryActionHeld = false;
  private secondaryActionQueued = false;
  private queuedCastSlot: number | null = null;
  private yaw = 0;
  private pitch = 0;
  private readonly sensitivity = 0.0025;
  private mainUiOpen = false;

  public constructor(private readonly canvas: HTMLCanvasElement) {}

  public attach(): void {
    this.canvas.addEventListener("click", this.onCanvasClick);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("contextmenu", this.onContextMenu);
  }

  public detach(): void {
    this.canvas.removeEventListener("click", this.onCanvasClick);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("blur", this.onWindowBlur);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("contextmenu", this.onContextMenu);
  }

  public setMainUiOpen(open: boolean): void {
    this.mainUiOpen = open;
    if (open) {
      this.primaryActionHeld = false;
      this.secondaryActionHeld = false;
    }
  }

  public sampleMovement(): MovementInput {
    const forward = (this.heldKeys.has("KeyW") ? 1 : 0) + (this.heldKeys.has("KeyS") ? -1 : 0);
    const strafe = (this.heldKeys.has("KeyD") ? 1 : 0) + (this.heldKeys.has("KeyA") ? -1 : 0);

    let normForward = forward;
    let normStrafe = strafe;
    if (normForward !== 0 && normStrafe !== 0) {
      const norm = 1 / Math.sqrt(2);
      normForward *= norm;
      normStrafe *= norm;
    }

    const movement: MovementInput = {
      forward: normForward,
      strafe: normStrafe,
      jump: this.jumpQueued,
      toggleFlyPressed: this.toggleFlyQueued,
      sprint: this.heldKeys.has("ShiftLeft") || this.heldKeys.has("ShiftRight")
    };

    this.jumpQueued = false;
    this.toggleFlyQueued = false;
    return movement;
  }

  public getYaw(): number {
    return this.yaw;
  }

  public getPitch(): number {
    return this.pitch;
  }

  public isPrimaryActionHeld(): boolean {
    return this.primaryActionHeld;
  }

  public isSecondaryActionHeld(): boolean {
    return this.secondaryActionHeld;
  }

  public consumePrimaryActionTrigger(): boolean {
    const queued = this.primaryActionQueued;
    this.primaryActionQueued = false;
    return queued;
  }

  public consumeSecondaryActionTrigger(): boolean {
    const queued = this.secondaryActionQueued;
    this.secondaryActionQueued = false;
    return queued;
  }

  public consumeDirectCastSlotTrigger(): number | null {
    const queued = this.queuedCastSlot;
    this.queuedCastSlot = null;
    return queued;
  }

  public consumeBindingIntents(): MouseBindingIntent[] {
    if (this.queuedBindingIntents.length === 0) {
      return [];
    }
    const intents = this.queuedBindingIntents.slice();
    this.queuedBindingIntents.length = 0;
    return intents;
  }

  public setLookAngles(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = Math.max(-1.45, Math.min(1.45, pitch));
  }

  public applyYawDelta(delta: number): void {
    this.yaw += delta;
  }

  public consumeCameraFreezeToggle(): boolean {
    const queued = this.cameraFreezeToggleQueued;
    this.cameraFreezeToggleQueued = false;
    return queued;
  }

  public consumeCspToggle(): boolean {
    const queued = this.cspToggleQueued;
    this.cspToggleQueued = false;
    return queued;
  }

  public consumeMainMenuToggle(): boolean {
    const queued = this.mainMenuToggleQueued;
    this.mainMenuToggleQueued = false;
    return queued;
  }

  private readonly onCanvasClick = (): void => {
    if (this.mainUiOpen) {
      return;
    }
    if (document.pointerLockElement !== this.canvas) {
      void this.canvas.requestPointerLock();
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Backquote" && !event.repeat) {
      this.mainMenuToggleQueued = true;
      event.preventDefault();
      return;
    }

    if (this.isTypingTarget(event.target)) {
      return;
    }

    this.heldKeys.add(event.code);
    if (event.code === "Space") {
      this.jumpQueued = true;
      return;
    }
    if (event.code === "KeyZ" && !event.repeat) {
      this.cameraFreezeToggleQueued = true;
      return;
    }
    if (event.code === "KeyC" && !event.repeat) {
      this.cspToggleQueued = true;
      return;
    }
    if (event.code === "KeyF" && !event.repeat) {
      this.toggleFlyQueued = true;
      return;
    }
    if (event.repeat) {
      return;
    }

    const slot = this.mapDigitCodeToHotbarSlot(event.code);
    if (slot === null) {
      return;
    }

    if (event.shiftKey) {
      this.queuedBindingIntents.push({ slot, target: "primary" });
      event.preventDefault();
      return;
    }

    if (event.altKey) {
      this.queuedBindingIntents.push({ slot, target: "secondary" });
      event.preventDefault();
      return;
    }

    this.queuedCastSlot = slot;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas || this.mainUiOpen) {
      return;
    }

    this.yaw -= event.movementX * this.sensitivity;
    this.pitch -= event.movementY * this.sensitivity;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.mainUiOpen) {
      return;
    }
    if (document.pointerLockElement !== this.canvas) {
      this.primaryActionHeld = false;
      this.secondaryActionHeld = false;
      return;
    }

    if (event.button === 0) {
      this.primaryActionHeld = true;
      this.primaryActionQueued = true;
      return;
    }

    if (event.button === 2) {
      this.secondaryActionHeld = true;
      this.secondaryActionQueued = true;
      event.preventDefault();
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.primaryActionHeld = false;
      return;
    }
    if (event.button === 2) {
      this.secondaryActionHeld = false;
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onWindowBlur = (): void => {
    this.primaryActionHeld = false;
    this.primaryActionQueued = false;
    this.secondaryActionHeld = false;
    this.secondaryActionQueued = false;
    this.queuedCastSlot = null;
    this.toggleFlyQueued = false;
    this.heldKeys.clear();
  };

  private mapDigitCodeToHotbarSlot(code: string): number | null {
    switch (code) {
      case "Digit1":
        return 0;
      case "Digit2":
        return 1;
      case "Digit3":
        return 2;
      case "Digit4":
        return 3;
      case "Digit5":
        return 4;
      case "Digit6":
        return 5;
      case "Digit7":
        return 6;
      case "Digit8":
        return 7;
      case "Digit9":
        return 8;
      case "Digit0":
        return 9;
      default:
        return null;
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return true;
    }
    return target.isContentEditable;
  }
}
