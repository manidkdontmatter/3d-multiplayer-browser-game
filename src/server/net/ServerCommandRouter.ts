// Routes parsed nengi command payloads to input simulation or ability-state mutation handlers.
import { NType } from "../../shared/netcode";
import type {
  AbilityCommand as AbilityWireCommand,
  AbilityCreatorCommand as AbilityCreatorWireCommand,
  InputCommand as InputWireCommand,
  MapTransferCommand as MapTransferWireCommand
} from "../../shared/netcode";

export interface ServerCommandRouterHandlers<TUser> {
  readonly onInputCommands: (commands: Partial<InputWireCommand>[]) => void;
  readonly onAbilityCommand: (user: TUser, command: Partial<AbilityWireCommand>) => void;
  readonly onAbilityCreatorCommand: (user: TUser, command: Partial<AbilityCreatorWireCommand>) => void;
  readonly onMapTransferCommand: (user: TUser, command: Partial<MapTransferWireCommand>) => void;
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

      if (ntype === NType.AbilityCreatorCommand) {
        handlers.onAbilityCreatorCommand(user, rawCommand as Partial<AbilityCreatorWireCommand>);
        continue;
      }

      if (ntype === NType.MapTransferCommand) {
        handlers.onMapTransferCommand(user, rawCommand as Partial<MapTransferWireCommand>);
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
