# Combat Runtime Unification Plan

## Objective
Build one canonical, server-authoritative combat runtime that supports:
- Any entity as attacker (player, NPC, object, possessed object)
- Any entity as target (characters, props, world objects, structures)
- Deterministic and composable attack patterns (`straight`, `spiral`, `spread`, `spread+spiral`, future operators)
- Data-driven behavior authored by creator/crafting systems through attributes and runtime activation specs
- High-performance operation for high-CCU multiplayer on one VPS

This plan is intentionally extensive and production-focused. No legacy compatibility path is kept when it conflicts with correctness.

---

## Design Principles
- Server owns all combat truth (spawn, movement/hit resolution, damage, death lifecycle).
- Client is a rendering endpoint for combat state/events, not a combat authority.
- One canonical runtime path for all attackers and targets.
- Composition over hardcoded branches (`pattern operators`, `target filters`, `hit policies`, `death policies`).
- Deterministic execution using per-shot seeds and fixed tick semantics.
- Pool hot-path runtime objects and minimize allocations.
- Keep engine/game separation strict (`src/engine` generic; `src/game` content profiles/archetypes).

---

## High-Level Architecture

### 1) Combat Intent Layer
Input commands from player/NPC/AI convert to a canonical `AttackIntent`:
- `attackerEntityId`
- `activationSource` (ability/item/action)
- `aimBasis` (yaw/pitch or explicit direction vector)
- `triggerTick`

This layer does not compute outcomes.

### 2) Attack Spec Resolution Layer
`AttackSpecResolver` produces immutable `ResolvedAttackSpec` from:
- Base activation spec (ability/item/weapon)
- Creator attributes (upsides/downsides)
- Actor modifiers/status
- Station/world modifiers (optional future)

Result includes:
- Trajectory base model
- Ordered pattern operators
- Target policy
- Hit policy
- Damage packet template
- Cooldown/resource costs
- VFX/audio ids for client events

### 3) Attack Runtime Layer
`AttackRuntimeSystem` owns active attack instances:
- Spawns instances from `ResolvedAttackSpec`
- Ticks instances deterministically
- Executes spatial queries/casts
- Applies filters/policies
- Emits `DamageEvent`
- Emits replication/render events

This is the canonical execution engine for melee/projectile forms.

### 4) Damage Runtime Layer
`DamageRuntimeSystem` consumes canonical `DamageEvent` packets and applies:
- Resistances/armor/status modifiers
- Minimum/maximum/floor/ceil rules
- Health changes
- Damage reaction events

Targets are generic entities with `Damageable`/`Health` components.

### 5) Death Lifecycle Layer
`DeathLifecycleSystem` triggers from health reaching zero and executes entity `DeathPolicy`:
- `respawn_in_place_immediate`
- `despawn_and_respawn_at_anchor_after_delay`
- `destroy_permanent`
- `disable_until_repaired`
- extensible policy IDs

No hardcoded player-vs-NPC branch logic outside policy data.

---

## Canonical Data Contracts (Engine)

### AttackIntent
- `attackerEid: number`
- `activationRef: { kind: "ability" | "item" | "action"; id: number }`
- `aimYaw: number`
- `aimPitch: number`
- `clientTickHint?: number`
- `serverTick: number`

### ResolvedAttackSpec
- `specId: number`
- `category: "projectile" | "melee" | "beam" | "aoe"`
- `cooldownSeconds: number`
- `resourceCosts: ResourceCost[]`
- `trajectory: TrajectoryBaseSpec`
- `patternOps: PatternOpSpec[]`
- `targetPolicy: TargetPolicySpec`
- `hitPolicy: HitPolicySpec`
- `damageTemplate: DamageSpec`
- `replicationHints: ReplicationHintSpec`

### ActiveAttackInstance
- `instanceId: number`
- `attackerEid: number`
- `shotSequence: number`
- `seed: number`
- `spawnTick: number`
- `ageTicks: number`
- `state` (position/velocity/orientation/runtime operator state)
- `resolvedSpecRef`

### DamageEvent
- `sourceEid: number | null`
- `targetEid: number`
- `attackInstanceId: number | null`
- `amount: number`
- `damageType: string`
- `tags: string[]`
- `flags: { crit?: boolean; blocked?: boolean; reflected?: boolean }`

### DeathPolicy
- `policyId: string`
- `paramsJson: string` (or structured)
- `respawnDelayTicks?: number`
- `anchorRef?: number`

---

## Deterministic Pattern System

### Seed Strategy
Each shot gets deterministic seed from:
- `worldSeed`
- `attackerNid/eid`
- `activationRef.id`
- `shotSequence`
- `serverTickFired`

Seed must be stable and reproducible for replay/debug.

### Pattern Operators (Composable)
Operators run in declared order each tick/step:
- `spread` (initial angle offsets)
- `spiral` (time-varying radial/tangential offset)
- `wave`
- `drift`
- `homing` (future)
- `burst_n` (multi-projectile fan)

Initial required examples:
- Straight only
- Spiral only
- Spread only
- Spread + Spiral

### Notes
- Variation across rapid-fire shots comes from shotSequence-derived seed.
- Client can render identical path from seed + operator specs.

---

## Targeting + Hit Resolution

### Target Policy
Data-driven filters:
- allowSelf
- allowAllies
- allowEnemies
- allowNeutral
- allowStructures
- allowFoliage
- required/excluded tags

### Hit Policy
Data-driven behavior after hit:
- `stop_on_first`
- `pierce_n`
- `chain_n`
- `explode_radius`
- `apply_status`

### Spatial Resolution
- Default fast path: swept shape query/cast (sensor-like authoritative query)
- Physics path: optional rigidbody/collider projectiles only when true physics behavior is required

---

## Melee Model (Canonical)
Melee is an attack trajectory policy, not a separate bespoke combat system:
- Short-lived attack volume/segment cast
- Arc/radius/range constraints
- LOS filtering
- Optional multi-hit windows (future)

Initial melee example:
- `punch` (single short-range cone/arc hit)

---

## Network Model

### Authoritative Flow
1. Client sends attack intent only.
2. Server validates and resolves spec.
3. Server spawns/ticks attack instances.
4. Server applies damage/death.
5. Server replicates visual-relevant state/events.

### Replication Strategy
- Prefer spawn packet + deterministic parameters over per-tick projectile position when possible.
- Use per-tick replication only when necessary (non-deterministic interactions, heavy physics projectiles, correction cases).
- Keep hit confirmations and health authoritative.

### UI/Feedback
- Client receives explicit success/failure/blocked reasons for attempts.
- Combat feel cues (sound/VFX) can start from authoritative use event.

---

## Creator/Crafting Integration
Creator-authored attributes must directly map into attack spec composition.

### Mapping Rules
- Attribute IDs map to deterministic spec patches/operators.
- Upsides/downsides modify budget-driven traits and produce explicit effects.
- Augment-driven attributes are same underlying attribute mechanism with stricter source rules.

### Example Mappings
- `attr_pattern_spiral_t1` -> add `spiral` operator with profile A.
- `attr_pattern_spread_t1` -> add `spread` operator with profile A.
- both active -> operator stack `[spread, spiral]`.

### Guard Rule
- Combat runtime never infers content semantics from UI labels; it consumes canonical resolved spec data only.

---

## Damage for “Anything Can Be Damaged”

### Required Components
- `DamageableTag`
- `HealthCurrent`, `HealthMax`
- optional `ResistanceProfileId`
- optional `ArmorProfileId`
- optional `DeathPolicy`

### Entity Types
All entity archetypes can opt in:
- characters (players/NPCs)
- world objects (doors/trees/structures)
- spawned constructs

### Outcome Events
Emit standard events for systems/UI:
- `damage_applied`
- `target_killed`
- `death_policy_started`
- `death_policy_completed`

---

## Death and Respawn Behaviors

### Player (current desired baseline)
- on zero health: immediate respawn at designated policy location/state
- health restored

### NPC (current desired baseline)
- on zero health: deactivate/despawn
- respawn after 30 seconds at spawn anchor
- health restored

### Generalization
All through `DeathPolicy` data, not entity-type switch statements.

---

## Performance and Allocation Plan
- Pool active attack instances.
- Pool query scratch buffers and temporary vectors.
- Keep operator state packed and numeric.
- Avoid per-tick dynamic object creation in hot loops.
- Keep deterministic math stable and bounded.

---

## Migration Strategy (No Legacy Parallel Systems)
1. Introduce canonical contracts (`AttackIntent`, `ResolvedAttackSpec`, `DamageEvent`, `DeathPolicy`).
2. Route existing ability execution through new resolver/runtime.
3. Re-home melee/projectile behaviors as trajectory/pattern policies under one runtime.
4. Replace old direct branches once parity achieved.
5. Remove legacy duplicate paths.

No fallback/compatibility track retained when canonical system is live.

---

## Delivery Phases and Checklist

### Phase 0: Baseline Audit + Contract Freeze
- [x] Enumerate all current entry points that spawn projectiles/apply melee/damage.
- [x] Define and commit canonical combat contracts in engine shared/server modules.
- [x] Identify and mark legacy duplicate paths for removal.

### Phase 1: Attack Runtime Core
- [x] Implement `AttackSpecResolver` (ability/item/action -> immutable resolved spec).
- [x] Implement `AttackRuntimeSystem` with pooled active attack instances.
- [x] Implement deterministic shot sequence + seed generation utility.
- [x] Integrate with existing action/effect pipeline as canonical combat executor.

### Phase 2: Pattern Operators
- [x] Implement `straight` base trajectory policy.
- [x] Implement `spiral` operator.
- [x] Implement `spread` operator.
- [x] Implement composable operator ordering (`spread + spiral`) with deterministic behavior.
- [x] Add example activation specs using all four required patterns.

### Phase 3: Unified Target/Hit Pipeline
- [x] Implement target policy evaluation (self/ally/enemy/tag/domain filters).
- [x] Implement hit policy evaluation (`stop`, `pierce`, etc baseline).
- [x] Unify melee and projectile collision resolution through canonical runtime APIs.

### Phase 4: Damage Runtime Unification
- [x] Expand/align damage system to consume canonical `DamageEvent` packets.
- [x] Ensure non-character entities can be damaged via shared path.
- [x] Remove hardcoded assumptions that damage targets are only characters/dummies.

### Phase 5: Death Lifecycle Generalization
- [x] Implement generic `DeathLifecycleSystem` with policy dispatch.
- [x] Implement player immediate respawn policy.
- [x] Implement NPC 30-second deactivate/respawn-at-anchor policy.
- [x] Bind death lifecycle events into replication and UI notifications.

### Phase 6: Creator/Crafting Attribute Binding
- [x] Define canonical mapping from creator attributes -> attack spec operators/modifiers.
- [x] Wire runtime activation spec generation to include pattern attributes.
- [x] Ensure authored weapon/ability creations flow cleanly into combat runtime.

### Phase 7: Networking + Rendering Discipline
- [x] Ensure server-authoritative attack outcomes with client intent-only inputs.
- [x] Replicate minimal deterministic projectile spawn payloads where feasible.
- [x] Keep client projectile visuals deterministic from server payload/seed.
- [x] Replicate authoritative hit/damage/death results.

### Phase 8: Legacy Removal + Cleanup
- [x] Remove obsolete parallel melee/projectile execution paths.
- [x] Remove obsolete data fields and helper methods no longer used.
- [x] Tighten naming and module boundaries for clarity.

### Phase 9: Completion Verification
- [ ] Manual verify: straight projectile works end-to-end.
- [ ] Manual verify: spiral projectile variation per shot works.
- [ ] Manual verify: spread projectile variation per shot works.
- [ ] Manual verify: spread+spiral composition works.
- [ ] Manual verify: melee punch works.
- [ ] Manual verify: players and NPCs both use same runtime path.
- [ ] Manual verify: inanimate damageable object can be hit and processed.
- [ ] Manual verify: player death policy and NPC death policy both behave correctly.
- [ ] Confirm no legacy parallel combat execution remains.

---

## Definition of Done
System is complete when all are true:
1. One canonical attack execution runtime handles melee/projectile attacks.
2. Pattern operators are deterministic, composable, and include required examples.
3. Damage path is generic and supports any damageable entity type.
4. Death lifecycle is policy-driven and includes required player/NPC behaviors.
5. Creator-authored attributes can drive attack patterns and modifiers.
6. Server is authoritative; client is rendering-centric for combat state.
7. Legacy duplicate combat paths are removed.

---

## Risks and Mitigations
- Risk: hidden legacy paths still applying damage.
  - Mitigation: centralize damage writes through DamageRuntimeSystem only.
- Risk: deterministic divergence between client/server pattern visuals.
  - Mitigation: shared math/seed routines in `shared` module; no duplicated math variants.
- Risk: performance regressions from dynamic allocations.
  - Mitigation: pooled runtime instances and scratch buffers in hot loops.
- Risk: creator attributes becoming ad-hoc hardcoded logic.
  - Mitigation: strict attribute-to-spec mapping table and resolver layer.

---

## Immediate Next Execution Order
1. Phase 0 and Phase 1 foundation.
2. Implement pattern operators and four example attacks.
3. Unify damage/death lifecycle.
4. Bind creator attributes and remove legacy combat branches.

