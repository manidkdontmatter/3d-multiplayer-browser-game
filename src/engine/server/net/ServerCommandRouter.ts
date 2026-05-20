/**
 * Purpose: This file coordinates authoritative server behavior, and routes incoming messages/commands/events to the right handler.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import { NType } from "../../shared/netcode";
import type {
  AbilityCommand as AbilityWireCommand,
  CreatorCommandWire,
  InputCommand as InputWireCommand,
  ItemCommand as ItemWireCommand,
  MapTransferCommand as MapTransferWireCommand,
  PlayerSettingsCommand as PlayerSettingsWireCommand
} from "../../shared/netcode";

export interface ServerCommandRouterHandlers<TUser> {
  readonly onInputCommands: (commands: Partial<InputWireCommand>[]) => void;
  readonly onAbilityCommand: (user: TUser, command: Partial<AbilityWireCommand>) => void;
  readonly onCreatorCommand: (user: TUser, command: CreatorCommandWire) => void;
  readonly onItemCommand: (user: TUser, command: Partial<ItemWireCommand>) => void;
  readonly onMapTransferCommand: (user: TUser, command: Partial<MapTransferWireCommand>) => void;
  readonly onPlayerSettingsCommand: (user: TUser, command: PlayerSettingsWireCommand) => void;
}

export class ServerCommandRouter<TUser> {
  public route(user: TUser, commands: unknown[], handlers: ServerCommandRouterHandlers<TUser>): void {
    const inputCommands: Partial<InputWireCommand>[] = [];

    for (const rawCommand of commands) {
      const ntype = (rawCommand as { ntype?: unknown })?.ntype;
      if (ntype === NType.AbilityCommand) {
        handlers.onAbilityCommand(user, rawCommand as Partial<AbilityWireCommand>);
        continue;
      }

      if (ntype === NType.CreatorCommand) {
        handlers.onCreatorCommand(user, rawCommand as CreatorCommandWire);
        continue;
      }

      if (ntype === NType.MapTransferCommand) {
        handlers.onMapTransferCommand(user, rawCommand as Partial<MapTransferWireCommand>);
        continue;
      }

      if (ntype === NType.ItemCommand) {
        handlers.onItemCommand(user, rawCommand as Partial<ItemWireCommand>);
        continue;
      }
      if (ntype === NType.PlayerSettingsCommand) {
        handlers.onPlayerSettingsCommand(user, rawCommand as PlayerSettingsWireCommand);
        continue;
      }

      if (ntype === NType.InputCommand) {
        inputCommands.push(rawCommand as Partial<InputWireCommand>);
      }
    }

    if (inputCommands.length > 0) {
      handlers.onInputCommands(inputCommands);
    }
  }
}
