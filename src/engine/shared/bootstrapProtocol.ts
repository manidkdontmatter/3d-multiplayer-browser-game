// Shared bootstrap protocol between the browser client and the orchestrator entry service.
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
