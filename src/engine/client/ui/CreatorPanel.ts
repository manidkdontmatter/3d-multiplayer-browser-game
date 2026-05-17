/**
 * Purpose: This file defines the "creator panel" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import type { BlueprintDefinition } from "../../shared/blueprint";
import type { CreatorClientState } from "../runtime/network/CreatorStateStore";
import { getBlueprintTemplateProfile } from "../../shared/blueprint";
import {
  collectStatModifiers,
  creatorProfileIdToKind,
  deriveStats,
  getCreatorDraftAttributeValues,
  getCreatorDraftStatValues,
  getCreatorFieldDefinitions,
  getDerivedEffectsForKind,
  type CreatorFieldDefinition,
  type CreatorFieldValue,
  type CreatorProfileId
} from "../../shared/index";

export interface CreatorPanelOptions {
  profileId: CreatorProfileId;
  profileLabel: string;
  availableBaseBlueprints: readonly BlueprintDefinition[];
  onCommand: (command: CreatorPanelCommand) => void;
}

export interface CreatorPanelCommand {
  sessionId?: number;
  sequence?: number;
  setName?: boolean;
  name?: string;
  selectBaseBlueprint?: boolean;
  baseBlueprintId?: number;
  stepField?: boolean;
  fieldId?: string;
  fieldDelta?: number;
  setField?: boolean;
  fieldValueJson?: string;
  submitCreate?: boolean;
}

export class CreatorPanel {
  private readonly root: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly baseSelect: HTMLSelectElement;
  private readonly fieldContainer: HTMLElement;
  private readonly attributeUpsideContainer: HTMLElement;
  private readonly attributeDownsideContainer: HTMLElement;
  private readonly derivedContainer: HTMLElement;
  private readonly statusNode: HTMLParagraphElement;
  private readonly createButton: HTMLButtonElement;
  private readonly headerTitle: HTMLHeadingElement;
  private currentState: CreatorClientState | null = null;
  private suppressEvents = false;

  public constructor(
    documentRef: Document,
    private readonly options: CreatorPanelOptions
  ) {
    this.root = documentRef.createElement("section");
    this.root.className = "main-ui-panel main-ui-panel-creator";
    this.root.dataset.section = `${options.profileId}`;

    const header = documentRef.createElement("header");
    header.className = "main-ui-heading";
    this.headerTitle = documentRef.createElement("h3");
    this.headerTitle.textContent = options.profileLabel;
    header.append(this.headerTitle);
    this.root.append(header);

    const topControls = documentRef.createElement("div");
    topControls.className = "creator-top-controls";

    this.nameInput = documentRef.createElement("input");
    this.nameInput.type = "text";
    this.nameInput.className = "creator-input";
    this.nameInput.placeholder = "Name";
    this.nameInput.maxLength = 24;
    this.nameInput.addEventListener("change", () => {
      if (this.suppressEvents) return;
      options.onCommand({ setName: true, name: this.nameInput.value });
    });
    this.nameInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      options.onCommand({ setName: true, name: this.nameInput.value });
      this.nameInput.blur();
    });

    this.baseSelect = documentRef.createElement("select");
    this.baseSelect.className = "creator-select";
    this.baseSelect.addEventListener("change", () => {
      if (this.suppressEvents) return;
      const id = parseInt(this.baseSelect.value, 10);
      if (Number.isFinite(id) && id > 0) {
        options.onCommand({ selectBaseBlueprint: true, baseBlueprintId: id });
      }
    });

    topControls.append(
      this.createLabeledControl(documentRef, "Name", this.nameInput),
      this.createLabeledControl(documentRef, "Template", this.baseSelect)
    );
    this.root.append(topControls);

    const body = documentRef.createElement("div");
    body.className = "creator-body";

    const fieldPane = documentRef.createElement("section");
    fieldPane.className = "creator-pane";
    const fieldHeading = documentRef.createElement("h4");
    fieldHeading.textContent = "Fields";
    fieldPane.append(fieldHeading);
    this.fieldContainer = documentRef.createElement("div");
    this.fieldContainer.className = "creator-stat-rows";
    fieldPane.append(this.fieldContainer);
    body.append(fieldPane);

    const attributePane = documentRef.createElement("section");
    attributePane.className = "creator-pane";
    const attributeHeading = documentRef.createElement("h4");
    attributeHeading.textContent = "Attributes";
    attributePane.append(attributeHeading);
    const attributeSections = documentRef.createElement("div");
    attributeSections.className = "creator-trait-sections";

    const upsideSection = documentRef.createElement("section");
    upsideSection.className = "creator-trait-section";
    const upsideHeading = documentRef.createElement("h5");
    upsideHeading.textContent = "Upsides";
    upsideSection.append(upsideHeading);
    this.attributeUpsideContainer = documentRef.createElement("div");
    upsideSection.append(this.attributeUpsideContainer);

    const downsideSection = documentRef.createElement("section");
    downsideSection.className = "creator-trait-section";
    const downsideHeading = documentRef.createElement("h5");
    downsideHeading.textContent = "Downsides";
    downsideSection.append(downsideHeading);
    this.attributeDownsideContainer = documentRef.createElement("div");
    downsideSection.append(this.attributeDownsideContainer);

    attributeSections.append(upsideSection, downsideSection);
    attributePane.append(attributeSections);
    body.append(attributePane);

    const resultsPane = documentRef.createElement("section");
    resultsPane.className = "creator-pane";
    const resultsHeading = documentRef.createElement("h4");
    resultsHeading.textContent = "Results";
    resultsPane.append(resultsHeading);
    this.derivedContainer = documentRef.createElement("ul");
    this.derivedContainer.className = "creator-derived-list";
    resultsPane.append(this.derivedContainer);
    this.statusNode = documentRef.createElement("p");
    this.statusNode.className = "creator-validation";
    resultsPane.append(this.statusNode);
    body.append(resultsPane);

    this.root.append(body);

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
    this.populateBaseSelect();
    this.render();
  }

  private render(): void {
    const state = this.currentState;
    const disabled = state === null;
    this.root.classList.toggle("creator-disabled", disabled);
    this.nameInput.disabled = disabled;
    this.baseSelect.disabled = disabled;
    this.createButton.disabled = disabled;

    this.suppressEvents = true;
    if (!state) {
      this.headerTitle.textContent = this.options.profileLabel;
      this.nameInput.value = "";
      this.fieldContainer.innerHTML = "";
      this.attributeUpsideContainer.innerHTML = "";
      this.attributeDownsideContainer.innerHTML = "";
      this.derivedContainer.innerHTML = "";
      this.statusNode.textContent = "Waiting for creator session...";
      this.suppressEvents = false;
      return;
    }

    this.headerTitle.textContent = this.options.profileLabel;
    this.nameInput.value = state.draft.name;
    this.baseSelect.value = String(state.draft.baseBlueprintId);
    this.renderFieldRows(state);
    this.renderAttributeRows(state);
    this.renderDerivedRows(state);
    this.statusNode.textContent = state.validation.message;
    this.statusNode.classList.toggle("creator-validation-invalid", !state.validation.valid);
    this.suppressEvents = false;
  }

  private renderFieldRows(state: CreatorClientState): void {
    this.fieldContainer.innerHTML = "";
    const baseBlueprint = this.resolveSelectedBlueprint(state);
    if (!baseBlueprint) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.textContent = "Select a template to edit its fields.";
      this.fieldContainer.append(empty);
      return;
    }

    const fieldDefinitions = getCreatorFieldDefinitions(state.draft, baseBlueprint)
      .filter((definition) => definition.groupId !== "attributes");
    if (fieldDefinitions.length === 0) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.textContent = "No editable fields available for this template.";
      this.fieldContainer.append(empty);
      return;
    }

    const groups = new Map<string, CreatorFieldDefinition[]>();
    for (const definition of fieldDefinitions) {
      const group = groups.get(definition.groupId) ?? [];
      group.push(definition);
      groups.set(definition.groupId, group);
    }

    for (const definitions of groups.values()) {
      const heading = this.root.ownerDocument.createElement("h5");
      heading.textContent = definitions[0]?.groupLabel ?? "Fields";
      this.fieldContainer.append(heading);
      for (const definition of definitions) {
        this.fieldContainer.append(this.createFieldRow(definition, state.draft.fieldValues[definition.id]));
      }
    }

    const stats = getCreatorDraftStatValues(state.draft);
    if (Object.keys(stats).length > 0) {
      const budget = this.root.ownerDocument.createElement("p");
      budget.className = "creator-detail";
      budget.textContent =
        `Points: ${state.capacity.statBudgetSpent}/${state.capacity.statBudgetTotal} ` +
        `(${state.capacity.statBudgetRemaining} remaining)`;
      this.fieldContainer.append(budget);
    }
  }

  private renderAttributeRows(state: CreatorClientState): void {
    this.attributeUpsideContainer.innerHTML = "";
    this.attributeDownsideContainer.innerHTML = "";
    const baseBlueprint = this.resolveSelectedBlueprint(state);
    if (!baseBlueprint) {
      return;
    }
    const templateProfile = getBlueprintTemplateProfile(baseBlueprint, state.profileId);
    if (!templateProfile || templateProfile.availableAttributeIds.length === 0) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.textContent = "No attributes available for this template.";
      this.attributeUpsideContainer.append(empty);
      return;
    }

    const selectedAttributes = getCreatorDraftAttributeValues(state.draft);
    const fieldDefinitions = getCreatorFieldDefinitions(state.draft, baseBlueprint)
      .filter((definition) => definition.groupId === "attributes");

    for (const definition of fieldDefinitions) {
      const row = this.createFieldRow(definition, state.draft.fieldValues[definition.id]);
      if (definition.polarity === "downside") {
        this.attributeDownsideContainer.append(row);
      } else {
        this.attributeUpsideContainer.append(row);
      }
    }

    const budget = this.root.ownerDocument.createElement("p");
    budget.className = "creator-detail";
    budget.textContent =
      `Attributes: ${state.capacity.attributeBudget.spent}/${state.capacity.attributeBudget.total} ` +
      `(${state.capacity.attributeBudget.remaining} remaining)`;
    this.attributeUpsideContainer.append(budget);

    const slots = this.root.ownerDocument.createElement("p");
    slots.className = "creator-detail";
    slots.textContent =
      `Upsides: ${state.capacity.attributeSlots.upsideUsed}/${state.capacity.attributeSlots.upsideMax} | ` +
      `Downsides: ${state.capacity.attributeSlots.downsideUsed}/${state.capacity.attributeSlots.downsideMax}`;
    this.attributeDownsideContainer.append(slots);

    if (Object.keys(selectedAttributes).length === 0 && fieldDefinitions.length === 0) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.textContent = "No attributes available for this template.";
      this.attributeUpsideContainer.append(empty);
    }
  }

  private renderDerivedRows(state: CreatorClientState): void {
    this.derivedContainer.innerHTML = "";
    const kind = creatorProfileIdToKind(state.profileId);
    const statValues = getCreatorDraftStatValues(state.draft);
    const selectedAttributes = getCreatorDraftAttributeValues(state.draft);
    const modifiers = collectStatModifiers(selectedAttributes);
    const derived = deriveStats(kind, {}, statValues, modifiers);
    const derivedDefinitions = getDerivedEffectsForKind(kind);

    for (const effect of derivedDefinitions) {
      const value = derived[effect.id];
      if (value === undefined) {
        continue;
      }
      const item = this.root.ownerDocument.createElement("li");
      const label = this.root.ownerDocument.createElement("span");
      label.textContent = effect.label;
      const statValue = this.root.ownerDocument.createElement("span");
      statValue.textContent = Number.isInteger(value) ? String(value) : value.toFixed(2);
      item.append(label, statValue);
      this.derivedContainer.append(item);
    }
    if (this.derivedContainer.childElementCount === 0) {
      const empty = this.root.ownerDocument.createElement("li");
      empty.textContent = "No derived preview available for this profile yet.";
      this.derivedContainer.append(empty);
    }
  }

  private createFieldRow(
    definition: CreatorFieldDefinition,
    rawValue: CreatorFieldValue | undefined
  ): HTMLElement {
    const row = this.root.ownerDocument.createElement("div");
    row.className = "creator-stat-row";

    const label = this.root.ownerDocument.createElement("span");
    label.className = "creator-stat-name";
    label.textContent = definition.label;
    label.title = definition.description;

    row.append(label);

    if (definition.valueKind === "number") {
      const controls = this.root.ownerDocument.createElement("span");
      controls.className = "creator-stat-controls";

      const dec = this.root.ownerDocument.createElement("button");
      dec.type = "button";
      dec.className = "creator-stat-button";
      dec.textContent = "-";
      dec.addEventListener("click", () => {
        this.options.onCommand({ stepField: true, fieldId: definition.id, fieldDelta: -1 });
      });

      const inc = this.root.ownerDocument.createElement("button");
      inc.type = "button";
      inc.className = "creator-stat-button";
      inc.textContent = "+";
      inc.addEventListener("click", () => {
        this.options.onCommand({ stepField: true, fieldId: definition.id, fieldDelta: 1 });
      });

      const statValue = this.root.ownerDocument.createElement("span");
      statValue.className = "creator-stat-value";
      statValue.textContent = String(typeof rawValue === "number" ? rawValue : definition.defaultValue);

      controls.append(dec, inc);
      row.append(controls, statValue);
      return row;
    }

    if (definition.valueKind === "boolean") {
      const checkbox = this.root.ownerDocument.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(rawValue);
      checkbox.addEventListener("change", () => {
        this.options.onCommand({
          setField: true,
          fieldId: definition.id,
          fieldValueJson: JSON.stringify(checkbox.checked)
        });
      });
      row.append(checkbox);
      return row;
    }

    if (definition.valueKind === "enum") {
      const select = this.root.ownerDocument.createElement("select");
      select.className = "creator-select";
      for (const optionDef of definition.options ?? []) {
        const option = this.root.ownerDocument.createElement("option");
        option.value = optionDef.value;
        option.textContent = optionDef.label;
        select.append(option);
      }
      select.value = typeof rawValue === "string"
        ? rawValue
        : typeof definition.defaultValue === "string"
          ? definition.defaultValue
          : "";
      select.addEventListener("change", () => {
        this.options.onCommand({
          setField: true,
          fieldId: definition.id,
          fieldValueJson: JSON.stringify(select.value)
        });
      });
      row.append(select);
      return row;
    }

    const textInput = this.root.ownerDocument.createElement("input");
    textInput.className = "creator-input";
    textInput.type = "text";
    textInput.value = definition.valueKind === "json"
      ? JSON.stringify(rawValue ?? definition.defaultValue)
      : typeof rawValue === "string"
        ? rawValue
        : typeof definition.defaultValue === "string"
          ? definition.defaultValue
          : "";
    textInput.addEventListener("change", () => {
      const nextValueJson = definition.valueKind === "json"
        ? textInput.value
        : JSON.stringify(textInput.value);
      this.options.onCommand({
        setField: true,
        fieldId: definition.id,
        fieldValueJson: nextValueJson
      });
    });
    row.append(textInput);
    return row;
  }

  private populateBaseSelect(): void {
    const doc = this.root.ownerDocument;
    this.baseSelect.innerHTML = "";
    const none = doc.createElement("option");
    none.value = "0";
    none.textContent = "Select template...";
    this.baseSelect.append(none);
    for (const blueprint of this.getAvailableBaseBlueprints()) {
      const option = doc.createElement("option");
      option.value = String(blueprint.id);
      option.textContent = `${blueprint.name} (#${blueprint.id})`;
      this.baseSelect.append(option);
    }
  }

  private getAvailableBaseBlueprints(): readonly BlueprintDefinition[] {
    const stateBlueprints = this.currentState?.availableBlueprints;
    if (stateBlueprints && stateBlueprints.length > 0) {
      return stateBlueprints;
    }
    return this.options.availableBaseBlueprints;
  }

  private resolveSelectedBlueprint(state: CreatorClientState): BlueprintDefinition | null {
    return this.getAvailableBaseBlueprints().find(
      (blueprint) => blueprint.id === state.draft.baseBlueprintId
    ) ?? null;
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
