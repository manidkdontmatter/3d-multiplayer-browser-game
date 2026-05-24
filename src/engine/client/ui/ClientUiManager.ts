/**
 * Purpose: This file coordinates client-side behavior and presentation, and renders or coordinates in-game UI panels and overlays.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import type { AbilityDefinition } from "../../shared/abilities";
import type { AlertSeverity } from "../../shared/alerts";
import type { ClientLocalSettings } from "../../shared/clientLocalSettings";
import type { InventorySnapshot } from "../../shared/items";
import type { PlayerSettings } from "../../shared/playerSettings";
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
import { AlertFeed } from "./AlertFeed";
import { PlayerHealthBar } from "./PlayerHealthBar";
import { ClientKinematicsPanel, type ClientKinematicsSnapshot } from "./ClientKinematicsPanel";

export class ClientUiManager {
  private readonly runtime: UiRuntime;
  private readonly abilityHud: AbilityHud;
  private readonly diagnosticsPanel: NetworkDiagnosticsPanel;
  private readonly playerCountPanel: PlayerCountPanel;
  private readonly interactPrompt: InteractPrompt;
  private readonly alertFeed: AlertFeed;
  private readonly playerHealthBar: PlayerHealthBar;
  private readonly clientKinematicsPanel: ClientKinematicsPanel;
  private diagnosticsVisible = false;
  private destroyed = false;

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
    this.alertFeed = AlertFeed.mount(this.runtime.getLayer("gameplay"), documentRef);
    this.playerHealthBar = PlayerHealthBar.mount(this.runtime.getLayer("gameplay"), documentRef);
    this.clientKinematicsPanel = ClientKinematicsPanel.mount(this.runtime.getLayer("gameplay"), documentRef);
    this.diagnosticsPanel.setVisible(false);
    this.playerCountPanel.setVisible(false);
    this.clientKinematicsPanel.setVisible(false);
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

  public setPlayerSettings(settings: PlayerSettings): void {
    this.abilityHud.setPlayerSettings(settings);
  }

  public setClientLocalSettings(settings: ClientLocalSettings): void {
    this.abilityHud.setClientLocalSettings(settings);
  }

  public setOwnedAbilityIds(ownedAbilityIds: ReadonlyArray<number>): void {
    this.abilityHud.setOwnedAbilityIds(ownedAbilityIds);
  }

  public setCreatorState(state: CreatorClientState | null): void {
    this.abilityHud.setCreatorState(state);
  }

  public openCreatorSection(): void {
    this.abilityHud.openCreatorSection();
  }

  public setInventoryState(state: InventorySnapshot): void {
    this.abilityHud.setInventoryState(state);
  }

  public toggleDiagnostics(): boolean {
    this.diagnosticsVisible = !this.diagnosticsVisible;
    this.diagnosticsPanel.setVisible(this.diagnosticsVisible);
    this.playerCountPanel.setVisible(this.diagnosticsVisible);
    this.clientKinematicsPanel.setVisible(this.diagnosticsVisible);
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

  public showInteractPromptActions(actions: ReadonlyArray<{ keyLabel: string; label: string; enabled?: boolean; disabledReason?: string }>): void {
    this.interactPrompt.showActions(actions);
  }

  public showAlert(message: string, severity: AlertSeverity = "info"): void {
    this.alertFeed.enqueue(message, severity);
  }

  public getRecentAlerts(): ReadonlyArray<{ text: string; severity: AlertSeverity }> {
    return this.alertFeed.getRecentHistory();
  }

  public updateLocalPlayerHealth(currentHealth: number | null, maxHealth: number | null, deltaSeconds: number): void {
    this.playerHealthBar.update(currentHealth, maxHealth, deltaSeconds);
  }

  public updateClientKinematics(snapshot: ClientKinematicsSnapshot): void {
    if (!this.diagnosticsVisible) {
      return;
    }
    this.clientKinematicsPanel.update(snapshot);
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.abilityHud.destroy();
  }
}

