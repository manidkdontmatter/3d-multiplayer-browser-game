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
  CREATOR_ACTIVATION_APPEARANCE_FIELD_ID,
  CREATOR_READY_APPEARANCE_FIELD_ID,
  creatorProfileIdToLabel,
  creatorProfileIdToKind,
  deriveStats,
  getCreatorDraftAttributeValues,
  getCreatorDraftStatValues,
  resolveActivationAppearanceRuntimeBinding,
  resolveReadyAppearanceRuntimeBinding,
  supportsCreatorActivationAppearance,
  supportsCreatorReadyAppearance,
  getDerivedEffectsForKind,
  getTraitDefinitionById,
  getItemDefinitionById,
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
  submitCreateAndInstantiate?: boolean;
  forkItemInstanceBlueprint?: boolean;
  itemInstanceId?: number;
  inspectActorCapabilities?: boolean;
  setActorCapability?: boolean;
  capabilityKey?: string;
  capabilityValue?: number;
}

export class CreatorPanel {
  private readonly root: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly baseSelect: HTMLSelectElement;
  private readonly tierSelect: HTMLSelectElement;
  private readonly fieldContainer: HTMLElement;
  private readonly attributeUpsideContainer: HTMLElement;
  private readonly attributeDownsideContainer: HTMLElement;
  private readonly augmentContainer: HTMLElement;
  private readonly derivedContainer: HTMLElement;
  private readonly appearancePreviewPane: HTMLElement;
  private readonly readyAppearancePreview: HTMLElement;
  private readonly activationAppearancePreview: HTMLElement;
  private readonly statusNode: HTMLParagraphElement;
  private readonly productionPreviewContainer: HTMLElement;
  private readonly createButton: HTMLButtonElement;
  private readonly headerTitle: HTMLHeadingElement;
  private currentState: CreatorClientState | null = null;
  private openAugmentFieldId: string | null = null;
  private lastAugmentContextKey: string | null = null;
  private suppressEvents = false;
  private readonly onDocumentClick: (event: MouseEvent) => void;
  private readonly onRootKeyDown: (event: KeyboardEvent) => void;
  private destroyed = false;

  public constructor(
    documentRef: Document,
    private readonly options: CreatorPanelOptions
  ) {
    this.root = documentRef.createElement("section");
    this.root.className = "main-ui-panel main-ui-panel-creator";
    this.root.dataset.section = "creator";

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
    this.tierSelect = documentRef.createElement("select");
    this.tierSelect.className = "creator-select";
    this.tierSelect.disabled = true;
    this.tierSelect.addEventListener("change", () => {
      if (this.suppressEvents) return;
      const nextTier = Number.parseInt(this.tierSelect.value, 10);
      if (!Number.isFinite(nextTier) || nextTier <= 0) {
        return;
      }
      this.options.onCommand({
        setField: true,
        fieldId: "tier",
        fieldValueJson: JSON.stringify(Math.floor(nextTier))
      });
    });

    topControls.append(
      this.createLabeledControl(documentRef, "Name", this.nameInput),
      this.createLabeledControl(documentRef, "Template", this.baseSelect),
      this.createLabeledControl(documentRef, "Tier", this.tierSelect)
    );
    this.createButton = documentRef.createElement("button");
    this.createButton.type = "button";
    this.createButton.className = "creator-create";
    this.createButton.textContent = "Create";
    this.createButton.addEventListener("click", () => {
      options.onCommand({ submitCreate: true, submitCreateAndInstantiate: true });
    });
    const createControl = this.createLabeledControl(documentRef, "Create", this.createButton);
    createControl.classList.add("creator-control-action");
    topControls.append(createControl);
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
    this.augmentContainer = documentRef.createElement("div");
    this.augmentContainer.className = "creator-augment-section";
    attributePane.append(this.augmentContainer);
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
    this.productionPreviewContainer = documentRef.createElement("div");
    this.productionPreviewContainer.className = "creator-production-preview";
    resultsPane.append(this.productionPreviewContainer);
    body.append(resultsPane);

    this.appearancePreviewPane = documentRef.createElement("section");
    this.appearancePreviewPane.className = "creator-pane creator-appearance-pane";
    const appearanceHeading = documentRef.createElement("h4");
    appearanceHeading.textContent = "Appearance Preview";
    this.appearancePreviewPane.append(appearanceHeading);
    this.readyAppearancePreview = this.createAppearancePreviewPane(documentRef, "Ready Appearance");
    this.activationAppearancePreview = this.createAppearancePreviewPane(documentRef, "Activation Appearance");
    this.appearancePreviewPane.append(this.readyAppearancePreview, this.activationAppearancePreview);
    body.append(this.appearancePreviewPane);

    this.root.append(body);

    this.onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!this.root.contains(target)) {
        this.closeAugmentPickers();
        return;
      }
      if (target instanceof Element && target.closest(".creator-augment-slot")) {
        return;
      }
      this.closeAugmentPickers();
    };
    documentRef.addEventListener("click", this.onDocumentClick);
    this.onRootKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (!this.openAugmentFieldId) {
        return;
      }
      event.preventDefault();
      this.closeAugmentPickers();
    };
    this.root.addEventListener("keydown", this.onRootKeyDown);

    this.populateBaseSelect();
    this.render();
  }

  public getElement(): HTMLElement {
    return this.root;
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const ownerDocument = this.root.ownerDocument;
    ownerDocument.removeEventListener("click", this.onDocumentClick);
    this.root.removeEventListener("keydown", this.onRootKeyDown);
    this.currentState = null;
    this.openAugmentFieldId = null;
    this.lastAugmentContextKey = null;
    this.root.remove();
  }

  public setState(state: CreatorClientState | null): void {
    if (this.destroyed) {
      return;
    }
    this.currentState = state;
    this.populateBaseSelect();
    this.render();
  }

  private render(): void {
    if (this.destroyed) {
      return;
    }
    const state = this.currentState;
    const disabled = state === null;
    this.root.classList.toggle("creator-disabled", disabled);
    this.nameInput.disabled = disabled;
    this.baseSelect.disabled = disabled;
    this.tierSelect.disabled = disabled;
    this.createButton.disabled = disabled;

    this.suppressEvents = true;
    if (!state) {
      this.closeAugmentPickers();
      this.lastAugmentContextKey = null;
      this.headerTitle.textContent = this.options.profileLabel;
      this.nameInput.value = "";
      this.tierSelect.innerHTML = "";
      this.fieldContainer.innerHTML = "";
      this.attributeUpsideContainer.innerHTML = "";
      this.attributeDownsideContainer.innerHTML = "";
      this.augmentContainer.innerHTML = "";
      this.derivedContainer.innerHTML = "";
      this.renderAppearancePreviews(null);
      this.statusNode.textContent = "Waiting for creator session. Use a station or creator access point.";
      this.productionPreviewContainer.innerHTML = "";
      this.createButton.title = "";
      this.suppressEvents = false;
      return;
    }

    this.headerTitle.textContent = creatorProfileIdToLabel(state.profileId);
    this.nameInput.value = state.draft.name;
    this.baseSelect.value = String(state.draft.baseBlueprintId);
    this.syncTierControl(state);
    this.renderFieldRows(state);
    this.renderAttributeRows(state);
    this.renderDerivedRows(state);
    this.renderAppearancePreviews(state);
    this.renderProductionPreview(state);
    this.statusNode.textContent = state.validation.message;
    this.statusNode.classList.toggle("creator-validation-invalid", !state.validation.valid);
    this.createButton.disabled = !state.validation.valid;
    this.createButton.title = state.validation.valid
      ? "Create blueprint and instantiate."
      : (state.validation.errors[0] ?? state.validation.message);
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

    const selectedTier = this.resolveSelectedTier(state.draft.fieldValues);
    const fieldDefinitions = this.resolveFieldDefinitions(state)
      .filter((definition) => !this.isAugmentFieldHiddenForTier(definition.id, selectedTier))
      .filter((definition) => this.resolveRenderBundle(state).nonAttributeFieldIds.includes(definition.id))
      .filter((definition) => definition.id !== (this.resolveRenderBundle(state).tierFieldId ?? "tier"));
    if (fieldDefinitions.length === 0) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.textContent = "No editable fields available for this template.";
      this.fieldContainer.append(empty);
      return;
    }

    const groups = new Map<string, CreatorFieldDefinition[]>();
    const bundle = this.resolveRenderBundle(state);
    for (const definition of fieldDefinitions) {
      const group = groups.get(definition.groupId) ?? [];
      group.push(definition);
      groups.set(definition.groupId, group);
    }

    const orderedGroupIds = bundle.fieldGroupOrder.length > 0 ? bundle.fieldGroupOrder : Array.from(groups.keys());
    for (const groupId of orderedGroupIds) {
      const definitions = groups.get(groupId) ?? [];
      const visibleDefinitions = definitions.filter((definition) => !this.isAugmentFieldId(definition.id));
      if (visibleDefinitions.length <= 0) {
        continue;
      }
      const heading = this.root.ownerDocument.createElement("h5");
      heading.textContent = bundle.fieldGroupLabels[groupId] ?? visibleDefinitions[0]?.groupLabel ?? "Fields";
      this.fieldContainer.append(heading);
      for (const definition of visibleDefinitions) {
        this.fieldContainer.append(
          this.createFieldRow(
            definition,
            state.draft.fieldValues[definition.id]
          )
        );
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

  private resolveSelectedTier(fieldValues: Record<string, CreatorFieldValue>): number {
    const rawTier = fieldValues.tier;
    const numericTier = typeof rawTier === "number" && Number.isFinite(rawTier)
      ? Math.floor(rawTier)
      : 1;
    return Math.max(1, Math.min(5, numericTier));
  }

  private isAugmentFieldHiddenForTier(fieldId: string, tier: number): boolean {
    if (!fieldId.startsWith("augment_slot_")) {
      return false;
    }
    const suffix = Number.parseInt(fieldId.slice("augment_slot_".length), 10);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return false;
    }
    return suffix > tier;
  }

  private isAugmentFieldId(fieldId: string): boolean {
    return fieldId.startsWith("augment_slot_");
  }

  private renderAugmentSlots(
    state: CreatorClientState,
    baseBlueprint: BlueprintDefinition,
    slotCount: number,
    container: HTMLElement
  ): void {
    const templateProfile = getBlueprintTemplateProfile(baseBlueprint, state.profileId);
    const mappingIds = Object.keys(templateProfile?.augmentMappings ?? {})
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    const safeSlotCount = Math.max(0, slotCount);
    if (safeSlotCount <= 0) {
      return;
    }

    const wrapper = this.root.ownerDocument.createElement("div");
    wrapper.className = "creator-augment-slots";
    wrapper.style.setProperty("--augment-slot-count", String(safeSlotCount));
    if (safeSlotCount <= 5) {
      wrapper.classList.add(`creator-augment-slots-count-${safeSlotCount}`);
    } else {
      wrapper.classList.add("creator-augment-slots-count-generic");
    }

    for (let slotIndex = 1; slotIndex <= safeSlotCount; slotIndex += 1) {
      const fieldId = `augment_slot_${slotIndex}`;
      const rawValue = state.draft.fieldValues[fieldId];
      const selectedAugmentId = typeof rawValue === "number" && Number.isFinite(rawValue)
        ? Math.max(0, Math.floor(rawValue))
        : 0;

      const slot = this.root.ownerDocument.createElement("div");
      slot.className = "creator-augment-slot";
      if (safeSlotCount <= 5) {
        slot.classList.add(`creator-augment-slot-pos-${safeSlotCount}-${slotIndex}`);
      }
      slot.classList.toggle("creator-augment-slot-active", selectedAugmentId > 0);

      const gem = this.root.ownerDocument.createElement("button");
      gem.type = "button";
      gem.className = "creator-augment-gem";
      gem.classList.toggle("creator-augment-gem-active", selectedAugmentId > 0);
      gem.setAttribute("aria-label", `Toggle augment slot ${slotIndex} picker`);
      gem.title = selectedAugmentId > 0
        ? `Augment slot ${slotIndex} is filled.`
        : `Augment slot ${slotIndex} is empty.`;
      slot.append(gem);

      const controlColumn = this.root.ownerDocument.createElement("div");
      controlColumn.className = "creator-augment-control";
      const summaryRow = this.root.ownerDocument.createElement("div");
      summaryRow.className = "creator-augment-summary-row";

      const itemDefinition = selectedAugmentId > 0 ? getItemDefinitionById(selectedAugmentId) : null;
      const summary = this.root.ownerDocument.createElement("button");
      summary.type = "button";
      summary.className = "creator-augment-summary";
      summary.textContent = selectedAugmentId > 0
        ? `Slot ${slotIndex}: ${itemDefinition?.name ?? `Item #${selectedAugmentId}`}`
        : `Slot ${slotIndex}: Pick augment`;
      summary.title = "Choose or clear augment for this slot.";
      summaryRow.append(summary);

      if (selectedAugmentId > 0) {
        const clearButton = this.root.ownerDocument.createElement("button");
        clearButton.type = "button";
        clearButton.className = "creator-augment-clear";
        clearButton.textContent = "Clear";
        clearButton.title = `Clear augment from slot ${slotIndex}.`;
        clearButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.closeAugmentPickers();
          this.options.onCommand({
            setField: true,
            fieldId,
            fieldValueJson: JSON.stringify(0)
          });
        });
        summaryRow.append(clearButton);
      }
      const effects = selectedAugmentId > 0
        ? templateProfile?.augmentMappings?.[selectedAugmentId] ?? []
        : [];
      const effectSummary = this.root.ownerDocument.createElement("p");
      effectSummary.className = "creator-augment-effects";
      if (effects.length <= 0) {
        effectSummary.textContent = selectedAugmentId > 0
          ? "No mapped augment effects."
          : "Select an augment to view effects.";
        effectSummary.title = "";
      } else {
        const visibleLabels = effects
          .slice(0, 3)
          .map((effect) => this.formatAugmentEffectLabel(effect.statId, effect.mode, effect.value));
        const hiddenCount = Math.max(0, effects.length - visibleLabels.length);
        effectSummary.textContent = hiddenCount > 0
          ? `${visibleLabels.join(" | ")} | +${hiddenCount} more`
          : visibleLabels.join(" | ");
        effectSummary.title = effects
          .map((effect) => this.formatAugmentEffectLabel(effect.statId, effect.mode, effect.value))
          .join("\n");
      }

      const picker = this.root.ownerDocument.createElement("div");
      picker.className = "creator-augment-picker";
      picker.id = `creator-augment-picker-${slotIndex}`;
      summary.setAttribute("aria-controls", picker.id);
      gem.setAttribute("aria-controls", picker.id);

      const select = this.root.ownerDocument.createElement("select");
      select.className = "creator-select";
      const noneOption = this.root.ownerDocument.createElement("option");
      noneOption.value = "0";
      noneOption.textContent = `Slot ${slotIndex}: Empty`;
      select.append(noneOption);
      for (const augmentId of mappingIds) {
        const option = this.root.ownerDocument.createElement("option");
        option.value = String(augmentId);
        const itemDefinition = getItemDefinitionById(augmentId);
        option.textContent = itemDefinition ? itemDefinition.name : `Item #${augmentId}`;
        select.append(option);
      }
      if (selectedAugmentId > 0 && !mappingIds.includes(selectedAugmentId)) {
        const unknownOption = this.root.ownerDocument.createElement("option");
        unknownOption.value = String(selectedAugmentId);
        const unknownItem = getItemDefinitionById(selectedAugmentId);
        unknownOption.textContent = unknownItem
          ? `${unknownItem.name} (unmapped)`
          : `Item #${selectedAugmentId} (unmapped)`;
        select.append(unknownOption);
      }
      select.value = String(selectedAugmentId);
      if (this.openAugmentFieldId === fieldId) {
        slot.classList.add("creator-augment-slot-open");
        summary.setAttribute("aria-expanded", "true");
        gem.setAttribute("aria-expanded", "true");
      } else {
        summary.setAttribute("aria-expanded", "false");
        gem.setAttribute("aria-expanded", "false");
      }
      select.addEventListener("change", () => {
        const nextValue = Number.parseInt(select.value, 10);
        this.openAugmentFieldId = fieldId;
        this.options.onCommand({
          setField: true,
          fieldId,
          fieldValueJson: JSON.stringify(Number.isFinite(nextValue) ? Math.max(0, nextValue) : 0)
        });
      });
      select.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        this.closeAugmentPickers();
      });
      picker.append(select);
      controlColumn.append(summaryRow, effectSummary, picker);
      slot.append(controlColumn);

      const togglePicker = () => {
        if (this.openAugmentFieldId === fieldId) {
          this.openAugmentFieldId = null;
        } else {
          this.openAugmentFieldId = fieldId;
        }
        for (const sibling of wrapper.querySelectorAll<HTMLElement>(".creator-augment-slot")) {
          const siblingFieldId = sibling.dataset.augmentFieldId;
          const isOpen = siblingFieldId === this.openAugmentFieldId;
          sibling.classList.toggle("creator-augment-slot-open", isOpen);
          const siblingSummary = sibling.querySelector<HTMLElement>(".creator-augment-summary");
          const siblingGem = sibling.querySelector<HTMLElement>(".creator-augment-gem");
          siblingSummary?.setAttribute("aria-expanded", isOpen ? "true" : "false");
          siblingGem?.setAttribute("aria-expanded", isOpen ? "true" : "false");
          if (isOpen) {
            sibling.querySelector<HTMLSelectElement>(".creator-select")?.focus();
          }
        }
      };
      slot.dataset.augmentFieldId = fieldId;
      gem.addEventListener("click", togglePicker);
      summary.addEventListener("click", togglePicker);
      summary.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        this.closeAugmentPickers();
      });
      wrapper.append(slot);
    }
    if (
      this.openAugmentFieldId &&
      !Array.from(wrapper.querySelectorAll<HTMLElement>(".creator-augment-slot"))
        .some((slot) => slot.dataset.augmentFieldId === this.openAugmentFieldId)
    ) {
      this.openAugmentFieldId = null;
    }
    container.append(wrapper);
  }

  private closeAugmentPickers(): void {
    if (!this.openAugmentFieldId) {
      return;
    }
    this.openAugmentFieldId = null;
    for (const slot of this.root.querySelectorAll<HTMLElement>(".creator-augment-slot")) {
      slot.classList.remove("creator-augment-slot-open");
      slot.querySelector<HTMLElement>(".creator-augment-summary")?.setAttribute("aria-expanded", "false");
      slot.querySelector<HTMLElement>(".creator-augment-gem")?.setAttribute("aria-expanded", "false");
    }
  }

  private formatAugmentEffectLabel(statId: string, mode: "add" | "multiply", value: number): string {
    const stat = statId.trim().length > 0 ? statId.trim() : "stat";
    if (mode === "multiply") {
      const pct = Math.round(value * 100);
      return `${stat} ${pct >= 0 ? "+" : ""}${pct}%`;
    }
    const numeric = Number.isFinite(value) ? value : 0;
    return `${stat} ${numeric >= 0 ? "+" : ""}${numeric}`;
  }

  private renderAttributeRows(state: CreatorClientState): void {
    this.attributeUpsideContainer.innerHTML = "";
    this.attributeDownsideContainer.innerHTML = "";
    this.augmentContainer.innerHTML = "";
    const baseBlueprint = this.resolveSelectedBlueprint(state);
    if (!baseBlueprint) {
      this.closeAugmentPickers();
      this.lastAugmentContextKey = null;
      return;
    }
    const templateProfile = getBlueprintTemplateProfile(baseBlueprint, state.profileId);
    if (!templateProfile || templateProfile.availableAttributeIds.length === 0) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.textContent = "No attributes available for this template.";
      this.attributeUpsideContainer.append(empty);
      return;
    }

    const attributeFieldIds = new Set(this.resolveRenderBundle(state).attributeFieldIds);
    const fieldDefinitions = this.resolveFieldDefinitions(state)
      .filter((definition) => attributeFieldIds.has(definition.id));

    const sharedBudget = this.root.ownerDocument.createElement("p");
    sharedBudget.className = "creator-detail";
    sharedBudget.textContent = `Shared budget: ${state.capacity.attributeBudget.remaining}`;
    this.attributeUpsideContainer.append(sharedBudget);

    const upsideList = this.root.ownerDocument.createElement("div");
    upsideList.className = "creator-attribute-list";
    const downsideList = this.root.ownerDocument.createElement("div");
    downsideList.className = "creator-attribute-list";

    for (const definition of fieldDefinitions) {
      const row = this.createAttributeCard(definition, state);
      if (definition.polarity === "downside") {
        downsideList.append(row);
      } else {
        upsideList.append(row);
      }
    }
    this.attributeUpsideContainer.append(upsideList);
    this.attributeDownsideContainer.append(downsideList);
    if (fieldDefinitions.length === 0) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.textContent = "No attributes available for this template.";
      this.attributeUpsideContainer.append(empty);
    }

    if (state.profileId === "item_creator") {
      const selectedTier = this.resolveSelectedTier(state.draft.fieldValues);
      const augmentFieldIds = this.resolveRenderBundle(state).augmentFieldIds;
      const resolvedAugmentSlotCount = augmentFieldIds
        .map((fieldId) => Number.parseInt(fieldId.slice("augment_slot_".length), 10))
        .filter((slotIndex) => Number.isFinite(slotIndex) && slotIndex > 0 && slotIndex <= selectedTier)
        .length;
      const nextAugmentContextKey = `${state.draft.baseBlueprintId}:${selectedTier}:${resolvedAugmentSlotCount}`;
      if (this.lastAugmentContextKey !== nextAugmentContextKey) {
        this.closeAugmentPickers();
        this.lastAugmentContextKey = nextAugmentContextKey;
      }
      const heading = this.root.ownerDocument.createElement("h5");
      heading.textContent = "Augments";
      this.augmentContainer.append(heading);
      const help = this.root.ownerDocument.createElement("p");
      help.className = "creator-detail";
      help.textContent = "Click a gem or slot label to pick an augment from mapped inventory items.";
      this.augmentContainer.append(help);
      this.renderAugmentSlots(state, baseBlueprint, resolvedAugmentSlotCount, this.augmentContainer);
    } else {
      this.closeAugmentPickers();
      this.lastAugmentContextKey = null;
    }
  }

  private createAttributeCard(definition: CreatorFieldDefinition, state: CreatorClientState): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `creator-trait-card ${definition.polarity === "downside" ? "creator-trait-card-downside" : "creator-trait-card-upside"}`;
    button.title = definition.description;
    button.textContent = definition.label;

    const rawValue = state.draft.fieldValues[definition.id];
    const active = typeof rawValue === "number" && rawValue > 0;
    const trait = getTraitDefinitionById(definition.id.slice("attribute:".length));
    const budgetDelta = Math.abs(trait?.budgetDelta ?? 50);
    const isDownside = definition.polarity === "downside";
    const remaining = state.capacity.attributeBudget.remaining;
    const canEnableUpside = !isDownside && remaining >= budgetDelta;
    const canEnableDownside = isDownside;
    const canDisableDownside = !isDownside || remaining - budgetDelta >= 0;
    let canToggle = false;
    if (active) {
      canToggle = canDisableDownside;
    } else {
      canToggle = canEnableUpside || canEnableDownside;
    }
    button.disabled = !canToggle;
    button.classList.toggle("creator-trait-selected", active);
    button.classList.toggle("creator-trait-selected-downside", active && definition.polarity === "downside");
    button.classList.toggle("creator-trait-selected-upside", active && definition.polarity !== "downside");
    button.addEventListener("click", () => {
      const nextValue = active ? 0 : 1;
      this.options.onCommand({
        setField: true,
        fieldId: definition.id,
        fieldValueJson: JSON.stringify(nextValue)
      });
    });
    return button;
  }

  private resolveFieldDefinitions(state: CreatorClientState): readonly CreatorFieldDefinition[] {
    return Array.isArray(state.fieldDefinitions) ? state.fieldDefinitions : [];
  }

  private resolveRenderBundle(state: CreatorClientState): CreatorClientState["renderBundle"] {
    return state.renderBundle;
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

  private renderProductionPreview(state: CreatorClientState): void {
    this.productionPreviewContainer.innerHTML = "";
    const preview = state.productionPreview;
    if (!preview) {
      return;
    }

    const header = this.root.ownerDocument.createElement("h5");
    header.textContent = "Production Requirements";
    this.productionPreviewContainer.append(header);

    const tier = this.root.ownerDocument.createElement("p");
    tier.className = "creator-detail";
    tier.textContent = `Tier: ${preview.tier} | Station Required: ${preview.requiresStationSession ? "Yes" : "No"}`;
    this.productionPreviewContainer.append(tier);

    const materialsHeading = this.root.ownerDocument.createElement("p");
    materialsHeading.className = "creator-detail";
    materialsHeading.textContent = "Consumable Materials:";
    this.productionPreviewContainer.append(materialsHeading);

    if (preview.consumableCosts.length <= 0) {
      const empty = this.root.ownerDocument.createElement("p");
      empty.className = "creator-detail";
      empty.textContent = "None";
      this.productionPreviewContainer.append(empty);
    } else {
      const list = this.root.ownerDocument.createElement("ul");
      list.className = "creator-derived-list";
      for (const cost of preview.consumableCosts) {
        const item = this.root.ownerDocument.createElement("li");
        const definition = getItemDefinitionById(cost.itemDefinitionId);
        const itemLabel = definition ? `${definition.name} (#${cost.itemDefinitionId})` : `Item #${cost.itemDefinitionId}`;
        item.textContent = `${itemLabel} x${cost.quantity}`;
        item.title = `Consumable material requirement: item ${cost.itemDefinitionId}, quantity ${cost.quantity}.`;
        list.append(item);
      }
      this.productionPreviewContainer.append(list);
    }

    const requiredHeading = this.root.ownerDocument.createElement("p");
    requiredHeading.className = "creator-detail";
    requiredHeading.textContent = "Required Non-Consumed Items:";
    this.productionPreviewContainer.append(requiredHeading);
    if (preview.requiredItemDefinitionIds.length <= 0) {
      const none = this.root.ownerDocument.createElement("p");
      none.className = "creator-detail";
      none.textContent = "None";
      this.productionPreviewContainer.append(none);
    } else {
      const reqList = this.root.ownerDocument.createElement("ul");
      reqList.className = "creator-derived-list";
      for (const id of preview.requiredItemDefinitionIds) {
        const item = this.root.ownerDocument.createElement("li");
        const definition = getItemDefinitionById(id);
        item.textContent = definition ? `${definition.name} (#${id})` : `Item #${id}`;
        item.title = `Required item presence (not consumed): item ${id}.`;
        reqList.append(item);
      }
      this.productionPreviewContainer.append(reqList);
    }

    const actorHeading = this.root.ownerDocument.createElement("p");
    actorHeading.className = "creator-detail";
    actorHeading.textContent = "Actor Requirements:";
    this.productionPreviewContainer.append(actorHeading);
    if (preview.actorRequirements.length <= 0) {
      const none = this.root.ownerDocument.createElement("p");
      none.className = "creator-detail";
      none.textContent = "None";
      this.productionPreviewContainer.append(none);
    } else {
      const actorList = this.root.ownerDocument.createElement("ul");
      actorList.className = "creator-derived-list";
      for (const req of preview.actorRequirements) {
        const item = this.root.ownerDocument.createElement("li");
        item.textContent = `${req.key} >= ${req.minValue}`;
        item.title = `Actor requirement: ${req.key} must be at least ${req.minValue}.`;
        actorList.append(item);
      }
      this.productionPreviewContainer.append(actorList);
    }

    const baseBlueprint = this.resolveSelectedBlueprint(state);
    const templateProfile = baseBlueprint
      ? getBlueprintTemplateProfile(baseBlueprint, state.profileId)
      : null;
    const selectedAugments = preview.selectedAugmentDefinitionIds;
    const augmentMappings = templateProfile?.augmentMappings ?? {};
    const augmentEffectRows: Array<{ augmentId: number; statId: string; mode: "add" | "multiply"; value: number }> = [];
    for (const augmentId of selectedAugments) {
      const effects = augmentMappings[augmentId] ?? [];
      for (const effect of effects) {
        augmentEffectRows.push({
          augmentId,
          statId: effect.statId,
          mode: effect.mode,
          value: effect.value
        });
      }
    }
    const augmentHeading = this.root.ownerDocument.createElement("p");
    augmentHeading.className = "creator-detail";
    augmentHeading.textContent = "Selected Augment Effects:";
    this.productionPreviewContainer.append(augmentHeading);
    if (augmentEffectRows.length <= 0) {
      const none = this.root.ownerDocument.createElement("p");
      none.className = "creator-detail";
      none.textContent = selectedAugments.length > 0
        ? "No mapped effects for selected augments."
        : "None";
      this.productionPreviewContainer.append(none);
    } else {
      const effectList = this.root.ownerDocument.createElement("ul");
      effectList.className = "creator-derived-list";
      for (const effect of augmentEffectRows) {
        const item = this.root.ownerDocument.createElement("li");
        const valueLabel = effect.mode === "multiply"
          ? `${effect.value >= 0 ? "+" : ""}${Math.round(effect.value * 100)}%`
          : `${effect.value >= 0 ? "+" : ""}${effect.value}`;
        const definition = getItemDefinitionById(effect.augmentId);
        const augmentLabel = definition ? `${definition.name} (#${effect.augmentId})` : `Item #${effect.augmentId}`;
        item.textContent = `${augmentLabel}: ${effect.statId} (${effect.mode}) ${valueLabel}`;
        item.title = `Augment effect from item ${effect.augmentId}: ${effect.statId} ${effect.mode} ${valueLabel}.`;
        effectList.append(item);
      }
      this.productionPreviewContainer.append(effectList);
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
      const numericValue = typeof rawValue === "number"
        ? rawValue
        : (typeof definition.defaultValue === "number" ? definition.defaultValue : 0);
      statValue.textContent = String(numericValue);
      const min = typeof definition.min === "number" && Number.isFinite(definition.min) ? definition.min : Number.NEGATIVE_INFINITY;
      const max = typeof definition.max === "number" && Number.isFinite(definition.max) ? definition.max : Number.POSITIVE_INFINITY;
      dec.disabled = numericValue <= min;
      inc.disabled = numericValue >= max;
      const currentState = this.currentState;
      if (currentState && definition.id.startsWith("stat:")) {
        inc.disabled = inc.disabled || currentState.capacity.statBudgetRemaining <= 0;
      }

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
      const enumWrapper = this.root.ownerDocument.createElement("span");
      enumWrapper.className = "creator-enum-field";
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
      enumWrapper.append(select);
      row.append(enumWrapper);
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

  private createAppearancePreviewPane(doc: Document, labelText: string): HTMLElement {
    const pane = doc.createElement("section");
    pane.className = "creator-appearance-preview-pane";
    const label = doc.createElement("h5");
    label.className = "creator-appearance-preview-heading";
    label.textContent = labelText;
    const scene = doc.createElement("div");
    scene.className = "creator-appearance-preview-scene";
    const cube = doc.createElement("div");
    cube.className = "creator-appearance-preview-cube";
    for (let face = 0; face < 6; face += 1) {
      const side = doc.createElement("span");
      side.className = `creator-appearance-preview-face creator-appearance-preview-face-${face + 1}`;
      cube.append(side);
    }
    scene.append(cube);
    const caption = doc.createElement("p");
    caption.className = "creator-appearance-preview-caption";
    caption.textContent = "No appearance selected.";
    pane.append(label, scene, caption);
    return pane;
  }

  private renderAppearancePreviews(state: CreatorClientState | null): void {
    this.applyPreviewPaneState(this.readyAppearancePreview, null, false);
    this.applyPreviewPaneState(this.activationAppearancePreview, null, true);
    if (!state) {
      this.appearancePreviewPane.classList.add("creator-disabled");
      return;
    }
    const baseBlueprint = this.resolveSelectedBlueprint(state);
    if (!baseBlueprint) {
      this.appearancePreviewPane.classList.add("creator-disabled");
      return;
    }
    const definitions = this.resolveFieldDefinitions(state);
    const renderBundle = this.resolveRenderBundle(state);
    const readyFieldId = renderBundle.readyAppearanceFieldId ?? CREATOR_READY_APPEARANCE_FIELD_ID;
    const activationFieldId = renderBundle.activationAppearanceFieldId ?? CREATOR_ACTIVATION_APPEARANCE_FIELD_ID;
    const readyDefinition = definitions.find((definition) => definition.id === readyFieldId);
    const activationDefinition = definitions.find((definition) => definition.id === activationFieldId);
    const readyValue = this.resolveAppearanceValueFromDraft(state.draft.fieldValues[readyFieldId], readyDefinition?.defaultValue);
    const activationValue = this.resolveAppearanceValueFromDraft(
      state.draft.fieldValues[activationFieldId],
      activationDefinition?.defaultValue
    );
    const fallbackReadyValue = readyValue ?? (supportsCreatorReadyAppearance(state.profileId) ? "blue" : null);
    const fallbackActivationValue = activationValue ?? (supportsCreatorActivationAppearance(state.profileId) ? "blue" : null);
    this.applyPreviewPaneState(this.readyAppearancePreview, fallbackReadyValue, false);
    this.applyPreviewPaneState(this.activationAppearancePreview, fallbackActivationValue, true);
    const enabled = Boolean(readyDefinition || activationDefinition);
    this.appearancePreviewPane.classList.toggle("creator-disabled", !enabled);
  }

  private resolveAppearanceValueFromDraft(
    rawValue: CreatorFieldValue | undefined,
    defaultValue: CreatorFieldValue | undefined
  ): string | null {
    if (typeof rawValue === "string" && rawValue.length > 0) {
      return rawValue;
    }
    if (typeof defaultValue === "string" && defaultValue.length > 0) {
      return defaultValue;
    }
    return null;
  }

  private applyPreviewPaneState(target: HTMLElement, appearanceId: string | null, activationMode: boolean): void {
    const scene = target.querySelector<HTMLElement>(".creator-appearance-preview-scene");
    const cube = target.querySelector<HTMLElement>(".creator-appearance-preview-cube");
    const caption = target.querySelector<HTMLElement>(".creator-appearance-preview-caption");
    const activationBinding = resolveActivationAppearanceRuntimeBinding(appearanceId);
    const readyBinding = resolveReadyAppearanceRuntimeBinding(appearanceId);
    const previewTextureUrl = activationMode
      ? activationBinding.previewTextureUrl
      : readyBinding.equipped.previewTextureUrl;
    const tint = activationMode
      ? activationBinding.previewTintColorRgb
      : readyBinding.equipped.tintColorRgb;
    const tintHex = `#${tint.toString(16).padStart(6, "0")}`;
    if (scene) {
      scene.style.setProperty("--creator-appearance-tint", tintHex);
      scene.classList.toggle("creator-appearance-preview-activation", activationMode);
      scene.style.backgroundImage = previewTextureUrl
        ? `url("${previewTextureUrl}")`
        : "";
    }
    if (cube) {
      cube.classList.toggle("creator-appearance-preview-cube-activation", activationMode);
    }
    if (caption) {
      caption.textContent = appearanceId
        ? activationMode
          ? `${appearanceId} (activation) | asset: ${activationBinding.assetId ?? "none"} | preview: ${previewTextureUrl ?? "none"}`
          : `${appearanceId} (ready) | equipped asset: ${readyBinding.equipped.assetId ?? "none"} | pickup asset: ${readyBinding.pickup.assetId ?? "none"} | preview: ${previewTextureUrl ?? "none"}`
        : "No appearance selected.";
    }
  }

  private syncTierControl(state: CreatorClientState): void {
    const baseBlueprint = this.resolveSelectedBlueprint(state);
    this.tierSelect.innerHTML = "";
    this.tierSelect.disabled = true;
    if (!baseBlueprint) {
      return;
    }
    const tierFieldId = this.resolveRenderBundle(state).tierFieldId ?? "tier";
    const tierDefinition = this.resolveFieldDefinitions(state).find(
      (definition) => definition.id === tierFieldId && definition.valueKind === "number"
    );
    if (!tierDefinition) {
      return;
    }
    const min = typeof tierDefinition.min === "number" && Number.isFinite(tierDefinition.min)
      ? Math.floor(tierDefinition.min)
      : 1;
    const max = typeof tierDefinition.max === "number" && Number.isFinite(tierDefinition.max)
      ? Math.floor(tierDefinition.max)
      : 5;
    for (let value = min; value <= max; value += 1) {
      const option = this.root.ownerDocument.createElement("option");
      option.value = String(value);
      option.textContent = `Tier ${value}`;
      this.tierSelect.append(option);
    }
    const rawValue = state.draft.fieldValues.tier;
    const selectedTier = typeof rawValue === "number" && Number.isFinite(rawValue)
      ? Math.floor(rawValue)
      : Number(typeof tierDefinition.defaultValue === "number" ? tierDefinition.defaultValue : min);
    this.tierSelect.value = String(Math.max(min, Math.min(max, selectedTier)));
    this.tierSelect.title = tierDefinition.description;
    this.tierSelect.disabled = false;
  }
}
