/**
 * Purpose: This file routes incoming messages/commands/events to the right handler.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { NType } from "../../../shared/netcode";
import type {
  AbilityUseMessage,
  ReferenceFrameVolumeEnteredMessage,
  ReferenceFrameVolumeExitedMessage,
  IdentityMessage,
  InputAckMessage,
  UiViewOpenMessage,
  UiViewPatchMessage,
  UiViewCloseMessage,
  UiIntentResultMessage,
  PlayerSettingsMessage,
  ServerAlertMessage,
  MapTransferMessage,
  ServerNetDiagnosticsMessage,
  ServerPopulationMessage
} from "../../../shared/netcode";

export interface InboundMessageRouterHandlers {
  readonly onIdentityMessage: (message: IdentityMessage) => void;
  readonly onInputAckMessage: (message: InputAckMessage) => void;
  readonly onServerPopulationMessage: (message: ServerPopulationMessage) => void;
  readonly onServerNetDiagnosticsMessage: (message: ServerNetDiagnosticsMessage) => void;
  readonly onMapTransferMessage: (message: MapTransferMessage) => void;
  readonly onReferenceFrameVolumeEnteredMessage: (message: ReferenceFrameVolumeEnteredMessage) => void;
  readonly onReferenceFrameVolumeExitedMessage: (message: ReferenceFrameVolumeExitedMessage) => void;
  readonly onUiViewOpenMessage: (message: UiViewOpenMessage) => void;
  readonly onUiViewPatchMessage: (message: UiViewPatchMessage) => void;
  readonly onUiViewCloseMessage: (message: UiViewCloseMessage) => void;
  readonly onUiIntentResultMessage: (message: UiIntentResultMessage) => void;
  readonly onPlayerSettingsMessage: (message: PlayerSettingsMessage) => void;
  readonly onServerAlertMessage: (message: ServerAlertMessage) => void;
  readonly onUnhandledMessage: (message: unknown) => void;
}

export class InboundMessageRouter {
  public route(messages: unknown[], handlers: InboundMessageRouterHandlers): void {
    for (const message of messages) {
      const typed = message as
        | IdentityMessage
        | InputAckMessage
        | AbilityUseMessage
        | ServerNetDiagnosticsMessage
        | ServerPopulationMessage
        | MapTransferMessage
        | ReferenceFrameVolumeEnteredMessage
        | ReferenceFrameVolumeExitedMessage
        | UiViewOpenMessage
        | UiViewPatchMessage
        | UiViewCloseMessage
        | UiIntentResultMessage
        | PlayerSettingsMessage
        | ServerAlertMessage
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

      if (typed?.ntype === NType.ServerNetDiagnosticsMessage) {
        handlers.onServerNetDiagnosticsMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.MapTransferMessage) {
        handlers.onMapTransferMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.ReferenceFrameVolumeEnteredMessage) {
        handlers.onReferenceFrameVolumeEnteredMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.ReferenceFrameVolumeExitedMessage) {
        handlers.onReferenceFrameVolumeExitedMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.UiViewOpenMessage) {
        handlers.onUiViewOpenMessage(typed);
        continue;
      }
      if (typed?.ntype === NType.UiViewPatchMessage) {
        handlers.onUiViewPatchMessage(typed);
        continue;
      }
      if (typed?.ntype === NType.UiViewCloseMessage) {
        handlers.onUiViewCloseMessage(typed);
        continue;
      }
      if (typed?.ntype === NType.UiIntentResultMessage) {
        handlers.onUiIntentResultMessage(typed);
        continue;
      }
      if (typed?.ntype === NType.PlayerSettingsMessage) {
        handlers.onPlayerSettingsMessage(typed);
        continue;
      }
      if (typed?.ntype === NType.ServerAlertMessage) {
        handlers.onServerAlertMessage(typed);
        continue;
      }

      handlers.onUnhandledMessage(message);
    }
  }
}
