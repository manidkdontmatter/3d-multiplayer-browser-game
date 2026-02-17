import {
  ABILITY_ID_NONE,
  HOTBAR_SLOT_COUNT,
  clampHotbarSlotIndex,
  getAbilityDefinitionById,
  getAllAbilityDefinitions,
  type AbilityDefinition
} from "../../shared/abilities";

export interface AbilityHudOptions {
  initialHotbarAssignments: ReadonlyArray<number>;
  initialSelectedSlot?: number;
  onHotbarSlotSelected?: (slot: number) => void;
  onHotbarAssignmentChanged?: (slot: number, abilityId: number) => void;
}

type SlotElements = {
  button: HTMLButtonElement;
  nameLabel: HTMLSpanElement;
};

const ABILITY_DRAG_MIME = "application/x-vibe-ability-id";

export class AbilityHud {
  private readonly root: HTMLDivElement;
  private readonly loadoutPanel: HTMLDivElement;
  private readonly cardGrid: HTMLDivElement;
  private readonly loadoutSlotLabel: HTMLSpanElement;
  private readonly loadoutAbilityLabel: HTMLParagraphElement;
  private readonly loadoutAbilityDetail: HTMLParagraphElement;
  private readonly abilityCards = new Map<number, HTMLButtonElement>();
  private readonly slotElements: SlotElements[] = [];
  private readonly assignments = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
  private readonly abilityCatalog = new Map<number, AbilityDefinition>();
  private selectedSlot = 0;
  private loadoutPanelOpen = false;

  private constructor(private readonly options: AbilityHudOptions, documentRef: Document) {
    this.root = documentRef.createElement("div");
    this.root.id = "ability-ui";

    const hotbar = documentRef.createElement("div");
    hotbar.id = "ability-hotbar";
    this.root.append(hotbar);

    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "ability-slot";
      button.dataset.slot = String(slot);
      button.title = `Select slot ${slot + 1}`;
      button.addEventListener("click", () => {
        this.setSelectedSlot(slot, true);
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.assignAbilityToSlot(slot, ABILITY_ID_NONE, true);
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
        this.setSelectedSlot(slot, true);
        this.assignAbilityToSlot(slot, droppedAbilityId, true);
      });

      const indexLabel = documentRef.createElement("span");
      indexLabel.className = "ability-slot-index";
      indexLabel.textContent = String(slot + 1);

      const nameLabel = documentRef.createElement("span");
      nameLabel.className = "ability-slot-name";

      button.append(indexLabel, nameLabel);
      hotbar.append(button);
      this.slotElements.push({ button, nameLabel });
    }

    this.loadoutPanel = documentRef.createElement("div");
    this.loadoutPanel.id = "ability-loadout-panel";
    this.loadoutPanel.className = "ability-system-panel ability-panel-hidden";

    this.loadoutPanel.append(
      this.createPanelHeader(documentRef, "Loadout", "Equip abilities to active hotbar slots.", "B")
    );

    const loadoutSummary = documentRef.createElement("div");
    loadoutSummary.className = "ability-loadout-summary";

    const loadoutSummaryLabel = documentRef.createElement("p");
    loadoutSummaryLabel.className = "ability-section-label";
    loadoutSummaryLabel.textContent = "Selected Slot";

    const loadoutSummaryTop = documentRef.createElement("div");
    loadoutSummaryTop.className = "ability-loadout-summary-top";

    this.loadoutSlotLabel = documentRef.createElement("span");
    this.loadoutSlotLabel.className = "ability-slot-pill";

    const clearSlotButton = documentRef.createElement("button");
    clearSlotButton.type = "button";
    clearSlotButton.className = "ability-button-secondary";
    clearSlotButton.textContent = "Clear Slot";
    clearSlotButton.addEventListener("click", () => {
      this.assignAbilityToSlot(this.selectedSlot, ABILITY_ID_NONE, true);
    });

    loadoutSummaryTop.append(this.loadoutSlotLabel, clearSlotButton);

    this.loadoutAbilityLabel = documentRef.createElement("p");
    this.loadoutAbilityLabel.className = "ability-loadout-current-name";

    this.loadoutAbilityDetail = documentRef.createElement("p");
    this.loadoutAbilityDetail.className = "ability-loadout-current-detail";

    loadoutSummary.append(
      loadoutSummaryLabel,
      loadoutSummaryTop,
      this.loadoutAbilityLabel,
      this.loadoutAbilityDetail
    );
    this.loadoutPanel.append(loadoutSummary);

    const inventoryLabel = documentRef.createElement("p");
    inventoryLabel.className = "ability-section-label";
    inventoryLabel.textContent = "Unlocked Abilities";
    this.loadoutPanel.append(inventoryLabel);

    this.cardGrid = documentRef.createElement("div");
    this.cardGrid.className = "ability-card-grid";
    this.loadoutPanel.append(this.cardGrid);

    this.root.append(this.loadoutPanel);
    documentRef.body.append(this.root);

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
      this.upsertAbility(staticAbility);
    }
    this.rebuildAbilityCards(documentRef, this.cardGrid);

    this.setHotbarAssignments(this.options.initialHotbarAssignments);
    this.setSelectedSlot(this.options.initialSelectedSlot ?? 0, false);
  }

  public static mount(documentRef: Document, options: AbilityHudOptions): AbilityHud {
    return new AbilityHud(options, documentRef);
  }

  public toggleLoadoutPanel(): boolean {
    this.setLoadoutPanelOpen(!this.loadoutPanelOpen);
    return this.loadoutPanelOpen;
  }

  public setLoadoutPanelOpen(open: boolean): void {
    this.loadoutPanelOpen = open;
    this.setPanelVisibility(this.loadoutPanel, open);
  }

  public isLoadoutPanelOpen(): boolean {
    return this.loadoutPanelOpen;
  }

  public isAnyPanelOpen(): boolean {
    return this.loadoutPanelOpen;
  }

  public setSelectedSlot(slot: number, emitSelectionEvent: boolean): void {
    const clampedSlot = clampHotbarSlotIndex(slot);
    this.selectedSlot = clampedSlot;

    for (let i = 0; i < this.slotElements.length; i += 1) {
      const isSelected = i === clampedSlot;
      this.slotElements[i]?.button.classList.toggle("ability-slot-selected", isSelected);
    }

    this.updateCardSelection();
    this.updateLoadoutSummary();

    if (emitSelectionEvent) {
      this.options.onHotbarSlotSelected?.(clampedSlot);
    }
  }

  public setHotbarAssignments(assignments: ReadonlyArray<number>): void {
    for (let slot = 0; slot < HOTBAR_SLOT_COUNT; slot += 1) {
      const abilityId = assignments[slot] ?? ABILITY_ID_NONE;
      this.assignAbilityToSlot(slot, abilityId, false);
    }
    this.updateCardSelection();
    this.updateLoadoutSummary();
  }

  public upsertAbility(ability: AbilityDefinition): void {
    this.abilityCatalog.set(ability.id, ability);
    const card = this.abilityCards.get(ability.id);
    if (!card) {
      const newCard = this.createAbilityCard(this.root.ownerDocument, ability.id);
      this.cardGrid.append(newCard);
      return;
    }
    this.renderAbilityCard(card, ability.id);
    this.updateCardSelection();
    this.updateLoadoutSummary();
  }

  public getSelectedSlot(): number {
    return this.selectedSlot;
  }

  public getSelectedAbilityId(): number {
    return this.assignments[this.selectedSlot] ?? ABILITY_ID_NONE;
  }

  private createPanelHeader(
    documentRef: Document,
    title: string,
    subtitle: string,
    keyHint: string
  ): HTMLElement {
    const wrapper = documentRef.createElement("header");
    wrapper.className = "ability-panel-header";

    const headingRow = documentRef.createElement("div");
    headingRow.className = "ability-panel-heading-row";

    const heading = documentRef.createElement("h2");
    heading.className = "ability-panel-title";
    heading.textContent = title;

    const key = documentRef.createElement("span");
    key.className = "ability-key-hint";
    key.textContent = keyHint;

    headingRow.append(heading, key);

    const subtitleNode = documentRef.createElement("p");
    subtitleNode.className = "ability-panel-subtitle";
    subtitleNode.textContent = subtitle;

    wrapper.append(headingRow, subtitleNode);
    return wrapper;
  }

  private rebuildAbilityCards(documentRef: Document, grid: HTMLDivElement): void {
    grid.innerHTML = "";
    const sorted = Array.from(this.abilityCatalog.values()).sort((a, b) => a.id - b.id);
    for (const ability of sorted) {
      const card = this.createAbilityCard(documentRef, ability.id);
      grid.append(card);
    }
  }

  private createAbilityCard(documentRef: Document, abilityId: number): HTMLButtonElement {
    const card = documentRef.createElement("button");
    card.type = "button";
    card.className = "ability-card";
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
      this.assignAbilityToSlot(this.selectedSlot, abilityId, true);
    });

    this.abilityCards.set(abilityId, card);
    return card;
  }

  private renderAbilityCard(card: HTMLButtonElement, abilityId: number): void {
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

    const footer = this.root.ownerDocument.createElement("div");
    footer.className = "ability-card-footer";

    const points = this.root.ownerDocument.createElement("span");
    points.className = "ability-card-meta";
    const totalPoints = ability
      ? ability.points.power + ability.points.velocity + ability.points.efficiency + ability.points.control
      : 0;
    points.textContent = `Pts ${totalPoints}`;

    const attrs = this.root.ownerDocument.createElement("span");
    attrs.className = "ability-card-meta";
    attrs.textContent =
      ability && ability.attributes.length > 0 ? `Attrs ${ability.attributes.join(", ")}` : "Attrs none";

    footer.append(points, attrs);

    card.append(header, description, footer);
  }

  private assignAbilityToSlot(slot: number, abilityId: number, emitAssignmentEvent: boolean): void {
    const clampedSlot = clampHotbarSlotIndex(slot);
    const normalizedAbilityId = this.normalizeAbilityId(abilityId);

    this.assignments[clampedSlot] = normalizedAbilityId;
    this.renderSlot(clampedSlot);
    this.updateCardSelection();
    this.updateLoadoutSummary();

    if (emitAssignmentEvent) {
      this.options.onHotbarAssignmentChanged?.(clampedSlot, normalizedAbilityId);
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

  private updateLoadoutSummary(): void {
    const abilityId = this.assignments[this.selectedSlot] ?? ABILITY_ID_NONE;
    const ability = this.resolveAbilityById(abilityId);

    this.loadoutSlotLabel.textContent = `Slot ${this.selectedSlot + 1}`;
    this.loadoutAbilityLabel.textContent = ability?.name ?? "Unknown";
    this.loadoutAbilityDetail.textContent = ability?.description ?? "No description available.";
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

  private updateCardSelection(): void {
    const selectedAbilityId = this.getSelectedAbilityId();
    for (const [abilityId, card] of this.abilityCards) {
      card.classList.toggle("ability-card-selected", abilityId === selectedAbilityId);
    }
  }

  private setPanelVisibility(panel: HTMLElement, open: boolean): void {
    panel.classList.toggle("ability-panel-hidden", !open);
    panel.classList.toggle("ability-panel-visible", open);
  }
}
