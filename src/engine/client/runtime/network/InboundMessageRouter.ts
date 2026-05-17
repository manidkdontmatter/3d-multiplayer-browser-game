/**
 * Purpose: This file routes incoming messages/commands/events to the right handler.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { NType } from "../../../shared/netcode";
import type {
  AbilityUseMessage,
  IdentityMessage,
  InputAckMessage,
  InventoryStateMessage,
  MapTransferMessage,
  ServerPopulationMessage
} from "../../../shared/netcode";

export interface InboundMessageRouterHandlers {
  readonly onIdentityMessage: (message: IdentityMessage) => void;
  readonly onInputAckMessage: (message: InputAckMessage) => void;
  readonly onServerPopulationMessage: (message: ServerPopulationMessage) => void;
  readonly onMapTransferMessage: (message: MapTransferMessage) => void;
  readonly onInventoryStateMessage: (message: InventoryStateMessage) => void;
  readonly onUnhandledMessage: (message: unknown) => void;
}

export class InboundMessageRouter {
  public route(messages: unknown[], handlers: InboundMessageRouterHandlers): void {
    for (const message of messages) {
      const typed = message as
        | IdentityMessage
        | InputAckMessage
        | AbilityUseMessage
        | InventoryStateMessage
        | ServerPopulationMessage
        | MapTransferMessage
        | undefined;

      if (typed?.ntype === NType.IdentityMessage) {
        handlers.onIdentityMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.InputAckMessage) {
        handlers.onInputAckMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.ServerPopulationMessage) {
        handlers.onServerPopulationMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.MapTransferMessage) {
        handlers.onMapTransferMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.InventoryStateMessage) {
        handlers.onInventoryStateMessage(typed);
        continue;
      }

      handlers.onUnhandledMessage(message);
    }
  }
}
