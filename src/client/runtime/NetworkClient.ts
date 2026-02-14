import { Client, Interpolator } from "nengi";
import { WebSocketClientAdapter } from "nengi-websocket-client-adapter";
import {
  DEFAULT_HOTBAR_ABILITY_IDS,
  abilityCategoryFromWireValue,
  clampHotbarSlotIndex,
  decodeAbilityAttributeMask,
  getAllAbilityDefinitions,
  normalizeYaw,
  type AbilityDefinition
} from "../../shared/index";
import {
  NType,
  type AbilityCreateResultMessage,
  type AbilityDefinitionMessage,
  type IdentityMessage,
  type InputAckMessage,
  type LoadoutStateMessage,
  ncontext
} from "../../shared/netcode";
import { SERVER_TICK_RATE } from "../../shared/config";
import type { MovementInput, PlatformState, ProjectileState, RemotePlayerState } from "./types";

export interface PendingInput {
  sequence: number;
  delta: number;
  movement: MovementInput;
  orientation: { yaw: number; pitch: number };
}

export interface ReconciliationFrame {
  ack: {
    sequence: number;
    serverTick: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    vx: number;
    vy: number;
    vz: number;
    grounded: boolean;
    groundedPlatformPid: number;
    platformYawDelta: number;
  };
  replay: PendingInput[];
}

export interface AbilityCreateDraftCommandPayload {
  name: string;
  category: number;
  pointsPower: number;
  pointsVelocity: number;
  pointsEfficiency: number;
  pointsControl: number;
  attributeMask: number;
  targetHotbarSlot: number;
}

export interface AbilityCreateResult {
  submitNonce: number;
  success: boolean;
  createdAbilityId: number;
  message: string;
}

export interface LoadoutState {
  selectedHotbarSlot: number;
  abilityIds: number[];
}

export interface AbilityEventBatch {
  definitions: AbilityDefinition[];
  loadout: LoadoutState | null;
  createResults: AbilityCreateResult[];
}

const INPUT_SEQUENCE_MODULO = 0x10000;
const INPUT_SEQUENCE_HALF_RANGE = INPUT_SEQUENCE_MODULO >>> 1;
const SERVER_TICK_INTERVAL_MS = 1000 / SERVER_TICK_RATE;
const INTERPOLATION_DELAY_MIN_MS = 60;
const INTERPOLATION_DELAY_MAX_MS = 220;
const INTERPOLATION_DELAY_BASE_TICKS = 2;
const INTERPOLATION_DELAY_SMOOTHING = 0.15;
const ACK_JITTER_SMOOTHING = 0.15;
const ACK_SIMULATION_BUFFER_LIMIT = 64;

interface NetSimulationConfig {
  enabled: boolean;
  ackDropRate: number;
  ackDelayMs: number;
  ackJitterMs: number;
}

interface BufferedAck {
  readyAtMs: number;
  message: InputAckMessage;
}

interface QueuedAbilityCreateCommand extends AbilityCreateDraftCommandPayload {
  submitNonce: number;
}

export class NetworkClient {
  private readonly client = new Client(ncontext, WebSocketClientAdapter, SERVER_TICK_RATE);
  private readonly interpolator = new Interpolator(this.client);
  private readonly entities = new Map<number, Record<string, unknown>>();
  private readonly netSimulation = this.resolveNetSimulationConfig();
  private readonly bufferedAcks: BufferedAck[] = [];
  private readonly abilityDefinitions = new Map<number, AbilityDefinition>();
  private readonly pendingAbilityDefinitions = new Map<number, AbilityDefinition>();
  private readonly pendingAbilityCreateResults: AbilityCreateResult[] = [];
  private pendingLoadoutState: LoadoutState | null = null;
  private queuedAbilityCreateCommand: QueuedAbilityCreateCommand | null = null;
  private localPlayerNid: number | null = null;
  private connected = false;
  private nextCommandSequence = 0;
  private nextAbilitySubmitNonce = 0;
  private readonly pendingInputs: PendingInput[] = [];
  private latestAck: ReconciliationFrame["ack"] | null = null;
  private lastAckSequence: number | null = null;
  private lastAckArrivalAtMs: number | null = null;
  private ackJitterMs = 0;
  private interpolationDelayMs = 100;
  private serverGroundedPlatformPid = -1;
  private lastSentYaw = 0;
  private hasSentYaw = false;

  public constructor() {
    for (const ability of getAllAbilityDefinitions()) {
      this.abilityDefinitions.set(ability.id, ability);
    }
    this.client.setDisconnectHandler(() => {
      this.connected = false;
      this.pendingInputs.length = 0;
      this.bufferedAcks.length = 0;
      this.latestAck = null;
      this.lastAckSequence = null;
      this.lastAckArrivalAtMs = null;
      this.ackJitterMs = 0;
      this.interpolationDelayMs = 100;
      this.serverGroundedPlatformPid = -1;
      this.lastSentYaw = 0;
      this.hasSentYaw = false;
      this.pendingAbilityCreateResults.length = 0;
      this.pendingAbilityDefinitions.clear();
      this.pendingLoadoutState = null;
      this.queuedAbilityCreateCommand = null;
    });
    this.client.setWebsocketErrorHandler(() => {
      // Errors are expected when server is unavailable during local-only workflows.
    });
  }

  public async connect(serverUrl: string): Promise<void> {
    try {
      const timeoutMs = 1500;
      await Promise.race([
        this.client.connect(serverUrl, { token: "dev-token" }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error(`connect timeout after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
      this.connected = true;
      console.log(`[client] connected to ${serverUrl}`);
    } catch (error) {
      this.connected = false;
      console.warn("[client] network unavailable, running local-only mode", error);
    }
  }

  public step(
    delta: number,
    movement: MovementInput,
    orientation: { yaw: number; pitch: number },
    actions: { usePrimaryPressed: boolean; activeHotbarSlot: number; selectedAbilityId: number }
  ): void {
    if (!this.connected) {
      return;
    }

    this.readMessages();
    this.updateInterpolationDelay();
    this.applyInterpolatedFrames(this.interpolator.getInterpolatedState(this.interpolationDelayMs));

    this.nextCommandSequence = (this.nextCommandSequence + 1) & 0xffff;
    const sequence = this.nextCommandSequence;
    const yawDelta = this.hasSentYaw ? normalizeYaw(orientation.yaw - this.lastSentYaw) : orientation.yaw;
    this.lastSentYaw = orientation.yaw;
    this.hasSentYaw = true;
    const activeHotbarSlot = this.clampUnsignedInt(actions.activeHotbarSlot, 0xff);
    const selectedAbilityId = this.clampUnsignedInt(actions.selectedAbilityId, 0xffff);
    this.pendingInputs.push({
      sequence,
      delta,
      movement: { ...movement },
      orientation: { ...orientation }
    });

    this.client.addCommand({
      ntype: NType.InputCommand,
      sequence,
      forward: movement.forward,
      strafe: movement.strafe,
      jump: movement.jump,
      sprint: movement.sprint,
      usePrimaryPressed: actions.usePrimaryPressed,
      activeHotbarSlot,
      selectedAbilityId,
      yawDelta,
      pitch: orientation.pitch,
      delta
    });

    const abilityCommand = this.queuedAbilityCreateCommand;
    if (abilityCommand) {
      this.client.addCommand({
        ntype: NType.AbilityCreateCommand,
        submitNonce: this.clampUnsignedInt(abilityCommand.submitNonce, 0xffff),
        name: abilityCommand.name.slice(0, 64),
        category: this.clampUnsignedInt(abilityCommand.category, 0xff),
        pointsPower: this.clampUnsignedInt(abilityCommand.pointsPower, 0xff),
        pointsVelocity: this.clampUnsignedInt(abilityCommand.pointsVelocity, 0xff),
        pointsEfficiency: this.clampUnsignedInt(abilityCommand.pointsEfficiency, 0xff),
        pointsControl: this.clampUnsignedInt(abilityCommand.pointsControl, 0xff),
        attributeMask: this.clampUnsignedInt(abilityCommand.attributeMask, 0xffff),
        targetHotbarSlot: this.clampUnsignedInt(abilityCommand.targetHotbarSlot, 0xff)
      });
      this.queuedAbilityCreateCommand = null;
    }

    this.client.flush();
  }

  public queueAbilityCreateDraft(payload: AbilityCreateDraftCommandPayload): number {
    this.nextAbilitySubmitNonce = (this.nextAbilitySubmitNonce + 1) & 0xffff;
    this.queuedAbilityCreateCommand = {
      submitNonce: this.nextAbilitySubmitNonce,
      ...payload
    };
    return this.nextAbilitySubmitNonce;
  }

  public consumeAbilityEvents(): AbilityEventBatch | null {
    if (
      this.pendingAbilityDefinitions.size === 0 &&
      this.pendingAbilityCreateResults.length === 0 &&
      this.pendingLoadoutState === null
    ) {
      return null;
    }

    const definitions = Array.from(this.pendingAbilityDefinitions.values()).sort((a, b) => a.id - b.id);
    const loadout = this.pendingLoadoutState;
    const createResults = [...this.pendingAbilityCreateResults];
    this.pendingAbilityDefinitions.clear();
    this.pendingAbilityCreateResults.length = 0;
    this.pendingLoadoutState = null;

    return {
      definitions,
      loadout,
      createResults
    };
  }

  public getAbilityCatalog(): AbilityDefinition[] {
    return Array.from(this.abilityDefinitions.values()).sort((a, b) => a.id - b.id);
  }

  public getAbilityById(abilityId: number): AbilityDefinition | null {
    return this.abilityDefinitions.get(abilityId) ?? null;
  }

  public getRemotePlayers(): RemotePlayerState[] {
    const output: RemotePlayerState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.PlayerEntity) {
        continue;
      }
      const player = this.toPlayerState(rawEntity);
      if (!player) {
        continue;
      }
      if (player.nid === this.localPlayerNid) {
        continue;
      }
      output.push(player);
    }
    return output;
  }

  public getLocalPlayerPose(): RemotePlayerState | null {
    if (this.localPlayerNid === null) {
      return null;
    }
    const rawEntity = this.entities.get(this.localPlayerNid);
    if (!rawEntity || rawEntity.ntype !== NType.PlayerEntity) {
      return null;
    }
    return this.toPlayerState(rawEntity);
  }

  public getPlatforms(): PlatformState[] {
    const output: PlatformState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.PlatformEntity) {
        continue;
      }
      const platform = this.toPlatformState(rawEntity);
      if (!platform) {
        continue;
      }
      output.push(platform);
    }
    return output;
  }

  public getProjectiles(): ProjectileState[] {
    const output: ProjectileState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.ProjectileEntity) {
        continue;
      }
      const projectile = this.toProjectileState(rawEntity);
      if (!projectile) {
        continue;
      }
      output.push(projectile);
    }
    return output;
  }

  public getConnectionState(): "connected" | "local-only" {
    return this.connected ? "connected" : "local-only";
  }

  public getLocalPlayerNid(): number | null {
    return this.localPlayerNid;
  }

  public isServerGroundedOnPlatform(): boolean {
    return this.serverGroundedPlatformPid >= 0;
  }

  public getInterpolationDelayMs(): number {
    return this.interpolationDelayMs;
  }

  public getAckJitterMs(): number {
    return this.ackJitterMs;
  }

  public syncSentYaw(yaw: number): void {
    this.lastSentYaw = yaw;
    this.hasSentYaw = true;
  }

  public shiftPendingInputYaw(deltaYaw: number): void {
    if (!Number.isFinite(deltaYaw) || Math.abs(deltaYaw) <= 1e-6) {
      return;
    }
    for (const entry of this.pendingInputs) {
      entry.orientation.yaw = normalizeYaw(entry.orientation.yaw + deltaYaw);
    }
  }

  public consumeReconciliationFrame(): ReconciliationFrame | null {
    if (!this.latestAck) {
      return null;
    }
    const frame: ReconciliationFrame = {
      ack: { ...this.latestAck },
      replay: this.pendingInputs.map((entry) => ({
        sequence: entry.sequence,
        delta: entry.delta,
        movement: { ...entry.movement },
        orientation: { ...entry.orientation }
      }))
    };
    this.latestAck = null;
    return frame;
  }

  private readMessages(): void {
    const messages = (this.client.network as { messages?: unknown[] }).messages;
    if (!messages || messages.length === 0) {
      this.processBufferedAcks();
      return;
    }

    const messageCount = messages.length;
    for (let i = 0; i < messageCount; i++) {
      const message = messages[i] as
        | IdentityMessage
        | InputAckMessage
        | AbilityDefinitionMessage
        | LoadoutStateMessage
        | AbilityCreateResultMessage
        | undefined;
      if (message?.ntype === NType.IdentityMessage) {
        this.localPlayerNid = message.playerNid;
        continue;
      }
      if (message?.ntype === NType.InputAckMessage) {
        this.enqueueAckMessage(message);
        continue;
      }
      if (message?.ntype === NType.AbilityDefinitionMessage) {
        const ability = this.toAbilityDefinition(message);
        if (!ability) {
          continue;
        }
        this.abilityDefinitions.set(ability.id, ability);
        this.pendingAbilityDefinitions.set(ability.id, ability);
        continue;
      }
      if (message?.ntype === NType.LoadoutStateMessage) {
        this.pendingLoadoutState = this.toLoadoutState(message);
        continue;
      }
      if (message?.ntype === NType.AbilityCreateResultMessage) {
        this.pendingAbilityCreateResults.push({
          submitNonce: message.submitNonce,
          success: message.success,
          createdAbilityId: message.createdAbilityId,
          message: message.message
        });
      }
    }

    // Drain processed messages without allocating a new array in this hot path.
    messages.length = 0;
    this.processBufferedAcks();
  }

  private toAbilityDefinition(message: AbilityDefinitionMessage): AbilityDefinition | null {
    const category = abilityCategoryFromWireValue(message.category);
    if (!category) {
      return null;
    }
    const id = this.clampUnsignedInt(message.abilityId, 0xffff);
    const points = {
      power: this.clampUnsignedInt(message.pointsPower, 255),
      velocity: this.clampUnsignedInt(message.pointsVelocity, 255),
      efficiency: this.clampUnsignedInt(message.pointsEfficiency, 255),
      control: this.clampUnsignedInt(message.pointsControl, 255)
    };
    const attributes = decodeAbilityAttributeMask(this.clampUnsignedInt(message.attributeMask, 0xffff));
    const hasProjectile =
      category === "projectile" &&
      this.clampUnsignedInt(message.kind, 0xff) > 0 &&
      message.speed > 0 &&
      message.damage > 0;

    return {
      id,
      key: `runtime-${id}`,
      name: typeof message.name === "string" && message.name.trim() ? message.name.trim() : `Ability ${id}`,
      description: `${category} | attrs: ${attributes.length > 0 ? attributes.join(", ") : "none"}`,
      category,
      points,
      attributes,
      projectile: hasProjectile
        ? {
            kind: this.clampUnsignedInt(message.kind, 0xff),
            speed: message.speed,
            damage: message.damage,
            radius: message.radius,
            cooldownSeconds: message.cooldownSeconds,
            lifetimeSeconds: message.lifetimeSeconds,
            spawnForwardOffset: message.spawnForwardOffset,
            spawnVerticalOffset: message.spawnVerticalOffset
          }
        : undefined
    };
  }

  private toLoadoutState(message: LoadoutStateMessage): LoadoutState {
    return {
      selectedHotbarSlot: clampHotbarSlotIndex(message.selectedHotbarSlot),
      abilityIds: [
        message.slot0AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[0],
        message.slot1AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[1],
        message.slot2AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[2],
        message.slot3AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[3],
        message.slot4AbilityId ?? DEFAULT_HOTBAR_ABILITY_IDS[4]
      ]
    };
  }

  private enqueueAckMessage(message: InputAckMessage): void {
    if (!this.netSimulation.enabled) {
      this.applyAckMessage(message);
      return;
    }

    if (Math.random() < this.netSimulation.ackDropRate) {
      return;
    }

    const jitterOffset =
      this.netSimulation.ackJitterMs > 0
        ? (Math.random() * 2 - 1) * this.netSimulation.ackJitterMs
        : 0;
    const readyAtMs = performance.now() + Math.max(0, this.netSimulation.ackDelayMs + jitterOffset);
    this.bufferedAcks.push({
      readyAtMs,
      message: { ...message }
    });

    if (this.bufferedAcks.length > ACK_SIMULATION_BUFFER_LIMIT) {
      this.bufferedAcks.shift();
    }
  }

  private processBufferedAcks(): void {
    if (this.bufferedAcks.length === 0) {
      return;
    }

    const now = performance.now();
    const due: BufferedAck[] = [];
    const pending: BufferedAck[] = [];
    for (const buffered of this.bufferedAcks) {
      if (buffered.readyAtMs <= now) {
        due.push(buffered);
      } else {
        pending.push(buffered);
      }
    }
    this.bufferedAcks.length = 0;
    this.bufferedAcks.push(...pending);

    due.sort((a, b) => a.readyAtMs - b.readyAtMs);
    for (const buffered of due) {
      this.applyAckMessage(buffered.message);
    }
  }

  private applyAckMessage(message: InputAckMessage): void {
    if (
      this.lastAckSequence !== null &&
      !this.isSequenceAheadOf(this.lastAckSequence, message.sequence)
    ) {
      return;
    }
    this.lastAckSequence = message.sequence;
    this.observeAckArrival();

    const platformYawDelta = Number.isFinite(message.platformYawDelta)
      ? message.platformYawDelta
      : 0;
    let accumulatedPlatformYawDelta = platformYawDelta;
    if (
      this.latestAck &&
      this.latestAck.groundedPlatformPid >= 0 &&
      this.latestAck.groundedPlatformPid === message.groundedPlatformPid
    ) {
      accumulatedPlatformYawDelta = normalizeYaw(
        this.latestAck.platformYawDelta + platformYawDelta
      );
    }
    this.latestAck = {
      sequence: message.sequence,
      serverTick: message.serverTick,
      x: message.x,
      y: message.y,
      z: message.z,
      yaw: message.yaw,
      pitch: message.pitch,
      vx: message.vx,
      vy: message.vy,
      vz: message.vz,
      grounded: message.grounded,
      groundedPlatformPid: message.groundedPlatformPid,
      platformYawDelta: accumulatedPlatformYawDelta
    };
    this.serverGroundedPlatformPid = message.groundedPlatformPid;
    this.trimPendingInputs(message.sequence);
  }

  private trimPendingInputs(ackedSequence: number): void {
    while (this.pendingInputs.length > 0) {
      const first = this.pendingInputs[0];
      if (!first) {
        break;
      }
      if (this.isAckForOrAheadOf(first.sequence, ackedSequence)) {
        this.pendingInputs.shift();
      } else {
        break;
      }
    }
  }

  private isAckForOrAheadOf(candidateSequence: number, ackedSequence: number): boolean {
    const delta = (ackedSequence - candidateSequence + INPUT_SEQUENCE_MODULO) % INPUT_SEQUENCE_MODULO;
    return delta === 0 || delta < INPUT_SEQUENCE_HALF_RANGE;
  }

  private isSequenceAheadOf(lastSequence: number, candidateSequence: number): boolean {
    const delta = (candidateSequence - lastSequence + INPUT_SEQUENCE_MODULO) % INPUT_SEQUENCE_MODULO;
    return delta > 0 && delta < INPUT_SEQUENCE_HALF_RANGE;
  }

  private observeAckArrival(): void {
    const now = performance.now();
    if (this.lastAckArrivalAtMs === null) {
      this.lastAckArrivalAtMs = now;
      return;
    }

    const intervalMs = now - this.lastAckArrivalAtMs;
    const jitterSample = Math.abs(intervalMs - SERVER_TICK_INTERVAL_MS);
    this.ackJitterMs =
      this.ackJitterMs === 0
        ? jitterSample
        : this.ackJitterMs * (1 - ACK_JITTER_SMOOTHING) + jitterSample * ACK_JITTER_SMOOTHING;
    this.lastAckArrivalAtMs = now;
  }

  private updateInterpolationDelay(): void {
    const rawLatency = (this.client.network as { latency?: unknown }).latency;
    const latencyMs = typeof rawLatency === "number" && Number.isFinite(rawLatency) ? rawLatency : 0;
    const baseDelayMs = SERVER_TICK_INTERVAL_MS * INTERPOLATION_DELAY_BASE_TICKS;
    const jitterBudgetMs = Math.min(this.ackJitterMs * 2.2, 110);
    const latencyBudgetMs = Math.min(Math.max(latencyMs * 0.1, 0), 45);
    const targetDelayMs = this.clampNumber(
      baseDelayMs + jitterBudgetMs + latencyBudgetMs,
      INTERPOLATION_DELAY_MIN_MS,
      INTERPOLATION_DELAY_MAX_MS
    );
    this.interpolationDelayMs =
      this.interpolationDelayMs * (1 - INTERPOLATION_DELAY_SMOOTHING) +
      targetDelayMs * INTERPOLATION_DELAY_SMOOTHING;
  }

  private resolveNetSimulationConfig(): NetSimulationConfig {
    const params = new URLSearchParams(window.location.search);
    const hasNetSimToggle =
      params.get("netsim") === "1" ||
      params.get("netsim") === "true" ||
      params.has("ackDrop") ||
      params.has("ackDelayMs") ||
      params.has("ackJitterMs");
    const ackDropRate = this.clampNumber(this.readQueryNumber(params, "ackDrop", 0), 0, 0.95);
    const ackDelayMs = this.clampNumber(this.readQueryNumber(params, "ackDelayMs", 0), 0, 1000);
    const ackJitterMs = this.clampNumber(this.readQueryNumber(params, "ackJitterMs", 0), 0, 1000);
    const enabled = hasNetSimToggle && (ackDropRate > 0 || ackDelayMs > 0 || ackJitterMs > 0);
    return {
      enabled,
      ackDropRate,
      ackDelayMs,
      ackJitterMs
    };
  }

  private readQueryNumber(params: URLSearchParams, key: string, fallback: number): number {
    const raw = params.get(key);
    if (raw === null) {
      return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private clampUnsignedInt(raw: number, max: number): number {
    if (!Number.isFinite(raw)) {
      return 0;
    }
    const integer = Math.floor(raw);
    return Math.max(0, Math.min(max, integer));
  }

  private applyInterpolatedFrames(rawFrames: unknown): void {
    if (!Array.isArray(rawFrames)) {
      return;
    }

    for (const rawFrame of rawFrames) {
      const frame = rawFrame as {
        createEntities?: unknown[];
        updateEntities?: unknown[];
        deleteEntities?: unknown[];
      };

      for (const rawEntity of frame.createEntities ?? []) {
        if (!rawEntity || typeof rawEntity !== "object") {
          continue;
        }
        const entity = rawEntity as Record<string, unknown>;
        const nid = entity.nid;
        if (typeof nid !== "number") {
          continue;
        }
        this.entities.set(nid, { ...entity });
      }

      for (const rawPatch of frame.updateEntities ?? []) {
        if (!rawPatch || typeof rawPatch !== "object") {
          continue;
        }
        const patch = rawPatch as { nid?: unknown; prop?: unknown; value?: unknown };
        if (typeof patch.nid !== "number" || typeof patch.prop !== "string") {
          continue;
        }
        const entity = this.entities.get(patch.nid) ?? { nid: patch.nid, ntype: NType.PlayerEntity };
        entity[patch.prop] = patch.value;
        this.entities.set(patch.nid, entity);
      }

      for (const rawNid of frame.deleteEntities ?? []) {
        if (typeof rawNid === "number") {
          this.entities.delete(rawNid);
        }
      }
    }
  }

  private toPlayerState(raw: Record<string, unknown>): RemotePlayerState | null {
    const nid = raw.nid;
    const x = raw.x;
    const y = raw.y;
    const z = raw.z;
    const yaw = raw.yaw;
    const pitch = raw.pitch;
    const serverTick = raw.serverTick;
    const grounded = raw.grounded;
    const health = raw.health;
    const upperBodyAction = raw.upperBodyAction;
    const upperBodyActionNonce = raw.upperBodyActionNonce;

    if (
      typeof nid !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof yaw !== "number" ||
      typeof pitch !== "number" ||
      typeof serverTick !== "number"
    ) {
      return null;
    }

    return {
      nid,
      x,
      y,
      z,
      yaw,
      pitch,
      serverTick,
      grounded: typeof grounded === "boolean" ? grounded : true,
      health: typeof health === "number" ? health : 100,
      upperBodyAction: typeof upperBodyAction === "number" ? upperBodyAction : 0,
      upperBodyActionNonce: typeof upperBodyActionNonce === "number" ? upperBodyActionNonce : 0
    };
  }

  private toPlatformState(raw: Record<string, unknown>): PlatformState | null {
    const nid = raw.nid;
    const pid = raw.pid;
    const kind = raw.kind;
    const x = raw.x;
    const y = raw.y;
    const z = raw.z;
    const yaw = raw.yaw;
    const serverTick = raw.serverTick;
    const halfX = raw.halfX;
    const halfY = raw.halfY;
    const halfZ = raw.halfZ;

    if (
      typeof nid !== "number" ||
      typeof pid !== "number" ||
      typeof kind !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof yaw !== "number" ||
      typeof serverTick !== "number" ||
      typeof halfX !== "number" ||
      typeof halfY !== "number" ||
      typeof halfZ !== "number"
    ) {
      return null;
    }

    return {
      nid,
      pid,
      kind,
      x,
      y,
      z,
      yaw,
      serverTick,
      halfX,
      halfY,
      halfZ
    };
  }

  private toProjectileState(raw: Record<string, unknown>): ProjectileState | null {
    const nid = raw.nid;
    const ownerNid = raw.ownerNid;
    const kind = raw.kind;
    const x = raw.x;
    const y = raw.y;
    const z = raw.z;
    const serverTick = raw.serverTick;
    if (
      typeof nid !== "number" ||
      typeof ownerNid !== "number" ||
      typeof kind !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof serverTick !== "number"
    ) {
      return null;
    }

    return {
      nid,
      ownerNid,
      kind,
      x,
      y,
      z,
      serverTick
    };
  }
}
