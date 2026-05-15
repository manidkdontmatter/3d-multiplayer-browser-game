// Generalized creator UI panel — renders based on archetype metadata.
// One panel for all archetype kinds (characters, abilities, items).
// Replaces the ability-specific AbilityCreatorPanel.

import type { ArchetypeDefinition } from "../../shared/archetype";
import type { CreatorClientState } from "../runtime/network/CreatorStateStore";
import { getTraitDefinitionById } from "../../shared/traits";

export interface CreatorPanelOptions {
  kind: string;
  kindLabel: string;
  availableBaseArchetypes: readonly ArchetypeDefinition[];
  onCommand: (command: CreatorPanelCommand) => void;
}

export interface CreatorPanelCommand {
  sessionId?: number;
  sequence?: number;
  applyName?: boolean;
  name?: string;
  selectBaseArchetype?: boolean;
  baseArchetypeId?: number;
  allocateStat?: boolean;
  statId?: string;
  statDelta?: number;
  toggleTrait?: boolean;
  traitId?: string;
  submitCreate?: boolean;
}

export class CreatorPanel {
  private readonly root: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly baseSelect: HTMLSelectElement;
  private readonly statContainer: HTMLElement;
  private readonly traitUpsideContainer: HTMLElement;
  private readonly traitDownsideContainer: HTMLElement;
  private readonly derivedContainer: HTMLElement;
  private readonly statusNode: HTMLParagraphElement;
  private readonly createButton: HTMLButtonElement;
  private readonly statRows = new Map<string, {
    value: HTMLSpanElement;
    dec: HTMLButtonElement;
    inc: HTMLButtonElement;
  }>();
  private readonly traitCards = new Map<string, HTMLButtonElement>();
  private readonly derivedNodes = new Map<string, HTMLSpanElement>();

  private currentState: CreatorClientState | null = null;
  private suppressEvents = false;
  private readonly headerTitle: HTMLHeadingElement;

  public constructor(
    documentRef: Document,
    private readonly options: CreatorPanelOptions
  ) {
    this.root = documentRef.createElement("section");
    this.root.className = "main-ui-panel main-ui-panel-creator";
    this.root.dataset.section = `${options.kind}-creator`;

    // Header
    const header = documentRef.createElement("header");
    header.className = "main-ui-heading";
    this.headerTitle = documentRef.createElement("h3");
    this.headerTitle.textContent = options.kindLabel;
    header.append(this.headerTitle);
    this.root.append(header);

    // Name + base archetype
    const topControls = documentRef.createElement("div");
    topControls.className = "creator-top-controls";

    this.nameInput = documentRef.createElement("input");
    this.nameInput.type = "text";
    this.nameInput.className = "creator-input";
    this.nameInput.placeholder = "Name";
    this.nameInput.maxLength = 24;
    this.nameInput.addEventListener("change", () => {
      if (this.suppressEvents) return;
      options.onCommand({ applyName: true, name: this.nameInput.value });
    });
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        options.onCommand({ applyName: true, name: this.nameInput.value });
        this.nameInput.blur();
      }
    });

    this.baseSelect = documentRef.createElement("select");
    this.baseSelect.className = "creator-select";
    this.baseSelect.addEventListener("change", () => {
      if (this.suppressEvents) return;
      const id = parseInt(this.baseSelect.value, 10);
      if (Number.isFinite(id) && id > 0) {
        options.onCommand({ selectBaseArchetype: true, baseArchetypeId: id });
      }
    });

    topControls.append(
      this.createLabeledControl(documentRef, "Name", this.nameInput),
      this.createLabeledControl(documentRef, "Base", this.baseSelect)
    );
    this.root.append(topControls);

    // Body: stat allocation + traits + derived
    const body = documentRef.createElement("div");
    body.className = "creator-body";

    // Stat allocation pane
    const statPane = documentRef.createElement("section");
    statPane.className = "creator-pane";
    const statHeading = documentRef.createElement("h4");
    statHeading.textContent = "Stat Allocation";
    statPane.append(statHeading);
    this.statContainer = documentRef.createElement("div");
    this.statContainer.className = "creator-stat-rows";
    statPane.append(this.statContainer);
    body.append(statPane);

    // Trait pane
    const traitPane = documentRef.createElement("section");
    traitPane.className = "creator-pane";
    const traitHeading = documentRef.createElement("h4");
    traitHeading.textContent = "Traits";
    traitPane.append(traitHeading);
    const traitContainer = documentRef.createElement("div");
    traitContainer.className = "creator-trait-sections";

    const upsideSection = documentRef.createElement("section");
    upsideSection.className = "creator-trait-section";
    const upsideHeading = documentRef.createElement("h5");
    upsideHeading.textContent = "Upsides";
    upsideSection.append(upsideHeading);
    this.traitUpsideContainer = documentRef.createElement("div");
    upsideSection.append(this.traitUpsideContainer);

    const downsideSection = documentRef.createElement("section");
    downsideSection.className = "creator-trait-section";
    const downsideHeading = documentRef.createElement("h5");
    downsideHeading.textContent = "Downsides";
    downsideSection.append(downsideHeading);
    this.traitDownsideContainer = documentRef.createElement("div");
    downsideSection.append(this.traitDownsideContainer);

    traitContainer.append(upsideSection, downsideSection);
    traitPane.append(traitContainer);
    body.append(traitPane);

    // Derived + validation pane
    const derivedPane = documentRef.createElement("section");
    derivedPane.className = "creator-pane";
    const derivedHeading = documentRef.createElement("h4");
    derivedHeading.textContent = "Results";
    derivedPane.append(derivedHeading);
    this.derivedContainer = documentRef.createElement("ul");
    this.derivedContainer.className = "creator-derived-list";
    derivedPane.append(this.derivedContainer);
    this.statusNode = documentRef.createElement("p");
    this.statusNode.className = "creator-validation";
    derivedPane.append(this.statusNode);
    body.append(derivedPane);

    this.root.append(body);

    // Footer
    const footer = documentRef.createElement("div");
    footer.className = "creator-footer";
    this.createButton = documentRef.createElement("button");
    this.createButton.type = "button";
    this.createButton.className = "creator-create";
    this.createButton.textContent = "Create";
    this.createButton.addEventListener("click", () => {
      options.onCommand({ submitCreate: true });
    });
    footer.append(this.createButton);
    this.root.append(footer);

    this.populateBaseSelect();
    this.render();
  }

  public getElement(): HTMLElement {
    return this.root;
  }

  public setState(state: CreatorClientState | null): void {
    this.currentState = state;
    this.render();
  }

  // ── Internal render ─────────────────────────────────────────────────────

  private render(): void {
    const state = this.currentState;
    const disabled = state === null;
    this.root.classList.toggle("creator-disabled", disabled);

    this.nameInput.disabled = disabled;
    this.baseSelect.disabled = disabled;
    this.createButton.disabled = disabled;

    this.suppressEvents = true;
    if (!state) {
      this.headerTitle.textContent = "Creator";
      this.nameInput.value = "";
      this.clearStatRows();
      this.clearTraitCards();
      this.clearDerivedNodes();
      this.statusNode.textContent = "Waiting for creator session...";
      this.suppressEvents = false;
      return;
    }

    this.headerTitle.textContent = `${state.draft.kind.charAt(0).toUpperCase()}${state.draft.kind.slice(1)} Creator`;
    this.nameInput.value = state.draft.name;
    this.renderStatRows(state);
    this.renderTraitCards(state);
    this.renderDerivedNodes(state);
    this.statusNode.textContent = state.validation.message;
    this.statusNode.classList.toggle("creator-validation-invalid", !state.validation.valid);

    this.baseSelect.value = String(state.draft.baseArchetypeId);
    this.suppressEvents = false;
  }

  private renderStatRows(state: CreatorClientState): void {
    this.clearStatRows();
    const stats = Object.entries(state.draft.statAllocations);
    if (stats.length === 0) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.textContent = "No stats available for this archetype.";
      this.statContainer.append(empty);
      return;
    }

    for (const [statId, value] of stats) {
      const row = this.root.ownerDocument.createElement("div");
      row.className = "creator-stat-row";

      const nameSpan = this.root.ownerDocument.createElement("span");
      nameSpan.className = "creator-stat-name";
      nameSpan.textContent = statId;

      const controls = this.root.ownerDocument.createElement("span");
      controls.className = "creator-stat-controls";

      const dec = this.root.ownerDocument.createElement("button");
      dec.type = "button";
      dec.className = "creator-stat-button";
      dec.textContent = "-";
      dec.addEventListener("click", () => {
        this.options.onCommand({ allocateStat: true, statId, statDelta: -1 });
      });

      const inc = this.root.ownerDocument.createElement("button");
      inc.type = "button";
      inc.className = "creator-stat-button";
      inc.textContent = "+";
      inc.addEventListener("click", () => {
        this.options.onCommand({ allocateStat: true, statId, statDelta: 1 });
      });

      const val = this.root.ownerDocument.createElement("span");
      val.className = "creator-stat-value";
      val.textContent = String(value);

      controls.append(dec, inc);
      row.append(nameSpan, controls, val);
      this.statContainer.append(row);
      this.statRows.set(statId, { value: val, dec, inc });
    }

    const budget = this.root.ownerDocument.createElement("p");
    budget.className = "creator-detail";
    budget.textContent = `Points: ${state.capacity.statBudgetSpent}/${state.capacity.statBudgetTotal}`;
    this.statContainer.append(budget);
  }

  private renderTraitCards(state: CreatorClientState): void {
    this.clearTraitCards();
    const baseArchetype = this.options.availableBaseArchetypes.find(
      (a) => a.id === state.draft.baseArchetypeId
    );
    if (!baseArchetype) return;

    for (const traitId of baseArchetype.availableTraits) {
      const card = this.root.ownerDocument.createElement("button");
      card.type = "button";
      card.className = "creator-trait-card";
      card.textContent = traitId;
      card.title = traitId;

      const isSelected = state.draft.selectedTraits.includes(traitId);
      card.classList.toggle("creator-trait-selected", isSelected);

      card.addEventListener("click", () => {
        this.options.onCommand({ toggleTrait: true, traitId });
      });

      // Sort into upside/downside sections by polarity metadata, not toggle state
      const traitDef = this.findTraitDefinition(traitId);
      if (traitDef?.polarity === "downside") {
        this.traitDownsideContainer.append(card);
      } else {
        this.traitUpsideContainer.append(card);
      }

      this.traitCards.set(traitId, card);
    }
  }

  private findTraitDefinition(traitId: string): { polarity: string } | null {
    return getTraitDefinitionById(traitId) as { polarity: string } | null;
  }

  private renderDerivedNodes(state: CreatorClientState): void {
    this.clearDerivedNodes();
    for (const [statId, value] of Object.entries(state.draft.statAllocations)) {
      const item = this.root.ownerDocument.createElement("li");
      const label = this.root.ownerDocument.createElement("span");
      label.textContent = statId;
      const valSpan = this.root.ownerDocument.createElement("span");
      valSpan.textContent = String(value);
      item.append(label, valSpan);
      this.derivedContainer.append(item);
      this.derivedNodes.set(statId, valSpan);
    }
  }

  private populateBaseSelect(): void {
    const doc = this.root.ownerDocument;
    this.baseSelect.innerHTML = "";
    const none = doc.createElement("option");
    none.value = "0";
    none.textContent = `Select ${this.options.kindLabel.split(" ")[0]}...`;
    this.baseSelect.append(none);
    for (const archetype of this.options.availableBaseArchetypes) {
      const opt = doc.createElement("option");
      opt.value = String(archetype.id);
      opt.textContent = `[${archetype.kind}] ${archetype.name} (#${archetype.id})`;
      this.baseSelect.append(opt);
    }
  }

  private clearStatRows(): void {
    this.statContainer.innerHTML = "";
    this.statRows.clear();
  }

  private clearTraitCards(): void {
    this.traitUpsideContainer.innerHTML = "";
    this.traitDownsideContainer.innerHTML = "";
    this.traitCards.clear();
  }

  private clearDerivedNodes(): void {
    this.derivedContainer.innerHTML = "";
    this.derivedNodes.clear();
  }

  private createLabeledControl(doc: Document, label: string, control: HTMLElement): HTMLElement {
    const wrapper = doc.createElement("label");
    wrapper.className = "creator-control";
    const text = doc.createElement("span");
    text.className = "creator-control-label";
    text.textContent = label;
    wrapper.append(text, control);
    return wrapper;
  }
}
