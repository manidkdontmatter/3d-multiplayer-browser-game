import {
  Channel,
  ChannelAABB3D,
  Instance,
  NetworkEvent,
  type Context
} from "nengi";
import type {
  ServerNetworkAdapter,
  ServerNetworkQueueEvent,
  ServerNetworkUser
} from "./ServerNetworkTypes";

export interface ServerNetworkHostStartOptions {
  readonly port: number;
  readonly onListen?: () => void;
  readonly onHandshake: (handshake: unknown) => Promise<unknown>;
}

export interface ServerNetworkHostQueueHandlers {
  readonly onUserConnected?: (user: ServerNetworkUser, payload: unknown) => void;
  readonly onCommandSet?: (user: ServerNetworkUser, commands: unknown[]) => void;
  readonly onUserDisconnected?: (user: ServerNetworkUser) => void;
}

export class ServerNetworkHost {
  private readonly instance: Instance;
  private readonly globalChannel: Channel;
  private readonly spatialChannel: ChannelAABB3D;
  private adapter: ServerNetworkAdapter | null = null;

  public constructor(context: Context) {
    this.instance = new Instance(context);
    this.globalChannel = new Channel(this.instance.localState);
    this.spatialChannel = new ChannelAABB3D(this.instance.localState);
  }

  public getGlobalChannel(): Channel {
    return this.globalChannel;
  }

  public getSpatialChannel(): ChannelAABB3D {
    return this.spatialChannel;
  }

  public async start(options: ServerNetworkHostStartOptions): Promise<void> {
    this.instance.onConnect = options.onHandshake;
    this.adapter = await this.createNetworkAdapter();
    this.adapter.listen(options.port, () => {
      options.onListen?.();
    });
  }

  public stop(): void {
    if (this.adapter?.close) {
      this.adapter.close();
    }
    this.adapter = null;
  }

  public drainQueue(handlers: ServerNetworkHostQueueHandlers): void {
    while (!this.instance.queue.isEmpty()) {
      const event = this.instance.queue.next() as ServerNetworkQueueEvent;

      if (event.type === NetworkEvent.UserConnected && event.user) {
        handlers.onUserConnected?.(event.user, event.payload);
        continue;
      }

      if (event.type === NetworkEvent.CommandSet && event.user) {
        handlers.onCommandSet?.(event.user, event.commands ?? []);
        continue;
      }

      if (event.type === NetworkEvent.UserDisconnected && event.user) {
        handlers.onUserDisconnected?.(event.user);
      }
    }
  }

  public step(): void {
    this.instance.step();
  }

  private async createNetworkAdapter(): Promise<ServerNetworkAdapter> {
    const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
    const nodeSupportsUws = nodeMajor === 20;
    if (!nodeSupportsUws) {
      throw new Error(
        `uWS transport requires Node 20.x in this project. Current Node: ${process.versions.node}`
      );
    }

    try {
      const { uWebSocketsInstanceAdapter } = await import("nengi-uws-instance-adapter");
      console.log("[server] transport=uws");
      return new uWebSocketsInstanceAdapter(this.instance.network, {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`uWS adapter failed to initialize: ${message}`);
    }
  }
}
