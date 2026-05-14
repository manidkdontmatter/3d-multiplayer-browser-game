// Validates broadphase-driven NPC perception, hostile/docile behavior branches, and lifecycle tiering.
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { init as initNavigation } from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";
import { NpcAiSystem, type AiVisibleTarget, type NpcCharacter } from "../src/server/ai/NpcAiSystem";
import { loadServerArchetypeCatalog } from "../src/server/content/ArchetypeCatalog";
import { CONTROLLER_KIND_AI } from "../src/server/controllers/ControllerSystem";
import { buildServerNavigationWorld } from "../src/server/navigation/NavigationWorldBuilder";
import {
  CharacterNavigationPlanner,
  NavigationWorld,
  RecastNavigationContext
} from "../src/server/navigation/NavigationService";

await RAPIER.init();
await initNavigation();

const navigationWorld = new NavigationWorld();
const navMeshResult = generateSoloNavMesh(
  [-8, 0, -8, -8, 0, 8, 8, 0, -8, 8, 0, 8],
  [0, 1, 2, 2, 1, 3],
  {
    cs: 0.25,
    ch: 0.2,
    walkableHeight: 4,
    walkableClimb: 1,
    walkableRadius: 1
  }
);
if (!navMeshResult.success) {
  throw new Error(`test navmesh should build: ${navMeshResult.error}`);
}
navigationWorld.registerContext(new RecastNavigationContext({
  id: "test:surface",
  kind: "location",
  navMesh: navMeshResult.navMesh,
  referenceFrameId: 123,
  priority: 10
}));
const navigation = new CharacterNavigationPlanner(navigationWorld);
const surfacePath = navigation.planPath({
  start: { x: -4, y: 0, z: 0 },
  end: { x: 4, y: 0, z: 0 },
  mode: "surface",
  startFrameId: 123,
  endFrameId: 123
});
assert.equal(surfacePath.status, "complete", "surface planner should query a Recast navmesh");
const proceduralBuild = buildServerNavigationWorld({
  enableRecastSurfaceNavigation: true,
  cache: { enabled: false }
});
assert.ok(
  proceduralBuild.world.getContext("location:10001"),
  "procedural island context should build a Recast navmesh at boot"
);
assert.ok(
  proceduralBuild.report.surfaceContextCount > 0,
  "boot builder should report at least one surface navigation context"
);

const catalog = loadServerArchetypeCatalog();
assert.equal(catalog.npcSpawns.length, 20, "archetype catalog should spawn 20 test NPCs on the terrain");
assert.ok(catalog.characterArchetypes.get(100), "hostile archetype 100 must exist");
assert.ok(catalog.characterArchetypes.get(101), "docile archetype 101 must exist");

const hostileSpawn = catalog.npcSpawns.find((spawn) => spawn.archetypeId === 100);
const docileSpawn = catalog.npcSpawns.find((spawn) => spawn.archetypeId === 101);
assert.ok(hostileSpawn, "npcSpawns must include at least one hostile guard spawn");
assert.ok(docileSpawn, "npcSpawns must include at least one docile flee spawn");
const hostileTestSpawn = { ...hostileSpawn, patrolPoints: [] };
const docileTestSpawn = { ...docileSpawn, patrolPoints: [] };

function createPerceptionTarget(
  world: RAPIER.World,
  seed: Omit<AiVisibleTarget, "eid" | "nid"> & { eid: number; nid: number }
): {
  readonly colliderHandle: number;
  readonly target: AiVisibleTarget;
  setPosition: (x: number, y: number, z: number) => void;
} {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(seed.x, seed.y, seed.z)
  );
  const collider = world.createCollider(RAPIER.ColliderDesc.ball(0.4), body);
  const target = {
    eid: seed.eid,
    nid: seed.nid,
    x: seed.x,
    y: seed.y,
    z: seed.z,
    movementMode: seed.movementMode,
    carriedFramePid: seed.carriedFramePid,
    groundedPlatformPid: seed.groundedPlatformPid
  };
  return {
    colliderHandle: collider.handle,
    target,
    setPosition: (x, y, z) => {
      body.setTranslation({ x, y, z }, true);
      target.x = x;
      target.y = y;
      target.z = z;
    }
  };
}

const created: NpcCharacter[] = [];

const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
const perceptionTargetsByColliderHandle = new Map<number, AiVisibleTarget>();
const hostileTargetFixture = createPerceptionTarget(world, {
  eid: 1,
  nid: 10,
  x: hostileTestSpawn.x + 10,
  y: hostileTestSpawn.y,
  z: hostileTestSpawn.z
});
perceptionTargetsByColliderHandle.set(hostileTargetFixture.colliderHandle, hostileTargetFixture.target);

const system = new NpcAiSystem({
  world,
  navigation,
  characterArchetypes: catalog.characterArchetypes,
  spawns: [hostileTestSpawn],
  controllerKindAi: CONTROLLER_KIND_AI,
  onCharacterCreated: (character) => created.push(character),
  onCharacterUpdated: () => {},
  hasPerceptionTargets: () => perceptionTargetsByColliderHandle.size > 0,
  resolvePerceptionTargetByColliderHandle: (colliderHandle) =>
    perceptionTargetsByColliderHandle.get(colliderHandle) ?? null,
  usePrimaryAbility: () => {},
  aiTickIntervalSeconds: 0.2,
  perceptionTickIntervalSeconds: 0.2,
  pathReplanIntervalSeconds: 0.2,
  inactiveAiTickIntervalSeconds: 0.5,
  inactivePerceptionTickIntervalSeconds: 0.75,
  inactivePathReplanIntervalSeconds: 1.25,
  lifecycleRecheckIntervalSeconds: 0.25,
  inactiveMoveSpeedScale: 0.7,
  pathStuckTimeoutSeconds: 1,
  pathStuckRecoveryDelaySeconds: 0.4,
  hibernationEnabled: false
});

system.initialize();
world.step();
assert.equal(created.length, 1, "hostile guard should spawn as an AI-controlled character");

let chasedTarget = false;
for (let elapsed = 0; elapsed <= 1.2; elapsed += 0.2) {
  system.step(elapsed);
  if (Math.hypot(created[0].vx, created[0].vz) > 0.01) {
    chasedTarget = true;
    break;
  }
}
assert.equal(chasedTarget, true, "hostile guard should chase a perceived target via broadphase");

const hibernatingCreated: NpcCharacter[] = [];
const hibernatingWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
const hibernatingSystem = new NpcAiSystem({
  world: hibernatingWorld,
  navigation,
  characterArchetypes: catalog.characterArchetypes,
  spawns: [hostileTestSpawn],
  controllerKindAi: CONTROLLER_KIND_AI,
  onCharacterCreated: (character) => hibernatingCreated.push(character),
  onCharacterUpdated: () => {},
  hasPerceptionTargets: () => false,
  resolvePerceptionTargetByColliderHandle: () => null,
  usePrimaryAbility: () => {},
  aiTickIntervalSeconds: 0.2,
  perceptionTickIntervalSeconds: 0.2,
  pathReplanIntervalSeconds: 0.2,
  inactiveAiTickIntervalSeconds: 0.5,
  inactivePerceptionTickIntervalSeconds: 0.75,
  inactivePathReplanIntervalSeconds: 1.25,
  lifecycleRecheckIntervalSeconds: 0.25,
  inactiveMoveSpeedScale: 0.7,
  pathStuckTimeoutSeconds: 1,
  pathStuckRecoveryDelaySeconds: 0.4,
  hibernationEnabled: true
});

hibernatingSystem.initialize();
hibernatingWorld.step();
hibernatingSystem.step(0);
hibernatingSystem.step(0.4);
assert.equal(hibernatingCreated.length, 1, "hibernating guard should still exist server-side");
assert.equal(hibernatingSystem.getActiveCount(), 0, "guard should hibernate without nearby targets");

const inactiveWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
const inactiveTargetByHandle = new Map<number, AiVisibleTarget>();
const inactiveTargetFixture = createPerceptionTarget(inactiveWorld, {
  eid: 2,
  nid: 11,
  x: hostileTestSpawn.x + 165,
  y: hostileTestSpawn.y,
  z: hostileTestSpawn.z
});
inactiveTargetByHandle.set(inactiveTargetFixture.colliderHandle, inactiveTargetFixture.target);

const inactiveSystem = new NpcAiSystem({
  world: inactiveWorld,
  navigation,
  characterArchetypes: catalog.characterArchetypes,
  spawns: [hostileTestSpawn],
  controllerKindAi: CONTROLLER_KIND_AI,
  onCharacterCreated: () => {},
  onCharacterUpdated: () => {},
  hasPerceptionTargets: () => inactiveTargetByHandle.size > 0,
  resolvePerceptionTargetByColliderHandle: (colliderHandle) =>
    inactiveTargetByHandle.get(colliderHandle) ?? null,
  usePrimaryAbility: () => {},
  aiTickIntervalSeconds: 0.2,
  perceptionTickIntervalSeconds: 0.2,
  pathReplanIntervalSeconds: 0.2,
  inactiveAiTickIntervalSeconds: 0.5,
  inactivePerceptionTickIntervalSeconds: 0.75,
  inactivePathReplanIntervalSeconds: 1.25,
  lifecycleRecheckIntervalSeconds: 0.25,
  inactiveMoveSpeedScale: 0.7,
  pathStuckTimeoutSeconds: 1,
  pathStuckRecoveryDelaySeconds: 0.4,
  hibernationEnabled: true
});
inactiveSystem.initialize();
inactiveWorld.step();
inactiveSystem.step(0);
inactiveSystem.step(0.4);
assert.equal(
  inactiveSystem.getStats().hibernating,
  0,
  "guard should remain awake when a target exists inside deactivation radius"
);

const docileCreated: NpcCharacter[] = [];
let docilePrimaryUses = 0;
const docileWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
const docileTargetsByHandle = new Map<number, AiVisibleTarget>();
const docileThreatFixture = createPerceptionTarget(docileWorld, {
  eid: 3,
  nid: 12,
  x: docileTestSpawn.x + 7,
  y: docileTestSpawn.y,
  z: docileTestSpawn.z + 1
});
docileTargetsByHandle.set(docileThreatFixture.colliderHandle, docileThreatFixture.target);

const docileSystem = new NpcAiSystem({
  world: docileWorld,
  navigation,
  characterArchetypes: catalog.characterArchetypes,
  spawns: [docileTestSpawn],
  controllerKindAi: CONTROLLER_KIND_AI,
  onCharacterCreated: (character) => docileCreated.push(character),
  onCharacterUpdated: () => {},
  hasPerceptionTargets: () => docileTargetsByHandle.size > 0,
  resolvePerceptionTargetByColliderHandle: (colliderHandle) =>
    docileTargetsByHandle.get(colliderHandle) ?? null,
  usePrimaryAbility: () => {
    docilePrimaryUses += 1;
  },
  aiTickIntervalSeconds: 0.2,
  perceptionTickIntervalSeconds: 0.2,
  pathReplanIntervalSeconds: 0.2,
  inactiveAiTickIntervalSeconds: 0.5,
  inactivePerceptionTickIntervalSeconds: 0.75,
  inactivePathReplanIntervalSeconds: 1.25,
  lifecycleRecheckIntervalSeconds: 0.25,
  inactiveMoveSpeedScale: 0.7,
  pathStuckTimeoutSeconds: 1,
  pathStuckRecoveryDelaySeconds: 0.4,
  hibernationEnabled: false
});

docileSystem.initialize();
docileWorld.step();
for (let elapsed = 0; elapsed <= 1.2; elapsed += 0.2) {
  docileSystem.step(elapsed);
}
assert.equal(docileCreated.length, 1, "docile NPC should spawn and tick AI");
const toThreatX = docileThreatFixture.target.x - docileCreated[0].x;
const toThreatZ = docileThreatFixture.target.z - docileCreated[0].z;
const fleeDot = docileCreated[0].vx * toThreatX + docileCreated[0].vz * toThreatZ;
assert.ok(fleeDot < 0, "docile NPC should move away from perceived player threat");
assert.equal(docilePrimaryUses, 0, "docile NPC should not attack while fleeing");

console.log("npc-ai-regression passed");
