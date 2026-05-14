// Deterministic parity harness validating client prediction and server authority movement alignment.
import process from "node:process";
import RAPIER from "@dimforge/rapier3d-compat";
import { LocalPhysicsWorld } from "../src/engine/client/runtime/LocalPhysicsWorld";
import type { MovementInput } from "../src/engine/client/runtime/types";
import { PlayerMovementSystem } from "../src/engine/server/movement/PlayerMovementSystem";
import { PlatformSystem } from "../src/engine/server/platform/PlatformSystem";
import { WorldBootstrapSystem } from "../src/engine/server/world/WorldBootstrapSystem";
import { LocationRootSystem } from "../src/engine/server/location/LocationRootSystem";
import {
  GROUND_CONTACT_MIN_NORMAL_Y,
  MOVEMENT_MODE_FLYING,
  MOVEMENT_MODE_GROUNDED,
  PLATFORM_DEFINITIONS,
  PLAYER_CAMERA_OFFSET_Y,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  PLAYER_JUMP_VELOCITY,
  SERVER_TICK_SECONDS,
  VOID_LOCATION_DEFINITIONS,
  normalizeYaw,
  quaternionFromYawPitchRoll,
  sampleLocationTransform,
  samplePlatformTransform,
  stepFlyingMovement,
  toggleMovementMode,
  stepHorizontalMovement,
  type MovementMode
} from "../src/engine/shared/index";

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
  movementMode: MovementMode;
  groundedPlatformPid: number | null;
  carriedFramePid: number | null;
  x: number;
  y: number;
  z: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  serverTick: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

const EPS_POSITION = 1e-3;
const EPS_VELOCITY = 1e-3;
const EPS_ANGLE = 1e-4;

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
      toggleFlyAtStart?: boolean;
    }
  ): void => {
    for (let i = 0; i < count; i += 1) {
      frames.push({
        movement: {
          forward: frame.forward,
          strafe: frame.strafe,
          sprint: frame.sprint,
          jump: i === 0 && Boolean(frame.jumpAtStart),
          toggleFlyPressed: i === 0 && Boolean(frame.toggleFlyAtStart)
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
  push(1, { forward: 0, strafe: 0, sprint: false, toggleFlyAtStart: true });
  push(50, { forward: 1, strafe: 0, sprint: false, pitchDelta: 0.014 });
  push(35, { forward: 1, strafe: 0.6, sprint: true, yawDelta: -0.008, pitchDelta: -0.01 });
  push(1, { forward: 0, strafe: 0, sprint: false, toggleFlyAtStart: true });
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

  const worldBootstrap = new WorldBootstrapSystem({
    world
  });
  worldBootstrap.createStaticWorldColliders();

  const platformSystem = new PlatformSystem({
    world,
    definitions: PLATFORM_DEFINITIONS
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
  world.step();

  const serverPlayer: ServerParityPlayer = {
    yaw: 0,
    pitch: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    movementMode: MOVEMENT_MODE_GROUNDED,
    groundedPlatformPid: 1,
    carriedFramePid: null,
    x: platformOnePose.x,
    y: cameraY,
    z: platformOnePose.z,
    position: { x: platformOnePose.x, y: cameraY, z: platformOnePose.z },
    rotation: quaternionFromYawPitchRoll(0, 0),
    serverTick: tick,
    body,
    collider
  };

  const serverPlayers = new Map<number, ServerParityPlayer>([[1, serverPlayer]]);

  const movementSystem = new PlayerMovementSystem<ServerParityPlayer>({
    characterController,
    samplePlayerPlatformCarry: (player) => ({
      ...platformSystem.samplePlayerPlatformCarry(player),
      carriedFramePid: null
    }),
    resolveGroundSupportColliderHandle: (player, groundedByQuery) => {
      if (!groundedByQuery) {
        return { hit: false, colliderHandle: null };
      }
      const snapDistance = characterController.snapToGroundDistance() ?? 0;
      const origin = player.body.translation();
      const maxToi = PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS + snapDistance + 0.1;
      const hit = world.castRayAndGetNormal(
        new RAPIER.Ray(
          {
            x: origin.x,
            y: origin.y + 0.05,
            z: origin.z
          },
          { x: 0, y: -1, z: 0 }
        ),
        maxToi,
        true,
        undefined,
        undefined,
        player.collider,
        player.body,
        (collider) => collider.handle !== player.collider.handle
      );
      if (!hit) {
        return { hit: false, colliderHandle: null };
      }
      if (!Number.isFinite(hit.normal.y) || hit.normal.y < GROUND_CONTACT_MIN_NORMAL_Y) {
        return { hit: false, colliderHandle: null };
      }
      return { hit: true, colliderHandle: hit.collider.handle };
    },
    resolvePlatformPidByColliderHandle: (colliderHandle) =>
      platformSystem.resolvePlatformPidByColliderHandle(colliderHandle),
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
    carriedFramePid: -1,
    movementMode: MOVEMENT_MODE_GROUNDED,
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

    if (frame.movement.toggleFlyPressed) {
      serverPlayer.movementMode = toggleMovementMode(serverPlayer.movementMode);
      serverPlayer.grounded = false;
      serverPlayer.groundedPlatformPid = null;
      serverPlayer.vy = 0;
    }
    if (serverPlayer.movementMode === MOVEMENT_MODE_GROUNDED) {
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
    } else if (serverPlayer.movementMode === MOVEMENT_MODE_FLYING) {
      serverPlayer.grounded = false;
      serverPlayer.groundedPlatformPid = null;
      const directional = stepFlyingMovement(
        { vx: serverPlayer.vx, vy: serverPlayer.vy, vz: serverPlayer.vz },
        {
          forward: frame.movement.forward,
          strafe: frame.movement.strafe,
          sprint: frame.movement.sprint,
          yaw,
          pitch
        },
        frame.delta
      );
      serverPlayer.vx = directional.vx;
      serverPlayer.vy = directional.vy;
      serverPlayer.vz = directional.vz;
    }
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
    if (serverPlayer.movementMode !== localKinematic.movementMode) {
      throw new Error(
        `Frame ${i}: movementMode mismatch expected=${serverPlayer.movementMode} actual=${localKinematic.movementMode}`
      );
    }
    if (serverPlayer.groundedPlatformPid !== localKinematic.groundedPlatformPid) {
      throw new Error(
        `Frame ${i}: groundedPlatformPid mismatch expected=${String(serverPlayer.groundedPlatformPid)} actual=${String(localKinematic.groundedPlatformPid)}`
      );
    }
    if (serverPlayer.carriedFramePid !== localKinematic.carriedFramePid) {
      throw new Error(
        `Frame ${i}: carriedFramePid mismatch expected=${String(serverPlayer.carriedFramePid)} actual=${String(localKinematic.carriedFramePid)}`
      );
    }
  }

  {
    const movingLocal = await LocalPhysicsWorld.create();
    const movingWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
    movingWorld.integrationParameters.dt = SERVER_TICK_SECONDS;
    const movingController = movingWorld.createCharacterController(0.01);
    movingController.setSlideEnabled(true);
    movingController.enableSnapToGround(0.2);
    movingController.disableAutostep();
    movingController.setMaxSlopeClimbAngle((60 * Math.PI) / 180);
    movingController.setMinSlopeSlideAngle((80 * Math.PI) / 180);

    const movingWorldBootstrap = new WorldBootstrapSystem({
      world: movingWorld
    });
    movingWorldBootstrap.createStaticWorldColliders();

    const movingLocationSystem = new LocationRootSystem({
      world: movingWorld
    });
    movingLocationSystem.initializeLocations();

    const movingDefinition = VOID_LOCATION_DEFINITIONS.find(
      (definition) => definition.id === "single-volume-moving-slab"
    );
    if (!movingDefinition) {
      throw new Error("Missing single-volume-moving-slab definition");
    }
    const movingPose = sampleLocationTransform(movingDefinition, 0);
    const movingBodyY = movingPose.y + 0.5 + PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS;
    const movingCameraY = movingBodyY + PLAYER_CAMERA_OFFSET_Y;
    const movingBody = movingWorld.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(movingPose.x, movingBodyY, movingPose.z)
    );
    const movingCollider = movingWorld.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_RADIUS).setFriction(0),
      movingBody
    );
    movingWorld.step();
    const movingServerPlayer: ServerParityPlayer = {
      yaw: 0,
      pitch: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      movementMode: MOVEMENT_MODE_GROUNDED,
      groundedPlatformPid: null,
      carriedFramePid: movingDefinition.pid,
      x: movingPose.x,
      y: movingCameraY,
      z: movingPose.z,
      position: { x: movingPose.x, y: movingCameraY, z: movingPose.z },
      rotation: quaternionFromYawPitchRoll(0, 0),
      serverTick: 0,
      body: movingBody,
      collider: movingCollider
    };
    const movingServerPlayers = new Map<number, ServerParityPlayer>([[1, movingServerPlayer]]);
    const movingSystem = new PlayerMovementSystem<ServerParityPlayer>({
      characterController: movingController,
      samplePlayerPlatformCarry: (player) => movingLocationSystem.sampleFrameCarry(player),
      resolvePlayerCarriedFramePid: (_player, movedBody, previousCarriedFramePid) =>
        movingLocationSystem.resolveCarriedFramePidForPoint(movedBody, previousCarriedFramePid),
      resolveGroundSupportColliderHandle: (player, groundedByQuery) => {
        if (!groundedByQuery) {
          return { hit: false, colliderHandle: null };
        }
        const snapDistance = movingController.snapToGroundDistance() ?? 0;
        const origin = player.body.translation();
        const maxToi = PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS + snapDistance + 0.1;
        const hit = movingWorld.castRayAndGetNormal(
          new RAPIER.Ray(
            {
              x: origin.x,
              y: origin.y + 0.05,
              z: origin.z
            },
            { x: 0, y: -1, z: 0 }
          ),
          maxToi,
          true,
          undefined,
          undefined,
          player.collider,
          player.body,
          (collider) => collider.handle !== player.collider.handle && !collider.isSensor()
        );
        if (!hit) {
          return { hit: false, colliderHandle: null };
        }
        if (!Number.isFinite(hit.normal.y) || hit.normal.y < GROUND_CONTACT_MIN_NORMAL_Y) {
          return { hit: false, colliderHandle: null };
        }
        return { hit: true, colliderHandle: hit.collider.handle };
      },
      resolvePlatformPidByColliderHandle: () => null,
      onPlayerStepped: () => undefined
    });

    movingLocal.setReconciliationState({
      x: movingServerPlayer.x,
      y: movingServerPlayer.y,
      z: movingServerPlayer.z,
      yaw: 0,
      pitch: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      groundedPlatformPid: -1,
      carriedFramePid: movingDefinition.pid,
      movementMode: MOVEMENT_MODE_GROUNDED,
      serverTimeSeconds: 0
    });

    let movingSeconds = 0;
    let movingYaw = 0;
    const idleMovement: MovementInput = {
      forward: 0,
      strafe: 0,
      sprint: false,
      jump: false,
      toggleFlyPressed: false
    };

    for (let i = 0; i < 180; i += 1) {
      const predictedFrameYawDelta = movingLocal.predictCarriedFrameYawDelta(SERVER_TICK_SECONDS);
      movingServerPlayer.yaw = movingYaw;
      const previousMovingSeconds = movingSeconds;
      movingSeconds += SERVER_TICK_SECONDS;
      movingLocationSystem.updateLocations(previousMovingSeconds, movingSeconds);
      movingSystem.stepPlayers(movingServerPlayers, SERVER_TICK_SECONDS, movingSeconds);
      movingWorld.step();

      movingYaw = normalizeYaw(movingYaw + predictedFrameYawDelta);
      movingLocal.step(SERVER_TICK_SECONDS, idleMovement, movingYaw, 0);
      const localPose = movingLocal.getPose();
      const localKinematic = movingLocal.getKinematicState();
      assertClose("moving x", i, movingServerPlayer.x, localPose.x, EPS_POSITION);
      assertClose("moving y", i, movingServerPlayer.y, localPose.y, EPS_POSITION);
      assertClose("moving z", i, movingServerPlayer.z, localPose.z, EPS_POSITION);
      assertClose("moving yaw", i, movingServerPlayer.yaw, localPose.yaw, EPS_ANGLE);
      if (localKinematic.carriedFramePid !== movingDefinition.pid) {
        throw new Error(
          `Frame ${i}: moving carriedFramePid mismatch expected=${movingDefinition.pid} actual=${String(localKinematic.carriedFramePid)}`
        );
      }
      if (!localKinematic.grounded || !movingServerPlayer.grounded) {
        throw new Error(
          `Frame ${i}: moving grounded mismatch expected=${movingServerPlayer.grounded} actual=${localKinematic.grounded}`
        );
      }
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
