/**
 * Purpose: This file coordinates client-side behavior and presentation.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { Client, Interpolator, type Context } from "nengi";
import { WebSocketClientAdapter } from "nengi-websocket-client-adapter";

const CONNECT_TIMEOUT_MS = 10000;

export class NetTransportClient {
  private readonly client: Client;
  private readonly interpolator: Interpolator;
  private connected = false;
  private currentServerUrl: string | null = null;

  public constructor(
    context: Context,
    tickRate: number,
    onDisconnect: () => void,
    onWebsocketError: () => void
  ) {
    this.client = new Client(context, WebSocketClientAdapter, tickRate);
    this.interpolator = new Interpolator(this.client);

    this.client.setDisconnectHandler(() => {
      this.connected = false;
      onDisconnect();
    });
    this.client.setWebsocketErrorHandler(() => {
      onWebsocketError();
    });
  }

  public async connect(
    serverUrl: string,
    authKey: string | null,
    options?: { joinTicket?: string | null }
  ): Promise<void> {
    this.currentServerUrl = serverUrl;
    try {
      this.disconnectActiveSocket("map-transfer-reconnect");
      const handshake: { authVersion: number; accessKey?: string; authKey?: string; joinTicket?: string } = { authVersion: 1 };
      if (typeof authKey === "string" && authKey.length > 0) {
        handshake.accessKey = authKey;
        handshake.authKey = authKey;
      }
      if (typeof options?.joinTicket === "string" && options.joinTicket.length > 0) {
        handshake.joinTicket = options.joinTicket;
      }
      await Promise.race([
        this.client.connect(serverUrl, handshake),
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error(`connect timeout after ${CONNECT_TIMEOUT_MS}ms`)),
            CONNECT_TIMEOUT_MS
          );
        })
      ]);
      this.connected = true;
      console.log(`[client] connected to ${serverUrl}`);
    } catch (error) {
      this.connected = false;
      console.warn("[client] network unavailable, running local-only mode", error);
    }
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public addCommand(command: unknown): void {
    this.client.addCommand(command);
  }

  public flush(): void {
    this.client.flush();
  }

  public consumeMessages(): unknown[] {
    const messages = (this.client.network as { messages?: unknown[] }).messages;
    if (!messages || messages.length === 0) {
      return [];
    }
    const drained = messages.slice();
    messages.length = 0;
    return drained;
  }

  public getInterpolatedState(delayMs: number): unknown {
    return this.interpolator.getInterpolatedState(delayMs);
  }

  public getLatencyMs(): number {
    const rawLatency = (this.client.network as { latency?: unknown }).latency;
    return typeof rawLatency === "number" && Number.isFinite(rawLatency) ? rawLatency : 0;
  }

  public getAverageTimeDifferenceMs(): number {
    return (this.client.network as { chronus?: { averageTimeDifference: number } }).chronus?.averageTimeDifference ?? 0;
  }

  public getCurrentServerUrl(): string | null {
    return this.currentServerUrl;
  }

  private disconnectActiveSocket(reason: string): void {
    const adapter = this.client.adapter as { socket?: WebSocket | null } | undefined;
    const socket = adapter?.socket;
    if (!socket) {
      return;
    }
    if (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) {
      return;
    }
    try {
      socket.close(1000, reason);
    } catch {
      // Best-effort reconnect handoff.
    }
  }
}
