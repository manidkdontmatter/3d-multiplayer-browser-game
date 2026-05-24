/**
 * Purpose: This file handles network transport, message flow, or network state.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  encodeCreatorCommandPayload,
  NType,
  type CreatorCommandPayload,
  type CreatorCommandAction
} from "../../../shared/netcode";
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
    const queuedCommand: CreatorPanelCommand = {
      ...command,
      sessionId: Number.isFinite(sessionId) && sessionId > 0
        ? Math.floor(sessionId)
        : undefined,
      sequence: this.nextSequence
    };
    this.nextSequence = (this.nextSequence % 0xffff) + 1;
    this.queuedCommands.push(queuedCommand);
  }

  public drainCommands(sessionId: number): string[] {
    if (this.queuedCommands.length === 0) return [];
    const drained = this.queuedCommands.splice(0, this.queuedCommands.length);
    const jsonPayloads: string[] = [];
    for (const cmd of drained) {
      const actions: CreatorCommandAction[] = [];
      if (cmd.setName && cmd.name !== undefined) {
        actions.push({ kind: "set_name", name: cmd.name });
      }
      if (cmd.selectBaseBlueprint && cmd.baseBlueprintId !== undefined) {
        actions.push({ kind: "select_base_blueprint", blueprintId: cmd.baseBlueprintId });
      }
      if (cmd.stepField && cmd.fieldId) {
        actions.push({ kind: "step_field", fieldId: cmd.fieldId, delta: cmd.fieldDelta ?? 1 });
      }
      if (cmd.setField && cmd.fieldId && cmd.fieldValueJson !== undefined) {
        actions.push({
          kind: "set_field",
          fieldId: cmd.fieldId,
          valueJson: cmd.fieldValueJson
        });
      }
      if (cmd.submitCreate) {
        actions.push(
          cmd.submitCreateAndInstantiate
            ? { kind: "submit_create_and_instantiate" }
            : { kind: "submit_create" }
        );
      }
      if (cmd.forkItemInstanceBlueprint && typeof cmd.itemInstanceId === "number" && Number.isFinite(cmd.itemInstanceId)) {
        actions.push({
          kind: "fork_item_instance_blueprint",
          itemInstanceId: Math.max(0, Math.floor(cmd.itemInstanceId)),
          name: cmd.name
        });
      }
      if (cmd.inspectActorCapabilities) {
        actions.push({ kind: "inspect_actor_capabilities" });
      }
      if (
        cmd.setActorCapability &&
        typeof cmd.capabilityKey === "string" &&
        cmd.capabilityKey.trim().length > 0 &&
        typeof cmd.capabilityValue === "number" &&
        Number.isFinite(cmd.capabilityValue)
      ) {
        actions.push({
          kind: "set_actor_capability",
          key: cmd.capabilityKey.trim(),
          value: cmd.capabilityValue
        });
      }
      if (actions.length > 0) {
        const resolvedSessionId = Number.isFinite(cmd.sessionId)
          ? Math.max(0, Math.floor(cmd.sessionId as number))
          : Math.max(0, Math.floor(sessionId));
        if (resolvedSessionId <= 0) {
          continue;
        }
        const payload: CreatorCommandPayload = {
          sessionId: resolvedSessionId,
          sequence: cmd.sequence ?? this.nextSequence,
          actions
        };
        jsonPayloads.push(encodeCreatorCommandPayload(payload));
      }
    }
    return jsonPayloads;
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
