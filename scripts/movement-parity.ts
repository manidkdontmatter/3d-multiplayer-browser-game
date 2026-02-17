import process from "node:process";
import RAPIER from "@dimforge/rapier3d-compat";
import type { ChannelAABB3D } from "nengi";
import { LocalPhysicsWorld } from "../src/client/runtime/LocalPhysicsWorld";
import type { MovementInput } from "../src/client/runtime/types";
import { PlayerMovementSystem } from "../src/server/movement/PlayerMovementSystem";
import { PlatformSystem } from "../src/server/platform/PlatformSystem";
import { WorldBootstrapSystem } from "../src/server/world/WorldBootstrapSystem";
import {
  PLATFORM_DEFINITIONS,
  PLAYER_BODY_CENTER_HEIGHT,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_JUMP_VELOCITY,
  SERVER_TICK_SECONDS,
  normalizeYaw,
  samplePlatformTransform,
  stepHorizontalMovement
} from "../src/shared/index";

type MovementFrame = {
  movement: MovementInput;
  yawDelta: number;
  pitchDelta: number;
  delta: number;
};

type ServerParityPlayer = {
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number | null;
  x: number;
  y: number;
  z: number;
  serverTick: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

const EPS_POSITION = 1e-3;
const EPS_VELOCITY = 1e-3;
const EPS_ANGLE = 1e-4;

function createNoopSpatialChannel(): ChannelAABB3D {
  const channel = {
    addEntity: (_entity: unknown) => undefined,
    removeEntity: (_entity: unknown) => undefined
  };
  return channel as unknown as ChannelAABB3D;
}

function createTrace(): MovementFrame[] {
  const frames: MovementFrame[] = [];
  const push = (
    count: number,
    frame: {
      forward: number;
      strafe: number;
      sprint: boolean;
      yawDelta?: number;
      pitchDelta?: number;
      jumpAtStart?: boolean;
    }
  ): void => {
    for (let i = 0; i < count; i += 1) {
      frames.push({
        movement: {
          forward: frame.forward,
          strafe: frame.strafe,
          sprint: frame.sprint,
          jump: i === 0 && Boolean(frame.jumpAtStart)
        },
        yawDelta: frame.yawDelta ?? 0,
        pitchDelta: frame.pitchDelta ?? 0,
        delta: SERVER_TICK_SECONDS
      });
    }
  };

  push(80, { forward: 0, strafe: 0, sprint: false });
  push(1, { forward: 0, strafe: 0, sprint: false, jumpAtStart: true });
  push(40, { forward: 1, strafe: 0, sprint: false, pitchDelta: 0.0015 });
  push(45, { forward: 1, strafe: 0, sprint: true, yawDelta: -0.01 });
  push(35, { forward: 0, strafe: 1, sprint: true, yawDelta: 0.013 });
  push(25, { forward: -0.4, strafe: 0.65, sprint: false, pitchDelta: -0.002 });
  push(40, { forward: 0, strafe: 0, sprint: false });

  return frames;
}

function assertClose(label: string, frameIndex: number, expected: number, actual: number, epsilon: number): void {
  if (Math.abs(expected - actual) <= epsilon) {
    return;
  }
  throw new Error(
    `Frame ${frameIndex}: ${label} mismatch expected=${expected.toFixed(6)} actual=${actual.toFixed(6)} eps=${epsilon}`
  );
}

async function runParityTest(): Promise<void> {
  await RAPIER.init();

  const local = await LocalPhysicsWorld.create();

  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.integrationParameters.dt = SERVER_TICK_SECONDS;
  const characterController = world.createCharacterController(0.01);
  characterController.setSlideEnabled(true);
  characterController.enableSnapToGround(0.2);
  characterController.disableAutostep();
  characterController.setMaxSlopeClimbAngle((60 * Math.PI) / 180);
  characterController.setMinSlopeSlideAngle((80 * Math.PI) / 180);

  let tick = 0;
  let elapsedSeconds = 0;

  const spatial = createNoopSpatialChannel();
  const worldBootstrap = new WorldBootstrapSystem({
    world,
    spatialChannel: spatial,
    getTickNumber: () => tick
  });
  worldBootstrap.createStaticWorldColliders();

  const platformSystem = new PlatformSystem({
    world,
    spatialChannel: spatial,
    getTickNumber: () => tick
  });
  platformSystem.initializePlatforms();

  const platformOne = PLATFORM_DEFINITIONS.find((definition) => definition.pid === 1);
  if (!platformOne) {
    throw new Error("Missing platform definition pid=1");
  }
  const platformOnePose = samplePlatformTransform(platformOne, 0);
  const bodyY = platformOnePose.y + platformOne.halfY + PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS;
  const cameraY = bodyY + PLAYER_CAMERA_OFFSET_Y;

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(platformOnePose.x, bodyY, platformOnePose.z)
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS).setFriction(0),
    body
  );

  const serverPlayer: ServerParityPlayer = {
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    groundedPlatformPid: 1,
    x: platformOnePose.x,
    y: cameraY,
    z: platformOnePose.z,
    serverTick: tick,
    body,
    collider
  };

  const serverPlayers = new Map<number, ServerParityPlayer>([[1, serverPlayer]]);

  const movementSystem = new PlayerMovementSystem<ServerParityPlayer>({
    characterController,
    getTickNumber: () => tick,
    samplePlayerPlatformCarry: (player) => platformSystem.samplePlayerPlatformCarry(player),
    findGroundedPlatformPid: (x, y, z, preferredPid) =>
      platformSystem.findGroundedPlatformPid(x, y, z, preferredPid),
    onPlayerStepped: () => undefined
  });

  local.setReconciliationState({
    x: serverPlayer.x,
    y: serverPlayer.y,
    z: serverPlayer.z,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    groundedPlatformPid: 1,
    serverTimeSeconds: 0
  });

  const trace = createTrace();
  let yaw = 0;
  let pitch = 0;

  for (let i = 0; i < trace.length; i += 1) {
    const frame = trace[i];
    if (!frame) {
      continue;
    }

    yaw = normalizeYaw(yaw + frame.yawDelta);
    pitch = Math.max(-1.45, Math.min(1.45, pitch + frame.pitchDelta));

    if (frame.movement.jump && serverPlayer.grounded) {
      serverPlayer.vy = PLAYER_JUMP_VELOCITY;
      serverPlayer.grounded = false;
      serverPlayer.groundedPlatformPid = null;
    }
    const horizontal = stepHorizontalMovement(
      { vx: serverPlayer.vx, vz: serverPlayer.vz },
      {
        forward: frame.movement.forward,
        strafe: frame.movement.strafe,
        sprint: frame.movement.sprint,
        yaw
      },
      serverPlayer.grounded,
      frame.delta
    );
    serverPlayer.vx = horizontal.vx;
    serverPlayer.vz = horizontal.vz;
    serverPlayer.yaw = yaw;
    serverPlayer.pitch = pitch;

    tick += 1;
    const previousElapsedSeconds = elapsedSeconds;
    elapsedSeconds += frame.delta;
    platformSystem.updatePlatforms(previousElapsedSeconds, elapsedSeconds);
    movementSystem.stepPlayers(serverPlayers, frame.delta);
    world.step();

    local.step(frame.delta, frame.movement, yaw, pitch);

    const localPose = local.getPose();
    const localKinematic = local.getKinematicState();

    assertClose("x", i, serverPlayer.x, localPose.x, EPS_POSITION);
    assertClose("y", i, serverPlayer.y, localPose.y, EPS_POSITION);
    assertClose("z", i, serverPlayer.z, localPose.z, EPS_POSITION);
    assertClose("yaw", i, serverPlayer.yaw, localPose.yaw, EPS_ANGLE);
    assertClose("pitch", i, serverPlayer.pitch, localPose.pitch, EPS_ANGLE);

    assertClose("vx", i, serverPlayer.vx, localKinematic.vx, EPS_VELOCITY);
    assertClose("vy", i, serverPlayer.vy, localKinematic.vy, EPS_VELOCITY);
    assertClose("vz", i, serverPlayer.vz, localKinematic.vz, EPS_VELOCITY);

    if (serverPlayer.grounded !== localKinematic.grounded) {
      throw new Error(
        `Frame ${i}: grounded mismatch expected=${serverPlayer.grounded} actual=${localKinematic.grounded}`
      );
    }
    if (serverPlayer.groundedPlatformPid !== localKinematic.groundedPlatformPid) {
      throw new Error(
        `Frame ${i}: groundedPlatformPid mismatch expected=${String(serverPlayer.groundedPlatformPid)} actual=${String(localKinematic.groundedPlatformPid)}`
      );
    }
  }

  console.log(
    `[movement-parity] PASS frames=${trace.length} final_pos=(${serverPlayer.x.toFixed(3)},${serverPlayer.y.toFixed(3)},${serverPlayer.z.toFixed(3)}) final_vel=(${serverPlayer.vx.toFixed(3)},${serverPlayer.vy.toFixed(3)},${serverPlayer.vz.toFixed(3)}) platformPid=${String(serverPlayer.groundedPlatformPid)}`
  );
}

void runParityTest().catch((error) => {
  console.error("[movement-parity] FAIL", error);
  process.exit(1);
});
