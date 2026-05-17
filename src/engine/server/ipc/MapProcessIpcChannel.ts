/**
 * Purpose: This file sends and receives inter-process messages between runtime processes.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import {
  type OrchestratorIpcEnvelope,
  type OrchestratorIpcEventMap,
  type OrchestratorIpcRequestMap,
  isOrchestratorIpcEnvelope
} from "../orchestrator/OrchestratorIpcProtocol";

type RequestHandler<K extends keyof OrchestratorIpcRequestMap> = (
  payload: OrchestratorIpcRequestMap[K]["request"]
) => Promise<OrchestratorIpcRequestMap[K]["response"]> | OrchestratorIpcRequestMap[K]["response"];

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
};

export class MapProcessIpcChannel {
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly requestHandlers = new Map<
    keyof OrchestratorIpcRequestMap,
    RequestHandler<keyof OrchestratorIpcRequestMap>
  >();
  private nextCorrelationId = 1;
  private listening = false;

  public constructor(
    private readonly source: string,
    private readonly target = "orchestrator",
    private readonly requestTimeoutMs = 5000
  ) {}

  public isAvailable(): boolean {
    return typeof process.send === "function";
  }

  public start(): void {
    if (this.listening || !this.isAvailable()) {
      return;
    }
    this.listening = true;
    process.on("message", (message) => {
      void this.handleMessage(message);
    });
  }

  public onRequest<K extends keyof OrchestratorIpcRequestMap>(
    messageType: K,
    handler: RequestHandler<K>
  ): void {
    this.requestHandlers.set(
      messageType,
      handler as unknown as RequestHandler<keyof OrchestratorIpcRequestMap>
    );
  }

  public emit<K extends keyof OrchestratorIpcEventMap>(messageType: K, payload: OrchestratorIpcEventMap[K]): void {
    if (!this.isAvailable()) {
      return;
    }
    this.sendEnvelope({
      messageKind: "event",
      messageType,
      correlationId: null,
      source: this.source,
      target: this.target,
      sentAtMs: Date.now(),
      payload
    });
  }

  public request<K extends keyof OrchestratorIpcRequestMap>(
    messageType: K,
    payload: OrchestratorIpcRequestMap[K]["request"],
    timeoutMs = this.requestTimeoutMs
  ): Promise<OrchestratorIpcRequestMap[K]["response"]> {
    if (!this.isAvailable()) {
      return Promise.reject(new Error(`IPC unavailable for request ${String(messageType)}.`));
    }
    const correlationId = `${process.pid}:${this.nextCorrelationId++}`;
    const envelope: OrchestratorIpcEnvelope<OrchestratorIpcRequestMap[K]["request"]> = {
      messageKind: "request",
      messageType,
      correlationId,
      source: this.source,
      target: this.target,
      sentAtMs: Date.now(),
      payload
    };
    return new Promise<OrchestratorIpcRequestMap[K]["response"]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`IPC request timed out: ${String(messageType)}`));
      }, timeoutMs);
      this.pendingRequests.set(correlationId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout
      });
      this.sendEnvelope(envelope);
    });
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isOrchestratorIpcEnvelope(message)) {
      return;
    }
    const envelope = message as OrchestratorIpcEnvelope;
    if (envelope.target !== this.source && envelope.target !== "map-process") {
      return;
    }
    if (envelope.messageKind === "response" && envelope.correlationId) {
      this.resolvePending(envelope);
      return;
    }
    if (envelope.messageKind !== "request") {
      return;
    }
    const handler = this.requestHandlers.get(
      envelope.messageType as keyof OrchestratorIpcRequestMap
    ) as RequestHandler<keyof OrchestratorIpcRequestMap> | undefined;
    if (!handler) {
      this.sendEnvelope({
        messageKind: "response",
        messageType: envelope.messageType,
        correlationId: envelope.correlationId,
        source: this.source,
        target: envelope.source,
        sentAtMs: Date.now(),
        payload: {},
        ok: false,
        error: `Unhandled IPC request ${envelope.messageType}`
      });
      return;
    }
    try {
      const responsePayload = await handler(envelope.payload as never);
      this.sendEnvelope({
        messageKind: "response",
        messageType: envelope.messageType,
        correlationId: envelope.correlationId,
        source: this.source,
        target: envelope.source,
        sentAtMs: Date.now(),
        payload: responsePayload,
        ok: true
      });
    } catch (error) {
      this.sendEnvelope({
        messageKind: "response",
        messageType: envelope.messageType,
        correlationId: envelope.correlationId,
        source: this.source,
        target: envelope.source,
        sentAtMs: Date.now(),
        payload: {},
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private resolvePending(envelope: OrchestratorIpcEnvelope): void {
    const correlationId = envelope.correlationId;
    if (!correlationId) {
      return;
    }
    const pending = this.pendingRequests.get(correlationId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(correlationId);
    if (envelope.ok === false) {
      pending.reject(new Error(envelope.error ?? `IPC request failed: ${envelope.messageType}`));
      return;
    }
    pending.resolve(envelope.payload);
  }

  private sendEnvelope(envelope: OrchestratorIpcEnvelope): void {
    const send = process.send?.bind(process) as ((message: unknown) => boolean) | undefined;
    send?.(envelope);
  }
}
