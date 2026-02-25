// Renders and controls the authoritative full-screen Ability Creator panel in the main UI shell.
import {
  ABILITY_CREATOR_EXAMPLE_DOWNSIDE_DESCRIPTION,
  ABILITY_CREATOR_EXAMPLE_DOWNSIDE_NAME,
  ABILITY_CREATOR_EXAMPLE_UPSIDE_DESCRIPTION,
  ABILITY_CREATOR_EXAMPLE_UPSIDE_NAME,
  ABILITY_CREATOR_TYPE_OPTIONS,
  abilityCategoryToWireValue,
  abilityCreatorTypeToCategory,
  type AbilityCreatorType,
  type AbilityDefinition
} from "../../shared/index";
import type { AbilityCreatorState } from "../runtime/network/types";

export interface AbilityCreatorCommandInput {
  applyName?: boolean;
  abilityName?: string;
  applyType?: boolean;
  abilityType?: number;
  applyTier?: boolean;
  tier?: number;
  incrementExampleStat?: boolean;
  decrementExampleStat?: boolean;
  applyExampleUpsideEnabled?: boolean;
  exampleUpsideEnabled?: boolean;
  applyExampleDownsideEnabled?: boolean;
  exampleDownsideEnabled?: boolean;
  applyTemplateAbilityId?: boolean;
  templateAbilityId?: number;
  submitCreate?: boolean;
}

export interface AbilityCreatorPanelOptions {
  onCommand: (command: AbilityCreatorCommandInput) => void;
  resolveAbilityById: (abilityId: number) => AbilityDefinition | null;
}

export class AbilityCreatorPanel {
  private readonly root: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly typeSelect: HTMLSelectElement;
  private readonly tierSelect: HTMLSelectElement;
  private readonly templateSelect: HTMLSelectElement;
  private readonly coreStatValue: HTMLSpanElement;
  private readonly pointsRemainingNode: HTMLParagraphElement;
  private readonly decrementButton: HTMLButtonElement;
  private readonly incrementButton: HTMLButtonElement;
  private readonly availableSlotsNode: HTMLParagraphElement;
  private readonly exampleUpsideButton: HTMLButtonElement;
  private readonly exampleDownsideButton: HTMLButtonElement;
  private readonly statusNode: HTMLParagraphElement;
  private readonly derivedPowerNode: HTMLSpanElement;
  private readonly derivedStabilityNode: HTMLSpanElement;
  private readonly derivedComplexityNode: HTMLSpanElement;
  private readonly createButton: HTMLButtonElement;
  private readonly ownedAbilityIds = new Set<number>();
  private currentState: AbilityCreatorState | null = null;
  private suppressControlEvents = false;

  public constructor(documentRef: Document, private readonly options: AbilityCreatorPanelOptions) {
    this.root = documentRef.createElement("section");
    this.root.className = "main-ui-panel main-ui-panel-ability-creator";
    this.root.dataset.section = "ability-creator";

    const header = documentRef.createElement("header");
    header.className = "main-ui-heading";
    const title = documentRef.createElement("h3");
    title.textContent = "Ability Creator";
    const subtitle = documentRef.createElement("p");
    subtitle.textContent = "Description Pending";
    header.append(title, subtitle);
    this.root.append(header);

    const topControls = documentRef.createElement("div");
    topControls.className = "ability-creator-top-controls";

    this.nameInput = documentRef.createElement("input");
    this.nameInput.type = "text";
    this.nameInput.className = "ability-creator-input";
    this.nameInput.placeholder = "Ability Name";
    this.nameInput.maxLength = 24;
    this.nameInput.addEventListener("change", () => {
      options.onCommand({
        applyName: true,
        abilityName: this.nameInput.value
      });
    });
    this.nameInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      options.onCommand({
        applyName: true,
        abilityName: this.nameInput.value
      });
      this.nameInput.blur();
    });

    this.typeSelect = documentRef.createElement("select");
    this.typeSelect.className = "ability-creator-select";
    for (const type of ABILITY_CREATOR_TYPE_OPTIONS) {
      const option = documentRef.createElement("option");
      option.value = type;
      option.textContent = this.toCreatorTypeLabel(type);
      this.typeSelect.append(option);
    }
    this.typeSelect.addEventListener("change", () => {
      if (this.suppressControlEvents) {
        return;
      }
      const selectedType = this.parseCreatorType(this.typeSelect.value);
      if (!selectedType) {
        return;
      }
      options.onCommand({
        applyType: true,
        abilityType: abilityCategoryToWireValue(abilityCreatorTypeToCategory(selectedType))
      });
    });

    this.tierSelect = documentRef.createElement("select");
    this.tierSelect.className = "ability-creator-select";
    this.tierSelect.addEventListener("change", () => {
      if (this.suppressControlEvents) {
        return;
      }
      const parsedTier = Number.parseInt(this.tierSelect.value, 10);
      if (!Number.isFinite(parsedTier)) {
        return;
      }
      options.onCommand({
        applyTier: true,
        tier: parsedTier
      });
    });

    this.templateSelect = documentRef.createElement("select");
    this.templateSelect.className = "ability-creator-select";
    this.templateSelect.addEventListener("change", () => {
      if (this.suppressControlEvents) {
        return;
      }
      const parsedAbilityId = Number.parseInt(this.templateSelect.value, 10);
      options.onCommand({
        applyTemplateAbilityId: true,
        templateAbilityId: Number.isFinite(parsedAbilityId) ? parsedAbilityId : 0
      });
    });

    topControls.append(
      this.createLabeledControl(documentRef, "Name", this.nameInput),
      this.createLabeledControl(documentRef, "Type", this.typeSelect),
      this.createLabeledControl(documentRef, "Tier", this.tierSelect),
      this.createLabeledControl(documentRef, "Modify Existing Ability", this.templateSelect)
    );
    this.root.append(topControls);

    const body = documentRef.createElement("div");
    body.className = "ability-creator-body";

    const corePane = documentRef.createElement("section");
    corePane.className = "ability-creator-pane";
    const coreHeading = documentRef.createElement("h4");
    coreHeading.textContent = "Stat Point Allocation";
    corePane.append(coreHeading);
    this.pointsRemainingNode = documentRef.createElement("p");
    this.pointsRemainingNode.className = "ability-creator-detail";
    corePane.append(this.pointsRemainingNode);
    const coreStatRow = documentRef.createElement("div");
    coreStatRow.className = "ability-creator-core-row";
    const coreStatName = documentRef.createElement("span");
    coreStatName.className = "ability-creator-core-name";
    coreStatName.textContent = "Example Stat";
    const coreControls = documentRef.createElement("span");
    coreControls.className = "ability-creator-core-controls";
    this.decrementButton = documentRef.createElement("button");
    this.decrementButton.type = "button";
    this.decrementButton.className = "ability-creator-core-button";
    this.decrementButton.textContent = "-";
    this.decrementButton.addEventListener("click", () => {
      options.onCommand({ decrementExampleStat: true });
    });
    this.incrementButton = documentRef.createElement("button");
    this.incrementButton.type = "button";
    this.incrementButton.className = "ability-creator-core-button";
    this.incrementButton.textContent = "+";
    this.incrementButton.addEventListener("click", () => {
      options.onCommand({ incrementExampleStat: true });
    });
    this.coreStatValue = documentRef.createElement("span");
    this.coreStatValue.className = "ability-creator-core-value";
    this.coreStatValue.textContent = "0";
    coreControls.append(this.decrementButton, this.incrementButton);
    coreStatRow.append(coreStatName, coreControls, this.coreStatValue);
    corePane.append(coreStatRow);

    const attributePane = documentRef.createElement("section");
    attributePane.className = "ability-creator-pane";
    const attributeHeading = documentRef.createElement("h4");
    attributeHeading.textContent = "Attributes";
    attributePane.append(attributeHeading);
    this.availableSlotsNode = documentRef.createElement("p");
    this.availableSlotsNode.className = "ability-creator-detail";
    attributePane.append(this.availableSlotsNode);
    const attributeSections = documentRef.createElement("div");
    attributeSections.className = "ability-creator-attribute-sections";

    const upsideSection = documentRef.createElement("section");
    upsideSection.className = "ability-creator-attribute-section";
    const upsideHeading = documentRef.createElement("h5");
    upsideHeading.textContent = "Upsides";
    upsideSection.append(upsideHeading);

    this.exampleUpsideButton = this.createAttributeCard(
      documentRef,
      ABILITY_CREATOR_EXAMPLE_UPSIDE_NAME,
      ABILITY_CREATOR_EXAMPLE_UPSIDE_DESCRIPTION,
      "upside",
      () => {
        options.onCommand({
          applyExampleUpsideEnabled: true,
          exampleUpsideEnabled: !(this.currentState?.exampleUpsideEnabled ?? false)
        });
      }
    );
    upsideSection.append(this.exampleUpsideButton);

    const downsideSection = documentRef.createElement("section");
    downsideSection.className = "ability-creator-attribute-section";
    const downsideHeading = documentRef.createElement("h5");
    downsideHeading.textContent = "Downsides";
    downsideSection.append(downsideHeading);
    this.exampleDownsideButton = this.createAttributeCard(
      documentRef,
      ABILITY_CREATOR_EXAMPLE_DOWNSIDE_NAME,
      ABILITY_CREATOR_EXAMPLE_DOWNSIDE_DESCRIPTION,
      "downside",
      () => {
        options.onCommand({
          applyExampleDownsideEnabled: true,
          exampleDownsideEnabled: !(this.currentState?.exampleDownsideEnabled ?? false)
        });
      }
    );
    downsideSection.append(this.exampleDownsideButton);
    attributeSections.append(upsideSection, downsideSection);
    attributePane.append(attributeSections);

    const derivedPane = documentRef.createElement("section");
    derivedPane.className = "ability-creator-pane";
    const derivedHeading = documentRef.createElement("h4");
    derivedHeading.textContent = "Ability Results";
    derivedPane.append(derivedHeading);
    const derivedList = documentRef.createElement("ul");
    derivedList.className = "ability-creator-derived-list";
    this.derivedPowerNode = this.createDerivedValueNode(documentRef, derivedList, "Example Power");
    this.derivedStabilityNode = this.createDerivedValueNode(documentRef, derivedList, "Example Stability");
    this.derivedComplexityNode = this.createDerivedValueNode(documentRef, derivedList, "Example Complexity");
    derivedPane.append(derivedList);
    this.statusNode = documentRef.createElement("p");
    this.statusNode.className = "ability-creator-validation";
    derivedPane.append(this.statusNode);

    body.append(corePane, attributePane, derivedPane);
    this.root.append(body);

    const footer = documentRef.createElement("div");
    footer.className = "ability-creator-footer";
    this.createButton = documentRef.createElement("button");
    this.createButton.type = "button";
    this.createButton.className = "ability-creator-create";
    this.createButton.textContent = "Create Ability";
    this.createButton.addEventListener("click", () => {
      options.onCommand({ submitCreate: true });
    });
    footer.append(this.createButton);
    this.root.append(footer);

    this.render();
  }

  public getElement(): HTMLElement {
    return this.root;
  }

  public setOwnedAbilityIds(abilityIds: ReadonlyArray<number>): void {
    this.ownedAbilityIds.clear();
    for (const abilityId of abilityIds) {
      const normalized = Number.isFinite(abilityId) ? Math.max(0, Math.floor(abilityId)) : 0;
      if (normalized <= 0) {
        continue;
      }
      this.ownedAbilityIds.add(normalized);
    }
    this.renderTemplateOptions();
  }

  public setState(state: AbilityCreatorState | null): void {
    this.currentState = state;
    this.render();
  }

  private createLabeledControl(
    documentRef: Document,
    label: string,
    control: HTMLInputElement | HTMLSelectElement
  ): HTMLElement {
    const wrapper = documentRef.createElement("label");
    wrapper.className = "ability-creator-control";
    const text = documentRef.createElement("span");
    text.className = "ability-creator-control-label";
    text.textContent = label;
    wrapper.append(text, control);
    return wrapper;
  }

  private createDerivedValueNode(
    documentRef: Document,
    list: HTMLUListElement,
    label: string
  ): HTMLSpanElement {
    const item = documentRef.createElement("li");
    const itemLabel = documentRef.createElement("span");
    itemLabel.textContent = label;
    const itemValue = documentRef.createElement("span");
    itemValue.textContent = "0";
    item.append(itemLabel, itemValue);
    list.append(item);
    return itemValue;
  }

  private createAttributeCard(
    documentRef: Document,
    label: string,
    tooltip: string,
    variant: "upside" | "downside",
    onToggle: () => void
  ): HTMLButtonElement {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = `ability-creator-attribute-card ability-creator-attribute-card-${variant}`;
    button.title = tooltip;
    const title = documentRef.createElement("span");
    title.className = "ability-creator-attribute-name";
    title.textContent = label;
    button.append(title);
    button.addEventListener("click", onToggle);
    return button;
  }

  private render(): void {
    const state = this.currentState;
    const disabled = state === null;
    this.root.classList.toggle("ability-creator-disabled", disabled);

    this.nameInput.disabled = disabled;
    this.typeSelect.disabled = disabled;
    this.tierSelect.disabled = disabled;
    this.templateSelect.disabled = disabled;
    this.decrementButton.disabled = disabled;
    this.incrementButton.disabled = disabled;
    this.exampleUpsideButton.disabled = disabled;
    this.exampleDownsideButton.disabled = disabled;
    this.createButton.disabled = disabled;

    this.suppressControlEvents = true;
    if (!state) {
      this.nameInput.value = "";
      this.coreStatValue.textContent = "0";
      this.pointsRemainingNode.textContent = "Waiting for creator session...";
      this.availableSlotsNode.textContent = "";
      this.exampleUpsideButton.classList.remove("ability-creator-attribute-selected");
      this.exampleDownsideButton.classList.remove("ability-creator-attribute-selected");
      this.derivedPowerNode.textContent = "0";
      this.derivedStabilityNode.textContent = "0";
      this.derivedComplexityNode.textContent = "0";
      this.statusNode.textContent = "Server has not sent creator state yet.";
      this.renderTierOptions(1, 1);
      this.renderTypeSelection("projectile");
      this.renderTemplateOptions();
      this.suppressControlEvents = false;
      return;
    }

    this.nameInput.value = state.abilityName;
    this.coreStatValue.textContent = String(state.coreExampleStat);
    this.pointsRemainingNode.textContent = `Points Remaining: ${state.remainingPoints}`;
    const availableUpsideSlots = Math.max(0, state.upsideSlots - state.usedUpsideSlots);
    const availableDownsideSlots = Math.max(0, state.downsideMax - state.usedDownsideSlots);
    this.availableSlotsNode.textContent = `Available Slots: ${availableUpsideSlots}`;
    this.exampleUpsideButton.classList.toggle("ability-creator-attribute-selected", state.exampleUpsideEnabled);
    this.exampleDownsideButton.classList.toggle("ability-creator-attribute-selected", state.exampleDownsideEnabled);
    this.exampleUpsideButton.disabled = !state.exampleUpsideEnabled && availableUpsideSlots <= 0;
    this.exampleDownsideButton.disabled = !state.exampleDownsideEnabled && availableDownsideSlots <= 0;
    this.derivedPowerNode.textContent = state.derivedExamplePower.toFixed(1);
    this.derivedStabilityNode.textContent = state.derivedExampleStability.toFixed(1);
    this.derivedComplexityNode.textContent = state.derivedExampleComplexity.toFixed(1);
    this.statusNode.textContent = state.validationMessage;
    this.statusNode.classList.toggle("ability-creator-validation-invalid", !state.isValid);

    this.renderTierOptions(state.maxCreatorTier, state.selectedTier);
    this.renderTypeSelection(state.selectedType);
    this.renderTemplateOptions();
    this.templateSelect.value = String(state.templateAbilityId);
    this.suppressControlEvents = false;
  }

  private renderTierOptions(maxTier: number, selectedTier: number): void {
    this.tierSelect.innerHTML = "";
    const documentRef = this.root.ownerDocument;
    const normalizedMaxTier = Math.max(1, Math.floor(Number.isFinite(maxTier) ? maxTier : 1));
    for (let tier = 1; tier <= normalizedMaxTier; tier += 1) {
      const option = documentRef.createElement("option");
      option.value = String(tier);
      option.textContent = `Tier ${tier}`;
      this.tierSelect.append(option);
    }
    this.tierSelect.value = String(Math.max(1, Math.min(normalizedMaxTier, Math.floor(selectedTier))));
  }

  private renderTypeSelection(selectedType: AbilityCreatorType): void {
    this.typeSelect.value = selectedType;
  }

  private renderTemplateOptions(): void {
    const documentRef = this.root.ownerDocument;
    const selectedTemplate = this.currentState?.templateAbilityId ?? 0;
    this.templateSelect.innerHTML = "";
    const noneOption = documentRef.createElement("option");
    noneOption.value = "0";
    noneOption.textContent = "New Ability";
    this.templateSelect.append(noneOption);

    const sortedOwnedIds = Array.from(this.ownedAbilityIds.values()).sort((a, b) => a - b);
    for (const abilityId of sortedOwnedIds) {
      const ability = this.options.resolveAbilityById(abilityId);
      if (!ability) {
        continue;
      }
      const option = documentRef.createElement("option");
      option.value = String(abilityId);
      option.textContent = `${ability.name} (#${abilityId})`;
      this.templateSelect.append(option);
    }
    this.templateSelect.value = String(selectedTemplate > 0 ? selectedTemplate : 0);
  }

  private parseCreatorType(rawType: string): AbilityCreatorType | null {
    if (rawType === "melee") {
      return rawType;
    }
    if (rawType === "projectile") {
      return rawType;
    }
    if (rawType === "beam") {
      return rawType;
    }
    if (rawType === "aoe") {
      return rawType;
    }
    if (rawType === "buff") {
      return rawType;
    }
    if (rawType === "movement") {
      return rawType;
    }
    return null;
  }

  private toCreatorTypeLabel(type: AbilityCreatorType): string {
    if (type === "aoe") {
      return "Area Of Effect";
    }
    return `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`;
  }
}
