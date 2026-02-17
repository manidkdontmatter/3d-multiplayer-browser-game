import process from "node:process";
import { NType, type InputAckMessage, type AbilityDefinitionMessage, type LoadoutStateMessage } from "../src/shared/netcode";
import { AckReconciliationBuffer } from "../src/client/runtime/network/AckReconciliationBuffer";
import { InterpolationController } from "../src/client/runtime/network/InterpolationController";
import { AbilityStateStore } from "../src/client/runtime/network/AbilityStateStore";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runAckBufferRegression(): void {
  let now = 0;
  const ackArrivalSamples: number[] = [];
  const buffer = new AckReconciliationBuffer(
    (acceptedAtMs) => {
      ackArrivalSamples.push(acceptedAtMs);
    },
    () => now
  );

  buffer.enqueueInput(1 / 60, { forward: 1, strafe: 0, sprint: false, jump: false }, { yaw: 0, pitch: 0 });
  buffer.enqueueInput(1 / 60, { forward: 1, strafe: 0, sprint: false, jump: false }, { yaw: 0.1, pitch: 0 });

  const ack1: InputAckMessage = {
    ntype: NType.InputAckMessage,
    sequence: 1,
    serverTick: 10,
    x: 1,
    y: 2,
    z: 3,
    yaw: 0.1,
    pitch: 0,
    vx: 1,
    vy: 0,
    vz: 0,
    grounded: true,
    groundedPlatformPid: -1,
    platformYawDelta: 0
  };
  buffer.enqueueAckMessage(ack1, { enabled: false, ackDropRate: 0, ackDelayMs: 0, ackJitterMs: 0 });

  const frame1 = buffer.consumeReconciliationFrame();
  assert(frame1 !== null, "Expected reconciliation frame after immediate ack");
  assert(frame1?.ack.sequence === 1, "Expected ack sequence 1");
  assert(frame1?.replay.length === 1, "Expected first ack to trim first pending input");

  const staleAck: InputAckMessage = { ...ack1, sequence: 1, serverTick: 11 };
  buffer.enqueueAckMessage(staleAck, { enabled: false, ackDropRate: 0, ackDelayMs: 0, ackJitterMs: 0 });
  const staleFrame = buffer.consumeReconciliationFrame();
  assert(staleFrame === null, "Stale ack should be ignored");

  const delayedAck: InputAckMessage = {
    ...ack1,
    sequence: 2,
    serverTick: 12,
    groundedPlatformPid: 2,
    platformYawDelta: 0.02
  };
  buffer.enqueueAckMessage(delayedAck, { enabled: true, ackDropRate: 0, ackDelayMs: 100, ackJitterMs: 0 });
  now = 50;
  buffer.processBufferedAcks();
  assert(buffer.consumeReconciliationFrame() === null, "Ack should not be processed before ready time");

  now = 100;
  buffer.processBufferedAcks();
  const frame2 = buffer.consumeReconciliationFrame();
  assert(frame2 !== null, "Ack should be processed at ready time");
  assert(frame2?.ack.sequence === 2, "Expected ack sequence 2");
  assert(ackArrivalSamples.length >= 2, "Expected ack arrival callback to be invoked");
  assert(buffer.getServerGroundedPlatformPid() === 2, "Expected grounded platform pid to update");
}

function runInterpolationRegression(): void {
  const interpolation = new InterpolationController();
  interpolation.observeAckArrival(1000);
  interpolation.observeAckArrival(1034);
  interpolation.observeAckArrival(1068);
  interpolation.update(50);

  const delay = interpolation.getInterpolationDelayMs();
  const jitter = interpolation.getAckJitterMs();
  assert(delay >= 60 && delay <= 220, `Interpolation delay should remain clamped, got ${delay}`);
  assert(jitter >= 0, `Ack jitter should be non-negative, got ${jitter}`);

  interpolation.reset();
  assert(interpolation.getAckJitterMs() === 0, "Expected jitter reset");
}

function runAbilityStateRegression(): void {
  const abilities = new AbilityStateStore();

  const abilityMsg: AbilityDefinitionMessage = {
    ntype: NType.AbilityDefinitionMessage,
    abilityId: 4000,
    name: "Test Bolt",
    category: 1,
    pointsPower: 4,
    pointsVelocity: 4,
    pointsEfficiency: 4,
    pointsControl: 4,
    attributeMask: 0,
    kind: 1,
    speed: 20,
    damage: 10,
    radius: 0.2,
    cooldownSeconds: 0.5,
    lifetimeSeconds: 1,
    spawnForwardOffset: 0.2,
    spawnVerticalOffset: 0,
    meleeRange: 0,
    meleeArcDegrees: 0
  };

  const loadoutMsg: LoadoutStateMessage = {
    ntype: NType.LoadoutStateMessage,
    selectedHotbarSlot: 2,
    slot0AbilityId: 4000,
    slot1AbilityId: 0,
    slot2AbilityId: 0,
    slot3AbilityId: 0,
    slot4AbilityId: 0
  };

  abilities.processMessage(abilityMsg);
  abilities.processMessage(loadoutMsg);
  abilities.processMessage({
    ntype: NType.AbilityUseMessage,
    ownerNid: 7,
    abilityId: 4000,
    category: 1,
    serverTick: 99
  });

  const batch = abilities.consumeAbilityEvents();
  assert(batch !== null, "Expected ability event batch");
  assert(batch?.definitions.length === 1, "Expected one definition in batch");
  assert(batch?.loadout?.selectedHotbarSlot === 2, "Expected loadout selection to round-trip");

  const useEvents = abilities.consumeAbilityUseEvents();
  assert(useEvents.length === 1, "Expected one ability-use event");
  assert(abilities.getAbilityById(4000) !== null, "Expected runtime ability to be cataloged");
}

try {
  runAckBufferRegression();
  runInterpolationRegression();
  runAbilityStateRegression();
  console.log("[network-client-regression] PASS");
} catch (error) {
  console.error("[network-client-regression] FAIL", error);
  process.exit(1);
}
