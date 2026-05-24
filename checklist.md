# Creator/Station Authoritative Runtime Plan

This checklist tracks remaining work to make creator + inventory behavior fully server-authoritative and runtime-dynamic for player-authored content.

Execution constraints:
- Game code only in implementation passes.
- No tests/guard rails during implementation passes.

## 1) Runtime Item Descriptor Authority

- [x] Add authoritative server->client runtime item descriptor replication (`ItemDefinitionMessage`).
Acceptance criteria: Newly created runtime items resolve name/category/use metadata on the client without requiring static startup catalogs.

- [x] Ensure inventory decode does not drop valid item instances because client lacks a static definition.
Acceptance criteria: Inventory snapshots preserve valid item entries by id/quantity/slot, with graceful UI fallback for unknown descriptors until descriptor replication arrives.

- [x] Resolve item definitions server-side via static+runtime capability fallback in inventory flows.
Acceptance criteria: Use/equip/drop/pickup/normalization paths handle runtime-authored items consistently.

## 2) Authoritative Creator Outcome UX

- [x] Remove client-side creator submit success/failure inference.
Acceptance criteria: Client does not infer success from creator validation text.

- [x] Emit authoritative server alerts for creator instantiate success/failure paths.
Acceptance criteria: User-facing create outcomes are produced by server authority only.

- [x] Add authoritative creator action result message channel (`CreatorActionResultMessage`) consumed directly by client UI.
Acceptance criteria: Creator success/failure outcome rendering is based on explicit server result payloads, not inferred from other message types.

## 3) Creator Session Payload Completeness

- [x] Include station session binding in creator state payload consumed by client.
Acceptance criteria: Client can render creator context strictly from authoritative state without local assumptions.

- [x] Ensure creator panel renders from server snapshot payload only (draft/capacity/validation/preview/options) with no correctness-critical local recomputation.
Acceptance criteria: Local UI logic is presentation-only; all gating and computed values are server-originated.

## 4) Runtime Descriptor Unification

- [x] Introduce unified runtime descriptor replication conventions (items first-class; ability/appearance extension hooks documented in code).
Acceptance criteria: Descriptor delivery model is explicit and extensible, not ad hoc per feature.

- [x] Remove remaining correctness dependence on startup static catalogs for dynamic creator/inventory flows.
Acceptance criteria: Static catalogs are treated as baseline content seed only, not required for runtime-authored correctness.

## 5) Final Sanity Pass (Code Inspection)

- [x] Verify station->creator->instantiate path remains single canonical authoritative flow.
Acceptance criteria: No bypass path creates inventory items outside server-validated creator/session policy checks.

- [x] Verify inventory visibility and naming path is deterministic: instantiate -> authoritative descriptor+inventory messages -> UI render.
Acceptance criteria: No "created but unknown/hidden item" regressions in code paths.

## 6) Next Authority Hardening Wave

- [x] Replace remaining creator UI local presentation derivations with a server-authored creator render bundle.
Acceptance criteria: Creator panel section layout data (grouped field rows / attribute rows / augment display rows / preview rows) comes from authoritative server payload, with client responsible only for rendering and input dispatch.

- [x] Extend runtime descriptor-on-demand replication pattern to additional descriptor classes (ability/appearance-facing descriptors).
Acceptance criteria: Dynamic runtime-authored definitions required for UI/visual rendering are replicated as needed from server authority, not assumed from startup seed catalogs.

- [x] Unify creator/inventory outcome messaging contracts to avoid overlap and ambiguity.
Acceptance criteria: For each action family, one canonical authoritative result channel drives user-facing outcome messaging.

## 7) Follow-On Performance and Robustness

- [x] Remove remaining static-catalog correctness dependencies from world/interact rendering paths.
Acceptance criteria: Runtime descriptor replication fully covers dynamic gameplay render needs; static catalogs are baseline seed only.

- [x] Add explicit schema/version tags to descriptor and creator-render payloads.
Acceptance criteria: Payload migrations and compatibility checks are deterministic and debuggable.

- [x] Reduce JSON-heavy payload overhead for high-churn channels (`CreatorStateMessage`, `InventoryStateMessage`) while preserving authority semantics.
Acceptance criteria: Message contracts remain authoritative but use tighter payload shapes for lower overhead under high CCU/churn.
