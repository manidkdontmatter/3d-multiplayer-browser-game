import {
  ABILITY_CREATOR_MAX_ATTRIBUTES,
  ABILITY_CREATOR_MAX_POINTS_PER_STAT,
  ABILITY_CREATOR_TOTAL_POINTS,
  ABILITY_ID_NONE,
  HOTBAR_SLOT_COUNT,
  abilityCategoryToWireValue,
  clampHotbarSlotIndex,
  encodeAbilityAttributeMask,
  getAbilityAttributeDefinitions,
  getAbilityDefinitionById,
  getAllAbilityDefinitions,
  type AbilityAttributeKey,
  type AbilityCategory,
  type AbilityDefinition,
  type AbilityStatPoints
} from "../../shared/abilities";

export interface AbilityCreateDraftSubmission {
  name: string;
  category: number;
  pointsPower: number;
  pointsVelocity: number;
  pointsEfficiency: number;
  pointsControl: number;
  attributeMask: number;
  targetHotbarSlot: number;
}

export interface AbilityHudOptions {
  initialHotbarAssignments: ReadonlyArray<number>;
  initialSelectedSlot?: number;
  onHotbarSlotSelected?: (slot: number) => void;
  onHotbarAssignmentChanged?: (slot: number, abilityId: number) => void;
  onCreateAbilityRequested?: (draft: AbilityCreateDraftSubmission) => void;
}

type SlotElements = {
  button: HTMLButtonElement;
  nameLabel: HTMLSpanElement;
};

type CreatorStatKey = keyof AbilityStatPoints;

type CreatorStatUi = {
  valueLabel: HTMLSpanElement;
  fill: HTMLDivElement;
};

const ABILITY_DRAG_MIME = "application/x-vibe-ability-id";
const CREATOR_DEFAULT_NAME = "Custom Bolt";
const CREATOR_CATEGORY: AbilityCategory = "projectile";

const CREATOR_STAT_LABELS: Readonly<Record<CreatorStatKey, string>> = Object.freeze({
  power: "Power",
  velocity: "Velocity",
  efficiency: "Efficiency",
  control: "Control"
});

export class AbilityHud {
  private readonly root: HTMLDivElement;
  private readonly loadoutPanel: HTMLDivElement;
  private readonly creatorPanel: HTMLDivElement;
  private readonly cardGrid: HTMLDivElement;
  private readonly loadoutSlotLabel: HTMLSpanElement;
  private readonly loadoutAbilityLabel: HTMLParagraphElement;
  private readonly loadoutAbilityDetail: HTMLParagraphElement;
  private readonly creatorStatus: HTMLParagraphElement;
  private readonly creatorBudgetLabel: HTMLSpanElement;
  private readonly creatorBudgetFill: HTMLDivElement;
  private readonly creatorTargetSlotLabel: HTMLSpanElement;
  private readonly creatorNameInput: HTMLInputElement;
  private readonly creatorStatUi = new Map<CreatorStatKey, CreatorStatUi>();
  private readonly abilityCards = new Map<number, HTMLButtonElement>();
  private readonly slotElements: SlotElements[] = [];
  private readonly assignments = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
  private readonly abilityCatalog = new Map<number, AbilityDefinition>();
  private readonly creatorPoints: AbilityStatPoints = {
    power: 5,
    velocity: 5,
    efficiency: 5,
    control: 5
  };
  private readonly creatorAttributeToggles = new Map<AbilityAttributeKey, HTMLInputElement>();
  private selectedSlot = 0;
  private loadoutPanelOpen = false;
  private creatorPanelOpen = false;

  private constructor(
    private readonly options: AbilityHudOptions,
    documentRef: Document
  ) {
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
      this.createPanelHeader(
        documentRef,
        "Loadout",
        "Equip abilities to active hotbar slots.",
        "B"
      )
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

    this.creatorPanel = documentRef.createElement("div");
    this.creatorPanel.id = "ability-creator-panel";
    this.creatorPanel.className = "ability-system-panel ability-panel-hidden";

    this.creatorPanel.append(
      this.createPanelHeader(
        documentRef,
        "Ability Creator",
        "Create and auto-equip a new ability to the selected slot.",
        "N"
      )
    );

    const creatorContext = documentRef.createElement("div");
    creatorContext.className = "ability-creator-context";

    this.creatorTargetSlotLabel = documentRef.createElement("span");
    this.creatorTargetSlotLabel.className = "ability-target-slot";

    this.creatorBudgetLabel = documentRef.createElement("span");
    this.creatorBudgetLabel.className = "ability-budget-label";

    const creatorBudgetTrack = documentRef.createElement("div");
    creatorBudgetTrack.className = "ability-budget-track";
    this.creatorBudgetFill = documentRef.createElement("div");
    this.creatorBudgetFill.className = "ability-budget-fill";
    creatorBudgetTrack.append(this.creatorBudgetFill);

    creatorContext.append(this.creatorTargetSlotLabel, this.creatorBudgetLabel, creatorBudgetTrack);
    this.creatorPanel.append(creatorContext);

    const creatorForm = documentRef.createElement("div");
    creatorForm.className = "ability-creator-form";

    const nameRow = documentRef.createElement("div");
    nameRow.className = "ability-form-row";
    const nameLabel = documentRef.createElement("label");
    nameLabel.className = "ability-form-label";
    nameLabel.textContent = "Ability Name";
    this.creatorNameInput = documentRef.createElement("input");
    this.creatorNameInput.type = "text";
    this.creatorNameInput.className = "ability-creator-input";
    this.creatorNameInput.maxLength = 24;
    this.creatorNameInput.value = CREATOR_DEFAULT_NAME;
    nameLabel.append(this.creatorNameInput);
    nameRow.append(nameLabel);

    const categoryRow = documentRef.createElement("div");
    categoryRow.className = "ability-form-row";
    const categoryLabel = documentRef.createElement("label");
    categoryLabel.className = "ability-form-label";
    categoryLabel.textContent = "Category";
    const categoryValue = documentRef.createElement("div");
    categoryValue.className = "ability-readonly-field";
    categoryValue.textContent = "Projectile (current runtime support)";
    categoryLabel.append(categoryValue);
    categoryRow.append(categoryLabel);

    const statGrid = documentRef.createElement("div");
    statGrid.className = "ability-creator-stat-grid";
    const statKeys: CreatorStatKey[] = ["power", "velocity", "efficiency", "control"];
    for (const statKey of statKeys) {
      statGrid.append(this.createStatControl(documentRef, statKey));
    }

    const attributeSection = documentRef.createElement("div");
    attributeSection.className = "ability-creator-attributes";

    const attributeLabel = documentRef.createElement("p");
    attributeLabel.className = "ability-section-label";
    attributeLabel.textContent = `Attributes (pick up to ${ABILITY_CREATOR_MAX_ATTRIBUTES})`;
    attributeSection.append(attributeLabel);

    const attributeGrid = documentRef.createElement("div");
    attributeGrid.className = "ability-attribute-grid";

    for (const attribute of getAbilityAttributeDefinitions()) {
      const wrapper = documentRef.createElement("label");
      wrapper.className = "ability-attribute-option";

      const checkbox = documentRef.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = attribute.key;
      checkbox.addEventListener("change", () => {
        this.enforceAttributeSelectionLimit(attribute.key);
      });

      const name = documentRef.createElement("span");
      name.className = "ability-attribute-name";
      name.textContent = attribute.name;

      const description = documentRef.createElement("span");
      description.className = "ability-attribute-description";
      description.textContent = attribute.description;

      wrapper.append(checkbox, name, description);
      attributeGrid.append(wrapper);
      this.creatorAttributeToggles.set(attribute.key, checkbox);
    }

    attributeSection.append(attributeGrid);

    const creatorFooter = documentRef.createElement("div");
    creatorFooter.className = "ability-creator-footer";

    const createButton = documentRef.createElement("button");
    createButton.type = "button";
    createButton.className = "ability-creator-submit";
    createButton.textContent = "Create Ability";
    createButton.addEventListener("click", () => {
      this.submitCreatorDraft();
    });

    this.creatorStatus = documentRef.createElement("p");
    this.creatorStatus.className = "ability-creator-status";

    creatorFooter.append(createButton, this.creatorStatus);

    creatorForm.append(nameRow, categoryRow, statGrid, attributeSection, creatorFooter);
    this.creatorPanel.append(creatorForm);

    this.root.append(this.loadoutPanel, this.creatorPanel);
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
    this.updateCreatorBudgetLabel();
    this.updateAttributeSelectionState();
    this.setCreatorStatus("Ready.");
  }

  public static mount(documentRef: Document, options: AbilityHudOptions): AbilityHud {
    return new AbilityHud(options, documentRef);
  }

  public toggleLoadoutPanel(): boolean {
    this.setLoadoutPanelOpen(!this.loadoutPanelOpen);
    return this.loadoutPanelOpen;
  }

  public setLoadoutPanelOpen(open: boolean): void {
    if (open) {
      this.setCreatorPanelOpen(false, true);
    }
    this.loadoutPanelOpen = open;
    this.setPanelVisibility(this.loadoutPanel, open);
  }

  public isLoadoutPanelOpen(): boolean {
    return this.loadoutPanelOpen;
  }

  public toggleCreatorPanel(): boolean {
    this.setCreatorPanelOpen(!this.creatorPanelOpen);
    return this.creatorPanelOpen;
  }

  public setCreatorPanelOpen(open: boolean, fromSibling = false): void {
    if (open && !fromSibling) {
      this.setLoadoutPanelOpen(false);
    }
    this.creatorPanelOpen = open;
    this.setPanelVisibility(this.creatorPanel, open);
  }

  public isCreatorPanelOpen(): boolean {
    return this.creatorPanelOpen;
  }

  public isAnyPanelOpen(): boolean {
    return this.loadoutPanelOpen || this.creatorPanelOpen;
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
    this.updateCreatorTargetSlotLabel();

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
    this.updateCreatorTargetSlotLabel();
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
    this.updateCreatorTargetSlotLabel();
  }

  public setCreatorStatus(message: string): void {
    this.creatorStatus.textContent = message;
    this.creatorStatus.classList.remove(
      "ability-creator-status-info",
      "ability-creator-status-pending",
      "ability-creator-status-success",
      "ability-creator-status-error"
    );

    const lowered = message.toLowerCase();
    if (lowered.includes("failed") || lowered.includes("error")) {
      this.creatorStatus.classList.add("ability-creator-status-error");
    } else if (lowered.includes("sent to server") || lowered.includes("queued")) {
      this.creatorStatus.classList.add("ability-creator-status-pending");
    } else if (lowered.includes("created ability")) {
      this.creatorStatus.classList.add("ability-creator-status-success");
    } else {
      this.creatorStatus.classList.add("ability-creator-status-info");
    }
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

  private createStatControl(documentRef: Document, statKey: CreatorStatKey): HTMLElement {
    const card = documentRef.createElement("div");
    card.className = "ability-stat-card";

    const top = documentRef.createElement("div");
    top.className = "ability-stat-top";

    const label = documentRef.createElement("span");
    label.className = "ability-stat-label";
    label.textContent = CREATOR_STAT_LABELS[statKey];

    const value = documentRef.createElement("span");
    value.className = "ability-stat-value";

    top.append(label, value);

    const controls = documentRef.createElement("div");
    controls.className = "ability-stat-controls";

    const minus = documentRef.createElement("button");
    minus.type = "button";
    minus.className = "ability-stat-stepper";
    minus.textContent = "-";
    minus.addEventListener("click", () => {
      this.adjustCreatorPoints(statKey, -1);
    });

    const track = documentRef.createElement("div");
    track.className = "ability-stat-track";
    const fill = documentRef.createElement("div");
    fill.className = "ability-stat-fill";
    track.append(fill);

    const plus = documentRef.createElement("button");
    plus.type = "button";
    plus.className = "ability-stat-stepper";
    plus.textContent = "+";
    plus.addEventListener("click", () => {
      this.adjustCreatorPoints(statKey, 1);
    });

    controls.append(minus, track, plus);
    card.append(top, controls);

    this.creatorStatUi.set(statKey, {
      valueLabel: value,
      fill
    });
    this.updateStatVisual(statKey);

    return card;
  }

  private adjustCreatorPoints(statKey: CreatorStatKey, delta: number): void {
    const current = this.creatorPoints[statKey];
    const next = Math.max(0, Math.min(ABILITY_CREATOR_MAX_POINTS_PER_STAT, current + delta));
    if (next === current) {
      return;
    }

    const totalWithoutCurrent = this.getCreatorTotalPoints() - current;
    if (totalWithoutCurrent + next > ABILITY_CREATOR_TOTAL_POINTS) {
      this.setCreatorStatus(`Point budget is ${ABILITY_CREATOR_TOTAL_POINTS}.`);
      return;
    }

    this.creatorPoints[statKey] = next;
    this.updateStatVisual(statKey);
    this.updateCreatorBudgetLabel();
  }

  private updateStatVisual(statKey: CreatorStatKey): void {
    const ui = this.creatorStatUi.get(statKey);
    if (!ui) {
      return;
    }
    const points = this.creatorPoints[statKey];
    ui.valueLabel.textContent = `${points}`;
    const fillPercent = (points / ABILITY_CREATOR_MAX_POINTS_PER_STAT) * 100;
    ui.fill.style.width = `${fillPercent.toFixed(1)}%`;
  }

  private updateCreatorBudgetLabel(): void {
    const used = this.getCreatorTotalPoints();
    const remaining = ABILITY_CREATOR_TOTAL_POINTS - used;
    this.creatorBudgetLabel.textContent = `Point Budget ${used}/${ABILITY_CREATOR_TOTAL_POINTS} (left ${remaining})`;
    this.creatorBudgetFill.style.width = `${((used / ABILITY_CREATOR_TOTAL_POINTS) * 100).toFixed(1)}%`;
  }

  private enforceAttributeSelectionLimit(changedKey: AbilityAttributeKey): void {
    const selected = this.getSelectedCreatorAttributes();
    if (selected.length > ABILITY_CREATOR_MAX_ATTRIBUTES) {
      const checkbox = this.creatorAttributeToggles.get(changedKey);
      if (checkbox) {
        checkbox.checked = false;
      }
      this.setCreatorStatus(`Choose up to ${ABILITY_CREATOR_MAX_ATTRIBUTES} attributes.`);
    }
    this.updateAttributeSelectionState();
  }

  private updateAttributeSelectionState(): void {
    for (const checkbox of this.creatorAttributeToggles.values()) {
      const wrapper = checkbox.closest(".ability-attribute-option");
      if (!wrapper) {
        continue;
      }
      wrapper.classList.toggle("ability-attribute-option-selected", checkbox.checked);
    }
  }

  private submitCreatorDraft(): void {
    const name = this.creatorNameInput.value.trim();
    const selectedAttributes = this.getSelectedCreatorAttributes();

    if (name.length < 3) {
      this.setCreatorStatus("Ability name must be at least 3 characters.");
      return;
    }

    if (selectedAttributes.length > ABILITY_CREATOR_MAX_ATTRIBUTES) {
      this.setCreatorStatus(`Choose up to ${ABILITY_CREATOR_MAX_ATTRIBUTES} attributes.`);
      return;
    }

    const payload: AbilityCreateDraftSubmission = {
      name,
      category: abilityCategoryToWireValue(CREATOR_CATEGORY),
      pointsPower: this.creatorPoints.power,
      pointsVelocity: this.creatorPoints.velocity,
      pointsEfficiency: this.creatorPoints.efficiency,
      pointsControl: this.creatorPoints.control,
      attributeMask: encodeAbilityAttributeMask(selectedAttributes),
      targetHotbarSlot: this.selectedSlot
    };

    this.options.onCreateAbilityRequested?.(payload);
    this.setCreatorStatus("Sent to server...");
  }

  private getSelectedCreatorAttributes(): AbilityAttributeKey[] {
    const selectedKeys: AbilityAttributeKey[] = [];
    for (const [key, checkbox] of this.creatorAttributeToggles.entries()) {
      if (checkbox.checked) {
        selectedKeys.push(key);
      }
    }
    return selectedKeys;
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
    this.updateCreatorTargetSlotLabel();

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

  private updateCreatorTargetSlotLabel(): void {
    const abilityId = this.assignments[this.selectedSlot] ?? ABILITY_ID_NONE;
    const ability = this.resolveAbilityById(abilityId);
    this.creatorTargetSlotLabel.textContent = `Target Slot ${this.selectedSlot + 1}: ${ability?.name ?? "Empty"}`;
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

  private getCreatorTotalPoints(): number {
    return (
      this.creatorPoints.power +
      this.creatorPoints.velocity +
      this.creatorPoints.efficiency +
      this.creatorPoints.control
    );
  }

  private setPanelVisibility(panel: HTMLElement, open: boolean): void {
    panel.classList.toggle("ability-panel-hidden", !open);
    panel.classList.toggle("ability-panel-visible", open);
  }
}
