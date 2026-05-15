// Generalized server-authoritative creator system — one system for all archetype kinds.
// In-memory session management, draft editing, archetype creation, and forgetting.
// Characters, abilities, items — all go through the same pipeline.

import {
  getArchetypeDefinitionById,
  type ArchetypeDefinition
} from "../../shared/archetype";
import {
  collectStatModifiers,
  checkTraitConstraints
} from "../../shared/traits";
import {
  deriveStats,
  getStatDefinitionsForKind,
  sanitizeCreatorStat,
  sanitizeCreatorName,
  getCreatorCapacity,
  validateCreatorDraft,
  CUSTOM_ARCHETYPE_ID_START,
  type CreatorDraft,
  type CreatorSessionSnapshot
} from "../../shared/index";

interface CreatorSessionState {
  sessionId: number;
  ackSequence: number;
  statusMessage: string;
  draft: CreatorDraft;
}

export interface CreatorApplyResult {
  snapshot: CreatorSessionSnapshot;
  createdArchetype: ArchetypeDefinition | null;
  replacedArchetypeId: number | null;
  nextOwnedArchetypeIds: number[] | null;
}

export interface CreatorForgetResult {
  ok: boolean;
  forgottenArchetypeId?: number;
  nextOwnedArchetypeIds?: number[];
  error?: string;
}

export class CreatorSystem {
  private readonly sessionsByUserId = new Map<number, CreatorSessionState>();
  private nextSessionId = 1;

  // Custom archetypes created by players
  private readonly customizedById = new Map<number, ArchetypeDefinition>();
  // Ownership: accountId -> Set<archetypeId>
  private readonly ownedByAccount = new Map<number, Set<number>>();
  private nextCustomArchetypeId = CUSTOM_ARCHETYPE_ID_START;

  // ── Session management ──────────────────────────────────────────────────

  public initializeSession(
    userId: number,
    ownedArchetypeIds: readonly number[],
    defaultKind: string
  ): CreatorSessionSnapshot {
    const session = this.createSessionState(defaultKind);
    this.sessionsByUserId.set(userId, session);
    return this.buildSnapshot(session, ownedArchetypeIds.length);
  }

  public removeSession(userId: number): void {
    this.sessionsByUserId.delete(userId);
  }

  public getSession(userId: number): CreatorSessionSnapshot | null {
    const session = this.sessionsByUserId.get(userId);
    if (!session) return null;
    return this.buildSnapshot(session, 0);
  }

  public synchronizeSessionOwnedCount(
    userId: number,
    ownedCount: number
  ): CreatorSessionSnapshot | null {
    const session = this.sessionsByUserId.get(userId);
    if (!session) return null;
    return this.buildSnapshot(session, ownedCount);
  }

  // ── Ownership ───────────────────────────────────────────────────────────

  public resolveOwnedArchetypeIds(
    accountId: number,
    defaultIds: readonly number[]
  ): number[] {
    const cached = this.ownedByAccount.get(accountId);
    if (cached) return Array.from(cached).sort((a, b) => a - b);

    const seeded = new Set(defaultIds.filter((id) => id > 0));
    this.ownedByAccount.set(accountId, seeded);
    return Array.from(seeded).sort((a, b) => a - b);
  }

  public resolveArchetypeDefinitionById(id: number): ArchetypeDefinition | null {
    const normalizedId = this.normalizeId(id);
    if (normalizedId <= 0) return null;
    return getArchetypeDefinitionById(normalizedId)
      ?? this.customizedById.get(normalizedId)
      ?? null;
  }

  // ── Command processing ──────────────────────────────────────────────────

  public applyCommand(params: {
    userId: number;
    accountId: number;
    ownedArchetypeIds: readonly number[];
    command: {
      sessionId: number;
      sequence: number;
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
      forgetArchetypeId?: number;
    };
  }): CreatorApplyResult {
    const session =
      this.sessionsByUserId.get(params.userId) ??
      this.createAndStoreSession(params.userId, "ability");

    const ownedSet = new Set(params.ownedArchetypeIds);
    const sequence = this.normalizeSequence(params.command.sequence, session.ackSequence);
    const requestedSessionId = this.normalizeSequence(params.command.sessionId, 0);

    if (requestedSessionId !== 0 && requestedSessionId !== session.sessionId) {
      session.statusMessage = "Creator session reset. Waiting for latest state.";
      return {
        snapshot: this.buildSnapshot(session, ownedSet.size),
        createdArchetype: null,
        replacedArchetypeId: null,
        nextOwnedArchetypeIds: null
      };
    }

    if (sequence <= session.ackSequence) {
      return {
        snapshot: this.buildSnapshot(session, ownedSet.size),
        createdArchetype: null,
        replacedArchetypeId: null,
        nextOwnedArchetypeIds: null
      };
    }
    session.ackSequence = sequence;

    let createdArchetype: ArchetypeDefinition | null = null;
    let replacedArchetypeId: number | null = null;
    let nextOwnedArchetypeIds: number[] | null = null;
    let explicitStatus = false;

    const baseArchetype = getArchetypeDefinitionById(session.draft.baseArchetypeId);

    if (params.command.applyName) {
      session.draft = { ...session.draft, name: sanitizeCreatorName(params.command.name ?? "") };
    }

    if (params.command.selectBaseArchetype && params.command.baseArchetypeId) {
      const newBase = getArchetypeDefinitionById(params.command.baseArchetypeId);
      if (newBase) {
        session.draft = this.createDraftFromArchetype(newBase);
        session.statusMessage = `Selected "${newBase.name}".`;
        explicitStatus = true;
      }
    }

    if (params.command.allocateStat && params.command.statId) {
      const statId = params.command.statId;
      const delta = params.command.statDelta ?? 0;
      const currentAlloc = { ...session.draft.statAllocations };
      const currentVal = currentAlloc[statId] ?? 0;
      const newVal = sanitizeCreatorStat(currentVal + delta);
      const validStats = getStatDefinitionsForKind(session.draft.kind);
      if (validStats.some((s) => s.id === statId)) {
        const totalAllocated = Object.values(currentAlloc).reduce((a, b) => a + b, 0) - currentVal + newVal;
        if (baseArchetype && totalAllocated <= baseArchetype.statBudget) {
          currentAlloc[statId] = newVal;
          session.draft = { ...session.draft, statAllocations: currentAlloc };
        }
      }
    }

    if (params.command.toggleTrait && params.command.traitId) {
      const traitId = params.command.traitId;
      const currentTraits = [...session.draft.selectedTraits];
      const idx = currentTraits.indexOf(traitId);
      if (idx >= 0) {
        currentTraits.splice(idx, 1);
      } else if (baseArchetype && baseArchetype.availableTraits.includes(traitId)) {
        const testTraits = [...currentTraits, traitId];
        const violations = checkTraitConstraints(testTraits, session.draft.kind);
        if (violations.length === 0) {
          currentTraits.push(traitId);
        }
      }
      session.draft = { ...session.draft, selectedTraits: currentTraits };
    }

    if (params.command.submitCreate && baseArchetype) {
      const validation = validateCreatorDraft(session.draft, baseArchetype, ownedSet.size);
      if (!validation.valid) {
        session.statusMessage = validation.message;
        explicitStatus = true;
      } else {
        const result = this.createCustomizedArchetype(
          params.accountId,
          session.draft,
          baseArchetype,
          ownedSet
        );
        if (!result.ok) {
          session.statusMessage = result.error;
          explicitStatus = true;
        } else {
          createdArchetype = result.archetype;
          replacedArchetypeId = result.replacedId;
          nextOwnedArchetypeIds = result.nextOwnedIds;
          session.statusMessage = `Created "${createdArchetype.name}".`;
          explicitStatus = true;
        }
      }
    }

    if (params.command.forgetArchetypeId !== undefined && params.command.forgetArchetypeId > 0) {
      const forgetResult = this.forgetArchetype(
        params.accountId,
        params.command.forgetArchetypeId
      );
      if (forgetResult.ok && forgetResult.nextOwnedArchetypeIds) {
        nextOwnedArchetypeIds = forgetResult.nextOwnedArchetypeIds;
        session.statusMessage = "Archetype removed.";
        explicitStatus = true;
      }
    }

    if (!explicitStatus) {
      const validation = baseArchetype
        ? validateCreatorDraft(session.draft, baseArchetype, ownedSet.size)
        : { valid: false, message: "Select a base archetype first.", errors: [] };
      session.statusMessage = validation.message;
    }

    return {
      snapshot: this.buildSnapshot(
        session,
        nextOwnedArchetypeIds?.length ?? ownedSet.size
      ),
      createdArchetype,
      replacedArchetypeId,
      nextOwnedArchetypeIds
    };
  }

  // ── Forget ──────────────────────────────────────────────────────────────

  public forgetArchetype(
    accountId: number,
    archetypeId: number
  ): CreatorForgetResult {
    const normalizedId = this.normalizeId(archetypeId);
    if (normalizedId <= 0) {
      return { ok: false, error: "Invalid archetype id." };
    }

    const owned = this.ownedByAccount.get(accountId);
    if (!owned || !owned.has(normalizedId)) {
      return { ok: false, error: "Archetype is not owned." };
    }

    owned.delete(normalizedId);
    this.customizedById.delete(normalizedId);
    return {
      ok: true,
      forgottenArchetypeId: normalizedId,
      nextOwnedArchetypeIds: Array.from(owned).sort((a, b) => a - b)
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private createCustomizedArchetype(
    accountId: number,
    draft: CreatorDraft,
    baseArchetype: ArchetypeDefinition,
    ownedSet: Set<number>
  ): { ok: true; archetype: ArchetypeDefinition; replacedId: number | null; nextOwnedIds: number[] }
   | { ok: false; error: string } {
    const archetypeId = this.allocateArchetypeId();
    if (archetypeId <= 0) return { ok: false, error: "Unable to allocate archetype id." };

    const statModifiers = collectStatModifiers(draft.selectedTraits);
    const resolvedStats = deriveStats(
      draft.kind,
      baseArchetype.baseStats,
      draft.statAllocations,
      statModifiers
    );

    const customized: ArchetypeDefinition = {
      id: archetypeId,
      kind: baseArchetype.kind,
      key: `custom-${archetypeId}`,
      name: sanitizeCreatorName(draft.name),
      description: `${draft.kind} | traits: ${draft.selectedTraits.join(", ") || "none"}`,
      modelId: baseArchetype.modelId,
      components: baseArchetype.components,
      baseStats: resolvedStats,
      statBudget: 0,
      traitBudget: 0,
      availableTraits: [],
      abilityCategory: baseArchetype.abilityCategory,
      abilityPoints: baseArchetype.abilityPoints,
      abilityAttributes: baseArchetype.abilityAttributes,
      projectileProfile: baseArchetype.projectileProfile,
      meleeProfile: baseArchetype.meleeProfile,
      itemCategory: baseArchetype.itemCategory,
      itemStackMax: baseArchetype.itemStackMax,
      itemEquipSlot: baseArchetype.itemEquipSlot,
      itemUse: baseArchetype.itemUse,
      npcMoveSpeed: baseArchetype.npcMoveSpeed,
      npcPerceptionRadius: baseArchetype.npcPerceptionRadius,
      npcAttackRange: baseArchetype.npcAttackRange,
      npcAttackDamage: baseArchetype.npcAttackDamage,
      npcAttackCooldownSeconds: baseArchetype.npcAttackCooldownSeconds,
      npcActivationRadius: baseArchetype.npcActivationRadius,
      npcDeactivationRadius: baseArchetype.npcDeactivationRadius,
      npcBehaviorTreeId: baseArchetype.npcBehaviorTreeId,
      npcCapsuleHalfHeight: baseArchetype.npcCapsuleHalfHeight,
      npcCapsuleRadius: baseArchetype.npcCapsuleRadius
    };

    this.customizedById.set(archetypeId, customized);

    let owned = this.ownedByAccount.get(accountId);
    if (!owned) {
      owned = new Set(ownedSet);
      this.ownedByAccount.set(accountId, owned);
    }
    owned.add(archetypeId);

    return {
      ok: true,
      archetype: customized,
      replacedId: null,
      nextOwnedIds: Array.from(owned).sort((a, b) => a - b)
    };
  }

  private allocateArchetypeId(): number {
    while (this.nextCustomArchetypeId <= 0xffff) {
      const candidate = this.nextCustomArchetypeId++;
      if (!this.customizedById.has(candidate) && !getArchetypeDefinitionById(candidate)) {
        return candidate;
      }
    }
    return 0;
  }

  private createAndStoreSession(userId: number, kind: string): CreatorSessionState {
    const session = this.createSessionState(kind);
    this.sessionsByUserId.set(userId, session);
    return session;
  }

  private createSessionState(kind: string): CreatorSessionState {
    return {
      sessionId: this.nextSessionId++,
      ackSequence: 0,
      statusMessage: "Select a base archetype to begin.",
      draft: this.createEmptyDraft(kind)
    };
  }

  private createEmptyDraft(kind: string): CreatorDraft {
    return {
      name: "New Creation",
      baseArchetypeId: 0,
      kind,
      statAllocations: {},
      selectedTraits: []
    };
  }

  private createDraftFromArchetype(archetype: ArchetypeDefinition): CreatorDraft {
    // Allocations start at zero — the player allocates from the budget.
    // baseStats represent the archetype's inherent properties, not allocated points.
    const stats = getStatDefinitionsForKind(archetype.kind);
    const allocations: Record<string, number> = {};
    for (const stat of stats) {
      allocations[stat.id] = 0;
    }
    return {
      name: archetype.name,
      baseArchetypeId: archetype.id,
      kind: archetype.kind,
      statAllocations: allocations,
      selectedTraits: []
    };
  }

  private buildSnapshot(
    session: CreatorSessionState,
    ownedCount: number
  ): CreatorSessionSnapshot {
    const baseArchetype = getArchetypeDefinitionById(session.draft.baseArchetypeId);
    const capacity = baseArchetype
      ? getCreatorCapacity(session.draft, baseArchetype)
      : {
          statBudgetTotal: 0,
          statBudgetSpent: 0,
          statBudgetRemaining: 0,
          traitBudget: { total: 0, spent: 0, remaining: 0 },
          traitSlots: { upsideUsed: 0, downsideUsed: 0, upsideMax: 0, downsideMax: 0 }
        };
    const validation = baseArchetype
      ? validateCreatorDraft(session.draft, baseArchetype, ownedCount)
      : { valid: false, message: "Select a base archetype first.", errors: ["No base archetype"] };

    return {
      sessionId: session.sessionId,
      ackSequence: session.ackSequence,
      kind: session.draft.kind,
      draft: session.draft,
      capacity,
      validation: {
        valid: validation.valid,
        message: session.statusMessage || validation.message,
        errors: validation.errors
      },
      ownedArchetypeCount: Math.max(0, Math.floor(ownedCount))
    };
  }

  private normalizeSequence(raw: number, fallback: number): number {
    if (!Number.isFinite(raw)) return Math.max(0, Math.floor(fallback));
    return Math.max(0, Math.min(0xffff, Math.floor(raw)));
  }

  private normalizeId(raw: number): number {
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(0xffff, Math.floor(raw)));
  }
}
