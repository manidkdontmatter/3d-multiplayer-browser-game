declare global {
  interface RenderGameStatePlayer {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    nid: number | null;
  }

  interface RenderGameStateRemotePlayer {
    nid: number;
    x: number;
    y: number;
    z: number;
    grounded: boolean;
    health: number;
  }

  interface RenderGameStatePerf {
    fps: number;
    lowFpsFrameCount: number;
  }

  interface RenderGameStatePayload {
    mode: "connected" | "local-only";
    pointerLock: boolean;
    coordinateSystem: string;
    player: RenderGameStatePlayer;
    remotePlayers: RenderGameStateRemotePlayer[];
    perf: RenderGameStatePerf;
    [key: string]: unknown;
  }

  interface TestMovementInput {
    forward: number;
    strafe: number;
    jump: boolean;
    sprint: boolean;
  }

  interface Window {
    render_game_to_text?: () => string;
    render_game_state?: (scope?: "full" | "minimal") => RenderGameStatePayload;
    advanceTime?: (ms: number) => void;
    set_test_movement?: (movement: TestMovementInput | null) => void;
    trigger_test_primary_action?: (count?: number) => void;
    set_test_primary_hold?: (held: boolean) => void;
    set_test_look_angles?: (yaw: number, pitch: number) => void;
  }
}

export {};
