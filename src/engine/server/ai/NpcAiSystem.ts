// Runs server-authoritative NPC behavior trees with Rapier broadphase perception and navigation-backed movement.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  ABILITY_ID_PUNCH,
  HOTBAR_SLOT_COUNT,
  MOVEMENT_MODE_FLYING,
  MOVEMENT_MODE_GROUNDED,
  PHYSICS_GROUP_CHARACTER,
  quaternionFromYawPitchRoll
} from "../../shared/index";
import type { CharacterObject } from "../ecs/SimulationEcsTypes";
import type {
  CharacterArchetypeDefinition,
  NpcSpawnDefinition
} from "../content/ArchetypeCatalog";
import type {
  CharacterNavigationPlanner,
  NavPoint,
  NavigationMode
} from "../navigation/NavigationService";

export type NpcLifecycleState = "active" | "inactive" | "hibernating";
export type NpcBehaviorState = "idle" | "patrol" | "wander" | "chase" | "attack" | "flee";

export type NpcCharacter = CharacterObject & {
  characterArchetypeId: number;
  controllerKind: number;
};

export interface AiVisibleTarget {
  readonly eid: number;
  readonly nid: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly movementMode?: number;
  readonly carriedFramePid?: number | null;
  readonly groundedPlatformPid?: number | null;
}

export interface NpcPresenceStimulus {
  readonly target: AiVisibleTarget;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly expiresAtSeconds: number;
}

interface NpcBlackboard {
  target: AiVisibleTarget | null;
  stimulus: NpcPresenceStimulus | null;
  behaviorState: NpcBehaviorState;
  lifecycleState: NpcLifecycleState;
  path: NavPoint[];
  pathIndex: number;
  patrolIndex: number;
  wanderGoal: NavPoint | null;
  wanderSeed: number;
  nextWanderAtSeconds: number;
  phase: number;
  nextLifecycleAtSeconds: number;
  nextThinkAtSeconds: number;
  nextPerceptionAtSeconds: number;
  nextPathAtSeconds: number;
  consecutivePathFailures: number;
  lastPathProgressAtSeconds: number;
  lastPathDistance: number;
}

interface NpcRuntime {
  readonly character: NpcCharacter;
  readonly archetype: CharacterArchetypeDefinition;
  readonly spawn: NpcSpawnDefinition;
  readonly blackboard: NpcBlackboard;
}

interface LifecycleProfile {
  readonly thinkIntervalSeconds: number;
  readonly perceptionIntervalSeconds: number;
  readonly pathReplanIntervalSeconds: number;
  readonly moveSpeedScale: number;
  readonly allowBehaviorTick: boolean;
}

export interface NpcAiStats {
  readonly total: number;
  readonly active: number;
  readonly inactive: number;
  readonly hibernating: number;
  readonly behaviorTicks: number;
  readonly perceptionTicks: number;
  readonly pathReplans: number;
  readonly pathFailures: number;
  readonly stuckResets: number;
  readonly lifecycleTransitions: number;
  readonly stimuliReceived: number;
}

export interface NpcAiSystemOptions {
  readonly world: RAPIER.World;
  readonly navigation: CharacterNavigationPlanner;
  readonly characterArchetypes: ReadonlyMap<number, CharacterArchetypeDefinition>;
  readonly spawns: readonly NpcSpawnDefinition[];
  readonly controllerKindAi: number;
  readonly onCharacterCreated: (character: NpcCharacter) => void;
  readonly onCharacterUpdated: (character: NpcCharacter) => void;
  readonly hasPerceptionTargets: () => boolean;
  readonly resolvePerceptionTargetByColliderHandle: (colliderHandle: number) => AiVisibleTarget | null;
  readonly usePrimaryAbility: (character: NpcCharacter) => void;
  readonly aiTickIntervalSeconds: number;
  readonly perceptionTickIntervalSeconds: number;
  readonly pathReplanIntervalSeconds: number;
  readonly inactiveAiTickIntervalSeconds: number;
  readonly inactivePerceptionTickIntervalSeconds: number;
  readonly inactivePathReplanIntervalSeconds: number;
  readonly lifecycleRecheckIntervalSeconds: number;
  readonly inactiveMoveSpeedScale: number;
  readonly pathStuckTimeoutSeconds: number;
  readonly pathStuckRecoveryDelaySeconds: number;
  readonly hibernationEnabled: boolean;
}

const ARRIVAL_DISTANCE = 0.8;
const ATTACK_FACE_PITCH = 0;
const PATH_PROGRESS_EPSILON = 0.03;
const PERCEPTION_RADIUS_CACHE_SCALE = 100;
const NPC_SEPARATION_RADIUS = 1.1;
const NPC_SEPARATION_SPEED_SCALE = 0.55;
const NPC_ATTACK_SEPARATION_SPEED_SCALE = 0.25;
const NPC_SEPARATION_MAX_SPEED_SCALE = 1.15;
const WANDER_MIN_RADIUS = 4;
const WANDER_MAX_RADIUS = 18;
const WANDER_IDLE_MIN_SECONDS = 1.5;
const WANDER_IDLE_MAX_SECONDS = 4.5;
const FLEE_FALLBACK_ANGLE_OFFSET = Math.PI * 0.25;
const IDENTITY_ROTATION: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };

export class NpcAiSystem {
  private readonly npcs: NpcRuntime[] = [];
  private readonly npcByColliderHandle = new Map<number, NpcRuntime>();
  private readonly perceptionShapeCache = new Map<number, RAPIER.Ball>();
  private readonly separationShape = new RAPIER.Ball(NPC_SEPARATION_RADIUS);
  private behaviorTicks = 0;
  private perceptionTicks = 0;
  private pathReplans = 0;
  private pathFailures = 0;
  private stuckResets = 0;
  private lifecycleTransitions = 0;
  private stimuliReceived = 0;

  public constructor(private readonly options: NpcAiSystemOptions) {}

  public initialize(): void {
    for (let index = 0; index < this.options.spawns.length; index += 1) {
      const spawn = this.options.spawns[index];
      if (!spawn) {
        continue;
      }
      const archetype = this.options.characterArchetypes.get(spawn.archetypeId);
      if (!archetype || !this.supportsBehaviorTree(archetype.behaviorTreeId)) {
        continue;
      }
      const character = this.createCharacter(archetype, spawn);
      const phase = this.computePhase(spawn, index);
      const runtime: NpcRuntime = {
        character,
        archetype,
        spawn,
        blackboard: {
          target: null,
          stimulus: null,
          behaviorState: "idle",
          lifecycleState: "active",
          path: [],
          pathIndex: 0,
          patrolIndex: 0,
          wanderGoal: null,
          wanderSeed: this.computeWanderSeed(spawn, index),
          nextWanderAtSeconds: 0,
          phase,
          nextLifecycleAtSeconds: phase * this.options.lifecycleRecheckIntervalSeconds,
          nextThinkAtSeconds: phase * this.options.aiTickIntervalSeconds,
          nextPerceptionAtSeconds: phase * this.options.perceptionTickIntervalSeconds,
          nextPathAtSeconds: 0,
          consecutivePathFailures: 0,
          lastPathProgressAtSeconds: 0,
          lastPathDistance: Number.POSITIVE_INFINITY
        }
      };
      this.npcs.push(runtime);
      this.npcByColliderHandle.set(character.collider.handle, runtime);
      this.options.onCharacterCreated(character);
    }
  }

  public step(elapsedSeconds: number): void {
    for (const guard of this.npcs) {
      if (elapsedSeconds >= guard.blackboard.nextLifecycleAtSeconds) {
        const previous = guard.blackboard.lifecycleState;
        this.updateLifecycle(guard, elapsedSeconds);
        if (previous !== guard.blackboard.lifecycleState) {
          this.lifecycleTransitions += 1;
          this.realignScheduleForTier(guard, elapsedSeconds);
        }
        guard.blackboard.nextLifecycleAtSeconds = this.scheduleNext(
          guard.blackboard.nextLifecycleAtSeconds,
          elapsedSeconds,
          this.options.lifecycleRecheckIntervalSeconds
        );
      }

      const profile = this.resolveLifecycleProfile(guard.blackboard.lifecycleState);
      if (!profile.allowBehaviorTick) {
        this.stopCharacter(guard.character);
        this.options.onCharacterUpdated(guard.character);
        continue;
      }
      if (elapsedSeconds < guard.blackboard.nextThinkAtSeconds) {
        continue;
      }

      this.behaviorTicks += 1;
      this.tickBehaviorTree(guard, elapsedSeconds, profile);
      this.applyLocalSeparation(guard);
      guard.blackboard.nextThinkAtSeconds = this.scheduleNext(
        guard.blackboard.nextThinkAtSeconds,
        elapsedSeconds,
        profile.thinkIntervalSeconds
      );
      this.options.onCharacterUpdated(guard.character);
    }
  }

  public getCharacters(): readonly NpcCharacter[] {
    return this.npcs.map((guard) => guard.character);
  }

  public getActiveCount(): number {
    return this.npcs.filter((guard) => guard.blackboard.lifecycleState === "active").length;
  }

  public receivePlayerPresenceByColliderHandle(
    colliderHandle: number,
    stimulus: NpcPresenceStimulus,
    elapsedSeconds: number
  ): boolean {
    const runtime = this.npcByColliderHandle.get(colliderHandle);
    if (!runtime) {
      return false;
    }
    const dx = stimulus.x - runtime.character.x;
    const dy = stimulus.y - runtime.character.y;
    const dz = stimulus.z - runtime.character.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    const maxDistance = runtime.archetype.deactivationRadius;
    if (distanceSq > maxDistance * maxDistance) {
      return false;
    }
    runtime.blackboard.stimulus = stimulus;
    if (runtime.blackboard.lifecycleState === "hibernating") {
      runtime.blackboard.lifecycleState =
        distanceSq <= runtime.archetype.activationRadius * runtime.archetype.activationRadius
        ? "active"
        : "inactive";
      this.lifecycleTransitions += 1;
      this.realignScheduleForTier(runtime, elapsedSeconds);
    }
    this.stimuliReceived += 1;
    return true;
  }

  public getStats(): NpcAiStats {
    let active = 0;
    let inactive = 0;
    let hibernating = 0;
    for (const guard of this.npcs) {
      if (guard.blackboard.lifecycleState === "active") {
        active += 1;
        continue;
      }
      if (guard.blackboard.lifecycleState === "inactive") {
        inactive += 1;
        continue;
      }
      hibernating += 1;
    }
    return {
      total: this.npcs.length,
      active,
      inactive,
      hibernating,
      behaviorTicks: this.behaviorTicks,
      perceptionTicks: this.perceptionTicks,
      pathReplans: this.pathReplans,
      pathFailures: this.pathFailures,
      stuckResets: this.stuckResets,
      lifecycleTransitions: this.lifecycleTransitions,
      stimuliReceived: this.stimuliReceived
    };
  }

  private tickBehaviorTree(
    guard: NpcRuntime,
    elapsedSeconds: number,
    profile: LifecycleProfile
  ): void {
    if (guard.archetype.behaviorTreeId === "wander.v1") {
      guard.blackboard.target = null;
      this.runWanderBranch(guard, elapsedSeconds, profile);
      return;
    }

    if (elapsedSeconds >= guard.blackboard.nextPerceptionAtSeconds) {
      this.perceptionTicks += 1;
      guard.blackboard.target = this.acquireTarget(guard);
      if (!guard.blackboard.target) {
        guard.blackboard.target = this.consumeStimulusTarget(guard, elapsedSeconds);
      }
      guard.blackboard.nextPerceptionAtSeconds = this.scheduleNext(
        guard.blackboard.nextPerceptionAtSeconds,
        elapsedSeconds,
        profile.perceptionIntervalSeconds
      );
    }

    if (guard.archetype.behaviorTreeId === "docile_flee.v1") {
      if (guard.blackboard.target) {
        this.runFleeBranch(guard, elapsedSeconds, profile);
        return;
      }
      this.runPatrolBranch(guard, elapsedSeconds, profile);
      return;
    }

    if (guard.blackboard.target) {
      this.runCombatBranch(guard, elapsedSeconds, profile);
      return;
    }

    this.runPatrolBranch(guard, elapsedSeconds, profile);
  }

  private runCombatBranch(
    guard: NpcRuntime,
    elapsedSeconds: number,
    profile: LifecycleProfile
  ): void {
    const target = guard.blackboard.target;
    if (!target) {
      return;
    }

    const dx = target.x - guard.character.x;
    const dz = target.z - guard.character.z;
    const distance = Math.hypot(dx, dz);
    this.faceDirection(guard.character, dx, dz);
    if (distance <= guard.archetype.attackRange) {
      guard.blackboard.behaviorState = "attack";
      this.stopCharacter(guard.character);
      guard.character.pitch = ATTACK_FACE_PITCH;
      this.options.usePrimaryAbility(guard.character);
      return;
    }

    guard.blackboard.behaviorState = "chase";
    if (elapsedSeconds >= guard.blackboard.nextPathAtSeconds || guard.blackboard.path.length === 0) {
      this.pathReplans += 1;
      const path = this.findPathToTarget(guard.character, target);
      if (path.length === 0) {
        this.pathFailures += 1;
        guard.blackboard.consecutivePathFailures += 1;
        guard.blackboard.path = [];
        guard.blackboard.pathIndex = 0;
        guard.blackboard.nextPathAtSeconds = elapsedSeconds +
          Math.max(
            profile.pathReplanIntervalSeconds,
            this.options.pathStuckRecoveryDelaySeconds * guard.blackboard.consecutivePathFailures
          );
        this.stopCharacter(guard.character);
        return;
      }
      guard.blackboard.path = path;
      guard.blackboard.pathIndex = Math.min(1, Math.max(0, path.length - 1));
      guard.blackboard.consecutivePathFailures = 0;
      this.markPathProgressReset(guard, elapsedSeconds);
      guard.blackboard.nextPathAtSeconds = this.scheduleNext(
        guard.blackboard.nextPathAtSeconds,
        elapsedSeconds,
        profile.pathReplanIntervalSeconds
      );
    }
    this.followPath(guard, guard.archetype.moveSpeed * profile.moveSpeedScale, elapsedSeconds);
  }

  private runFleeBranch(
    guard: NpcRuntime,
    elapsedSeconds: number,
    profile: LifecycleProfile
  ): void {
    const threat = guard.blackboard.target;
    if (!threat) {
      this.stopCharacter(guard.character);
      return;
    }

    const awayX = guard.character.x - threat.x;
    const awayZ = guard.character.z - threat.z;
    const awayDistance = Math.hypot(awayX, awayZ);
    const fallbackAngle = guard.blackboard.phase * Math.PI * 2 + FLEE_FALLBACK_ANGLE_OFFSET;
    const dirX = awayDistance > 1e-6 ? awayX / awayDistance : Math.cos(fallbackAngle);
    const dirZ = awayDistance > 1e-6 ? awayZ / awayDistance : Math.sin(fallbackAngle);
    const fleeDistance = Math.max(
      guard.archetype.attackRange * 3,
      Math.min(16, guard.archetype.perceptionRadius * 0.8)
    );
    const fleeGoal = {
      x: guard.character.x + dirX * fleeDistance,
      y: guard.character.y,
      z: guard.character.z + dirZ * fleeDistance
    };

    guard.blackboard.behaviorState = "flee";
    if (elapsedSeconds >= guard.blackboard.nextPathAtSeconds || guard.blackboard.path.length === 0) {
      this.pathReplans += 1;
      const path = this.findPathToPoint(guard.character, fleeGoal, threat);
      if (path.length === 0) {
        this.pathFailures += 1;
        guard.blackboard.consecutivePathFailures += 1;
        guard.blackboard.path = [];
        guard.blackboard.pathIndex = 0;
        guard.blackboard.nextPathAtSeconds = elapsedSeconds +
          Math.max(
            profile.pathReplanIntervalSeconds,
            this.options.pathStuckRecoveryDelaySeconds * guard.blackboard.consecutivePathFailures
          );
        const moveSpeed = guard.archetype.moveSpeed * 1.1 * profile.moveSpeedScale;
        guard.character.vx = dirX * moveSpeed;
        guard.character.vz = dirZ * moveSpeed;
        this.faceDirection(guard.character, dirX, dirZ);
        return;
      }
      guard.blackboard.path = path;
      guard.blackboard.pathIndex = Math.min(1, Math.max(0, path.length - 1));
      guard.blackboard.consecutivePathFailures = 0;
      this.markPathProgressReset(guard, elapsedSeconds);
      guard.blackboard.nextPathAtSeconds = this.scheduleNext(
        guard.blackboard.nextPathAtSeconds,
        elapsedSeconds,
        profile.pathReplanIntervalSeconds
      );
    }

    this.followPath(guard, guard.archetype.moveSpeed * 1.1 * profile.moveSpeedScale, elapsedSeconds);
  }

  private runPatrolBranch(
    guard: NpcRuntime,
    elapsedSeconds: number,
    profile: LifecycleProfile
  ): void {
    const patrolPoints = guard.spawn.patrolPoints.length > 0
      ? guard.spawn.patrolPoints
      : [{ x: guard.spawn.x, y: guard.spawn.y, z: guard.spawn.z }];
    const target = patrolPoints[guard.blackboard.patrolIndex % patrolPoints.length];
    if (!target) {
      guard.blackboard.behaviorState = "idle";
      this.stopCharacter(guard.character);
      return;
    }
    guard.blackboard.behaviorState = patrolPoints.length > 1 ? "patrol" : "idle";
    const dx = target.x - guard.character.x;
    const dz = target.z - guard.character.z;
    if (Math.hypot(dx, dz) <= ARRIVAL_DISTANCE) {
      guard.blackboard.patrolIndex = (guard.blackboard.patrolIndex + 1) % patrolPoints.length;
      this.stopCharacter(guard.character);
      return;
    }
    guard.blackboard.path = [this.toNavPoint(guard.character), target];
    guard.blackboard.pathIndex = 1;
    this.markPathProgressReset(guard, elapsedSeconds);
    this.followPath(guard, guard.archetype.moveSpeed * 0.65 * profile.moveSpeedScale, elapsedSeconds);
  }

  private runWanderBranch(
    guard: NpcRuntime,
    elapsedSeconds: number,
    profile: LifecycleProfile
  ): void {
    if (elapsedSeconds < guard.blackboard.nextWanderAtSeconds) {
      guard.blackboard.behaviorState = "idle";
      this.stopCharacter(guard.character);
      return;
    }

    const currentGoal = guard.blackboard.wanderGoal;
    if (currentGoal) {
      const dx = currentGoal.x - guard.character.x;
      const dz = currentGoal.z - guard.character.z;
      if (Math.hypot(dx, dz) <= ARRIVAL_DISTANCE) {
        guard.blackboard.wanderGoal = null;
        guard.blackboard.path = [];
        guard.blackboard.pathIndex = 0;
        guard.blackboard.nextWanderAtSeconds = elapsedSeconds + this.nextWanderIdleSeconds(guard);
        this.stopCharacter(guard.character);
        return;
      }
    }

    if (!guard.blackboard.wanderGoal) {
      guard.blackboard.wanderGoal = this.nextWanderGoal(guard);
      guard.blackboard.path = [];
      guard.blackboard.pathIndex = 0;
      guard.blackboard.nextPathAtSeconds = 0;
    }

    guard.blackboard.behaviorState = "wander";
    if (elapsedSeconds >= guard.blackboard.nextPathAtSeconds || guard.blackboard.path.length === 0) {
      const goal = guard.blackboard.wanderGoal;
      if (!goal) {
        this.stopCharacter(guard.character);
        return;
      }
      this.pathReplans += 1;
      const path = this.findPathToPoint(guard.character, goal);
      if (path.length === 0) {
        this.pathFailures += 1;
        guard.blackboard.wanderGoal = null;
        guard.blackboard.consecutivePathFailures += 1;
        guard.blackboard.nextWanderAtSeconds = elapsedSeconds + this.nextWanderIdleSeconds(guard);
        guard.blackboard.nextPathAtSeconds = elapsedSeconds + this.options.pathStuckRecoveryDelaySeconds;
        this.stopCharacter(guard.character);
        return;
      }
      guard.blackboard.path = path;
      guard.blackboard.pathIndex = Math.min(1, Math.max(0, path.length - 1));
      guard.blackboard.consecutivePathFailures = 0;
      this.markPathProgressReset(guard, elapsedSeconds);
      guard.blackboard.nextPathAtSeconds = this.scheduleNext(
        guard.blackboard.nextPathAtSeconds,
        elapsedSeconds,
        profile.pathReplanIntervalSeconds
      );
    }

    this.followPath(guard, guard.archetype.moveSpeed * 0.45 * profile.moveSpeedScale, elapsedSeconds);
  }

  private updateLifecycle(guard: NpcRuntime, elapsedSeconds: number): void {
    if (!this.options.hibernationEnabled) {
      guard.blackboard.lifecycleState = "active";
      return;
    }
    const stimulusDistance = this.getStimulusTargetDistance(guard, elapsedSeconds);
    if (stimulusDistance <= guard.archetype.activationRadius) {
      guard.blackboard.lifecycleState = "active";
      return;
    }
    if (stimulusDistance <= guard.archetype.deactivationRadius) {
      guard.blackboard.lifecycleState = "inactive";
      return;
    }
    if (guard.blackboard.lifecycleState === "hibernating") {
      return;
    }
    const nearestDistance = this.getNearestTargetDistance(guard);
    if (nearestDistance <= guard.archetype.activationRadius) {
      guard.blackboard.lifecycleState = "active";
      return;
    }
    if (nearestDistance >= guard.archetype.deactivationRadius) {
      guard.blackboard.lifecycleState = "hibernating";
      guard.blackboard.target = null;
      guard.blackboard.path = [];
      guard.blackboard.pathIndex = 0;
      return;
    }
    guard.blackboard.lifecycleState = "inactive";
  }

  private resolveLifecycleProfile(state: NpcLifecycleState): LifecycleProfile {
    if (state === "inactive") {
      return {
        thinkIntervalSeconds: this.options.inactiveAiTickIntervalSeconds,
        perceptionIntervalSeconds: this.options.inactivePerceptionTickIntervalSeconds,
        pathReplanIntervalSeconds: this.options.inactivePathReplanIntervalSeconds,
        moveSpeedScale: this.options.inactiveMoveSpeedScale,
        allowBehaviorTick: true
      };
    }
    if (state === "hibernating") {
      return {
        thinkIntervalSeconds: this.options.inactiveAiTickIntervalSeconds,
        perceptionIntervalSeconds: this.options.inactivePerceptionTickIntervalSeconds,
        pathReplanIntervalSeconds: this.options.inactivePathReplanIntervalSeconds,
        moveSpeedScale: this.options.inactiveMoveSpeedScale,
        allowBehaviorTick: false
      };
    }
    return {
      thinkIntervalSeconds: this.options.aiTickIntervalSeconds,
      perceptionIntervalSeconds: this.options.perceptionTickIntervalSeconds,
      pathReplanIntervalSeconds: this.options.pathReplanIntervalSeconds,
      moveSpeedScale: 1,
      allowBehaviorTick: true
    };
  }

  private realignScheduleForTier(guard: NpcRuntime, elapsedSeconds: number): void {
    const profile = this.resolveLifecycleProfile(guard.blackboard.lifecycleState);
    guard.blackboard.nextThinkAtSeconds = elapsedSeconds + profile.thinkIntervalSeconds * guard.blackboard.phase;
    guard.blackboard.nextPerceptionAtSeconds =
      elapsedSeconds + profile.perceptionIntervalSeconds * guard.blackboard.phase;
    guard.blackboard.nextPathAtSeconds = elapsedSeconds + profile.pathReplanIntervalSeconds * guard.blackboard.phase;
    this.markPathProgressReset(guard, elapsedSeconds);
  }

  private acquireTarget(guard: NpcRuntime): AiVisibleTarget | null {
    const nearest = this.queryNearestTarget(guard, guard.archetype.perceptionRadius);
    return nearest?.target ?? null;
  }

  private getNearestTargetDistance(guard: NpcRuntime): number {
    const nearest = this.queryNearestTarget(guard, guard.archetype.deactivationRadius);
    if (!nearest) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.sqrt(nearest.distanceSq);
  }

  private consumeStimulusTarget(guard: NpcRuntime, elapsedSeconds: number): AiVisibleTarget | null {
    const stimulus = guard.blackboard.stimulus;
    if (!stimulus || stimulus.expiresAtSeconds <= elapsedSeconds) {
      guard.blackboard.stimulus = null;
      return null;
    }
    return stimulus.target;
  }

  private getStimulusTargetDistance(guard: NpcRuntime, elapsedSeconds: number): number {
    const stimulus = guard.blackboard.stimulus;
    if (!stimulus) {
      return Number.POSITIVE_INFINITY;
    }
    if (stimulus.expiresAtSeconds <= elapsedSeconds) {
      guard.blackboard.stimulus = null;
      return Number.POSITIVE_INFINITY;
    }
    const dx = stimulus.x - guard.character.x;
    const dy = stimulus.y - guard.character.y;
    const dz = stimulus.z - guard.character.z;
    return Math.hypot(dx, dy, dz);
  }

  private queryNearestTarget(
    guard: NpcRuntime,
    maxDistance: number
  ): { target: AiVisibleTarget; distanceSq: number } | null {
    if (!this.options.hasPerceptionTargets()) {
      return null;
    }

    const range = Math.max(0, maxDistance);
    if (range <= 0) {
      return null;
    }

    const shape = this.getPerceptionShape(range);
    let nearestTarget: AiVisibleTarget | null = null;
    let nearestDistanceSq = range * range;

    this.options.world.intersectionsWithShape(
      { x: guard.character.x, y: guard.character.y, z: guard.character.z },
      IDENTITY_ROTATION,
      shape,
      (collider) => {
        const target = this.options.resolvePerceptionTargetByColliderHandle(collider.handle);
        if (!target) {
          return true;
        }
        const dx = target.x - guard.character.x;
        const dy = target.y - guard.character.y;
        const dz = target.z - guard.character.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq <= nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearestTarget = target;
        }
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      guard.character.collider,
      undefined,
      (collider) => this.options.resolvePerceptionTargetByColliderHandle(collider.handle) !== null
    );

    if (!nearestTarget) {
      return null;
    }

    return {
      target: nearestTarget,
      distanceSq: nearestDistanceSq
    };
  }

  private followPath(guard: NpcRuntime, speed: number, elapsedSeconds: number): void {
    const waypoint = guard.blackboard.path[guard.blackboard.pathIndex];
    if (!waypoint) {
      this.stopCharacter(guard.character);
      return;
    }
    const dx = waypoint.x - guard.character.x;
    const dz = waypoint.z - guard.character.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= ARRIVAL_DISTANCE) {
      guard.blackboard.pathIndex += 1;
      this.followPath(guard, speed, elapsedSeconds);
      return;
    }
    const hasProgress = guard.blackboard.lastPathDistance - distance > PATH_PROGRESS_EPSILON;
    if (hasProgress) {
      guard.blackboard.lastPathProgressAtSeconds = elapsedSeconds;
      guard.blackboard.lastPathDistance = distance;
    } else if (elapsedSeconds - guard.blackboard.lastPathProgressAtSeconds >= this.options.pathStuckTimeoutSeconds) {
      this.stuckResets += 1;
      guard.blackboard.path = [];
      guard.blackboard.pathIndex = 0;
      guard.blackboard.consecutivePathFailures += 1;
      guard.blackboard.nextPathAtSeconds = elapsedSeconds + this.options.pathStuckRecoveryDelaySeconds;
      this.markPathProgressReset(guard, elapsedSeconds);
      this.stopCharacter(guard.character);
      return;
    }

    const invDistance = distance > 1e-6 ? 1 / distance : 0;
    guard.character.vx = dx * invDistance * speed;
    guard.character.vz = dz * invDistance * speed;
    this.faceDirection(guard.character, dx, dz);
  }

  private applyLocalSeparation(guard: NpcRuntime): void {
    let separationX = 0;
    let separationZ = 0;
    this.options.world.intersectionsWithShape(
      { x: guard.character.x, y: guard.character.y, z: guard.character.z },
      IDENTITY_ROTATION,
      this.separationShape,
      (collider) => {
        const other = this.npcByColliderHandle.get(collider.handle);
        if (!other || other === guard) {
          return true;
        }
        const dx = guard.character.x - other.character.x;
        const dz = guard.character.z - other.character.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= NPC_SEPARATION_RADIUS) {
          return true;
        }
        if (distance <= 1e-6) {
          const angle = guard.blackboard.phase * Math.PI * 2;
          separationX += Math.cos(angle);
          separationZ += Math.sin(angle);
          return true;
        }
        const weight = (NPC_SEPARATION_RADIUS - distance) / NPC_SEPARATION_RADIUS;
        separationX += (dx / distance) * weight;
        separationZ += (dz / distance) * weight;
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      guard.character.collider
    );

    const separationLength = Math.hypot(separationX, separationZ);
    if (separationLength <= 1e-6) {
      return;
    }

    const currentSpeed = Math.hypot(guard.character.vx, guard.character.vz);
    const separationScale = guard.blackboard.behaviorState === "attack"
      ? NPC_ATTACK_SEPARATION_SPEED_SCALE
      : NPC_SEPARATION_SPEED_SCALE;
    const separationSpeed = guard.archetype.moveSpeed * separationScale;
    guard.character.vx += (separationX / separationLength) * separationSpeed;
    guard.character.vz += (separationZ / separationLength) * separationSpeed;

    const maxSpeed = Math.max(currentSpeed, guard.archetype.moveSpeed) * NPC_SEPARATION_MAX_SPEED_SCALE;
    const nextSpeed = Math.hypot(guard.character.vx, guard.character.vz);
    if (nextSpeed > maxSpeed && nextSpeed > 1e-6) {
      const scale = maxSpeed / nextSpeed;
      guard.character.vx *= scale;
      guard.character.vz *= scale;
    }
  }

  private stopCharacter(character: NpcCharacter): void {
    character.vx = 0;
    character.vz = 0;
  }

  private findPathToTarget(character: NpcCharacter, target: AiVisibleTarget): NavPoint[] {
    return this.findPathToPoint(character, { x: target.x, y: target.y, z: target.z }, target);
  }

  private findPathToPoint(
    character: NpcCharacter,
    goal: NavPoint,
    targetContext?: Pick<AiVisibleTarget, "movementMode" | "carriedFramePid" | "groundedPlatformPid">
  ): NavPoint[] {
    const frameId = character.carriedFramePid ?? character.groundedPlatformPid ?? null;
    const targetFrameId = targetContext
      ? targetContext.carriedFramePid ?? targetContext.groundedPlatformPid ?? null
      : frameId;
    const targetMovementMode = targetContext?.movementMode;
    const mode: NavigationMode =
      character.movementMode === MOVEMENT_MODE_FLYING || targetMovementMode === MOVEMENT_MODE_FLYING
        ? "freeFlight"
        : "auto";

    return this.options.navigation.planPath({
      start: this.toNavPoint(character),
      end: goal,
      mode,
      startFrameId: frameId,
      endFrameId: targetFrameId,
      preferFrameId: frameId ?? targetFrameId,
      allowFreeFlightFallback: true
    }).points;
  }

  private faceDirection(character: NpcCharacter, dx: number, dz: number): void {
    if (Math.hypot(dx, dz) <= 1e-6) {
      return;
    }
    character.yaw = Math.atan2(-dx, -dz);
    const rotation = quaternionFromYawPitchRoll(character.yaw, 0);
    character.rotation.x = rotation.x;
    character.rotation.y = rotation.y;
    character.rotation.z = rotation.z;
    character.rotation.w = rotation.w;
  }

  private createCharacter(
    archetype: CharacterArchetypeDefinition,
    spawn: NpcSpawnDefinition
  ): NpcCharacter {
    const body = this.options.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z)
    );
    const collider = this.options.world.createCollider(
      RAPIER.ColliderDesc
        .capsule(archetype.capsuleHalfHeight, archetype.capsuleRadius)
        .setFriction(0)
        .setCollisionGroups(PHYSICS_GROUP_CHARACTER)
        .setSolverGroups(PHYSICS_GROUP_CHARACTER),
      body
    );
    const hotbarAbilityIds = new Array<number>(HOTBAR_SLOT_COUNT).fill(0);
    hotbarAbilityIds[0] = ABILITY_ID_PUNCH;
    return {
      accountId: 0,
      nid: 0,
      modelId: archetype.modelId,
      characterArchetypeId: archetype.id,
      controllerKind: this.options.controllerKindAi,
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
      rotation: quaternionFromYawPitchRoll(spawn.yaw, 0),
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      yaw: spawn.yaw,
      pitch: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: false,
      movementMode: MOVEMENT_MODE_GROUNDED,
      groundedPlatformPid: null,
      carriedFramePid: null,
      health: archetype.maxHealth,
      maxHealth: archetype.maxHealth,
      primaryMouseSlot: 0,
      secondaryMouseSlot: 0,
      hotbarAbilityIds,
      lastPrimaryFireAtSeconds: Number.NEGATIVE_INFINITY,
      lastProcessedSequence: 0,
      primaryHeld: false,
      secondaryHeld: false,
      unlockedAbilityIds: new Set<number>([ABILITY_ID_PUNCH]),
      body,
      collider
    };
  }

  private toNavPoint(character: NpcCharacter): NavPoint {
    return { x: character.x, y: character.y, z: character.z };
  }

  private computePhase(spawn: NpcSpawnDefinition, index: number): number {
    const seed = Math.abs(
      Math.floor(spawn.x * 13.1) +
      Math.floor(spawn.y * 17.3) +
      Math.floor(spawn.z * 19.9) +
      Math.floor(spawn.yaw * 97.7) +
      index * 73
    );
    return (seed % 1000) / 1000;
  }

  private computeWanderSeed(spawn: NpcSpawnDefinition, index: number): number {
    return Math.abs(
      Math.floor(spawn.x * 73856093) ^
      Math.floor(spawn.y * 19349663) ^
      Math.floor(spawn.z * 83492791) ^
      (index + 1) * 2654435761
    ) >>> 0;
  }

  private nextWanderGoal(guard: NpcRuntime): NavPoint {
    const angle = this.nextWanderUnit(guard) * Math.PI * 2;
    const radius = WANDER_MIN_RADIUS + this.nextWanderUnit(guard) * (WANDER_MAX_RADIUS - WANDER_MIN_RADIUS);
    return {
      x: guard.spawn.x + Math.cos(angle) * radius,
      y: guard.spawn.y,
      z: guard.spawn.z + Math.sin(angle) * radius
    };
  }

  private nextWanderIdleSeconds(guard: NpcRuntime): number {
    return WANDER_IDLE_MIN_SECONDS +
      this.nextWanderUnit(guard) * (WANDER_IDLE_MAX_SECONDS - WANDER_IDLE_MIN_SECONDS);
  }

  private nextWanderUnit(guard: NpcRuntime): number {
    guard.blackboard.wanderSeed = (guard.blackboard.wanderSeed * 1664525 + 1013904223) >>> 0;
    return guard.blackboard.wanderSeed / 0x100000000;
  }

  private scheduleNext(current: number, elapsedSeconds: number, intervalSeconds: number): number {
    const interval = Math.max(0.01, intervalSeconds);
    let next = Number.isFinite(current) ? current : elapsedSeconds;
    while (next <= elapsedSeconds) {
      next += interval;
    }
    return next;
  }

  private markPathProgressReset(guard: NpcRuntime, elapsedSeconds: number): void {
    guard.blackboard.lastPathProgressAtSeconds = elapsedSeconds;
    guard.blackboard.lastPathDistance = Number.POSITIVE_INFINITY;
  }

  private supportsBehaviorTree(behaviorTreeId: string): boolean {
    return behaviorTreeId === "hostile_guard.v1" || behaviorTreeId === "docile_flee.v1" || behaviorTreeId === "wander.v1";
  }

  private getPerceptionShape(radius: number): RAPIER.Ball {
    const clampedRadius = Math.max(0.05, radius);
    const cacheKey = Math.max(1, Math.round(clampedRadius * PERCEPTION_RADIUS_CACHE_SCALE));
    let shape = this.perceptionShapeCache.get(cacheKey);
    if (!shape) {
      shape = new RAPIER.Ball(cacheKey / PERCEPTION_RADIUS_CACHE_SCALE);
      this.perceptionShapeCache.set(cacheKey, shape);
    }
    return shape;
  }
}
