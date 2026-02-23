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
  view?: { x: number; y: number; z: number };
};

export type ServerNetworkQueueEvent = {
  type: NetworkEvent;
  user?: ServerNetworkUser;
  commands?: unknown[];
  payload?: unknown;
};
