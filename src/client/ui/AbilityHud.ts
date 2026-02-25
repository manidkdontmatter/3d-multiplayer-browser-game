// Renders the fullscreen Main UI shell + combat hotbar for authoritative ability-book/hotbar interactions.
import {
  ABILITY_ID_NONE,
  HOTBAR_SLOT_COUNT,
  clampHotbarSlotIndex,
  getAbilityDefinitionById,
  getAllAbilityDefinitions,
  type AbilityDefinition
} from "../../shared/abilities";
import type { AbilityCreatorState } from "../runtime/network/types";
import { AbilityCreatorPanel, type AbilityCreatorCommandInput } from "./AbilityCreatorPanel";

export interface AbilityHudOptions {
  initialHotbarAssignments: ReadonlyArray<number>;
  initialPrimaryMouseSlot: number;
  initialSecondaryMouseSlot: number;
  onHotbarAssignmentChanged?: (slot: number, abilityId: number) => void;
  onAbilityForgotten?: (abilityId: number) => void;
  onAbilityCreatorCommand?: (command: AbilityCreatorCommandInput) => void;
}

type SlotElements = {
  button: HTMLButtonElement;
  nameLabel: HTMLSpanElement;
  badgeLabel: HTMLSpanElement;
};

type MainUiSectionKey = "character" | "inventory" | "ability-book" | "ability-creator" | "settings";

const ABILITY_DRAG_MIME = "application/x-ability-id";

export class AbilityHud {
  private readonly root: HTMLDivElement;
  private readonly hotbarRow: HTMLDivElement;
  private readonly mainUiOverlay: HTMLDivElement;
  private readonly navButtons = new Map<MainUiSectionKey, HTMLButtonElement>();
  private readonly sectionPanels = new Map<MainUiSectionKey, HTMLElement>();
  private abilityBookGrid!: HTMLDivElement;
  private abilitySearchInput!: HTMLInputElement;
  private readonly abilityCards = new Map<number, HTMLDivElement>();
  private readonly slotElements: SlotElements[] = [];
  private readonly assignments = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
  private readonly abilityCatalog = new Map<number, AbilityDefinition>();
  private readonly ownedAbilityIds = new Set<number>();
  private abilityCreatorPanel!: AbilityCreatorPanel;
  private mainUiOpen = false;
  private activeSection: MainUiSectionKey = "ability-book";
  private editSlot = 0;
  private primaryMouseSlot = 0;
  private secondaryMouseSlot = 1;

  private constructor(private readonly options: AbilityHudOptions, documentRef: Document) {
    this.root = documentRef.createElement("div");
    this.root.id = "ability-ui";

    this.hotbarRow = documentRef.createElement("div");
    this.hotbarRow.id = "ability-hotbar";
    this.root.append(this.hotbarRow);

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
    this.refreshEditSlotSelection();

    documentRef.body.append(this.root);
  }

  public static mount(documentRef: Document, options: AbilityHudOptions): AbilityHud {
    return new AbilityHud(options, documentRef);
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
    this.abilityCreatorPanel.setOwnedAbilityIds(Array.from(this.ownedAbilityIds.values()));
  }

  public setAbilityCreatorState(state: AbilityCreatorState | null): void {
    this.abilityCreatorPanel.setState(state);
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
    this.abilityCreatorPanel.setOwnedAbilityIds(Array.from(this.ownedAbilityIds.values()));
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
    const inventoryPanel = this.createPlaceholderPanel(
      documentRef,
      "inventory",
      "Inventory",
      "Inventory UI will be implemented in this section."
    );
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

    this.abilityCreatorPanel = new AbilityCreatorPanel(documentRef, {
      onCommand: (command) => this.options.onAbilityCreatorCommand?.(command),
      resolveAbilityById: (abilityId) => this.resolveAbilityById(abilityId)
    });
    this.abilityCreatorPanel.setOwnedAbilityIds(Array.from(this.ownedAbilityIds.values()));
    const creatorPanel = this.abilityCreatorPanel.getElement();
    const settingsPanel = this.createPlaceholderPanel(
      documentRef,
      "settings",
      "Settings",
      "Settings menu will be implemented here."
    );

    content.append(characterPanel, inventoryPanel, abilityBookPanel, creatorPanel, settingsPanel);

    this.sectionPanels.set("character", characterPanel);
    this.sectionPanels.set("inventory", inventoryPanel);
    this.sectionPanels.set("ability-book", abilityBookPanel);
    this.sectionPanels.set("ability-creator", creatorPanel);
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

  private setActiveSection(section: MainUiSectionKey): void {
    this.activeSection = section;
    for (const [key, button] of this.navButtons) {
      button.classList.toggle("main-ui-nav-button-active", key === section);
    }
    for (const [key, panel] of this.sectionPanels) {
      panel.classList.toggle("main-ui-panel-active", key === section);
    }
    this.updateHotbarOverlayMode();
  }

  private updateHotbarOverlayMode(): void {
    const shouldElevateHotbar = this.mainUiOpen && this.activeSection === "ability-book";
    this.root.classList.toggle("ability-ui-hotbar-on-top", shouldElevateHotbar);
  }

  private createHotbarSlotButton(documentRef: Document, slot: number): HTMLButtonElement {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "ability-slot";
    button.dataset.slot = String(slot);

    button.addEventListener("click", (event) => {
      if (event.altKey) {
        this.requestAssignment(slot, ABILITY_ID_NONE);
        return;
      }
      this.editSlot = slot;
      this.refreshEditSlotSelection();
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
      if (droppedAbilityId === null) {
        return;
      }
      this.editSlot = slot;
      this.refreshEditSlotSelection();
      this.requestAssignment(slot, droppedAbilityId);
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

  private refreshEditSlotSelection(): void {
    const normalizedEditSlot = clampHotbarSlotIndex(this.editSlot);
    this.editSlot = normalizedEditSlot;
    const label = this.root.querySelector("#ability-book-edit-slot");
    if (label instanceof HTMLElement) {
      label.textContent = `Edit Slot: ${this.toSlotKeyLabel(normalizedEditSlot)}`;
    }
    for (let slot = 0; slot < this.slotElements.length; slot += 1) {
      const elements = this.slotElements[slot];
      elements?.button.classList.toggle("ability-slot-edit-selected", slot === normalizedEditSlot);
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

  private toSlotKeyLabel(slot: number): string {
    const normalized = clampHotbarSlotIndex(slot);
    if (normalized === 9) {
      return "0";
    }
    return String(normalized + 1);
  }
}
