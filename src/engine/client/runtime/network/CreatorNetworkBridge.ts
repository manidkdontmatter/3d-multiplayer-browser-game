// Lightweight bridge between the CreatorPanel UI and the network layer.
// Converts CreatorPanelCommand → network messages and routes incoming
// CreatorStateMessage → CreatorStateStore.

import { NType, type CreatorCommandWire, type CreatorCommandPayload, type CreatorCommandAction } from "../../../shared/netcode";
import { CreatorStateStore, type CreatorClientState } from "./CreatorStateStore";
import type { CreatorPanelCommand } from "../../ui/CreatorPanel";

export class CreatorNetworkBridge {
  private readonly stateStore = new CreatorStateStore();
  private queuedCommands: CreatorPanelCommand[] = [];
  private nextSequence = 1;

  public getStateStore(): CreatorStateStore {
    return this.stateStore;
  }

  public queueCommand(command: CreatorPanelCommand, sessionId: number): void {
    command.sessionId = sessionId;
    command.sequence = this.nextSequence;
    this.nextSequence = (this.nextSequence % 0xffff) + 1;
    this.queuedCommands.push(command);
  }

  public drainCommands(sessionId: number): string[] {
    if (this.queuedCommands.length === 0) return [];
    const drained = this.queuedCommands.splice(0, this.queuedCommands.length);
    const jsonPayloads: string[] = [];
    for (const cmd of drained) {
      const actions: CreatorCommandAction[] = [];
      if (cmd.applyName && cmd.name !== undefined) {
        actions.push({ kind: "apply_name", name: cmd.name });
      }
      if (cmd.selectBaseArchetype && cmd.baseArchetypeId !== undefined) {
        actions.push({ kind: "select_base_archetype", archetypeId: cmd.baseArchetypeId });
      }
      if (cmd.allocateStat && cmd.statId) {
        actions.push({ kind: "allocate_stat", statId: cmd.statId, delta: cmd.statDelta ?? 1 });
      }
      if (cmd.toggleTrait && cmd.traitId) {
        actions.push({ kind: "toggle_trait", traitId: cmd.traitId });
      }
      if (cmd.submitCreate) {
        actions.push({ kind: "submit_create" });
      }
      if (actions.length > 0) {
        const payload: CreatorCommandPayload = {
          sessionId: cmd.sessionId ?? sessionId,
          sequence: cmd.sequence ?? this.nextSequence,
          actions
        };
        jsonPayloads.push(JSON.stringify(payload));
      }
    }
    return jsonPayloads;
  }

  public processMessage(message: unknown): boolean {
    return this.stateStore.processMessage(message);
  }

  public consumeState(): CreatorClientState | null {
    return this.stateStore.consumeState();
  }

  public reset(): void {
    this.stateStore.reset();
    this.queuedCommands.length = 0;
    this.nextSequence = 1;
  }
}
