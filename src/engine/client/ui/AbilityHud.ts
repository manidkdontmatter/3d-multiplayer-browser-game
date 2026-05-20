/**
 * Purpose: This file manages ability definitions, state, or execution flow, and renders real-time player HUD information.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  MAX_FIELD_OF_VIEW,
  MAX_MOUSE_SENSITIVITY,
  MIN_FIELD_OF_VIEW,
  MIN_MOUSE_SENSITIVITY,
  VOICE_CHAT_MODES,
  coercePlayerSettings,
  type PlayerSettings
} from "../../shared/playerSettings";
import {
  ANTI_ALIASING_MODES,
  GRAPHICS_PRESETS,
  coerceClientLocalSettings,
  type ClientLocalSettings
} from "../../shared/clientLocalSettings";
import {
  ABILITY_ID_NONE,
  HOTBAR_SLOT_COUNT,
  clampHotbarSlotIndex,
  getAbilityDefinitionById,
  getAllAbilityDefinitions,
  type AbilityDefinition
} from "../../shared/abilities";
import {
  EQUIPMENT_SLOT_WIRE_VALUE,
  getItemDefinitionById,
  type EquipmentSlot,
  type InventorySnapshot
} from "../../shared/items";
import { CreatorPanel, type CreatorPanelCommand } from "./CreatorPanel";
import { getBlueprintDefinitionsForProfile } from "../../shared/blueprint";
import type { CreatorClientState } from "../runtime/network/CreatorStateStore";

export interface AbilityHudOptions {
  initialHotbarAssignments: ReadonlyArray<number>;
  initialPrimaryMouseSlot: number;
  initialSecondaryMouseSlot: number;
  initialPlayerSettings: PlayerSettings;
  initialClientLocalSettings: ClientLocalSettings;
  onHotbarAssignmentChanged?: (slot: number, abilityId: number) => void;
  onAbilityForgotten?: (abilityId: number) => void;
  onCreatorCommand?: (command: CreatorPanelCommand) => void;
  onInventoryItemDropped?: (itemInstanceId: number) => void;
  onInventoryItemUsed?: (itemInstanceId: number, channel: number) => void;
  onInventoryItemEquipped?: (itemInstanceId: number) => void;
  onInventorySlotUnequipped?: (slot: EquipmentSlot) => void;
  onHotbarItemAssigned?: (slot: number, itemInstanceId: number) => void;
  onHotbarSlotCleared?: (slot: number) => void;
  onHotbarSlotMoved?: (sourceSlot: number, targetSlot: number) => void;
  onHotbarSlotExecuted?: (slot: number, channel: number) => void;
  onHotbarSlotDropped?: (slot: number) => void;
  onPlayerSettingsChanged?: (settingsPatch: Partial<PlayerSettings>) => void;
  onClientLocalSettingsChanged?: (settingsPatch: Partial<ClientLocalSettings>) => void;
}

type SlotElements = {
  button: HTMLButtonElement;
  nameLabel: HTMLSpanElement;
  badgeLabel: HTMLSpanElement;
};

type MainUiSectionKey = "character" | "inventory" | "ability-book" | "ability-creator" | "settings";

const ABILITY_DRAG_MIME = "application/x-ability-id";
const INVENTORY_ITEM_DRAG_MIME = "application/x-item-instance-id";
const HOTBAR_SLOT_DRAG_MIME = "application/x-hotbar-slot";

export class AbilityHud {
  private readonly root: HTMLDivElement;
  private readonly hotbarRow: HTMLDivElement;
  private readonly hotbarHint: HTMLParagraphElement;
  private readonly mainUiOverlay: HTMLDivElement;
  private readonly navButtons = new Map<MainUiSectionKey, HTMLButtonElement>();
  private readonly sectionPanels = new Map<MainUiSectionKey, HTMLElement>();
  private abilityBookGrid!: HTMLDivElement;
  private inventoryList!: HTMLDivElement;
  private equipmentList!: HTMLDivElement;
  private abilitySearchInput!: HTMLInputElement;
  private readonly abilityCards = new Map<number, HTMLDivElement>();
  private readonly slotElements: SlotElements[] = [];
  private readonly assignments = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
  private readonly abilityCatalog = new Map<number, AbilityDefinition>();
  private readonly ownedAbilityIds = new Set<number>();
  private inventoryState: InventorySnapshot = { maxSlots: 32, itemInstances: [], equipment: {}, hotbarSlots: [] };
  private creatorPanel!: CreatorPanel;
  private mainUiOpen = false;
  private activeSection: MainUiSectionKey = "ability-book";
  private editSlot = 0;
  private primaryMouseSlot = 0;
  private secondaryMouseSlot = 1;
  private playerSettings = coercePlayerSettings(null);
  private clientLocalSettings = coerceClientLocalSettings(null);
  private hotbarDigitToggleInput: HTMLInputElement | null = null;
  private mouseSmoothingToggleInput: HTMLInputElement | null = null;
  private mouseSensitivitySliderInput: HTMLInputElement | null = null;
  private mouseSensitivityValue: HTMLSpanElement | null = null;
  private fieldOfViewSliderInput: HTMLInputElement | null = null;
  private fieldOfViewValue: HTMLSpanElement | null = null;
  private voiceChatModeSelect: HTMLSelectElement | null = null;
  private graphicsPresetSelect: HTMLSelectElement | null = null;
  private antiAliasingModeSelect: HTMLSelectElement | null = null;

  private constructor(parent: HTMLElement, private readonly options: AbilityHudOptions, documentRef: Document) {
    this.playerSettings = coercePlayerSettings(options.initialPlayerSettings);
    this.clientLocalSettings = coerceClientLocalSettings(options.initialClientLocalSettings);
    this.root = documentRef.createElement("div");
    this.root.id = "ability-ui";

    this.hotbarRow = documentRef.createElement("div");
    this.hotbarRow.id = "ability-hotbar";
    this.root.append(this.hotbarRow);
    this.hotbarHint = documentRef.createElement("p");
    this.hotbarHint.id = "ability-hotbar-hint";
    this.hotbarHint.textContent = "0-9: LMB slot bind or activate (Settings). Alt+0-9: RMB bind.";
    this.root.append(this.hotbarHint);

    this.mainUiOverlay = this.buildMainUiOverlay(documentRef);
    this.root.append(this.mainUiOverlay);

    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      const slotButton = this.createHotbarSlotButton(documentRef, slot);
      this.hotbarRow.append(slotButton);
    }

    this.abilityCatalog.set(ABILITY_ID_NONE, {
      id: ABILITY_ID_NONE,
      key: "empty",
      name: "Empty",
      description: "No ability assigned to this slot.",
      category: "passive",
      points: {
        power: 0,
        velocity: 0,
        efficiency: 0,
        control: 0
      },
      attributes: []
    });

    for (const staticAbility of getAllAbilityDefinitions()) {
      this.ownedAbilityIds.add(staticAbility.id);
      this.upsertAbility(staticAbility);
    }
    for (const assignedAbilityId of this.options.initialHotbarAssignments) {
      const normalized = this.normalizeAbilityId(assignedAbilityId);
      if (normalized > 0) {
        this.ownedAbilityIds.add(normalized);
      }
    }

    this.setHotbarAssignments(this.options.initialHotbarAssignments);
    this.setMouseBindings(options.initialPrimaryMouseSlot, options.initialSecondaryMouseSlot);
    this.refreshSlotSelectionState();

    parent.append(this.root);
  }

  public static mount(parent: HTMLElement, documentRef: Document, options: AbilityHudOptions): AbilityHud {
    return new AbilityHud(parent, options, documentRef);
  }

  public toggleMainMenu(): boolean {
    this.setMainMenuOpen(!this.mainUiOpen);
    return this.mainUiOpen;
  }

  public setMainMenuOpen(open: boolean): void {
    this.mainUiOpen = open;
    this.root.classList.toggle("ability-ui-main-open", open);
    this.mainUiOverlay.classList.toggle("main-ui-visible", open);
    this.mainUiOverlay.classList.toggle("main-ui-hidden", !open);
    this.updateHotbarOverlayMode();
    this.refreshSlotSelectionState();
  }

  public isMainMenuOpen(): boolean {
    return this.mainUiOpen;
  }

  public setHotbarAssignments(assignments: ReadonlyArray<number>): void {
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      const abilityId = assignments[slot] ?? ABILITY_ID_NONE;
      this.assignments[slot] = this.normalizeAbilityId(abilityId);
      this.renderSlot(slot);
    }
    this.refreshAbilityCardSelection();
  }

  public setMouseBindings(primarySlot: number, secondarySlot: number): void {
    this.primaryMouseSlot = clampHotbarSlotIndex(primarySlot);
    this.secondaryMouseSlot = clampHotbarSlotIndex(secondarySlot);
    this.renderAllSlotBadges();
    this.refreshSlotSelectionState();
  }

  public setPlayerSettings(settings: PlayerSettings): void {
    this.playerSettings = coercePlayerSettings(settings);
    this.syncPlayerSettingsInputs();
  }

  public setClientLocalSettings(settings: ClientLocalSettings): void {
    this.clientLocalSettings = coerceClientLocalSettings(settings);
    this.syncClientLocalSettingsInputs();
  }

  public setOwnedAbilityIds(ownedAbilityIds: ReadonlyArray<number>): void {
    this.ownedAbilityIds.clear();
    for (const abilityId of ownedAbilityIds) {
      const normalized = this.normalizeAbilityId(abilityId);
      if (normalized > ABILITY_ID_NONE) {
        this.ownedAbilityIds.add(normalized);
      }
    }
    for (const hotbarAbilityId of this.assignments) {
      if (hotbarAbilityId > ABILITY_ID_NONE) {
        this.ownedAbilityIds.add(hotbarAbilityId);
      }
    }
    this.applyAbilityBookFilter(this.abilitySearchInput.value);
  }

  public setCreatorState(state: CreatorClientState | null): void {
    this.creatorPanel.setState(state);
  }

  public setInventoryState(state: InventorySnapshot): void {
    this.inventoryState = {
      maxSlots: state.maxSlots,
      itemInstances: state.itemInstances.map((item) => ({ ...item })),
      equipment: { ...state.equipment },
      hotbarSlots: state.hotbarSlots.map((entry) => (entry ? { ...entry } : null))
    };
    this.renderInventory();
    this.renderAllSlots();
  }

  public upsertAbility(ability: AbilityDefinition): void {
    this.abilityCatalog.set(ability.id, ability);
    const existingCard = this.abilityCards.get(ability.id);
    if (!existingCard) {
      const card = this.createAbilityCard(this.root.ownerDocument, ability.id);
      this.abilityCards.set(ability.id, card);
      this.abilityBookGrid.append(card);
    } else {
      this.renderAbilityCard(existingCard, ability.id);
    }
    this.applyAbilityBookFilter(this.abilitySearchInput.value);
    this.refreshAbilityCardSelection();
    this.renderAllSlots();
  }

  public getHotbarAssignments(): number[] {
    return this.assignments.slice();
  }

  private buildMainUiOverlay(documentRef: Document): HTMLDivElement {
    const overlay = documentRef.createElement("div");
    overlay.id = "main-ui-overlay";
    overlay.className = "main-ui-hidden";

    const shell = documentRef.createElement("div");
    shell.id = "main-ui-shell";

    const nav = documentRef.createElement("nav");
    nav.id = "main-ui-nav";

    const navTitle = documentRef.createElement("h2");
    navTitle.textContent = "Main";
    nav.append(navTitle);

    nav.append(
      this.createNavButton(documentRef, "character", "Character"),
      this.createNavButton(documentRef, "inventory", "Inventory"),
      this.createNavButton(documentRef, "ability-book", "Ability Book"),
      this.createNavButton(documentRef, "ability-creator", "Ability Creator"),
      this.createNavButton(documentRef, "settings", "Settings")
    );

    const content = documentRef.createElement("div");
    content.id = "main-ui-content";

    const characterPanel = this.createPlaceholderPanel(
      documentRef,
      "character",
      "Character",
      "Character stats and profile UI will be implemented in this section."
    );
    const inventoryPanel = this.createInventoryPanel(documentRef);
    const abilityBookPanel = documentRef.createElement("section");
    abilityBookPanel.className = "main-ui-panel";
    abilityBookPanel.dataset.section = "ability-book";
    abilityBookPanel.append(this.createPanelHeading(documentRef, "Ability Book", "Drag abilities onto hotbar slots. Alt+click a slot to clear."));

    const topRow = documentRef.createElement("div");
    topRow.className = "ability-book-toolbar";

    const searchInput = documentRef.createElement("input");
    searchInput.type = "text";
    searchInput.className = "ability-book-search";
    searchInput.placeholder = "Search abilities...";
    searchInput.addEventListener("input", () => {
      this.applyAbilityBookFilter(searchInput.value);
    });
    this.abilitySearchInput = searchInput;

    const editSlotLabel = documentRef.createElement("p");
    editSlotLabel.className = "ability-book-edit-slot";
    editSlotLabel.textContent = "Edit Slot: 1";
    editSlotLabel.id = "ability-book-edit-slot";

    topRow.append(searchInput, editSlotLabel);
    abilityBookPanel.append(topRow);

    const grid = documentRef.createElement("div");
    grid.className = "ability-book-grid";
    this.abilityBookGrid = grid;
    abilityBookPanel.append(grid);

    const baseBlueprints = getBlueprintDefinitionsForProfile("ability_creator");
    this.creatorPanel = new CreatorPanel(documentRef, {
      profileId: "ability_creator",
      profileLabel: "Ability Creator",
      availableBaseBlueprints: baseBlueprints,
      onCommand: (command) => this.options.onCreatorCommand?.(command)
    });
    const creatorPanelEl = this.creatorPanel.getElement();

    const settingsPanel = this.createSettingsPanel(documentRef);

    content.append(characterPanel, inventoryPanel, abilityBookPanel, creatorPanelEl, settingsPanel);

    this.sectionPanels.set("character", characterPanel);
    this.sectionPanels.set("inventory", inventoryPanel);
    this.sectionPanels.set("ability-book", abilityBookPanel);
    this.sectionPanels.set("ability-creator", creatorPanelEl);
    this.sectionPanels.set("settings", settingsPanel);

    shell.append(nav, content);
    overlay.append(shell);

    this.setActiveSection(this.activeSection);
    return overlay;
  }

  private createPanelHeading(documentRef: Document, title: string, subtitle: string): HTMLElement {
    const wrapper = documentRef.createElement("header");
    wrapper.className = "main-ui-heading";

    const heading = documentRef.createElement("h3");
    heading.textContent = title;

    const detail = documentRef.createElement("p");
    detail.textContent = subtitle;

    wrapper.append(heading, detail);
    return wrapper;
  }

  private createInventoryPanel(documentRef: Document): HTMLElement {
    const panel = documentRef.createElement("section");
    panel.className = "main-ui-panel";
    panel.dataset.section = "inventory";
    panel.append(this.createPanelHeading(documentRef, "Inventory", "Manage carried items and equipment."));

    const layout = documentRef.createElement("div");
    layout.className = "inventory-layout";

    const inventoryColumn = documentRef.createElement("div");
    inventoryColumn.className = "inventory-column";
    const inventoryTitle = documentRef.createElement("h4");
    inventoryTitle.textContent = "Items";
    this.inventoryList = documentRef.createElement("div");
    this.inventoryList.className = "inventory-list";
    inventoryColumn.append(inventoryTitle, this.inventoryList);

    const equipmentColumn = documentRef.createElement("div");
    equipmentColumn.className = "inventory-column";
    const equipmentTitle = documentRef.createElement("h4");
    equipmentTitle.textContent = "Equipment";
    this.equipmentList = documentRef.createElement("div");
    this.equipmentList.className = "equipment-list";
    equipmentColumn.append(equipmentTitle, this.equipmentList);

    layout.append(inventoryColumn, equipmentColumn);
    panel.append(layout);
    this.renderInventory();
    return panel;
  }

  private createPlaceholderPanel(
    documentRef: Document,
    section: MainUiSectionKey,
    title: string,
    message: string
  ): HTMLElement {
    const panel = documentRef.createElement("section");
    panel.className = "main-ui-panel";
    panel.dataset.section = section;
    panel.append(this.createPanelHeading(documentRef, title, message));
    return panel;
  }

  private createSettingsPanel(documentRef: Document): HTMLElement {
    const panel = documentRef.createElement("section");
    panel.className = "main-ui-panel";
    panel.dataset.section = "settings";
    panel.append(this.createPanelHeading(documentRef, "Settings", "Controls, camera, voice, and graphics options."));

    const settingsPage = documentRef.createElement("div");
    settingsPage.className = "settings-page";

    const controlsCategory = this.createSettingsCategory(
      documentRef,
      "Controls",
      "Input behavior and key interaction preferences."
    );
    const mouseSensitivityRow = this.createSliderRow(
      documentRef,
      "Mouse Sensitivity",
      "Adjust look speed. Wheel over slider also adjusts value.",
      {
        min: MIN_MOUSE_SENSITIVITY,
        max: MAX_MOUSE_SENSITIVITY,
        step: 0.05
      },
      (value) => `${value.toFixed(2)}x`,
      (value) => this.options.onPlayerSettingsChanged?.({ mouseSensitivity: value })
    );
    this.mouseSensitivitySliderInput = mouseSensitivityRow.input;
    this.mouseSensitivityValue = mouseSensitivityRow.valueLabel;
    controlsCategory.rows.append(mouseSensitivityRow.row);

    const mouseSmoothingRow = this.createToggleRow(
      documentRef,
      "Mouse Smoothing",
      "Smooths raw mouse movement to reduce jitter.",
      (enabled) => this.options.onPlayerSettingsChanged?.({ mouseSmoothing: enabled })
    );
    this.mouseSmoothingToggleInput = mouseSmoothingRow.input;
    controlsCategory.rows.append(mouseSmoothingRow.row);

    const hotbarDigitRow = this.createToggleRow(
      documentRef,
      "0-9 Activates Hotbar Slot",
      "Enabled: 0-9 executes slot. Disabled: 0-9 binds LMB slot.",
      (enabled) => this.options.onPlayerSettingsChanged?.({ digitKeysActivateHotbar: enabled })
    );
    this.hotbarDigitToggleInput = hotbarDigitRow.input;
    controlsCategory.rows.append(hotbarDigitRow.row);
    settingsPage.append(controlsCategory.section);

    const cameraCategory = this.createSettingsCategory(
      documentRef,
      "Camera",
      "View and camera presentation settings."
    );
    const fieldOfViewRow = this.createSliderRow(
      documentRef,
      "Field Of View",
      "Higher values increase peripheral visibility at the cost of distortion.",
      {
        min: MIN_FIELD_OF_VIEW,
        max: MAX_FIELD_OF_VIEW,
        step: 1
      },
      (value) => `${Math.round(value)}°`,
      (value) => this.options.onPlayerSettingsChanged?.({ fieldOfView: Math.round(value) })
    );
    this.fieldOfViewSliderInput = fieldOfViewRow.input;
    this.fieldOfViewValue = fieldOfViewRow.valueLabel;
    cameraCategory.rows.append(fieldOfViewRow.row);
    settingsPage.append(cameraCategory.section);

    const voiceCategory = this.createSettingsCategory(
      documentRef,
      "Voice",
      "Voice chat mode preference (voice chat behavior not wired yet)."
    );
    const voiceModeRow = this.createSelectRow(
      documentRef,
      "Voice Chat Mode",
      "Select preferred transmission mode.",
      [
        { value: "push_to_talk", label: "Push To Talk" },
        { value: "open_mic", label: "Open Mic" }
      ],
      (value) => {
        if (value === "push_to_talk" || value === "open_mic") {
          this.options.onPlayerSettingsChanged?.({ voiceChatMode: value });
        }
      }
    );
    this.voiceChatModeSelect = voiceModeRow.select;
    voiceCategory.rows.append(voiceModeRow.row);
    settingsPage.append(voiceCategory.section);

    const graphicsCategory = this.createSettingsCategory(
      documentRef,
      "Graphics",
      "Device/browser-specific rendering options."
    );
    const graphicsPresetRow = this.createSelectRow(
      documentRef,
      "Graphics Preset",
      "Low, medium, and high tune renderer scale and foliage distance.",
      GRAPHICS_PRESETS.map((preset) => ({
        value: preset,
        label: preset.charAt(0).toUpperCase() + preset.slice(1)
      })),
      (value) => {
        if (value === "low" || value === "medium" || value === "high") {
          this.options.onClientLocalSettingsChanged?.({ graphicsPreset: value });
        }
      }
    );
    this.graphicsPresetSelect = graphicsPresetRow.select;
    graphicsCategory.rows.append(graphicsPresetRow.row);

    const antiAliasingRow = this.createSelectRow(
      documentRef,
      "Anti-Aliasing",
      "MSAA reduces edge jaggies. Applying this setting reloads the page.",
      ANTI_ALIASING_MODES.map((mode) => ({
        value: mode,
        label: mode === "msaa" ? "MSAA" : "Off"
      })),
      (value) => {
        if (value === "off" || value === "msaa") {
          this.options.onClientLocalSettingsChanged?.({ antiAliasingMode: value });
        }
      }
    );
    this.antiAliasingModeSelect = antiAliasingRow.select;
    graphicsCategory.rows.append(antiAliasingRow.row);
    settingsPage.append(graphicsCategory.section);

    panel.append(settingsPage);
    this.syncPlayerSettingsInputs();
    this.syncClientLocalSettingsInputs();
    return panel;
  }

  private createSettingsCategory(
    documentRef: Document,
    title: string,
    subtitle: string
  ): { section: HTMLElement; rows: HTMLDivElement } {
    const section = documentRef.createElement("section");
    section.className = "settings-category";
    const heading = documentRef.createElement("header");
    heading.className = "settings-category-heading";
    const titleNode = documentRef.createElement("h4");
    titleNode.textContent = title;
    const subtitleNode = documentRef.createElement("p");
    subtitleNode.textContent = subtitle;
    heading.append(titleNode, subtitleNode);
    const rows = documentRef.createElement("div");
    rows.className = "settings-list";
    section.append(heading, rows);
    return { section, rows };
  }

  private createToggleRow(
    documentRef: Document,
    label: string,
    detail: string,
    onChange: (enabled: boolean) => void
  ): { row: HTMLLabelElement; input: HTMLInputElement } {
    const row = documentRef.createElement("label");
    row.className = "settings-toggle-row";
    const info = documentRef.createElement("div");
    info.className = "settings-toggle-info";
    const labelNode = documentRef.createElement("span");
    labelNode.className = "settings-toggle-label";
    labelNode.textContent = label;
    const detailNode = documentRef.createElement("span");
    detailNode.className = "settings-toggle-detail";
    detailNode.textContent = detail;
    info.append(labelNode, detailNode);

    const input = documentRef.createElement("input");
    input.type = "checkbox";
    input.className = "settings-toggle-input";
    input.addEventListener("change", () => {
      onChange(input.checked);
    });

    const visual = documentRef.createElement("span");
    visual.className = "settings-toggle-visual";
    row.append(info, input, visual);
    return { row, input };
  }

  private createSliderRow(
    documentRef: Document,
    label: string,
    detail: string,
    range: { min: number; max: number; step: number },
    formatValue: (value: number) => string,
    onInput: (value: number) => void
  ): { row: HTMLDivElement; input: HTMLInputElement; valueLabel: HTMLSpanElement } {
    const row = documentRef.createElement("div");
    row.className = "settings-slider-row";
    const info = documentRef.createElement("div");
    info.className = "settings-slider-info";
    const labelNode = documentRef.createElement("span");
    labelNode.className = "settings-toggle-label";
    labelNode.textContent = label;
    const detailNode = documentRef.createElement("span");
    detailNode.className = "settings-toggle-detail";
    detailNode.textContent = detail;
    info.append(labelNode, detailNode);

    const controls = documentRef.createElement("div");
    controls.className = "settings-slider-controls";
    const valueLabel = documentRef.createElement("span");
    valueLabel.className = "settings-slider-value";
    valueLabel.textContent = formatValue(range.min);

    const input = documentRef.createElement("input");
    input.type = "range";
    input.className = "settings-slider-input";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(range.min);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        return;
      }
      valueLabel.textContent = formatValue(value);
      onInput(value);
    });
    this.attachSliderWheelBehavior(input);
    controls.append(valueLabel, input);
    row.append(info, controls);
    return { row, input, valueLabel };
  }

  private createSelectRow(
    documentRef: Document,
    label: string,
    detail: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    onChange: (value: string) => void
  ): { row: HTMLDivElement; select: HTMLSelectElement } {
    const row = documentRef.createElement("div");
    row.className = "settings-select-row";
    const info = documentRef.createElement("div");
    info.className = "settings-select-info";
    const labelNode = documentRef.createElement("span");
    labelNode.className = "settings-toggle-label";
    labelNode.textContent = label;
    const detailNode = documentRef.createElement("span");
    detailNode.className = "settings-toggle-detail";
    detailNode.textContent = detail;
    info.append(labelNode, detailNode);

    const select = documentRef.createElement("select");
    select.className = "settings-select-input";
    for (const option of options) {
      const optionNode = documentRef.createElement("option");
      optionNode.value = option.value;
      optionNode.textContent = option.label;
      select.append(optionNode);
    }
    select.addEventListener("change", () => {
      onChange(select.value);
    });
    row.append(info, select);
    return { row, select };
  }

  private attachSliderWheelBehavior(input: HTMLInputElement): void {
    input.addEventListener("wheel", (event) => {
      event.preventDefault();
      const currentValue = Number(input.value);
      const min = Number(input.min);
      const max = Number(input.max);
      const step = Number(input.step) || 1;
      if (!Number.isFinite(currentValue) || !Number.isFinite(min) || !Number.isFinite(max)) {
        return;
      }
      const direction = event.deltaY < 0 ? 1 : -1;
      const nextValue = Math.max(min, Math.min(max, currentValue + step * direction));
      input.value = String(nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, { passive: false });
  }

  private syncPlayerSettingsInputs(): void {
    if (this.hotbarDigitToggleInput) {
      this.hotbarDigitToggleInput.checked = this.playerSettings.digitKeysActivateHotbar;
    }
    if (this.mouseSmoothingToggleInput) {
      this.mouseSmoothingToggleInput.checked = this.playerSettings.mouseSmoothing;
    }
    if (this.mouseSensitivitySliderInput) {
      this.mouseSensitivitySliderInput.value = String(this.playerSettings.mouseSensitivity);
    }
    if (this.mouseSensitivityValue) {
      this.mouseSensitivityValue.textContent = `${this.playerSettings.mouseSensitivity.toFixed(2)}x`;
    }
    if (this.fieldOfViewSliderInput) {
      this.fieldOfViewSliderInput.value = String(this.playerSettings.fieldOfView);
    }
    if (this.fieldOfViewValue) {
      this.fieldOfViewValue.textContent = `${Math.round(this.playerSettings.fieldOfView)}°`;
    }
    if (this.voiceChatModeSelect) {
      this.voiceChatModeSelect.value = VOICE_CHAT_MODES.includes(this.playerSettings.voiceChatMode)
        ? this.playerSettings.voiceChatMode
        : "push_to_talk";
    }
  }

  private syncClientLocalSettingsInputs(): void {
    if (this.graphicsPresetSelect) {
      this.graphicsPresetSelect.value = this.clientLocalSettings.graphicsPreset;
    }
    if (this.antiAliasingModeSelect) {
      this.antiAliasingModeSelect.value = this.clientLocalSettings.antiAliasingMode;
    }
  }

  private createNavButton(
    documentRef: Document,
    section: MainUiSectionKey,
    label: string
  ): HTMLButtonElement {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "main-ui-nav-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      this.setActiveSection(section);
    });
    this.navButtons.set(section, button);
    return button;
  }

  private renderInventory(): void {
    if (!this.inventoryList || !this.equipmentList) {
      return;
    }
    this.inventoryList.innerHTML = "";
    this.equipmentList.innerHTML = "";

    const sortedItems = [...this.inventoryState.itemInstances].sort((a, b) => a.slotIndex - b.slotIndex);
    if (sortedItems.length === 0) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.className = "inventory-empty";
      empty.textContent = "No items carried.";
      this.inventoryList.append(empty);
    }
    const equippedIds = new Set(Object.values(this.inventoryState.equipment).filter((id): id is number => typeof id === "number"));
    for (const item of sortedItems) {
      const definition = getItemDefinitionById(item.definitionId);
      const row = this.root.ownerDocument.createElement("div");
      row.className = "inventory-item-row";
      row.classList.toggle("inventory-item-equipped", equippedIds.has(item.itemInstanceId));

      const main = this.root.ownerDocument.createElement("div");
      main.className = "inventory-item-main";
      const name = this.root.ownerDocument.createElement("span");
      name.className = "inventory-item-name";
      name.textContent = definition?.name ?? `Unknown Item ${item.definitionId}`;
      const meta = this.root.ownerDocument.createElement("span");
      meta.className = "inventory-item-meta";
      meta.textContent = `${definition?.category ?? "unknown"}${item.quantity > 1 ? ` x${item.quantity}` : ""}`;
      main.append(name, meta);

      const actions = this.root.ownerDocument.createElement("div");
      actions.className = "inventory-item-actions";
      if (definition?.use && definition.use.actions.length > 0) {
        for (let channel = 0; channel < definition.use.actions.length; channel += 1) {
          const action = definition.use.actions[channel];
          if (!action) {
            continue;
          }
          actions.append(this.createInventoryActionButton(action.label, () => {
            this.options.onInventoryItemUsed?.(item.itemInstanceId, channel);
          }));
        }
      }
      if (definition?.equipSlot) {
        actions.append(this.createInventoryActionButton(
          equippedIds.has(item.itemInstanceId) ? "Equipped" : "Equip",
          () => {
            if (!equippedIds.has(item.itemInstanceId)) {
              this.options.onInventoryItemEquipped?.(item.itemInstanceId);
            }
          },
          equippedIds.has(item.itemInstanceId)
        ));
      }
      actions.append(this.createInventoryActionButton("Drop", () => {
        this.options.onInventoryItemDropped?.(item.itemInstanceId);
      }));

      row.append(main, actions);
      row.draggable = true;
      row.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) {
          return;
        }
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData(INVENTORY_ITEM_DRAG_MIME, String(item.itemInstanceId));
        event.dataTransfer.setData("text/plain", `item:${item.itemInstanceId}`);
      });
      this.inventoryList.append(row);
    }

    for (const slot of Object.keys(EQUIPMENT_SLOT_WIRE_VALUE) as EquipmentSlot[]) {
      const itemInstanceId = this.inventoryState.equipment[slot] ?? 0;
      const item = sortedItems.find((entry) => entry.itemInstanceId === itemInstanceId);
      const definition = item ? getItemDefinitionById(item.definitionId) : null;
      const row = this.root.ownerDocument.createElement("div");
      row.className = "equipment-slot-row";
      const label = this.root.ownerDocument.createElement("span");
      label.className = "equipment-slot-label";
      label.textContent = slot;
      const value = this.root.ownerDocument.createElement("span");
      value.className = "equipment-slot-value";
      value.textContent = definition?.name ?? "Empty";
      row.append(label, value);
      if (itemInstanceId > 0) {
        row.append(this.createInventoryActionButton("Unequip", () => {
          this.options.onInventorySlotUnequipped?.(slot);
        }));
      }
      this.equipmentList.append(row);
    }
  }

  private createInventoryActionButton(
    label: string,
    onClick: () => void,
    disabled = false
  ): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "inventory-action-button";
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private setActiveSection(section: MainUiSectionKey): void {
    this.activeSection = section;
    for (const [key, button] of this.navButtons) {
      button.classList.toggle("main-ui-nav-button-active", key === section);
    }
    for (const [key, panel] of this.sectionPanels) {
      panel.classList.toggle("main-ui-panel-active", key === section);
    }
    this.updateHotbarOverlayMode();
    this.refreshSlotSelectionState();
  }

  private updateHotbarOverlayMode(): void {
    const shouldElevateHotbar = this.mainUiOpen
      && (this.activeSection === "ability-book" || this.activeSection === "inventory");
    this.root.classList.toggle("ability-ui-hotbar-on-top", shouldElevateHotbar);
  }

  private createHotbarSlotButton(documentRef: Document, slot: number): HTMLButtonElement {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "ability-slot";
    button.dataset.slot = String(slot);

    button.addEventListener("click", (event) => {
      if (event.altKey) {
        this.options.onHotbarSlotCleared?.(slot);
        this.requestAssignment(slot, ABILITY_ID_NONE);
        return;
      }
      if (event.ctrlKey) {
        this.options.onHotbarSlotDropped?.(slot);
        return;
      }
      if (this.mainUiOpen && this.activeSection === "ability-book") {
        this.editSlot = slot;
        this.refreshSlotSelectionState();
        return;
      }
      this.options.onHotbarSlotExecuted?.(slot, event.shiftKey ? 2 : 0);
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.options.onHotbarSlotExecuted?.(slot, event.shiftKey ? 3 : 1);
    });
    button.addEventListener("wheel", (event) => {
      if (event.deltaY > 0) {
        event.preventDefault();
        event.stopPropagation();
        this.options.onHotbarSlotExecuted?.(slot, 4);
      }
    }, { passive: false });
    button.draggable = true;
    button.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) {
        return;
      }
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(HOTBAR_SLOT_DRAG_MIME, String(slot));
      event.dataTransfer.setData("text/plain", `hotbar:${slot}`);
    });

    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      button.classList.add("ability-slot-drop-target");
    });

    button.addEventListener("dragleave", () => {
      button.classList.remove("ability-slot-drop-target");
    });

    button.addEventListener("drop", (event) => {
      event.preventDefault();
      button.classList.remove("ability-slot-drop-target");
      const droppedAbilityId = this.readDraggedAbilityId(event);
      if (droppedAbilityId !== null) {
        this.editSlot = slot;
        this.refreshSlotSelectionState();
        this.requestAssignment(slot, droppedAbilityId);
        return;
      }
      const itemInstanceId = this.readDraggedItemInstanceId(event);
      if (itemInstanceId !== null) {
        this.options.onHotbarItemAssigned?.(slot, itemInstanceId);
        return;
      }
      const sourceSlot = this.readDraggedHotbarSlot(event);
      if (sourceSlot !== null && sourceSlot !== slot) {
        this.options.onHotbarSlotMoved?.(sourceSlot, slot);
      }
    });

    const indexLabel = documentRef.createElement("span");
    indexLabel.className = "ability-slot-index";
    indexLabel.textContent = this.toSlotKeyLabel(slot);

    const nameLabel = documentRef.createElement("span");
    nameLabel.className = "ability-slot-name";

    const badgeLabel = documentRef.createElement("span");
    badgeLabel.className = "ability-slot-badge";

    button.append(indexLabel, nameLabel, badgeLabel);
    this.slotElements.push({ button, nameLabel, badgeLabel });
    return button;
  }

  private createAbilityCard(documentRef: Document, abilityId: number): HTMLDivElement {
    const card = documentRef.createElement("div");
    card.className = "ability-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.draggable = true;
    card.dataset.abilityId = String(abilityId);

    this.renderAbilityCard(card, abilityId);

    card.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) {
        return;
      }
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(ABILITY_DRAG_MIME, String(abilityId));
      event.dataTransfer.setData("text/plain", String(abilityId));
    });

    card.addEventListener("click", () => {
      this.requestAssignment(this.editSlot, abilityId);
    });

    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      this.requestAssignment(this.editSlot, abilityId);
    });

    return card;
  }

  private renderAbilityCard(card: HTMLElement, abilityId: number): void {
    const ability = this.resolveAbilityById(abilityId);

    card.innerHTML = "";

    const header = this.root.ownerDocument.createElement("div");
    header.className = "ability-card-header";

    const title = this.root.ownerDocument.createElement("span");
    title.className = "ability-card-title";
    title.textContent = ability ? ability.name : `Unknown (${abilityId})`;

    const category = this.root.ownerDocument.createElement("span");
    category.className = "ability-card-category";
    category.textContent = ability?.category ?? "unknown";

    header.append(title, category);

    const description = this.root.ownerDocument.createElement("p");
    description.className = "ability-card-description";
    description.textContent = ability?.description ?? "Unavailable";

    const actions = this.root.ownerDocument.createElement("div");
    actions.className = "ability-card-actions";

    const forgetButton = this.root.ownerDocument.createElement("button");
    forgetButton.type = "button";
    forgetButton.className = "ability-card-forget";
    forgetButton.textContent = "Forget Ability";
    forgetButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.options.onAbilityForgotten?.(abilityId);
    });
    actions.append(forgetButton);

    card.append(header, description, actions);
  }

  private requestAssignment(slot: number, abilityId: number): void {
    const targetSlot = clampHotbarSlotIndex(slot);
    const normalizedAbilityId = this.normalizeAbilityId(abilityId);
    if (
      normalizedAbilityId !== ABILITY_ID_NONE &&
      !this.ownedAbilityIds.has(normalizedAbilityId)
    ) {
      return;
    }
    this.options.onHotbarAssignmentChanged?.(targetSlot, normalizedAbilityId);
  }

  private renderAllSlots(): void {
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      this.renderSlot(slot);
    }
  }

  private renderSlot(slot: number): void {
    const elements = this.slotElements[slot];
    if (!elements) {
      return;
    }

    const hotbarPayload = this.inventoryState.hotbarSlots[slot] ?? null;
    if (hotbarPayload?.kind === "item_instance") {
      const item = this.inventoryState.itemInstances.find((entry) => entry.itemInstanceId === hotbarPayload.refId);
      const definition = item ? getItemDefinitionById(item.definitionId) : null;
      const itemLabel = definition?.name ?? `Item #${hotbarPayload.refId}`;
      elements.nameLabel.textContent = itemLabel;
      elements.button.title = `Slot ${slot + 1}: ${itemLabel}`;
      return;
    }
    if (hotbarPayload?.kind === "ability") {
      const ability = this.resolveAbilityById(hotbarPayload.refId);
      const abilityLabel = ability?.name ?? `Ability #${hotbarPayload.refId}`;
      elements.nameLabel.textContent = abilityLabel;
      elements.button.title = `Slot ${slot + 1}: ${abilityLabel}`;
      return;
    }

    const abilityId = this.assignments[slot] ?? ABILITY_ID_NONE;
    const ability = this.resolveAbilityById(abilityId);
    elements.nameLabel.textContent = ability?.name ?? "Unknown";
    elements.button.title = `Slot ${slot + 1}: ${ability?.name ?? "Unknown"}`;
  }

  private renderAllSlotBadges(): void {
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      const elements = this.slotElements[slot];
      if (!elements) {
        continue;
      }
      const labels: string[] = [];
      if (slot === this.primaryMouseSlot) {
        labels.push("LMB");
      }
      if (slot === this.secondaryMouseSlot) {
        labels.push("RMB");
      }
      elements.badgeLabel.textContent = labels.join(" + ");
    }
  }

  private refreshSlotSelectionState(): void {
    const normalizedEditSlot = clampHotbarSlotIndex(this.editSlot);
    this.editSlot = normalizedEditSlot;
    const label = this.root.querySelector("#ability-book-edit-slot");
    if (label instanceof HTMLElement) {
      label.textContent = `Edit Slot: ${this.toSlotKeyLabel(normalizedEditSlot)}`;
    }
    const editSlotSelectable = this.mainUiOpen && this.activeSection === "ability-book";
    for (let slot = 0; slot < this.slotElements.length; slot += 1) {
      const elements = this.slotElements[slot];
      elements?.button.classList.toggle("ability-slot-primary-selected", slot === this.primaryMouseSlot);
      elements?.button.classList.toggle("ability-slot-secondary-selected", slot === this.secondaryMouseSlot);
      elements?.button.classList.toggle("ability-slot-edit-selected", editSlotSelectable && slot === normalizedEditSlot);
    }
  }

  private refreshAbilityCardSelection(): void {
    const activeAbilityId = this.assignments[this.editSlot] ?? ABILITY_ID_NONE;
    for (const [abilityId, card] of this.abilityCards) {
      card.classList.toggle("ability-card-selected", abilityId === activeAbilityId);
    }
  }

  private applyAbilityBookFilter(rawFilter: string): void {
    const normalizedFilter = rawFilter.trim().toLowerCase();
    for (const [abilityId, card] of this.abilityCards) {
      const ability = this.resolveAbilityById(abilityId);
      const haystack = `${ability?.name ?? ""} ${ability?.description ?? ""} ${ability?.category ?? ""}`.toLowerCase();
      const visibleByOwnership = this.ownedAbilityIds.has(abilityId);
      const visibleBySearch = normalizedFilter.length === 0 || haystack.includes(normalizedFilter);
      const visible = visibleByOwnership && visibleBySearch;
      card.classList.toggle("ability-card-hidden", !visible);
    }
  }

  private resolveAbilityById(abilityId: number): AbilityDefinition | null {
    return this.abilityCatalog.get(abilityId) ?? getAbilityDefinitionById(abilityId);
  }

  private normalizeAbilityId(abilityId: number): number {
    if (!Number.isFinite(abilityId)) {
      return ABILITY_ID_NONE;
    }

    const normalized = Math.max(ABILITY_ID_NONE, Math.floor(abilityId));
    if (normalized === ABILITY_ID_NONE) {
      return ABILITY_ID_NONE;
    }

    return this.resolveAbilityById(normalized) ? normalized : ABILITY_ID_NONE;
  }

  private readDraggedAbilityId(event: DragEvent): number | null {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return null;
    }

    const raw = transfer.getData(ABILITY_DRAG_MIME) || transfer.getData("text/plain");
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private readDraggedItemInstanceId(event: DragEvent): number | null {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return null;
    }
    const raw = transfer.getData(INVENTORY_ITEM_DRAG_MIME) || transfer.getData("text/plain");
    if (!raw) {
      return null;
    }
    const cleaned = raw.startsWith("item:") ? raw.slice(5) : raw;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const itemInstanceId = Math.max(0, Math.floor(parsed));
    return itemInstanceId > 0 ? itemInstanceId : null;
  }

  private readDraggedHotbarSlot(event: DragEvent): number | null {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return null;
    }
    const raw = transfer.getData(HOTBAR_SLOT_DRAG_MIME) || transfer.getData("text/plain");
    if (!raw) {
      return null;
    }
    const cleaned = raw.startsWith("hotbar:") ? raw.slice(7) : raw;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return clampHotbarSlotIndex(Math.floor(parsed));
  }

  private toSlotKeyLabel(slot: number): string {
    const normalized = clampHotbarSlotIndex(slot);
    if (normalized === 9) {
      return "0";
    }
    return String(normalized + 1);
  }
}
