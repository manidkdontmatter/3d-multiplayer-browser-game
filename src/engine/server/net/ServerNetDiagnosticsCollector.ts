/**
 * Purpose: This file collects low-overhead server-side network diagnostics for live debugging and scalability profiling.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Tracks rolling per-player bytes/messages in and out so the server can report netcode health.
 */
import {
  NET_DIAGNOSTICS_WARNING_AVG_IN_BYTES,
  NET_DIAGNOSTICS_WARNING_AVG_IN_MESSAGES,
  NET_DIAGNOSTICS_WARNING_AVG_OUT_BYTES,
  NET_DIAGNOSTICS_WARNING_AVG_OUT_MESSAGES,
  NET_DIAGNOSTICS_WARNING_P95_IN_BYTES,
  NET_DIAGNOSTICS_WARNING_P95_IN_MESSAGES,
  NET_DIAGNOSTICS_WARNING_P95_OUT_BYTES,
  NET_DIAGNOSTICS_WARNING_P95_OUT_MESSAGES,
  NType,
  type ServerNetDiagnosticsMessage
} from "../../shared/netcode";

interface TrafficBucket {
  inboundBytes: number;
  outboundBytes: number;
  inboundMessages: number;
  outboundMessages: number;
}

interface UserTrafficState {
  readonly buckets: TrafficBucket[];
  lastSecond: number;
}

interface NetDiagnosticsThresholds {
  readonly avgOutboundBytesPerSecond: number;
  readonly avgInboundBytesPerSecond: number;
  readonly avgOutboundMessagesPerSecond: number;
  readonly avgInboundMessagesPerSecond: number;
  readonly p95OutboundBytesPerSecond: number;
  readonly p95InboundBytesPerSecond: number;
  readonly p95OutboundMessagesPerSecond: number;
  readonly p95InboundMessagesPerSecond: number;
}

export interface ServerNetDiagnosticsSnapshot extends ServerNetDiagnosticsMessage {
  readonly generatedAtMs: number;
}

const DEFAULT_WINDOW_SECONDS = 10;

function createTrafficBucket(): TrafficBucket {
  return {
    inboundBytes: 0,
    outboundBytes: 0,
    inboundMessages: 0,
    outboundMessages: 0
  };
}

function sumTrafficBuckets(buckets: readonly TrafficBucket[]): TrafficBucket {
  const sum = createTrafficBucket();
  for (const bucket of buckets) {
    sum.inboundBytes += bucket.inboundBytes;
    sum.outboundBytes += bucket.outboundBytes;
    sum.inboundMessages += bucket.inboundMessages;
    sum.outboundMessages += bucket.outboundMessages;
  }
  return sum;
}

function computeP95(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * 0.95)));
  return sorted[index] ?? 0;
}

export class ServerNetDiagnosticsCollector {
  private readonly windowSeconds: number;
  private readonly thresholds: NetDiagnosticsThresholds;
  private readonly userTraffic = new Map<number, UserTrafficState>();
  private currentSecond = Math.floor(Date.now() / 1000);
  private readonly serverBuckets: TrafficBucket[];
  private readonly startedSecond = this.currentSecond;

  public constructor(windowSeconds = DEFAULT_WINDOW_SECONDS) {
    this.windowSeconds = Math.max(2, Math.min(60, Math.floor(windowSeconds)));
    this.serverBuckets = Array.from({ length: this.windowSeconds }, () => createTrafficBucket());
    this.thresholds = this.resolveThresholds();
  }

  public recordInbound(userId: number, bytes: number, nowMs = Date.now()): void {
    this.recordDirection(userId, bytes, nowMs, "inbound");
  }

  public recordOutbound(userId: number, bytes: number, nowMs = Date.now()): void {
    this.recordDirection(userId, bytes, nowMs, "outbound");
  }

  public createSnapshot(connectedUserIds: readonly number[], nowMs = Date.now()): ServerNetDiagnosticsSnapshot {
    const second = Math.floor(nowMs / 1000);
    this.advanceGlobalBuckets(second);

    const activeIds = Array.from(
      new Set(
        connectedUserIds
          .map((value) => (Number.isFinite(value) ? Math.floor(value) : 0))
          .filter((value) => value > 0)
      )
    );
    const divisorSeconds = Math.max(
      1,
      Math.min(this.windowSeconds, second - this.startedSecond + 1)
    );
    const inboundBytesRates: number[] = [];
    const outboundBytesRates: number[] = [];
    const inboundMessageRates: number[] = [];
    const outboundMessageRates: number[] = [];

    for (const userId of activeIds) {
      const state = this.userTraffic.get(userId);
      if (!state) {
        inboundBytesRates.push(0);
        outboundBytesRates.push(0);
        inboundMessageRates.push(0);
        outboundMessageRates.push(0);
        continue;
      }
      this.advanceUserBuckets(state, second);
      const totals = sumTrafficBuckets(state.buckets);
      inboundBytesRates.push(totals.inboundBytes / divisorSeconds);
      outboundBytesRates.push(totals.outboundBytes / divisorSeconds);
      inboundMessageRates.push(totals.inboundMessages / divisorSeconds);
      outboundMessageRates.push(totals.outboundMessages / divisorSeconds);
    }

    this.pruneDisconnectedUsers(activeIds);

    const avgInboundBytesPerSecond = this.computeAverage(inboundBytesRates);
    const avgOutboundBytesPerSecond = this.computeAverage(outboundBytesRates);
    const avgInboundMessagesPerSecond = this.computeAverage(inboundMessageRates);
    const avgOutboundMessagesPerSecond = this.computeAverage(outboundMessageRates);
    const p95InboundBytesPerSecond = computeP95(inboundBytesRates);
    const p95OutboundBytesPerSecond = computeP95(outboundBytesRates);
    const p95InboundMessagesPerSecond = computeP95(inboundMessageRates);
    const p95OutboundMessagesPerSecond = computeP95(outboundMessageRates);

    const warningMask = this.computeWarningMask({
      avgInboundBytesPerSecond,
      avgOutboundBytesPerSecond,
      avgInboundMessagesPerSecond,
      avgOutboundMessagesPerSecond,
      p95InboundBytesPerSecond,
      p95OutboundBytesPerSecond,
      p95InboundMessagesPerSecond,
      p95OutboundMessagesPerSecond
    });

    return {
      ntype: NType.ServerNetDiagnosticsMessage,
      connectedPlayers: activeIds.length,
      windowSeconds: divisorSeconds,
      avgInboundBytesPerSecond,
      avgOutboundBytesPerSecond,
      avgInboundMessagesPerSecond,
      avgOutboundMessagesPerSecond,
      p95InboundBytesPerSecond,
      p95OutboundBytesPerSecond,
      p95InboundMessagesPerSecond,
      p95OutboundMessagesPerSecond,
      warningMask,
      generatedAtMs: nowMs
    };
  }

  public describeWarningMask(mask: number): string {
    const parts: string[] = [];
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_OUT_BYTES) parts.push("avg out bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_IN_BYTES) parts.push("avg in bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_OUT_MESSAGES) parts.push("avg out messages");
    if (mask & NET_DIAGNOSTICS_WARNING_AVG_IN_MESSAGES) parts.push("avg in messages");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_OUT_BYTES) parts.push("p95 out bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_IN_BYTES) parts.push("p95 in bytes");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_OUT_MESSAGES) parts.push("p95 out messages");
    if (mask & NET_DIAGNOSTICS_WARNING_P95_IN_MESSAGES) parts.push("p95 in messages");
    return parts.length > 0 ? parts.join(", ") : "ok";
  }

  private recordDirection(
    userId: number,
    bytes: number,
    nowMs: number,
    direction: "inbound" | "outbound"
  ): void {
    const normalizedUserId = Number.isFinite(userId) ? Math.floor(userId) : 0;
    if (normalizedUserId <= 0) {
      return;
    }
    const normalizedBytes = Number.isFinite(bytes) ? Math.max(0, Math.floor(bytes)) : 0;
    const second = Math.floor(nowMs / 1000);
    this.advanceGlobalBuckets(second);
    const serverBucket = this.serverBuckets[second % this.windowSeconds]!;
    const userState = this.getOrCreateUserState(normalizedUserId, second);
    const userBucket = userState.buckets[second % this.windowSeconds]!;

    if (direction === "inbound") {
      serverBucket.inboundBytes += normalizedBytes;
      serverBucket.inboundMessages += 1;
      userBucket.inboundBytes += normalizedBytes;
      userBucket.inboundMessages += 1;
      return;
    }

    serverBucket.outboundBytes += normalizedBytes;
    serverBucket.outboundMessages += 1;
    userBucket.outboundBytes += normalizedBytes;
    userBucket.outboundMessages += 1;
  }

  private getOrCreateUserState(userId: number, second: number): UserTrafficState {
    let state = this.userTraffic.get(userId);
    if (!state) {
      state = {
        buckets: Array.from({ length: this.windowSeconds }, () => createTrafficBucket()),
        lastSecond: second
      };
      this.userTraffic.set(userId, state);
      return state;
    }
    this.advanceUserBuckets(state, second);
    return state;
  }

  private advanceGlobalBuckets(second: number): void {
    if (second <= this.currentSecond) {
      return;
    }
    const cappedAdvance = Math.min(this.windowSeconds, second - this.currentSecond);
    for (let offset = 1; offset <= cappedAdvance; offset += 1) {
      this.resetBucket(this.serverBuckets[(this.currentSecond + offset) % this.windowSeconds]!);
    }
    this.currentSecond = second;
  }

  private advanceUserBuckets(state: UserTrafficState, second: number): void {
    if (second <= state.lastSecond) {
      return;
    }
    const cappedAdvance = Math.min(this.windowSeconds, second - state.lastSecond);
    for (let offset = 1; offset <= cappedAdvance; offset += 1) {
      this.resetBucket(state.buckets[(state.lastSecond + offset) % this.windowSeconds]!);
    }
    state.lastSecond = second;
  }

  private resetBucket(bucket: TrafficBucket): void {
    bucket.inboundBytes = 0;
    bucket.outboundBytes = 0;
    bucket.inboundMessages = 0;
    bucket.outboundMessages = 0;
  }

  private pruneDisconnectedUsers(activeIds: readonly number[]): void {
    const active = new Set(activeIds);
    for (const userId of this.userTraffic.keys()) {
      if (!active.has(userId)) {
        this.userTraffic.delete(userId);
      }
    }
  }

  private computeAverage(values: readonly number[]): number {
    if (values.length === 0) {
      return 0;
    }
    let sum = 0;
    for (const value of values) {
      sum += value;
    }
    return sum / values.length;
  }

  private computeWarningMask(snapshot: {
    avgInboundBytesPerSecond: number;
    avgOutboundBytesPerSecond: number;
    avgInboundMessagesPerSecond: number;
    avgOutboundMessagesPerSecond: number;
    p95InboundBytesPerSecond: number;
    p95OutboundBytesPerSecond: number;
    p95InboundMessagesPerSecond: number;
    p95OutboundMessagesPerSecond: number;
  }): number {
    let mask = 0;
    if (snapshot.avgOutboundBytesPerSecond > this.thresholds.avgOutboundBytesPerSecond) {
      mask |= NET_DIAGNOSTICS_WARNING_AVG_OUT_BYTES;
    }
    if (snapshot.avgInboundBytesPerSecond > this.thresholds.avgInboundBytesPerSecond) {
      mask |= NET_DIAGNOSTICS_WARNING_AVG_IN_BYTES;
    }
    if (snapshot.avgOutboundMessagesPerSecond > this.thresholds.avgOutboundMessagesPerSecond) {
      mask |= NET_DIAGNOSTICS_WARNING_AVG_OUT_MESSAGES;
    }
    if (snapshot.avgInboundMessagesPerSecond > this.thresholds.avgInboundMessagesPerSecond) {
      mask |= NET_DIAGNOSTICS_WARNING_AVG_IN_MESSAGES;
    }
    if (snapshot.p95OutboundBytesPerSecond > this.thresholds.p95OutboundBytesPerSecond) {
      mask |= NET_DIAGNOSTICS_WARNING_P95_OUT_BYTES;
    }
    if (snapshot.p95InboundBytesPerSecond > this.thresholds.p95InboundBytesPerSecond) {
      mask |= NET_DIAGNOSTICS_WARNING_P95_IN_BYTES;
    }
    if (snapshot.p95OutboundMessagesPerSecond > this.thresholds.p95OutboundMessagesPerSecond) {
      mask |= NET_DIAGNOSTICS_WARNING_P95_OUT_MESSAGES;
    }
    if (snapshot.p95InboundMessagesPerSecond > this.thresholds.p95InboundMessagesPerSecond) {
      mask |= NET_DIAGNOSTICS_WARNING_P95_IN_MESSAGES;
    }
    return mask;
  }

  private resolveThresholds(): NetDiagnosticsThresholds {
    return {
      avgOutboundBytesPerSecond: this.readThreshold("SERVER_NET_WARN_AVG_OUT_BYTES_PER_PLAYER", 20 * 1024),
      avgInboundBytesPerSecond: this.readThreshold("SERVER_NET_WARN_AVG_IN_BYTES_PER_PLAYER", 5 * 1024),
      avgOutboundMessagesPerSecond: this.readThreshold("SERVER_NET_WARN_AVG_OUT_MESSAGES_PER_PLAYER", 30),
      avgInboundMessagesPerSecond: this.readThreshold("SERVER_NET_WARN_AVG_IN_MESSAGES_PER_PLAYER", 30),
      p95OutboundBytesPerSecond: this.readThreshold("SERVER_NET_WARN_P95_OUT_BYTES_PER_PLAYER", 32 * 1024),
      p95InboundBytesPerSecond: this.readThreshold("SERVER_NET_WARN_P95_IN_BYTES_PER_PLAYER", 8 * 1024),
      p95OutboundMessagesPerSecond: this.readThreshold("SERVER_NET_WARN_P95_OUT_MESSAGES_PER_PLAYER", 40),
      p95InboundMessagesPerSecond: this.readThreshold("SERVER_NET_WARN_P95_IN_MESSAGES_PER_PLAYER", 40)
    };
  }

  private readThreshold(name: string, fallback: number): number {
    const raw = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return raw;
  }
}
