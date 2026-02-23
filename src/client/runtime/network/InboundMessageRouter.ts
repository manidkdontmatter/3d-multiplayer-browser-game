import { NType } from "../../../shared/netcode";
import type {
  AbilityUseMessage,
  IdentityMessage,
  InputAckMessage
} from "../../../shared/netcode";

export interface InboundMessageRouterHandlers {
  readonly onIdentityMessage: (message: IdentityMessage) => void;
  readonly onInputAckMessage: (message: InputAckMessage) => void;
  readonly onUnhandledMessage: (message: unknown) => void;
}

export class InboundMessageRouter {
  public route(messages: unknown[], handlers: InboundMessageRouterHandlers): void {
    for (const message of messages) {
      const typed = message as
        | IdentityMessage
        | InputAckMessage
        | AbilityUseMessage
        | undefined;

      if (typed?.ntype === NType.IdentityMessage) {
        handlers.onIdentityMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.InputAckMessage) {
        handlers.onInputAckMessage(typed);
        continue;
      }

      handlers.onUnhandledMessage(message);
    }
  }
}
