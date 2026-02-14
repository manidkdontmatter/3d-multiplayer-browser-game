import {
  ABILITY_ID_NONE,
  HOTBAR_SLOT_COUNT,
  clampHotbarSlotIndex,
  getAbilityDefinitionById,
  type AbilityDefinition
} from "../../shared/abilities";

export interface AbilityHudOptions {
  availableAbilities: ReadonlyArray<AbilityDefinition>;
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
  private readonly menu: HTMLDivElement;
  private readonly abilityCards = new Map<number, HTMLButtonElement>();
  private readonly slotElements: SlotElements[] = [];
  private readonly assignments = new Array<number>(HOTBAR_SLOT_COUNT).fill(ABILITY_ID_NONE);
  private selectedSlot = 0;
  private menuOpen = false;

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

    this.menu = documentRef.createElement("div");
    this.menu.id = "ability-menu";
    this.menu.className = "ability-menu-hidden";

    const menuHeader = documentRef.createElement("p");
    menuHeader.className = "ability-menu-title";
    menuHeader.textContent = "Ability Loadout";
    this.menu.append(menuHeader);

    const menuHint = documentRef.createElement("p");
    menuHint.className = "ability-menu-hint";
    menuHint.textContent = "Press B to close. Drag cards to hotbar slots or click to assign.";
    this.menu.append(menuHint);

    const cardGrid = documentRef.createElement("div");
    cardGrid.className = "ability-card-grid";
    this.menu.append(cardGrid);

    const emptyCard = this.createAbilityCard(documentRef, ABILITY_ID_NONE);
    cardGrid.append(emptyCard);

    for (const ability of this.options.availableAbilities) {
      const card = this.createAbilityCard(documentRef, ability.id);
      cardGrid.append(card);
    }

    this.root.append(this.menu);
    documentRef.body.append(this.root);

    this.setHotbarAssignments(this.options.initialHotbarAssignments);
    this.setSelectedSlot(this.options.initialSelectedSlot ?? 0, false);
  }

  public static mount(documentRef: Document, options: AbilityHudOptions): AbilityHud {
    return new AbilityHud(options, documentRef);
  }

  public toggleMenu(): boolean {
    this.setMenuOpen(!this.menuOpen);
    return this.menuOpen;
  }

  public setMenuOpen(open: boolean): void {
    this.menuOpen = open;
    this.menu.classList.toggle("ability-menu-hidden", !open);
    this.menu.classList.toggle("ability-menu-visible", open);
  }

  public isMenuOpen(): boolean {
    return this.menuOpen;
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

  public getSelectedSlot(): number {
    return this.selectedSlot;
  }

  public getSelectedAbilityId(): number {
    return this.assignments[this.selectedSlot] ?? ABILITY_ID_NONE;
  }

  public getAssignments(): ReadonlyArray<number> {
    return [...this.assignments];
  }

  private createAbilityCard(documentRef: Document, abilityId: number): HTMLButtonElement {
    const card = documentRef.createElement("button");
    card.type = "button";
    card.className = "ability-card";
    card.draggable = true;
    card.dataset.abilityId = String(abilityId);
    const ability = getAbilityDefinitionById(abilityId);
    const title = documentRef.createElement("span");
    title.className = "ability-card-title";
    title.textContent = ability ? ability.name : "Empty";
    const subtitle = documentRef.createElement("span");
    subtitle.className = "ability-card-subtitle";
    subtitle.textContent = ability ? `${ability.category} | points ${this.totalPoints(ability)}` : "Clear slot";
    card.append(title, subtitle);

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
    const ability = getAbilityDefinitionById(abilityId);
    elements.nameLabel.textContent = ability ? ability.name : "Empty";
  }

  private normalizeAbilityId(abilityId: number): number {
    if (!Number.isFinite(abilityId)) {
      return ABILITY_ID_NONE;
    }
    const normalized = Math.max(ABILITY_ID_NONE, Math.floor(abilityId));
    if (normalized === ABILITY_ID_NONE) {
      return ABILITY_ID_NONE;
    }
    return getAbilityDefinitionById(normalized) ? normalized : ABILITY_ID_NONE;
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

  private totalPoints(ability: AbilityDefinition): number {
    return ability.points.power + ability.points.velocity + ability.points.efficiency + ability.points.control;
  }
}
