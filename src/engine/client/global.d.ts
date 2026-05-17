/**
 * Purpose: This file defines the "global" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
declare global {
  interface RenderGameStatePlayer {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    nid: number | null;
    movementMode?: "grounded" | "flying";
    groundedPlatformPid?: number | null;
    carriedFramePid?: number | null;
  }

  interface RenderGameStateRemotePlayer {
    nid: number;
    x: number;
    y: number;
    z: number;
    grounded: boolean;
    movementMode?: "grounded" | "flying";
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
    toggleFlyPressed?: boolean;
    sprint: boolean;
  }

  interface Window {
    render_game_to_text?: () => string;
    render_game_state?: (scope?: "full" | "minimal") => RenderGameStatePayload;
    advanceTime?: (ms: number) => void;
    set_test_movement?: (movement: TestMovementInput | null) => void;
    trigger_test_primary_action?: (count?: number) => void;
    trigger_test_secondary_action?: (count?: number) => void;
    trigger_test_interact?: (count?: number) => void;
    drop_first_inventory_item?: () => void;
    use_first_inventory_item?: () => void;
    equip_first_equipment_item?: () => void;
    set_test_primary_hold?: (held: boolean) => void;
    set_test_secondary_hold?: (held: boolean) => void;
    set_test_look_angles?: (yaw: number, pitch: number) => void;
    request_map_transfer?: (targetMapInstanceId: string) => void;
    __runtimeMapConfig?: {
      mapId: string;
      instanceId: string;
      seed: number;
      groundHalfExtent: number;
      groundHalfThickness: number;
      cubeCount: number;
    };
  }

  var __runtimeMapConfig:
    | {
        mapId: string;
        instanceId: string;
        seed: number;
        groundHalfExtent: number;
        groundHalfThickness: number;
        cubeCount: number;
      }
    | undefined;
}

export {};
