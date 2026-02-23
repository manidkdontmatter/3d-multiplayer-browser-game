import { NType } from "../../shared/netcode";
import type {
  InputCommand as InputWireCommand,
  LoadoutCommand as LoadoutWireCommand
} from "../../shared/netcode";

export interface ServerCommandRouterHandlers<TUser> {
  readonly onInputCommands: (commands: Partial<InputWireCommand>[]) => void;
  readonly onLoadoutCommand: (user: TUser, command: Partial<LoadoutWireCommand>) => void;
}

export class ServerCommandRouter<TUser> {
  public route(user: TUser, commands: unknown[], handlers: ServerCommandRouterHandlers<TUser>): void {
    const inputCommands: Partial<InputWireCommand>[] = [];

    for (const rawCommand of commands) {
      const ntype = (rawCommand as { ntype?: unknown })?.ntype;
      if (ntype === NType.LoadoutCommand) {
        handlers.onLoadoutCommand(user, rawCommand as Partial<LoadoutWireCommand>);
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
