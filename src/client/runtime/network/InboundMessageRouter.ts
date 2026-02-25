// Routes inbound transport messages into identity, reconciliation, and ability-state handlers.
import { NType } from "../../../shared/netcode";
import type {
  AbilityUseMessage,
  IdentityMessage,
  InputAckMessage,
  ServerPopulationMessage
} from "../../../shared/netcode";

export interface InboundMessageRouterHandlers {
  readonly onIdentityMessage: (message: IdentityMessage) => void;
  readonly onInputAckMessage: (message: InputAckMessage) => void;
  readonly onServerPopulationMessage: (message: ServerPopulationMessage) => void;
  readonly onUnhandledMessage: (message: unknown) => void;
}

export class InboundMessageRouter {
  public route(messages: unknown[], handlers: InboundMessageRouterHandlers): void {
    for (const message of messages) {
      const typed = message as
        | IdentityMessage
        | InputAckMessage
        | AbilityUseMessage
        | ServerPopulationMessage
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

      handlers.onUnhandledMessage(message);
    }
  }
}
