/**
 * Purpose: This file provides the uWebSockets nengi adapter used by the server and exposes byte/message accounting hooks.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Owns the actual socket send/receive boundary so server net diagnostics can count real buffers.
 */
import { Buffer } from "node:buffer";
import { App, type WebSocket } from "uWebSockets.js";
import {
  type IServerNetworkAdapter,
  type InstanceNetwork,
  User
} from "nengi";
import { BufferReader, BufferWriter } from "nengi-buffers";
import { ServerNetDiagnosticsCollector } from "./ServerNetDiagnosticsCollector";

type UserData = {
  user: User;
};

export class InstrumentedUwsInstanceAdapter implements IServerNetworkAdapter {
  public constructor(
    private readonly network: InstanceNetwork,
    private readonly diagnostics: ServerNetDiagnosticsCollector
  ) {}

  public listen(port: number, ready: () => void): void {
    App({})
      .ws("/*", {
        open: async (ws: WebSocket<UserData>) => {
          const user = new User(ws, this);
          ws.getUserData().user = user;
          user.remoteAddress = Buffer.from(ws.getRemoteAddressAsText()).toString("utf8");
          this.network.onOpen(user);
        },
        message: async (ws: WebSocket<UserData>, message: ArrayBuffer, isBinary: boolean) => {
          const user = ws.getUserData().user;
          if (!isBinary) {
            return;
          }
          const buffer = Buffer.from(message);
          this.diagnostics.recordInbound(user.id, buffer.byteLength);
          this.network.onMessage(user, buffer);
        },
        drain: (ws: WebSocket<UserData>) => {
          console.log(`WebSocket backpressure: ${ws.getBufferedAmount()}`);
        },
        close: (ws: WebSocket<UserData>) => {
          this.network.onClose(ws.getUserData().user);
        }
      })
      .listen(port, (listenSocket: unknown) => {
        if (listenSocket) {
          ready();
        }
      });
  }

  public createBuffer(lengthInBytes: number): Buffer {
    return Buffer.allocUnsafe(lengthInBytes);
  }

  public createBufferWriter(lengthInBytes: number): BufferWriter {
    return new BufferWriter(this.createBuffer(lengthInBytes));
  }

  public createBufferReader(buffer: Buffer): BufferReader {
    return new BufferReader(buffer);
  }

  public disconnect(user: User, reason: unknown): void {
    user.socket.end(1000, JSON.stringify(reason));
  }

  public send(user: User, buffer: Buffer): void {
    this.diagnostics.recordOutbound(user.id, buffer.byteLength);
    user.socket.send(buffer, true);
  }
}
