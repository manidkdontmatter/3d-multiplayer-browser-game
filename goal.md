# Creator + Station System Completion Checklist

This checklist is the canonical definition of what still must be done before the unified creator/station production system is considered complete.

## A) Canonical Architecture Completion

- [x] Confirm one canonical runtime path exists: `station -> creator session -> server-authoritative author+instantiate`.
- [x] Remove all remaining parallel/legacy crafting pathways that bypass station/creator flow.
- [x] Remove residual conceptual overlap with legacy inventory-crafting behavior.
- [x] Verify creator UI remains fully separate from inventory UI in all gameplay paths.
- [x] Finalize and document single authoritative schema contract for authoring + instantiation.
- [x] Implement/verify blueprint payload versioning and migration path.

## B) Blueprint Lifecycle Correctness

- [x] Verify instance-to-blueprint promotion always creates a new blueprint and never mutates existing blueprint payloads.
- [x] Verify blueprint lineage and provenance metadata are complete and consistent across all creation paths.
- [x] Verify restricted-instantiation semantics are fully enforced by server permissions and access tags.

## C) Station Policy and Interaction Correctness

- [x] Remove implicit station-access fallback behavior; enforce explicit policy-driven access only.
- [x] Complete targeted station interaction reliability fix (station session must open deterministically from valid interaction).
- [x] Ensure multi-action interaction prompts are consistently rendered and reflect enabled/disabled reasons.
- [x] Verify station inventory source policy and consumption order behavior across edge cases.

## D) Creator UI Feature Completion

- [x] Complete augment slot assignment UX with full validation and preview feedback.
- [x] Add/verify tooltips for stats, traits, requirements, and augment effects.
- [x] Validate that unmet requirements/messages are precise, source-aware, and actionable.
- [x] Validate template/tier/attribute/points UX against final content contract expectations.

## E) Networking and Authority Hardening

- [x] Verify replication sends only necessary creator feedback/results (no redundant state leakage).
- [x] Audit and close any remaining client-authoritative loopholes in create/instantiate flows.
- [x] Confirm all requirement/cost/permission checks are server recomputed and never trusted from client payloads.

## F) Legacy Removal and Codebase Hygiene

- [x] Remove dead code and stale naming in creator/crafting/station domain.
- [x] Remove near-duplicate systems in this domain and consolidate onto canonical services.
- [x] Run and resolve static architecture checks after cleanup (`boundaries`, `cycles`, types).

## G) Playability and Acceptance

- [x] Validate in-game station discovery + interaction clarity.
- [x] Validate that prompt/keybind affordances are clear for single and multiple actions.
- [x] Validate happy-path creation flow end-to-end for low friction.
- [x] Validate failure-path UX end-to-end for clarity and recoverability.
- [x] Confirm in live play that inventory UI is not used as crafting UI.

## H) Release Gate (Must All Pass)

- [x] `npm run test:ci` passes after final changes.
- [x] Targeted station-creator regression/functional verification passes.
- [x] Final architectural audit confirms no parallel legacy crafting flow remains.
- [x] Final verification confirms one canonical creator/station system in code + data.
