import process from "node:process";
import {
  GRAVITY,
  PLAYER_JUMP_VELOCITY,
  SERVER_TICK_SECONDS,
  stepHorizontalMovement
} from "../src/shared/index";

type MovementFrame = {
  forward: number;
  strafe: number;
  sprint: boolean;
  jump: boolean;
  yawDelta: number;
  pitch: number;
  delta: number;
};

type SimState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
};

const EPSILON = 1e-9;
const GROUND_Y = 0;

function normalizeYaw(value: number): number {
  let yaw = value;
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;
  return yaw;
}

function createInitialState(): SimState {
  return {
    x: 0,
    y: GROUND_Y,
    z: 0,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true
  };
}

function stepServerStyle(state: SimState, frame: MovementFrame): SimState {
  const next: SimState = { ...state };
  if (frame.jump && next.grounded) {
    next.vy = PLAYER_JUMP_VELOCITY;
    next.grounded = false;
  }

  next.yaw = normalizeYaw(next.yaw + frame.yawDelta);
  next.pitch = Math.max(-1.45, Math.min(1.45, frame.pitch));
  const horizontal = stepHorizontalMovement(
    { vx: next.vx, vz: next.vz },
    { forward: frame.forward, strafe: frame.strafe, sprint: frame.sprint, yaw: next.yaw },
    next.grounded,
    frame.delta
  );
  next.vx = horizontal.vx;
  next.vz = horizontal.vz;

  if (next.grounded && next.vy < 0) {
    next.vy = 0;
  }
  next.vy += GRAVITY * frame.delta;
  next.x += next.vx * frame.delta;
  next.y += next.vy * frame.delta;
  next.z += next.vz * frame.delta;
  if (next.y <= GROUND_Y) {
    next.y = GROUND_Y;
    next.vy = 0;
    next.grounded = true;
  } else {
    next.grounded = false;
  }
  return next;
}

function stepClientStyle(state: SimState, frame: MovementFrame): SimState {
  const next: SimState = { ...state };
  if (frame.jump && next.grounded) {
    next.vy = PLAYER_JUMP_VELOCITY;
    next.grounded = false;
  }

  next.yaw = normalizeYaw(next.yaw + frame.yawDelta);
  next.pitch = Math.max(-1.45, Math.min(1.45, frame.pitch));
  const horizontal = stepHorizontalMovement(
    { vx: next.vx, vz: next.vz },
    { forward: frame.forward, strafe: frame.strafe, sprint: frame.sprint, yaw: next.yaw },
    next.grounded,
    frame.delta
  );
  next.vx = horizontal.vx;
  next.vz = horizontal.vz;

  if (next.grounded && next.vy < 0) {
    next.vy = 0;
  }
  next.vy += GRAVITY * frame.delta;
  next.x += next.vx * frame.delta;
  next.y += next.vy * frame.delta;
  next.z += next.vz * frame.delta;
  if (next.y <= GROUND_Y) {
    next.y = GROUND_Y;
    next.vy = 0;
    next.grounded = true;
  } else {
    next.grounded = false;
  }
  return next;
}

function createTrace(): MovementFrame[] {
  const frames: MovementFrame[] = [];
  const pushRepeated = (
    count: number,
    frame: Omit<MovementFrame, "delta" | "jump"> & { jump?: boolean; delta?: number }
  ): void => {
    for (let i = 0; i < count; i += 1) {
      frames.push({
        forward: frame.forward,
        strafe: frame.strafe,
        sprint: frame.sprint,
        jump: i === 0 ? Boolean(frame.jump) : false,
        yawDelta: frame.yawDelta,
        pitch: frame.pitch,
        delta: frame.delta ?? SERVER_TICK_SECONDS
      });
    }
  };

  pushRepeated(25, { forward: 1, strafe: 0, sprint: false, yawDelta: 0.008, pitch: 0.02 });
  pushRepeated(18, { forward: 1, strafe: 0, sprint: true, yawDelta: -0.01, pitch: 0.03 });
  pushRepeated(20, { forward: 0, strafe: 1, sprint: true, yawDelta: 0.012, pitch: -0.03 });
  pushRepeated(14, { forward: 0.6, strafe: 0.6, sprint: false, yawDelta: 0, pitch: 0 });
  pushRepeated(10, { forward: 0, strafe: 0, sprint: false, yawDelta: 0, pitch: 0 });
  pushRepeated(1, { forward: 1, strafe: 0, sprint: true, yawDelta: 0, pitch: 0.1, jump: true });
  pushRepeated(20, { forward: 1, strafe: 0, sprint: true, yawDelta: 0, pitch: 0.08 });
  pushRepeated(16, { forward: 1, strafe: -1, sprint: false, yawDelta: -0.02, pitch: -0.05 });
  pushRepeated(12, { forward: 0, strafe: 0, sprint: false, yawDelta: 0, pitch: 0 });
  return frames;
}

function assertClose(label: string, actual: number, expected: number, frameIndex: number): void {
  if (Math.abs(actual - expected) <= EPSILON) {
    return;
  }
  throw new Error(
    `Parity mismatch at frame ${frameIndex} for ${label}: expected=${expected.toFixed(12)} actual=${actual.toFixed(12)}`
  );
}

function assertStateParity(frameIndex: number, server: SimState, client: SimState): void {
  assertClose("x", server.x, client.x, frameIndex);
  assertClose("y", server.y, client.y, frameIndex);
  assertClose("z", server.z, client.z, frameIndex);
  assertClose("yaw", server.yaw, client.yaw, frameIndex);
  assertClose("pitch", server.pitch, client.pitch, frameIndex);
  assertClose("vx", server.vx, client.vx, frameIndex);
  assertClose("vy", server.vy, client.vy, frameIndex);
  assertClose("vz", server.vz, client.vz, frameIndex);
  if (server.grounded !== client.grounded) {
    throw new Error(
      `Parity mismatch at frame ${frameIndex} for grounded: expected=${server.grounded} actual=${client.grounded}`
    );
  }
}

function runParityTest(): void {
  const trace = createTrace();
  let serverState = createInitialState();
  let clientState = createInitialState();

  for (let i = 0; i < trace.length; i += 1) {
    const frame = trace[i];
    if (!frame) {
      continue;
    }
    serverState = stepServerStyle(serverState, frame);
    clientState = stepClientStyle(clientState, frame);
    assertStateParity(i, serverState, clientState);
  }

  console.log(
    `[movement-parity] PASS frames=${trace.length} final_pos=(${serverState.x.toFixed(3)},${serverState.y.toFixed(3)},${serverState.z.toFixed(3)}) final_vel=(${serverState.vx.toFixed(3)},${serverState.vy.toFixed(3)},${serverState.vz.toFixed(3)})`
  );
}

try {
  runParityTest();
} catch (error) {
  console.error("[movement-parity] FAIL", error);
  process.exit(1);
}
