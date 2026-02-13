import { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";
import type { InstanceNetwork, User as NengiUser } from "nengi";
import { User } from "nengi";
import { BufferReader, BufferWriter } from "nengi-buffers";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

type UserWithSocket = NengiUser & {
  socket: {
    send: (buffer: Buffer | ArrayBuffer) => void;
    close: (code?: number, reason?: string) => void;
  };
};

export class WsInstanceAdapter {
  private server: WebSocketServer | null = null;

  public constructor(private readonly network: InstanceNetwork) {}

  public listen(port: number, ready: () => void): void {
    const server = new WebSocketServer({ port });
    this.server = server;

    server.on("listening", ready);

    server.on("connection", (socket: WebSocket, request: IncomingMessage) => {
      const user = new User(socket, this) as UserWithSocket;
      user.remoteAddress = request.socket.remoteAddress ?? "";
      this.network.onOpen(user);

      socket.on("message", (data: RawData, isBinary: boolean) => {
        if (!isBinary) {
          return;
        }
        this.network.onMessage(user, this.toBuffer(data));
      });

      socket.on("close", () => {
        this.network.onClose(user);
      });
    });
  }

  public close(): void {
    this.server?.close();
    this.server = null;
  }

  public disconnect(user: UserWithSocket, reason: unknown): void {
    user.socket.close(1000, JSON.stringify(reason ?? "disconnect"));
  }

  public send(user: UserWithSocket, buffer: Buffer | ArrayBuffer): void {
    user.socket.send(buffer);
  }

  public createBuffer(lengthInBytes: number): Buffer {
    return Buffer.allocUnsafe(lengthInBytes);
  }

  public createBufferWriter(lengthInBytes: number): BufferWriter {
    return new BufferWriter(this.createBuffer(lengthInBytes));
  }

  public createBufferReader(buffer: Buffer | ArrayBuffer): BufferReader {
    return new BufferReader(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  }

  private toBuffer(data: RawData): Buffer {
    if (Buffer.isBuffer(data)) {
      return data;
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data.map((part) => this.toBuffer(part)));
    }

    return Buffer.from(data as ArrayBuffer);
  }
}
