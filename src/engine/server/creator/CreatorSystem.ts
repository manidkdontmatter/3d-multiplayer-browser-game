// Server-authoritative creator-profile system for universal blueprints.
// Creator profiles constrain editing, while blueprint storage and character access
// are kept global and generic.
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
  CUSTOM_BLUEPRINT_ID_START,
  type BlueprintAccessTag,
  type CreatorDraft,
  type CreatorProfileId,
  type CreatorSessionSnapshot
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
  draft: CreatorDraft;
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
    defaultProfileId: CreatorProfileId = DEFAULT_CREATOR_PROFILE_ID
  ): CreatorSessionSnapshot {
    this.hydrateAccessibleBlueprintIds(accountId, "blueprint.template", availableTemplateBlueprintIds);
    const session = this.createSessionState(accountId, defaultProfileId);
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
    return this.buildSnapshot(session);
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
      const validation = validateCreatorDraft(
        session.draft,
        baseBlueprint,
        this.resolveAvailableBlueprintsForProfile(session.accountId, session.draft.profileId).length
      );
      if (!validation.valid) {
        session.statusMessage = validation.message;
        explicitStatus = true;
      } else {
        const created = compileBlueprintFromCreatorDraft({
          nextId: this.allocateBlueprintId(),
          draft: session.draft,
          baseBlueprint
        });
        this.customizedBlueprintById.set(created.blueprint.id, created.blueprint);
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
    const session = this.createSessionState(accountId, profileId);
    this.sessionsByUserId.set(userId, session);
    return session;
  }

  private createSessionState(accountId: number, profileId: CreatorProfileId): CreatorSessionState {
    return {
      accountId,
      sessionId: this.nextSessionId++,
      ackSequence: 0,
      statusMessage: "Select a base blueprint to begin.",
      draft: {
        name: "New Creation",
        profileId,
        baseBlueprintId: 0,
        fieldValues: {}
      }
    };
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
    return {
      sessionId: session.sessionId,
      ackSequence: session.ackSequence,
      profileId: session.draft.profileId,
      draft: session.draft,
      capacity,
      validation: {
        valid: validation.valid,
        message: session.statusMessage || validation.message,
        errors: validation.errors
      },
      availableBlueprintCount: availableBlueprints.length,
      availableBlueprints
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
}
