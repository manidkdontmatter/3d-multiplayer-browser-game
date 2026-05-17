/**
 * Purpose: This file defines message shapes and command/event names used between systems, and runs ordered startup steps so dependencies initialize correctly.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import type { RuntimeMapConfig } from "./world";

export interface BootstrapRequest {
  authKey: string | null;
}

export interface BootstrapResponse {
  ok: boolean;
  wsUrl?: string;
  joinTicket?: string;
  mapConfig?: RuntimeMapConfig;
  error?: string;
}
