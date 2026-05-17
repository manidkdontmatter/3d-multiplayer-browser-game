/**
 * Purpose: This file defines data/type contracts that keep connected systems compatible, and coordinates authoritative server behavior.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
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
  farView?: {
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
