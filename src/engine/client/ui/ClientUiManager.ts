/**
 * Purpose: This file coordinates client-side behavior and presentation, and renders or coordinates in-game UI panels and overlays.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import type { AbilityDefinition } from "../../shared/abilities";
import type { InventoryStateSnapshot } from "../../shared/items";
import type { CreatorClientState } from "../runtime/network/CreatorStateStore";
import { AbilityHud, type AbilityHudOptions } from "./AbilityHud";
import {
  NetworkDiagnosticsPanel,
  type NetworkDiagnosticsSnapshot
} from "./NetworkDiagnosticsPanel";
import { TooltipSystem } from "./TooltipSystem";
import { UiRuntime } from "./UiRuntime";
import { PlayerCountPanel } from "./PlayerCountPanel";
import { InteractPrompt } from "./InteractPrompt";

export class ClientUiManager {
  private readonly runtime: UiRuntime;
  private readonly abilityHud: AbilityHud;
  private readonly diagnosticsPanel: NetworkDiagnosticsPanel;
  private readonly playerCountPanel: PlayerCountPanel;
  private readonly interactPrompt: InteractPrompt;
  private diagnosticsVisible = false;

  private constructor(documentRef: Document, abilityHudOptions: AbilityHudOptions) {
    this.runtime = UiRuntime.ensureDocumentRoot(documentRef);
    this.runtime.setUiScale(1);
    this.runtime.adoptElementById(documentRef, "boot-overlay", "boot");

    TooltipSystem.install(documentRef, this.runtime.getLayer("tooltip"));
    this.abilityHud = AbilityHud.mount(
      this.runtime.getLayer("gameplay"),
      documentRef,
      abilityHudOptions
    );
    this.diagnosticsPanel = NetworkDiagnosticsPanel.mount(
      this.runtime.getLayer("debug"),
      documentRef
    );
    this.playerCountPanel = PlayerCountPanel.mount(this.runtime.getLayer("gameplay"), documentRef);
    this.interactPrompt = InteractPrompt.mount(this.runtime.getLayer("gameplay"), documentRef);
    this.diagnosticsPanel.setVisible(false);
  }

  public static mount(documentRef: Document, abilityHudOptions: AbilityHudOptions): ClientUiManager {
    return new ClientUiManager(documentRef, abilityHudOptions);
  }

  public toggleMainMenu(): boolean {
    return this.abilityHud.toggleMainMenu();
  }

  public isMainMenuOpen(): boolean {
    return this.abilityHud.isMainMenuOpen();
  }

  public upsertAbility(ability: AbilityDefinition): void {
    this.abilityHud.upsertAbility(ability);
  }

  public setHotbarAssignments(assignments: ReadonlyArray<number>): void {
    this.abilityHud.setHotbarAssignments(assignments);
  }

  public setMouseBindings(primarySlot: number, secondarySlot: number): void {
    this.abilityHud.setMouseBindings(primarySlot, secondarySlot);
  }

  public setOwnedAbilityIds(ownedAbilityIds: ReadonlyArray<number>): void {
    this.abilityHud.setOwnedAbilityIds(ownedAbilityIds);
  }

  public setCreatorState(state: CreatorClientState | null): void {
    this.abilityHud.setCreatorState(state);
  }

  public setInventoryState(state: InventoryStateSnapshot): void {
    this.abilityHud.setInventoryState(state);
  }

  public toggleDiagnostics(): boolean {
    this.diagnosticsVisible = !this.diagnosticsVisible;
    this.diagnosticsPanel.setVisible(this.diagnosticsVisible);
    return this.diagnosticsVisible;
  }

  public updateDiagnostics(snapshot: NetworkDiagnosticsSnapshot): void {
    if (!this.diagnosticsVisible) {
      return;
    }
    this.diagnosticsPanel.update(snapshot);
  }

  public updatePlayerCount(serverPlayersLabel: string, aoiCount: number): void {
    this.playerCountPanel.update(serverPlayersLabel, aoiCount);
  }

  public clearInteractPrompt(): void {
    this.interactPrompt.clear();
  }

  public showInteractPrompt(text: string): void {
    this.interactPrompt.show(text);
  }
}
