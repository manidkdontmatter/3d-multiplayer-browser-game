import type { NetworkEvent } from "nengi";

export type ServerNetworkAdapter = {
  listen: (port: number, ready: () => void) => void;
  close?: () => void;
};

export type ServerNetworkUser = {
  id: number;
  queueMessage: (message: unknown) => void;
  remoteAddress?: string;
  networkAdapter?: {
    disconnect?: (user: unknown, reason: unknown) => void;
  };
  accountId?: number;
  authKey?: string | null;
  pendingTransferId?: string | null;
  view?: {
    x: number;
    y: number;
    z: number;
    halfWidth: number;
    halfHeight: number;
    halfDepth: number;
  };
};

export type ServerNetworkQueueEvent = {
  type: NetworkEvent;
  user?: ServerNetworkUser;
  commands?: unknown[];
  payload?: unknown;
};
