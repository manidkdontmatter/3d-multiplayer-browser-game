declare global {
  interface TestMovementInput {
    forward: number;
    strafe: number;
    jump: boolean;
    sprint: boolean;
  }

  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
    set_test_movement?: (movement: TestMovementInput | null) => void;
    trigger_test_primary_action?: (count?: number) => void;
    set_test_primary_hold?: (held: boolean) => void;
    set_test_look_angles?: (yaw: number, pitch: number) => void;
  }
}

export {};
