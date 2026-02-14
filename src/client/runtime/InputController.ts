import type { MovementInput } from "./types";

export class InputController {
  private readonly heldKeys = new Set<string>();
  private jumpQueued = false;
  private cameraFreezeToggleQueued = false;
  private cspToggleQueued = false;
  private primaryActionHeld = false;
  private yaw = 0;
  private pitch = 0;
  private readonly sensitivity = 0.0025;

  public constructor(private readonly canvas: HTMLCanvasElement) {}

  public attach(): void {
    this.canvas.addEventListener("click", this.onCanvasClick);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("mousemove", this.onMouseMove);
  }

  public detach(): void {
    this.canvas.removeEventListener("click", this.onCanvasClick);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("blur", this.onWindowBlur);
    window.removeEventListener("mousemove", this.onMouseMove);
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
      sprint: this.heldKeys.has("ShiftLeft") || this.heldKeys.has("ShiftRight")
    };

    this.jumpQueued = false;
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

  private readonly onCanvasClick = (): void => {
    if (document.pointerLockElement !== this.canvas) {
      void this.canvas.requestPointerLock();
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.heldKeys.add(event.code);
    if (event.code === "Space") {
      this.jumpQueued = true;
    } else if (event.code === "KeyZ" && !event.repeat) {
      this.cameraFreezeToggleQueued = true;
    } else if (event.code === "KeyC" && !event.repeat) {
      this.cspToggleQueued = true;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) {
      return;
    }

    this.yaw -= event.movementX * this.sensitivity;
    this.pitch -= event.movementY * this.sensitivity;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    if (document.pointerLockElement !== this.canvas) {
      this.primaryActionHeld = false;
      return;
    }
    this.primaryActionHeld = true;
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.primaryActionHeld = false;
  };

  private readonly onWindowBlur = (): void => {
    this.primaryActionHeld = false;
  };
}
