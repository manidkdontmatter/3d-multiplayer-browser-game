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
  }
}

export {};
