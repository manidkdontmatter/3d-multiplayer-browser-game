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
  private readonly creatorStatus: HTMLParagraphElement;
  private readonly creatorBudgetLabel: HTMLSpanElement;
  private readonly creatorNameInput: HTMLInputElement;
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
    this.loadoutPanel.className = "ability-panel ability-panel-hidden";

    const loadoutHeader = documentRef.createElement("p");
    loadoutHeader.className = "ability-panel-title";
    loadoutHeader.textContent = "Ability Inventory + Loadout";
    this.loadoutPanel.append(loadoutHeader);

    const loadoutHint = documentRef.createElement("p");
    loadoutHint.className = "ability-panel-hint";
    loadoutHint.textContent = "Press B to close. Drag cards to hotbar slots or click to equip.";
    this.loadoutPanel.append(loadoutHint);

    this.cardGrid = documentRef.createElement("div");
    this.cardGrid.className = "ability-card-grid";
    this.loadoutPanel.append(this.cardGrid);

    this.creatorPanel = documentRef.createElement("div");
    this.creatorPanel.id = "ability-creator-panel";
    this.creatorPanel.className = "ability-panel ability-panel-hidden";

    const creatorHeader = documentRef.createElement("p");
    creatorHeader.className = "ability-panel-title";
    creatorHeader.textContent = "Ability Creator";
    this.creatorPanel.append(creatorHeader);

    const creatorHint = documentRef.createElement("p");
    creatorHint.className = "ability-panel-hint";
    creatorHint.textContent =
      "Press N to close. Creator currently outputs projectile abilities.";
    this.creatorPanel.append(creatorHint);

    const creatorBody = documentRef.createElement("section");
    creatorBody.className = "ability-creator-panel";

    const creatorTitle = documentRef.createElement("p");
    creatorTitle.className = "ability-creator-title";
    creatorTitle.textContent = "Create Ability";
    creatorBody.append(creatorTitle);

    const creatorRow = documentRef.createElement("div");
    creatorRow.className = "ability-creator-row";
    const nameLabel = documentRef.createElement("label");
    nameLabel.className = "ability-creator-label";
    nameLabel.textContent = "Name";
    this.creatorNameInput = documentRef.createElement("input");
    this.creatorNameInput.type = "text";
    this.creatorNameInput.className = "ability-creator-input";
    this.creatorNameInput.maxLength = 24;
    this.creatorNameInput.value = CREATOR_DEFAULT_NAME;
    nameLabel.append(this.creatorNameInput);
    creatorRow.append(nameLabel);
    creatorBody.append(creatorRow);

    const statGrid = documentRef.createElement("div");
    statGrid.className = "ability-creator-stat-grid";
    const statKeys: CreatorStatKey[] = ["power", "velocity", "efficiency", "control"];
    for (const statKey of statKeys) {
      statGrid.append(this.createStatControl(documentRef, statKey));
    }
    creatorBody.append(statGrid);

    const attributeSection = documentRef.createElement("div");
    attributeSection.className = "ability-creator-attributes";
    const attributeTitle = documentRef.createElement("p");
    attributeTitle.className = "ability-creator-subtitle";
    attributeTitle.textContent = `Attributes (max ${ABILITY_CREATOR_MAX_ATTRIBUTES})`;
    attributeSection.append(attributeTitle);

    for (const attribute of getAbilityAttributeDefinitions()) {
      const wrapper = documentRef.createElement("label");
      wrapper.className = "ability-creator-attribute-option";
      const checkbox = documentRef.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = attribute.key;
      checkbox.addEventListener("change", () => {
        this.enforceAttributeSelectionLimit(attribute.key);
      });
      this.creatorAttributeToggles.set(attribute.key, checkbox);
      const text = documentRef.createElement("span");
      text.textContent = `${attribute.name} - ${attribute.description}`;
      wrapper.append(checkbox, text);
      attributeSection.append(wrapper);
    }
    creatorBody.append(attributeSection);

    const creatorFooter = documentRef.createElement("div");
    creatorFooter.className = "ability-creator-footer";
    this.creatorBudgetLabel = documentRef.createElement("span");
    this.creatorBudgetLabel.className = "ability-creator-budget";
    creatorFooter.append(this.creatorBudgetLabel);

    const createButton = documentRef.createElement("button");
    createButton.type = "button";
    createButton.className = "ability-creator-submit";
    createButton.textContent = "Create + Equip";
    createButton.addEventListener("click", () => {
      this.submitCreatorDraft();
    });
    creatorFooter.append(createButton);
    creatorBody.append(creatorFooter);

    this.creatorStatus = documentRef.createElement("p");
    this.creatorStatus.className = "ability-creator-status";
    creatorBody.append(this.creatorStatus);

    this.creatorPanel.append(creatorBody);

    this.root.append(this.loadoutPanel, this.creatorPanel);
    documentRef.body.append(this.root);

    this.abilityCatalog.set(ABILITY_ID_NONE, {
      id: ABILITY_ID_NONE,
      key: "empty",
      name: "Empty",
      description: "Clear slot",
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
    this.loadoutPanelOpen = open;
    this.loadoutPanel.classList.toggle("ability-panel-hidden", !open);
    this.loadoutPanel.classList.toggle("ability-panel-visible", open);
  }

  public isLoadoutPanelOpen(): boolean {
    return this.loadoutPanelOpen;
  }

  public toggleCreatorPanel(): boolean {
    this.setCreatorPanelOpen(!this.creatorPanelOpen);
    return this.creatorPanelOpen;
  }

  public setCreatorPanelOpen(open: boolean): void {
    this.creatorPanelOpen = open;
    this.creatorPanel.classList.toggle("ability-panel-hidden", !open);
    this.creatorPanel.classList.toggle("ability-panel-visible", open);
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
  }

  public setCreatorStatus(message: string): void {
    this.creatorStatus.textContent = message;
  }

  public getSelectedSlot(): number {
    return this.selectedSlot;
  }

  public getSelectedAbilityId(): number {
    return this.assignments[this.selectedSlot] ?? ABILITY_ID_NONE;
  }

  private createStatControl(documentRef: Document, statKey: CreatorStatKey): HTMLElement {
    const row = documentRef.createElement("div");
    row.className = "ability-creator-stat-row";

    const label = documentRef.createElement("span");
    label.className = "ability-creator-stat-label";
    label.textContent = CREATOR_STAT_LABELS[statKey];

    const minus = documentRef.createElement("button");
    minus.type = "button";
    minus.className = "ability-creator-stepper";
    minus.textContent = "-";
    minus.addEventListener("click", () => {
      this.adjustCreatorPoints(statKey, -1);
    });

    const value = documentRef.createElement("span");
    value.className = "ability-creator-stat-value";
    value.dataset.stat = statKey;
    value.textContent = String(this.creatorPoints[statKey]);

    const plus = documentRef.createElement("button");
    plus.type = "button";
    plus.className = "ability-creator-stepper";
    plus.textContent = "+";
    plus.addEventListener("click", () => {
      this.adjustCreatorPoints(statKey, 1);
    });

    row.append(label, minus, value, plus);
    return row;
  }

  private adjustCreatorPoints(statKey: CreatorStatKey, delta: number): void {
    const current = this.creatorPoints[statKey];
    const next = Math.max(0, Math.min(ABILITY_CREATOR_MAX_POINTS_PER_STAT, current + delta));
    if (next === current) {
      return;
    }
    const totalWithoutCurrent = this.getCreatorTotalPoints() - current;
    if (totalWithoutCurrent + next > ABILITY_CREATOR_TOTAL_POINTS) {
      return;
    }
    this.creatorPoints[statKey] = next;
    const valueNode = this.creatorPanel.querySelector(`[data-stat="${statKey}"]`);
    if (valueNode) {
      valueNode.textContent = String(next);
    }
    this.updateCreatorBudgetLabel();
  }

  private updateCreatorBudgetLabel(): void {
    const used = this.getCreatorTotalPoints();
    const remaining = ABILITY_CREATOR_TOTAL_POINTS - used;
    this.creatorBudgetLabel.textContent = `Points: ${used}/${ABILITY_CREATOR_TOTAL_POINTS} (left ${remaining})`;
  }

  private enforceAttributeSelectionLimit(changedKey: AbilityAttributeKey): void {
    const selected = this.getSelectedCreatorAttributes();
    if (selected.length <= ABILITY_CREATOR_MAX_ATTRIBUTES) {
      return;
    }
    const checkbox = this.creatorAttributeToggles.get(changedKey);
    if (checkbox) {
      checkbox.checked = false;
    }
  }

  private submitCreatorDraft(): void {
    const name = this.creatorNameInput.value.trim();
    const selectedAttributes = this.getSelectedCreatorAttributes();
    if (name.length < 3) {
      this.setCreatorStatus("Name must be at least 3 characters.");
      return;
    }
    if (selectedAttributes.length > ABILITY_CREATOR_MAX_ATTRIBUTES) {
      this.setCreatorStatus(`Choose at most ${ABILITY_CREATOR_MAX_ATTRIBUTES} attributes.`);
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
    const ability = this.abilityCatalog.get(abilityId) ?? getAbilityDefinitionById(abilityId);
    card.innerHTML = "";
    const title = this.root.ownerDocument.createElement("span");
    title.className = "ability-card-title";
    title.textContent = ability ? ability.name : `Unknown (${abilityId})`;
    const subtitle = this.root.ownerDocument.createElement("span");
    subtitle.className = "ability-card-subtitle";
    if (!ability) {
      subtitle.textContent = "Unavailable";
    } else {
      const attributes = ability.attributes.length > 0 ? ability.attributes.join(", ") : "none";
      subtitle.textContent = `${ability.category} | attrs ${attributes}`;
    }
    card.append(title, subtitle);
  }

  private assignAbilityToSlot(slot: number, abilityId: number, emitAssignmentEvent: boolean): void {
    const clampedSlot = clampHotbarSlotIndex(slot);
    const normalizedAbilityId = this.normalizeAbilityId(abilityId);
    this.assignments[clampedSlot] = normalizedAbilityId;
    this.renderSlot(clampedSlot);
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
    const ability =
      this.abilityCatalog.get(abilityId) ??
      getAbilityDefinitionById(abilityId) ??
      this.abilityCatalog.get(ABILITY_ID_NONE);
    elements.nameLabel.textContent = ability?.name ?? "Unknown";
  }

  private normalizeAbilityId(abilityId: number): number {
    if (!Number.isFinite(abilityId)) {
      return ABILITY_ID_NONE;
    }
    const normalized = Math.max(ABILITY_ID_NONE, Math.floor(abilityId));
    if (normalized === ABILITY_ID_NONE) {
      return ABILITY_ID_NONE;
    }
    return this.abilityCatalog.has(normalized) || getAbilityDefinitionById(normalized)
      ? normalized
      : ABILITY_ID_NONE;
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
}
