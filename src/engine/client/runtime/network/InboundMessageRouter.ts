/**
 * Purpose: This file routes incoming messages/commands/events to the right handler.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { NType } from "../../../shared/netcode";
import type {
  AbilityUseMessage,
  CarrierVolumeEnteredMessage,
  CarrierVolumeExitedMessage,
  IdentityMessage,
  InputAckMessage,
  InventoryStateMessage,
  InventoryActionResultMessage,
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
  readonly onInventoryStateMessage: (message: InventoryStateMessage) => void;
  readonly onCarrierVolumeEnteredMessage: (message: CarrierVolumeEnteredMessage) => void;
  readonly onCarrierVolumeExitedMessage: (message: CarrierVolumeExitedMessage) => void;
  readonly onInventoryActionResultMessage: (message: InventoryActionResultMessage) => void;
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
        | InventoryStateMessage
        | ServerNetDiagnosticsMessage
        | ServerPopulationMessage
        | MapTransferMessage
        | CarrierVolumeEnteredMessage
        | CarrierVolumeExitedMessage
        | InventoryActionResultMessage
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

      if (typed?.ntype === NType.InventoryStateMessage) {
        handlers.onInventoryStateMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.CarrierVolumeEnteredMessage) {
        handlers.onCarrierVolumeEnteredMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.CarrierVolumeExitedMessage) {
        handlers.onCarrierVolumeExitedMessage(typed);
        continue;
      }

      if (typed?.ntype === NType.InventoryActionResultMessage) {
        handlers.onInventoryActionResultMessage(typed);
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
