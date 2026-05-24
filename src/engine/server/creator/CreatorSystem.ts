/**
 * Purpose: This file defines the "creator system" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import {
  compileBlueprintFromCreatorDraft,
  createDraftFromBlueprint,
  DEFAULT_CREATOR_PROFILE_ID,
  getCreatorFieldDefinitions,
  getCreatorCapacity,
  sanitizeCreatorFieldValue,
  sanitizeCreatorName,
  stepCreatorFieldValue,
  validateCreatorDraft,
  buildCreatorProductionPreview,
  CUSTOM_BLUEPRINT_ID_START,
  getItemDefinitionById,
  getBlueprintRuntimeItemByBlueprintId,
  type BlueprintAccessTag,
  type CreatorDraft,
  type CreatorProfileId,
  type CreatorSessionSnapshot,
  type ItemDefinition
} from "../../shared/index";
import {
  cloneBlueprintDefinition,
  getBlueprintDefinitionById,
  getBlueprintDefinitionsForProfile,
  getBlueprintTemplateProfile,
  type BlueprintDefinition
} from "../../shared/index";

interface CreatorSessionState {
  accountId: number;
  sessionId: number;
  ackSequence: number;
  statusMessage: string;
  stationSessionId: string | null;
  draft: CreatorDraft;
}

interface CreatorCommandPolicy {
  tierMaxOverride: number | null;
  actorRequirementPolicy: "enforce" | "ignore";
}

export interface CreatorApplyResult {
  snapshot: CreatorSessionSnapshot;
  createdBlueprint: BlueprintDefinition | null;
}

export class CreatorSystem {
  private readonly sessionsByUserId = new Map<number, CreatorSessionState>();
  private readonly customizedBlueprintById = new Map<number, BlueprintDefinition>();
  private readonly accessibleBlueprintIdsByAccount = new Map<number, Map<BlueprintAccessTag, Set<number>>>();
  private nextSessionId = 1;
  private nextCustomBlueprintId = CUSTOM_BLUEPRINT_ID_START;

  public initializeSession(
    userId: number,
    accountId: number,
    availableTemplateBlueprintIds: readonly number[],
    defaultProfileId: CreatorProfileId = DEFAULT_CREATOR_PROFILE_ID,
    stationSessionId: string | null = null
  ): CreatorSessionSnapshot {
    this.hydrateAccessibleBlueprintIds(accountId, "blueprint.template", availableTemplateBlueprintIds);
    const session = this.createSessionState(accountId, defaultProfileId, stationSessionId);
    this.ensureSessionHasValidBaseBlueprint(session);
    this.sessionsByUserId.set(userId, session);
    return this.buildSnapshot(session);
  }

  public removeSession(userId: number): void {
    this.sessionsByUserId.delete(userId);
  }

  public synchronizeSessionAvailability(userId: number): CreatorSessionSnapshot | null {
    const session = this.sessionsByUserId.get(userId);
    if (!session) {
      return null;
    }
    this.ensureSessionHasValidBaseBlueprint(session);
    return this.buildSnapshot(session);
  }

  public getSessionStationSessionId(userId: number): string | null {
    return this.sessionsByUserId.get(userId)?.stationSessionId ?? null;
  }

  public getAccessibleBlueprintIds(
    accountId: number,
    accessTag: BlueprintAccessTag
  ): number[] | null {
    const cachedByTag = this.accessibleBlueprintIdsByAccount.get(accountId);
    const cached = cachedByTag?.get(accessTag);
    if (!cached) {
      return null;
    }
    return Array.from(cached).sort((a, b) => a - b);
  }

  public hydrateAccessibleBlueprintIds(
    accountId: number,
    accessTag: BlueprintAccessTag,
    blueprintIds: readonly number[]
  ): void {
    const byTag = this.ensureAccountAccessMap(accountId);
    byTag.set(
      accessTag,
      new Set(blueprintIds.filter((blueprintId) => blueprintId > 0))
    );
  }

  public resolveAccessibleBlueprintIds(
    accountId: number,
    accessTag: BlueprintAccessTag,
    defaultIds: readonly number[]
  ): number[] {
    const cached = this.getAccessibleBlueprintIds(accountId, accessTag);
    if (cached) {
      return cached;
    }
    this.hydrateAccessibleBlueprintIds(accountId, accessTag, defaultIds);
    return this.getAccessibleBlueprintIds(accountId, accessTag) ?? [];
  }

  public grantBlueprintAccess(
    accountId: number,
    accessTag: BlueprintAccessTag,
    blueprintId: number
  ): number[] {
    const byTag = this.ensureAccountAccessMap(accountId);
    let accessSet = byTag.get(accessTag);
    if (!accessSet) {
      accessSet = new Set<number>();
      byTag.set(accessTag, accessSet);
    }
    if (blueprintId > 0) {
      accessSet.add(Math.floor(blueprintId));
    }
    return Array.from(accessSet).sort((a, b) => a - b);
  }

  public revokeBlueprintAccess(
    accountId: number,
    accessTag: BlueprintAccessTag,
    blueprintId: number
  ): number[] {
    const byTag = this.ensureAccountAccessMap(accountId);
    const accessSet = byTag.get(accessTag);
    if (accessSet) {
      accessSet.delete(Math.max(0, Math.floor(blueprintId)));
    }
    return Array.from(accessSet ?? []).sort((a, b) => a - b);
  }

  public registerPersistedBlueprint(blueprint: BlueprintDefinition): void {
    if (getBlueprintDefinitionById(blueprint.id)) {
      return;
    }
    this.customizedBlueprintById.set(blueprint.id, cloneBlueprintDefinition(blueprint));
    this.nextCustomBlueprintId = Math.max(this.nextCustomBlueprintId, blueprint.id + 1);
  }

  public resolveBlueprintDefinitionById(id: number): BlueprintDefinition | null {
    const normalizedId = this.normalizeId(id);
    if (normalizedId <= 0) {
      return null;
    }
    return getBlueprintDefinitionById(normalizedId)
      ?? this.customizedBlueprintById.get(normalizedId)
      ?? null;
  }

  public applyCommand(params: {
    userId: number;
    accountId: number;
    availableTemplateBlueprintIds: readonly number[];
    creatorPolicy?: CreatorCommandPolicy | null;
    deferCreatedBlueprintRegistration?: boolean;
    command: {
      sessionId: number;
      sequence: number;
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
    };
  }): CreatorApplyResult {
    this.hydrateAccessibleBlueprintIds(params.accountId, "blueprint.template", params.availableTemplateBlueprintIds);
    const session =
      this.sessionsByUserId.get(params.userId) ??
      this.createAndStoreSession(params.userId, params.accountId, DEFAULT_CREATOR_PROFILE_ID);
    this.ensureSessionHasValidBaseBlueprint(session);

    const sequence = this.normalizeSequence(params.command.sequence, session.ackSequence);
    const requestedSessionId = this.normalizeSequence(params.command.sessionId, 0);

    if (requestedSessionId !== 0 && requestedSessionId !== session.sessionId) {
      session.statusMessage = "Creator session reset. Waiting for latest state.";
      return {
        snapshot: this.buildSnapshot(session),
        createdBlueprint: null
      };
    }

    if (sequence <= session.ackSequence) {
      return {
        snapshot: this.buildSnapshot(session),
        createdBlueprint: null
      };
    }
    session.ackSequence = sequence;

    let createdBlueprint: BlueprintDefinition | null = null;
    let explicitStatus = false;

    if (params.command.setName) {
      session.draft = { ...session.draft, name: sanitizeCreatorName(params.command.name ?? "") };
    }

    if (params.command.selectBaseBlueprint && params.command.baseBlueprintId) {
      const nextBaseBlueprint = this.resolveBlueprintDefinitionById(params.command.baseBlueprintId);
      if (nextBaseBlueprint && this.isBlueprintAvailableToProfile(session, nextBaseBlueprint)) {
        session.draft = createDraftFromBlueprint(nextBaseBlueprint, session.draft.profileId);
        session.statusMessage = `Selected "${nextBaseBlueprint.name}".`;
        explicitStatus = true;
      }
    }

    const baseBlueprint = this.resolveBlueprintDefinitionById(session.draft.baseBlueprintId);

    if (baseBlueprint && this.isBlueprintAvailableToProfile(session, baseBlueprint)) {
      const fieldDefinitions = new Map(
        getCreatorFieldDefinitions(session.draft, baseBlueprint).map((definition) => [
          definition.id,
          definition
        ])
      );

      if (params.command.stepField && params.command.fieldId) {
        const definition = fieldDefinitions.get(params.command.fieldId);
        if (definition) {
          const nextFieldValues = { ...session.draft.fieldValues };
          nextFieldValues[definition.id] = stepCreatorFieldValue(
            definition,
            nextFieldValues[definition.id],
            params.command.fieldDelta ?? 0
          );
          session.draft = { ...session.draft, fieldValues: nextFieldValues };
        }
      }

      if (params.command.setField && params.command.fieldId && params.command.fieldValueJson !== undefined) {
        const definition = fieldDefinitions.get(params.command.fieldId);
        if (definition) {
          try {
            const parsed = JSON.parse(params.command.fieldValueJson);
            const nextFieldValues = { ...session.draft.fieldValues };
            nextFieldValues[definition.id] = sanitizeCreatorFieldValue(definition, parsed);
            session.draft = { ...session.draft, fieldValues: nextFieldValues };
          } catch {
            session.statusMessage = `Field "${params.command.fieldId}" rejected malformed value.`;
            explicitStatus = true;
          }
        }
      }
    }

    if (params.command.submitCreate && baseBlueprint && this.isBlueprintAvailableToProfile(session, baseBlueprint)) {
      const policyAdjustedDraft = this.applyCreatorPolicyToDraft(session.draft, params.creatorPolicy ?? null);
      session.draft = policyAdjustedDraft;
      const validation = validateCreatorDraft(
        policyAdjustedDraft,
        baseBlueprint,
        this.resolveAvailableBlueprintsForProfile(session.accountId, session.draft.profileId).length
      );
      if (!validation.valid) {
        session.statusMessage = validation.message;
        explicitStatus = true;
      } else {
        const created = compileBlueprintFromCreatorDraft({
          nextId: this.allocateBlueprintId(),
          draft: policyAdjustedDraft,
          baseBlueprint
        });
        if (params.creatorPolicy?.actorRequirementPolicy === "ignore" && created.blueprint.templateProfiles) {
          const templateProfiles = { ...created.blueprint.templateProfiles };
          const itemProfile = templateProfiles.item_creator;
          if (itemProfile?.productionContract) {
            templateProfiles.item_creator = {
              ...itemProfile,
              productionContract: {
                ...itemProfile.productionContract,
                actorRequirements: []
              }
            };
            created.blueprint = cloneBlueprintDefinition(created.blueprint, { templateProfiles });
          }
        }
        if (!params.deferCreatedBlueprintRegistration) {
          this.customizedBlueprintById.set(created.blueprint.id, created.blueprint);
        }
        createdBlueprint = created.blueprint;
        session.statusMessage = `Created "${created.blueprint.name}".`;
        explicitStatus = true;
      }
    }

    if (!explicitStatus) {
      const validation = baseBlueprint && this.isBlueprintAvailableToProfile(session, baseBlueprint)
        ? validateCreatorDraft(
            session.draft,
            baseBlueprint,
            this.resolveAvailableBlueprintsForProfile(session.accountId, session.draft.profileId).length
          )
        : { valid: false, message: "Select a base blueprint first.", errors: [] };
      session.statusMessage = validation.message;
    }

    return {
      snapshot: this.buildSnapshot(session),
      createdBlueprint
    };
  }

  public overrideSessionStatus(userId: number, message: string): void {
    const session = this.sessionsByUserId.get(userId);
    if (!session) {
      return;
    }
    session.statusMessage = message.trim().length > 0 ? message : session.statusMessage;
  }

  public createDerivedBlueprintFromExisting(params: {
    sourceBlueprint: BlueprintDefinition;
    name: string;
    authoredViaProfile: CreatorProfileId;
    derivedFromInstanceId?: number;
  }): BlueprintDefinition {
    const nextId = this.allocateBlueprintId();
    const created = cloneBlueprintDefinition(params.sourceBlueprint, {
      id: nextId,
      key: `custom-${nextId}`,
      name: sanitizeCreatorName(params.name),
      description: `${sanitizeCreatorName(params.name)} | profile: ${params.authoredViaProfile}`,
      metadata: {
        authoredViaProfile: params.authoredViaProfile,
        derivedFromBlueprintId: params.sourceBlueprint.id,
        derivedFromInstanceId: params.derivedFromInstanceId
      }
    });
    this.customizedBlueprintById.set(created.id, created);
    return created;
  }

  private allocateBlueprintId(): number {
    while (this.nextCustomBlueprintId <= 0xffff) {
      const candidate = this.nextCustomBlueprintId++;
      if (!this.customizedBlueprintById.has(candidate) && !getBlueprintDefinitionById(candidate)) {
        return candidate;
      }
    }
    throw new Error("No more blueprint ids are available.");
  }

  private createAndStoreSession(
    userId: number,
    accountId: number,
    profileId: CreatorProfileId
  ): CreatorSessionState {
    const session = this.createSessionState(accountId, profileId, null);
    this.sessionsByUserId.set(userId, session);
    return session;
  }

  private createSessionState(
    accountId: number,
    profileId: CreatorProfileId,
    stationSessionId: string | null
  ): CreatorSessionState {
    return {
      accountId,
      sessionId: this.nextSessionId++,
      ackSequence: 0,
      statusMessage: "Select a base blueprint to begin.",
      stationSessionId: typeof stationSessionId === "string" && stationSessionId.length > 0 ? stationSessionId : null,
      draft: {
        name: "New Creation",
        profileId,
        baseBlueprintId: 0,
        fieldValues: {}
      }
    };
  }

  private ensureSessionHasValidBaseBlueprint(session: CreatorSessionState): void {
    const availableBlueprints = this.resolveAvailableBlueprintsForProfile(
      session.accountId,
      session.draft.profileId
    );
    if (availableBlueprints.length <= 0) {
      return;
    }
    const currentBase = this.resolveBlueprintDefinitionById(session.draft.baseBlueprintId);
    if (currentBase && this.isBlueprintAvailableToProfile(session, currentBase)) {
      return;
    }
    const fallbackBase = availableBlueprints[0] ?? null;
    if (!fallbackBase) {
      return;
    }
    session.draft = createDraftFromBlueprint(fallbackBase, session.draft.profileId);
    session.statusMessage = `Selected "${fallbackBase.name}".`;
  }

  private buildSnapshot(session: CreatorSessionState): CreatorSessionSnapshot {
    const baseBlueprint = this.resolveBlueprintDefinitionById(session.draft.baseBlueprintId);
    const availableBlueprints = this.resolveAvailableBlueprintsForProfile(
      session.accountId,
      session.draft.profileId
    );
    const capacity = baseBlueprint && this.isBlueprintAvailableToProfile(session, baseBlueprint)
      ? getCreatorCapacity(session.draft, baseBlueprint)
      : {
          statBudgetTotal: 0,
          statBudgetSpent: 0,
          statBudgetRemaining: 0,
          attributeBudget: { total: 0, spent: 0, remaining: 0 },
          attributeSlots: { upsideUsed: 0, downsideUsed: 0, upsideMax: 0, downsideMax: 0 }
        };
    const validation = baseBlueprint && this.isBlueprintAvailableToProfile(session, baseBlueprint)
      ? validateCreatorDraft(session.draft, baseBlueprint, availableBlueprints.length)
      : { valid: false, message: "Select a base blueprint first.", errors: ["No base blueprint"] };
    const fieldDefinitions = baseBlueprint && this.isBlueprintAvailableToProfile(session, baseBlueprint)
      ? getCreatorFieldDefinitions(session.draft, baseBlueprint)
      : [];
    const renderBundle = this.buildRenderBundle(fieldDefinitions);
    const productionPreview = baseBlueprint && this.isBlueprintAvailableToProfile(session, baseBlueprint)
      ? buildCreatorProductionPreview(session.draft, baseBlueprint)
      : null;
    const itemDescriptors = this.resolveSnapshotItemDescriptors(baseBlueprint, session.draft.profileId, productionPreview);
    return {
      sessionId: session.sessionId,
      ackSequence: session.ackSequence,
      profileId: session.draft.profileId,
      stationSessionId: session.stationSessionId,
      draft: session.draft,
      fieldDefinitions,
      renderBundle,
      capacity,
      validation: {
        valid: validation.valid,
        message: session.statusMessage || validation.message,
        errors: validation.errors
      },
      productionPreview,
      itemDescriptors,
      availableBlueprintCount: availableBlueprints.length,
      availableBlueprints
    };
  }

  private resolveSnapshotItemDescriptors(
    baseBlueprint: BlueprintDefinition | null,
    profileId: CreatorProfileId,
    productionPreview: {
      consumableCosts: readonly { itemDefinitionId: number; quantity: number }[];
      requiredItemDefinitionIds: readonly number[];
      selectedAugmentDefinitionIds: readonly number[];
    } | null
  ): ItemDefinition[] {
    const ids = new Set<number>();
    for (const cost of productionPreview?.consumableCosts ?? []) {
      if (cost.itemDefinitionId > 0) ids.add(cost.itemDefinitionId);
    }
    for (const requiredId of productionPreview?.requiredItemDefinitionIds ?? []) {
      if (requiredId > 0) ids.add(requiredId);
    }
    for (const augmentId of productionPreview?.selectedAugmentDefinitionIds ?? []) {
      if (augmentId > 0) ids.add(augmentId);
    }
    const templateProfile = baseBlueprint ? getBlueprintTemplateProfile(baseBlueprint, profileId) : null;
    for (const augmentIdRaw of Object.keys(templateProfile?.augmentMappings ?? {})) {
      const augmentId = Number.parseInt(augmentIdRaw, 10);
      if (Number.isFinite(augmentId) && augmentId > 0) {
        ids.add(augmentId);
      }
    }
    const descriptors: ItemDefinition[] = [];
    for (const definitionId of ids) {
      const definition = getItemDefinitionById(definitionId) ?? getBlueprintRuntimeItemByBlueprintId(definitionId);
      if (definition) {
        descriptors.push(definition);
      }
    }
    descriptors.sort((a, b) => a.id - b.id);
    return descriptors;
  }

  private buildRenderBundle(
    fieldDefinitions: readonly {
      id: string;
      groupId: string;
      groupLabel: string;
    }[]
  ): {
    fieldGroupOrder: readonly string[];
    fieldGroupLabels: Readonly<Record<string, string>>;
    nonAttributeFieldIds: readonly string[];
    attributeFieldIds: readonly string[];
    augmentFieldIds: readonly string[];
    tierFieldId: string | null;
    readyAppearanceFieldId: string | null;
    activationAppearanceFieldId: string | null;
  } {
    const fieldGroupOrder: string[] = [];
    const fieldGroupLabels: Record<string, string> = {};
    const nonAttributeFieldIds: string[] = [];
    const attributeFieldIds: string[] = [];
    const augmentFieldIds: string[] = [];
    let tierFieldId: string | null = null;
    let readyAppearanceFieldId: string | null = null;
    let activationAppearanceFieldId: string | null = null;
    for (const definition of fieldDefinitions) {
      if (!fieldGroupLabels[definition.groupId]) {
        fieldGroupOrder.push(definition.groupId);
        fieldGroupLabels[definition.groupId] = definition.groupLabel;
      }
      if (definition.id === "tier") {
        tierFieldId = definition.id;
      }
      if (definition.id === "ready_appearance") {
        readyAppearanceFieldId = definition.id;
      }
      if (definition.id === "activation_appearance") {
        activationAppearanceFieldId = definition.id;
      }
      if (definition.id.startsWith("augment_slot_")) {
        augmentFieldIds.push(definition.id);
      }
      if (definition.groupId === "attributes") {
        attributeFieldIds.push(definition.id);
      } else {
        nonAttributeFieldIds.push(definition.id);
      }
    }
    return {
      fieldGroupOrder,
      fieldGroupLabels,
      nonAttributeFieldIds,
      attributeFieldIds,
      augmentFieldIds,
      tierFieldId,
      readyAppearanceFieldId,
      activationAppearanceFieldId
    };
  }

  private resolveAvailableBlueprintsForProfile(
    accountId: number,
    profileId: CreatorProfileId
  ): BlueprintDefinition[] {
    const accessibleIds = this.getAccessibleBlueprintIds(accountId, "blueprint.template") ?? [];
    const allowedIds = new Set(accessibleIds);
    const available: BlueprintDefinition[] = [];
    for (const blueprint of getBlueprintDefinitionsForProfile(profileId)) {
      if (allowedIds.has(blueprint.id)) {
        available.push(blueprint);
      }
    }
    for (const blueprintId of accessibleIds) {
      const blueprint = this.customizedBlueprintById.get(blueprintId);
      if (!blueprint) {
        continue;
      }
      if (!getBlueprintTemplateProfile(blueprint, profileId)) {
        continue;
      }
      available.push(cloneBlueprintDefinition(blueprint));
    }
    available.sort((left, right) => left.id - right.id);
    return available;
  }

  private isBlueprintAvailableToProfile(
    session: CreatorSessionState,
    blueprint: BlueprintDefinition
  ): boolean {
    const accessibleIds = this.getAccessibleBlueprintIds(session.accountId, "blueprint.template") ?? [];
    return accessibleIds.includes(blueprint.id) && Boolean(getBlueprintTemplateProfile(blueprint, session.draft.profileId));
  }

  private ensureAccountAccessMap(accountId: number): Map<BlueprintAccessTag, Set<number>> {
    let byTag = this.accessibleBlueprintIdsByAccount.get(accountId);
    if (!byTag) {
      byTag = new Map<BlueprintAccessTag, Set<number>>();
      this.accessibleBlueprintIdsByAccount.set(accountId, byTag);
    }
    return byTag;
  }

  private normalizeSequence(raw: number, fallback: number): number {
    if (!Number.isFinite(raw)) {
      return Math.max(0, Math.floor(fallback));
    }
    return Math.max(0, Math.min(0xffff, Math.floor(raw)));
  }

  private normalizeId(raw: number): number {
    if (!Number.isFinite(raw)) {
      return 0;
    }
    return Math.max(0, Math.min(0xffff, Math.floor(raw)));
  }

  private applyCreatorPolicyToDraft(
    draft: CreatorDraft,
    policy: CreatorCommandPolicy | null
  ): CreatorDraft {
    if (!policy || draft.profileId !== "item_creator") {
      return draft;
    }
    if (!Number.isFinite(policy.tierMaxOverride) || (policy.tierMaxOverride ?? 0) <= 0) {
      return draft;
    }
    const tierLimit = Math.max(1, Math.floor(policy.tierMaxOverride as number));
    const currentRaw = draft.fieldValues?.tier;
    if (typeof currentRaw !== "number" || !Number.isFinite(currentRaw)) {
      return draft;
    }
    const currentTier = Math.max(1, Math.floor(currentRaw));
    if (currentTier <= tierLimit) {
      return draft;
    }
    return {
      ...draft,
      fieldValues: {
        ...draft.fieldValues,
        tier: tierLimit
      }
    };
  }
}
