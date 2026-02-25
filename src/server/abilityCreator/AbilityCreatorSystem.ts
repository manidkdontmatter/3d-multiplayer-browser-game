// Owns authoritative ability-creator sessions, dynamic ability catalog, and create/edit persistence integration.
import {
  ABILITY_CREATOR_EXAMPLE_DOWNSIDE_KEY,
  ABILITY_CREATOR_EXAMPLE_UPSIDE_KEY,
  ABILITY_CREATOR_MAX_ABILITIES,
  ABILITY_CREATOR_MAX_TIER,
  ABILITY_CREATOR_MIN_TIER,
  abilityCategoryFromWireValue,
  abilityCategoryToCreatorType,
  abilityCreatorTypeToCategory,
  computeAbilityCreatorDerivedStats,
  getAbilityCreatorCapacity,
  getAbilityDefinitionById,
  sanitizeAbilityCreatorName,
  sanitizeCreatorCoreExampleStat,
  sanitizeCreatorTier,
  validateAbilityCreatorDraft,
  type AbilityCreatorDraft,
  type AbilityCreatorSessionSnapshot,
  type AbilityCreatorType,
  type AbilityDefinition
} from "../../shared/index";
import type { AbilityCreatorCommand as AbilityCreatorWireCommand } from "../../shared/netcode";
import {
  GUEST_ACCOUNT_ID_BASE,
  type CreateOwnedAbilityRequest,
  type ForgetOwnedAbilityResult,
  type PersistedAbilityDefinitionRecord,
  type PersistenceService
} from "../persistence/PersistenceService";

interface AbilityCreatorSessionState {
  sessionId: number;
  maxCreatorTier: number;
  ackSequence: number;
  statusMessage: string;
  draft: AbilityCreatorDraft;
}

export interface AbilityCreatorApplyResult {
  snapshot: AbilityCreatorSessionSnapshot;
  createdAbility: AbilityDefinition | null;
  replacedAbilityId: number | null;
  nextOwnedAbilityIds: number[] | null;
}

export type AbilityForgetResult =
  | {
      ok: true;
      forgottenAbilityId: number;
      nextOwnedAbilityIds: number[];
    }
  | {
      ok: false;
      error: string;
    };

export class AbilityCreatorSystem {
  private readonly sessionsByUserId = new Map<number, AbilityCreatorSessionState>();
  private readonly dynamicDefinitionsById = new Map<number, AbilityDefinition>();
  private readonly guestOwnedAbilityIdsByAccountId = new Map<number, Set<number>>();
  private readonly guestDefinitionsById = new Map<number, AbilityDefinition>();
  private nextSessionId = 1;
  private nextGuestAbilityId = 60000;

  public constructor(private readonly persistence: PersistenceService) {}

  public resolveOwnedAbilityIds(accountId: number, defaultAbilityIds: ReadonlyArray<number>): number[] {
    if (accountId >= GUEST_ACCOUNT_ID_BASE) {
      return this.resolveGuestOwnedAbilityIds(accountId, defaultAbilityIds);
    }

    const ownedAbilityIds = this.persistence.loadOwnedAbilityIds(accountId, defaultAbilityIds);
    const dynamicRows = this.persistence.loadOwnedDynamicAbilityDefinitions(accountId);
    for (const row of dynamicRows) {
      this.dynamicDefinitionsById.set(row.abilityId, this.hydratePersistedDefinition(row));
    }
    return ownedAbilityIds;
  }

  public resolveAbilityDefinitionById(abilityId: number): AbilityDefinition | null {
    const normalizedAbilityId =
      Number.isFinite(abilityId) && abilityId > 0 ? Math.floor(abilityId) : 0;
    if (normalizedAbilityId <= 0) {
      return null;
    }
    return (
      getAbilityDefinitionById(normalizedAbilityId) ??
      this.dynamicDefinitionsById.get(normalizedAbilityId) ??
      this.guestDefinitionsById.get(normalizedAbilityId) ??
      null
    );
  }

  public initializeUserSession(
    userId: number,
    ownedAbilityIds: ReadonlyArray<number>
  ): AbilityCreatorSessionSnapshot {
    const session = this.createSessionState();
    this.sessionsByUserId.set(userId, session);
    return this.buildSessionSnapshot(session, ownedAbilityIds.length);
  }

  public removeUserSession(userId: number): void {
    this.sessionsByUserId.delete(userId);
  }

  public synchronizeSessionOwnedAbilities(
    userId: number,
    ownedAbilityIds: ReadonlyArray<number>
  ): AbilityCreatorSessionSnapshot | null {
    const session = this.sessionsByUserId.get(userId);
    if (!session) {
      return null;
    }
    const ownedSet = new Set<number>(
      ownedAbilityIds
        .map((abilityId) => this.normalizeAbilityId(abilityId))
        .filter((abilityId) => abilityId > 0)
    );
    const templateAbilityId = this.normalizeAbilityId(session.draft.templateAbilityId);
    if (templateAbilityId > 0 && !ownedSet.has(templateAbilityId)) {
      session.draft.templateAbilityId = 0;
      session.statusMessage = "Selected ability is no longer owned.";
    }
    return this.buildSessionSnapshot(session, ownedSet.size);
  }

  public forgetOwnedAbility(params: {
    accountId: number;
    ownedAbilityIds: ReadonlyArray<number>;
    abilityId: number;
  }): AbilityForgetResult {
    const normalizedAbilityId = this.normalizeAbilityId(params.abilityId);
    if (normalizedAbilityId <= 0) {
      return {
        ok: false,
        error: "Invalid ability id."
      };
    }

    const ownedSet = new Set<number>(
      params.ownedAbilityIds
        .map((abilityId) => this.normalizeAbilityId(abilityId))
        .filter((abilityId) => abilityId > 0)
    );
    if (!ownedSet.has(normalizedAbilityId)) {
      return {
        ok: false,
        error: "Ability is not owned by this player."
      };
    }

    if (params.accountId >= GUEST_ACCOUNT_ID_BASE) {
      return this.tryForgetGuestAbility(params.accountId, normalizedAbilityId);
    }

    const forgetResult: ForgetOwnedAbilityResult = this.persistence.forgetOwnedAbility({
      accountId: params.accountId,
      abilityId: normalizedAbilityId
    });
    if (!forgetResult.ok) {
      return {
        ok: false,
        error: forgetResult.error
      };
    }
    return {
      ok: true,
      forgottenAbilityId: normalizedAbilityId,
      nextOwnedAbilityIds: forgetResult.ownedAbilityIds
    };
  }

  public applyCommand(params: {
    userId: number;
    accountId: number;
    ownedAbilityIds: ReadonlyArray<number>;
    command: Partial<AbilityCreatorWireCommand>;
  }): AbilityCreatorApplyResult {
    const session =
      this.sessionsByUserId.get(params.userId) ??
      this.createAndStoreSession(params.userId);
    const ownedAbilitySet = new Set<number>(params.ownedAbilityIds);
    const sequence = this.normalizeSequence(params.command.sequence, session.ackSequence);
    const requestedSessionId = this.normalizeSequence(params.command.sessionId, 0);
    if (requestedSessionId !== 0 && requestedSessionId !== session.sessionId) {
      session.statusMessage = "Creator session was reset. Waiting for latest state.";
      return {
        snapshot: this.buildSessionSnapshot(session, ownedAbilitySet.size),
        createdAbility: null,
        replacedAbilityId: null,
        nextOwnedAbilityIds: null
      };
    }
    if (sequence <= session.ackSequence) {
      return {
        snapshot: this.buildSessionSnapshot(session, ownedAbilitySet.size),
        createdAbility: null,
        replacedAbilityId: null,
        nextOwnedAbilityIds: null
      };
    }
    session.ackSequence = sequence;

    let createdAbility: AbilityDefinition | null = null;
    let replacedAbilityId: number | null = null;
    let nextOwnedAbilityIds: number[] | null = null;
    let explicitStatusMessageSet = false;

    if (params.command.applyName) {
      session.draft.name = sanitizeAbilityCreatorName(params.command.abilityName ?? "");
    }
    if (params.command.applyType) {
      const wireType = abilityCategoryFromWireValue(
        Number.isFinite(params.command.abilityType) ? Number(params.command.abilityType) : 0
      );
      const creatorType = wireType ? abilityCategoryToCreatorType(wireType) : null;
      if (creatorType) {
        session.draft.type = creatorType;
      }
    }
    if (params.command.applyTier) {
      session.draft.tier = sanitizeCreatorTier(
        Number(params.command.tier ?? session.draft.tier),
        session.maxCreatorTier
      );
      const capacityAfterTierChange = getAbilityCreatorCapacity(session.draft);
      if (session.draft.coreExampleStat > capacityAfterTierChange.totalPointBudget) {
        session.draft.coreExampleStat = capacityAfterTierChange.totalPointBudget;
      }
    }
    if (params.command.incrementExampleStat) {
      const capacity = getAbilityCreatorCapacity(session.draft);
      if (capacity.spentPoints < capacity.totalPointBudget) {
        session.draft.coreExampleStat = sanitizeCreatorCoreExampleStat(session.draft.coreExampleStat + 1);
      }
    }
    if (params.command.decrementExampleStat) {
      session.draft.coreExampleStat = sanitizeCreatorCoreExampleStat(session.draft.coreExampleStat - 1);
    }
    if (params.command.applyExampleUpsideEnabled) {
      const requestedEnabled = Boolean(params.command.exampleUpsideEnabled);
      if (!requestedEnabled) {
        session.draft.exampleUpsideEnabled = false;
      } else {
        const capacity = getAbilityCreatorCapacity(session.draft);
        if (capacity.usedUpsideSlots < capacity.upsideSlots) {
          session.draft.exampleUpsideEnabled = true;
        } else {
          session.statusMessage = "No upside attribute slots available.";
          explicitStatusMessageSet = true;
        }
      }
    }
    if (params.command.applyExampleDownsideEnabled) {
      const requestedEnabled = Boolean(params.command.exampleDownsideEnabled);
      if (!requestedEnabled) {
        session.draft.exampleDownsideEnabled = false;
      } else {
        const capacity = getAbilityCreatorCapacity(session.draft);
        if (capacity.usedDownsideSlots < capacity.downsideMax) {
          session.draft.exampleDownsideEnabled = true;
        } else {
          session.statusMessage = "No downside attribute slots available.";
          explicitStatusMessageSet = true;
        }
      }
    }
    if (params.command.applyTemplateAbilityId) {
      const templateAbilityId = this.normalizeAbilityId(params.command.templateAbilityId);
      if (templateAbilityId === 0) {
        session.draft.templateAbilityId = 0;
      } else if (ownedAbilitySet.has(templateAbilityId)) {
        const templateAbility = this.resolveAbilityDefinitionById(templateAbilityId);
        if (templateAbility) {
          session.draft = this.buildDraftFromTemplate(
            templateAbility,
            templateAbilityId,
            session.maxCreatorTier
          );
          session.statusMessage = "Template loaded.";
          explicitStatusMessageSet = true;
        } else {
          session.statusMessage = "Template ability definition is unavailable.";
          explicitStatusMessageSet = true;
        }
      } else {
        session.statusMessage = "Template ability must be one of your owned abilities.";
        explicitStatusMessageSet = true;
      }
    }

    if (params.command.submitCreate) {
      const createOutcome = this.tryCreateAbility({
        accountId: params.accountId,
        draft: session.draft,
        ownedAbilityIds: ownedAbilitySet
      });
      if (!createOutcome.ok) {
        session.statusMessage = createOutcome.error;
        explicitStatusMessageSet = true;
      } else {
        createdAbility = createOutcome.ability;
        replacedAbilityId = createOutcome.replacedAbilityId;
        nextOwnedAbilityIds = createOutcome.nextOwnedAbilityIds;
        session.draft.templateAbilityId = 0;
        session.statusMessage = `Created ability "${createdAbility.name}".`;
        explicitStatusMessageSet = true;
      }
    }

    const validation = validateAbilityCreatorDraft(session.draft, session.maxCreatorTier);
    if (!params.command.submitCreate && !explicitStatusMessageSet) {
      session.statusMessage = validation.message;
    }

    return {
      snapshot: this.buildSessionSnapshot(
        session,
        nextOwnedAbilityIds?.length ?? ownedAbilitySet.size
      ),
      createdAbility,
      replacedAbilityId,
      nextOwnedAbilityIds
    };
  }

  private createAndStoreSession(userId: number): AbilityCreatorSessionState {
    const created = this.createSessionState();
    this.sessionsByUserId.set(userId, created);
    return created;
  }

  private createSessionState(): AbilityCreatorSessionState {
    return {
      sessionId: this.nextSessionId++,
      maxCreatorTier: ABILITY_CREATOR_MAX_TIER,
      ackSequence: 0,
      statusMessage: "Ready to create ability.",
      draft: {
        name: "New Ability",
        type: "projectile",
        tier: ABILITY_CREATOR_MIN_TIER,
        coreExampleStat: 0,
        exampleUpsideEnabled: false,
        exampleDownsideEnabled: false,
        templateAbilityId: 0
      }
    };
  }

  private buildSessionSnapshot(
    session: AbilityCreatorSessionState,
    ownedAbilityCount: number
  ): AbilityCreatorSessionSnapshot {
    const normalizedDraft: AbilityCreatorDraft = {
      ...session.draft,
      name: sanitizeAbilityCreatorName(session.draft.name),
      tier: sanitizeCreatorTier(session.draft.tier, session.maxCreatorTier),
      coreExampleStat: sanitizeCreatorCoreExampleStat(session.draft.coreExampleStat),
      templateAbilityId: this.normalizeAbilityId(session.draft.templateAbilityId)
    };
    const validation = validateAbilityCreatorDraft(normalizedDraft, session.maxCreatorTier);
    const abilityCountValidation =
      normalizedDraft.templateAbilityId === 0 && ownedAbilityCount >= ABILITY_CREATOR_MAX_ABILITIES
        ? {
            valid: false,
            message: `Ability limit reached (${ABILITY_CREATOR_MAX_ABILITIES}/${ABILITY_CREATOR_MAX_ABILITIES}).`
          }
        : validation;
    const capacity = getAbilityCreatorCapacity(normalizedDraft);
    return {
      sessionId: session.sessionId,
      ackSequence: session.ackSequence,
      maxCreatorTier: session.maxCreatorTier,
      draft: normalizedDraft,
      capacity,
      derived: computeAbilityCreatorDerivedStats(normalizedDraft),
      validation: {
        valid: abilityCountValidation.valid,
        message: session.statusMessage || abilityCountValidation.message
      },
      ownedAbilityCount: Math.max(0, Math.floor(ownedAbilityCount))
    };
  }

  private buildDraftFromTemplate(
    template: AbilityDefinition,
    templateAbilityId: number,
    maxCreatorTier: number
  ): AbilityCreatorDraft {
    const creatorType =
      template.creator?.type ??
      abilityCategoryToCreatorType(template.category) ??
      "projectile";
    const tier = sanitizeCreatorTier(template.creator?.tier ?? 1, maxCreatorTier);
    const coreExampleStat = Math.max(
      0,
      sanitizeCreatorCoreExampleStat(template.creator?.coreExampleStat ?? template.points.power)
    );
    const exampleUpsideEnabled =
      template.creator?.exampleUpsideEnabled ??
      template.attributes.includes(ABILITY_CREATOR_EXAMPLE_UPSIDE_KEY);
    const exampleDownsideEnabled =
      template.creator?.exampleDownsideEnabled ??
      template.attributes.includes(ABILITY_CREATOR_EXAMPLE_DOWNSIDE_KEY);
    const capacity = getAbilityCreatorCapacity({
      tier,
      coreExampleStat,
      exampleUpsideEnabled: Boolean(exampleUpsideEnabled),
      exampleDownsideEnabled: Boolean(exampleDownsideEnabled)
    });
    return {
      name: sanitizeAbilityCreatorName(template.name),
      type: creatorType,
      tier,
      coreExampleStat: Math.min(capacity.totalPointBudget, coreExampleStat),
      exampleUpsideEnabled: Boolean(exampleUpsideEnabled),
      exampleDownsideEnabled: Boolean(exampleDownsideEnabled),
      templateAbilityId
    };
  }

  private tryCreateAbility(params: {
    accountId: number;
    draft: AbilityCreatorDraft;
    ownedAbilityIds: Set<number>;
  }):
    | {
        ok: true;
        ability: AbilityDefinition;
        replacedAbilityId: number | null;
        nextOwnedAbilityIds: number[];
      }
    | { ok: false; error: string } {
    const validation = validateAbilityCreatorDraft(params.draft, ABILITY_CREATOR_MAX_TIER);
    if (!validation.valid) {
      return { ok: false, error: validation.message };
    }

    const templateAbilityId = this.normalizeAbilityId(params.draft.templateAbilityId);
    if (templateAbilityId > 0 && !params.ownedAbilityIds.has(templateAbilityId)) {
      return { ok: false, error: "Selected template ability is no longer owned." };
    }
    if (templateAbilityId === 0 && params.ownedAbilityIds.size >= ABILITY_CREATOR_MAX_ABILITIES) {
      return {
        ok: false,
        error: `Ability limit reached (${ABILITY_CREATOR_MAX_ABILITIES}/${ABILITY_CREATOR_MAX_ABILITIES}).`
      };
    }

    if (params.accountId >= GUEST_ACCOUNT_ID_BASE) {
      return this.tryCreateGuestAbility(params.accountId, params.draft, templateAbilityId);
    }

    const request: CreateOwnedAbilityRequest = {
      accountId: params.accountId,
      name: sanitizeAbilityCreatorName(params.draft.name),
      type: params.draft.type,
      tier: sanitizeCreatorTier(params.draft.tier, ABILITY_CREATOR_MAX_TIER),
      coreExampleStat: sanitizeCreatorCoreExampleStat(params.draft.coreExampleStat),
      exampleUpsideEnabled: Boolean(params.draft.exampleUpsideEnabled),
      exampleDownsideEnabled: Boolean(params.draft.exampleDownsideEnabled),
      templateAbilityId: templateAbilityId > 0 ? templateAbilityId : null,
      maxAbilities: ABILITY_CREATOR_MAX_ABILITIES
    };
    const createResult = this.persistence.createOwnedAbility(request);
    if (!createResult.ok) {
      return { ok: false, error: createResult.error };
    }
    const ability = this.hydratePersistedDefinition(createResult.ability);
    this.dynamicDefinitionsById.set(ability.id, ability);
    return {
      ok: true,
      ability,
      replacedAbilityId: createResult.replacedAbilityId,
      nextOwnedAbilityIds: createResult.ownedAbilityIds
    };
  }

  private tryCreateGuestAbility(
    accountId: number,
    draft: AbilityCreatorDraft,
    templateAbilityId: number
  ):
    | {
        ok: true;
        ability: AbilityDefinition;
        replacedAbilityId: number | null;
        nextOwnedAbilityIds: number[];
      }
    | { ok: false; error: string } {
    const guestOwned = this.guestOwnedAbilityIdsByAccountId.get(accountId);
    if (!guestOwned) {
      return { ok: false, error: "Guest ability ownership state is unavailable." };
    }

    if (templateAbilityId === 0 && guestOwned.size >= ABILITY_CREATOR_MAX_ABILITIES) {
      return {
        ok: false,
        error: `Ability limit reached (${ABILITY_CREATOR_MAX_ABILITIES}/${ABILITY_CREATOR_MAX_ABILITIES}).`
      };
    }

    const abilityId = this.allocateGuestAbilityId();
    if (abilityId <= 0) {
      return { ok: false, error: "Unable to allocate a new ability id." };
    }
    const ability = this.buildAbilityDefinition(abilityId, draft);
    this.guestDefinitionsById.set(abilityId, ability);
    this.dynamicDefinitionsById.set(abilityId, ability);
    guestOwned.add(abilityId);
    if (templateAbilityId > 0) {
      guestOwned.delete(templateAbilityId);
    }
    const nextOwned = Array.from(guestOwned.values()).sort((a, b) => a - b);
    return {
      ok: true,
      ability,
      replacedAbilityId: templateAbilityId > 0 ? templateAbilityId : null,
      nextOwnedAbilityIds: nextOwned
    };
  }

  private tryForgetGuestAbility(accountId: number, abilityId: number): AbilityForgetResult {
    const guestOwned = this.guestOwnedAbilityIdsByAccountId.get(accountId);
    if (!guestOwned) {
      return {
        ok: false,
        error: "Guest ability ownership state is unavailable."
      };
    }
    if (!guestOwned.has(abilityId)) {
      return {
        ok: false,
        error: "Ability is not owned by this player."
      };
    }
    guestOwned.delete(abilityId);
    this.guestDefinitionsById.delete(abilityId);
    this.dynamicDefinitionsById.delete(abilityId);
    const nextOwned = Array.from(guestOwned.values()).sort((a, b) => a - b);
    return {
      ok: true,
      forgottenAbilityId: abilityId,
      nextOwnedAbilityIds: nextOwned
    };
  }

  private allocateGuestAbilityId(): number {
    while (this.nextGuestAbilityId <= 0xffff) {
      const candidate = this.nextGuestAbilityId;
      this.nextGuestAbilityId += 1;
      if (
        !this.dynamicDefinitionsById.has(candidate) &&
        !this.guestDefinitionsById.has(candidate) &&
        !getAbilityDefinitionById(candidate)
      ) {
        return candidate;
      }
    }
    return 0;
  }

  private resolveGuestOwnedAbilityIds(
    accountId: number,
    defaultAbilityIds: ReadonlyArray<number>
  ): number[] {
    const existing = this.guestOwnedAbilityIdsByAccountId.get(accountId);
    if (existing) {
      return Array.from(existing.values()).sort((a, b) => a - b);
    }
    const seeded = new Set<number>();
    for (const abilityId of defaultAbilityIds) {
      const normalized = this.normalizeAbilityId(abilityId);
      if (normalized > 0) {
        seeded.add(normalized);
      }
    }
    this.guestOwnedAbilityIdsByAccountId.set(accountId, seeded);
    return Array.from(seeded.values()).sort((a, b) => a - b);
  }

  private hydratePersistedDefinition(record: PersistedAbilityDefinitionRecord): AbilityDefinition {
    return this.buildAbilityDefinition(record.abilityId, {
      name: record.name,
      type: record.type,
      tier: record.tier,
      coreExampleStat: record.coreExampleStat,
      exampleUpsideEnabled: record.exampleUpsideEnabled,
      exampleDownsideEnabled: record.exampleDownsideEnabled,
      templateAbilityId: 0
    });
  }

  private buildAbilityDefinition(abilityId: number, draft: AbilityCreatorDraft): AbilityDefinition {
    const type = draft.type;
    const category = abilityCreatorTypeToCategory(type);
    const tier = sanitizeCreatorTier(draft.tier, ABILITY_CREATOR_MAX_TIER);
    const coreExampleStat = sanitizeCreatorCoreExampleStat(draft.coreExampleStat);
    const attributes: AbilityDefinition["attributes"] = [];
    if (draft.exampleUpsideEnabled) {
      attributes.push(ABILITY_CREATOR_EXAMPLE_UPSIDE_KEY);
    }
    if (draft.exampleDownsideEnabled) {
      attributes.push(ABILITY_CREATOR_EXAMPLE_DOWNSIDE_KEY);
    }
    const attributeDescriptionBits: string[] = [];
    if (draft.exampleUpsideEnabled) {
      attributeDescriptionBits.push("Example Upside");
    }
    if (draft.exampleDownsideEnabled) {
      attributeDescriptionBits.push("Example Downside");
    }
    return {
      id: this.normalizeAbilityId(abilityId),
      key: `custom-${this.normalizeAbilityId(abilityId)}`,
      name: sanitizeAbilityCreatorName(draft.name),
      description: `${type} | tier ${tier} | core ${coreExampleStat}${
        attributeDescriptionBits.length > 0 ? ` | ${attributeDescriptionBits.join(" + ")}` : ""
      }`,
      category,
      points: {
        power: coreExampleStat,
        velocity: 0,
        efficiency: 0,
        control: 0
      },
      attributes,
      creator: {
        type,
        tier,
        coreExampleStat,
        exampleUpsideEnabled: Boolean(draft.exampleUpsideEnabled),
        exampleDownsideEnabled: Boolean(draft.exampleDownsideEnabled)
      }
    };
  }

  private normalizeAbilityId(rawAbilityId: unknown): number {
    if (typeof rawAbilityId !== "number" || !Number.isFinite(rawAbilityId)) {
      return 0;
    }
    return Math.max(0, Math.min(0xffff, Math.floor(rawAbilityId)));
  }

  private normalizeSequence(rawSequence: unknown, fallback: number): number {
    if (typeof rawSequence !== "number" || !Number.isFinite(rawSequence)) {
      return Math.max(0, Math.floor(fallback));
    }
    return Math.max(0, Math.min(0xffff, Math.floor(rawSequence)));
  }
}
