/**
 * Purpose: This file keeps module state organized and queryable in memory.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { NType, type CreatorStateMessageWire, type CreatorStatePayload } from "../../../shared/netcode";
import type {
  BlueprintDefinition,
  CreatorDraft,
  CreatorFieldDefinition,
  CreatorRenderBundle,
  CreatorCapacity,
  CreatorProfileId,
  CreatorValidation,
  CreatorProductionPreview,
  ItemDefinition
} from "../../../shared/index";
import { isCreatorProfileId, upsertItemDefinition } from "../../../shared/index";

export interface CreatorClientState {
  sessionId: number;
  ackSequence: number;
  profileId: CreatorProfileId;
  stationSessionId: string | null;
  draft: CreatorDraft;
  fieldDefinitions: readonly CreatorFieldDefinition[];
  renderBundle: CreatorRenderBundle;
  capacity: CreatorCapacity;
  validation: CreatorValidation;
  productionPreview: CreatorProductionPreview | null;
  availableBlueprintCount: number;
  availableBlueprints: readonly BlueprintDefinition[];
}

export class CreatorStateStore {
  private currentState: CreatorClientState | null = null;
  private pendingState: CreatorClientState | null = null;

  public reset(): void {
    this.currentState = null;
    this.pendingState = null;
  }

  public processMessage(message: unknown): boolean {
    const typed = message as CreatorStateMessageWire | undefined;
    if (typed?.ntype !== NType.CreatorStateMessage) return false;
    if (typeof typed.version !== "number" || !Number.isFinite(typed.version) || Math.floor(typed.version) !== 1) {
      return true;
    }

    try {
      const payload = JSON.parse(typed.stateJson) as CreatorStatePayload;
      const nextState = this.toState(payload);
      if (!nextState) return true;
      this.currentState = nextState;
      this.pendingState = nextState;
    } catch {
      // Malformed JSON — ignore
    }
    return true;
  }

  public consumeState(): CreatorClientState | null {
    const pending = this.pendingState;
    this.pendingState = null;
    return pending;
  }

  public getCurrentSessionId(): number {
    return this.currentState?.sessionId ?? 0;
  }

  public getLatestState(): CreatorClientState | null {
    return this.currentState;
  }

  private toState(payload: CreatorStatePayload): CreatorClientState | null {
    if (!payload || typeof payload !== "object") return null;
    try {
      const previous = this.currentState;
      const draft = JSON.parse(payload.draftJson) as CreatorDraft;
      const fieldDefinitions = payload.fieldDefinitionsJson && payload.fieldDefinitionsJson.length > 0
        ? (JSON.parse(payload.fieldDefinitionsJson) as CreatorFieldDefinition[])
        : (previous?.fieldDefinitions ?? []);
      const renderBundle = payload.renderBundleJson && payload.renderBundleJson.length > 0
        ? (JSON.parse(payload.renderBundleJson) as CreatorRenderBundle)
        : (previous?.renderBundle ?? {
            fieldGroupOrder: [],
            fieldGroupLabels: {},
            nonAttributeFieldIds: [],
            attributeFieldIds: [],
            augmentFieldIds: [],
            tierFieldId: null,
            readyAppearanceFieldId: null,
            activationAppearanceFieldId: null
          });
      const capacity = JSON.parse(payload.capacityJson) as CreatorCapacity;
      const validation = JSON.parse(payload.validationJson) as CreatorValidation;
      const productionPreview = payload.productionPreviewJson
        ? (JSON.parse(payload.productionPreviewJson) as CreatorProductionPreview | null)
        : null;
      const itemDescriptors = payload.itemDescriptorsJson && payload.itemDescriptorsJson.length > 0
        ? (JSON.parse(payload.itemDescriptorsJson) as ItemDefinition[])
        : [];
      const availableBlueprints = payload.availableBlueprintsJson && payload.availableBlueprintsJson.length > 0
        ? (JSON.parse(payload.availableBlueprintsJson) as BlueprintDefinition[])
        : (previous?.availableBlueprints ?? []);
      for (const descriptor of Array.isArray(itemDescriptors) ? itemDescriptors : []) {
        upsertItemDefinition(descriptor);
      }
      return {
        sessionId: this.clampInt(payload.sessionId, 0xffff),
        ackSequence: this.clampInt(payload.ackSequence, 0xffff),
        profileId: this.parseProfileId(payload.profileId),
        stationSessionId:
          typeof payload.stationSessionId === "string" && payload.stationSessionId.trim().length > 0
            ? payload.stationSessionId.trim()
            : null,
        draft,
        fieldDefinitions: Array.isArray(fieldDefinitions) ? fieldDefinitions : [],
        renderBundle: renderBundle && typeof renderBundle === "object"
          ? renderBundle
          : {
              fieldGroupOrder: [],
              fieldGroupLabels: {},
              nonAttributeFieldIds: [],
              attributeFieldIds: [],
              augmentFieldIds: [],
              tierFieldId: null,
              readyAppearanceFieldId: null,
              activationAppearanceFieldId: null
            },
        capacity,
        validation,
        productionPreview,
        availableBlueprintCount: this.clampInt(payload.availableBlueprintCount, 0xffff),
        availableBlueprints: Array.isArray(availableBlueprints) ? availableBlueprints : []
      };
    } catch {
      return null;
    }
  }

  private parseProfileId(raw: unknown): CreatorProfileId {
    if (isCreatorProfileId(raw)) {
      return raw;
    }
    return "ability_creator";
  }

  private clampInt(raw: number, max: number): number {
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(max, Math.floor(raw)));
  }
}
