# Unified UI View Protocol Completion Checklist

This checklist defines completion for migrating creator + inventory to one canonical server-authoritative UI view replication system.

Constraints:
- Game code only.
- No tests/guard rails/browser automation.

## 1) Protocol Foundations

- [x] Define canonical UI view wire messages in shared netcode:
  - `UiViewOpenMessage`
  - `UiViewPatchMessage`
  - `UiViewCloseMessage`
  - `UiIntentCommand`
  - `UiIntentResultMessage`
Acceptance criteria: all five contracts are schema-registered in nengi and typed in shared netcode.

- [x] Define keyed-partial patch contract and revision semantics.
Acceptance criteria: open sends full state + revision; patch sends `baseRevision` and partial payload; mismatch path is explicit.

## 2) Server UI View Runtime

- [x] Add a server UI view replication runtime responsible for:
  - creating scoped views,
  - tracking subscriptions,
  - incrementing revisions,
  - emitting open/patch/close,
  - handling intent routing.
Acceptance criteria: one reusable server-side runtime exists and is used by creator + inventory views.

- [x] Add per-user view cache to avoid sending unchanged heavy sections.
Acceptance criteria: unchanged large fields are omitted from patch payloads by keyed partial behavior.

## 3) Creator Migration

- [x] Migrate creator station/session UI to `ui_view_*` messages.
Acceptance criteria: creator panel state (draft, field definitions, render bundle, validation, production preview, descriptor refs) is delivered via UI view protocol, not legacy creator state message path.

- [x] Migrate creator outcomes fully to `UiIntentResultMessage` and remove `CreatorActionResultMessage`.
Acceptance criteria: creator action success/failure UX no longer depends on legacy creator result message.

## 4) Inventory Migration

- [x] Migrate inventory UI state to `ui_view_*` messages.
Acceptance criteria: inventory state open/patch/close is served via UI view protocol.

- [x] Migrate remaining inventory action pathways and outcomes fully to `UiIntentCommand` + `UiIntentResultMessage`.
Acceptance criteria: inventory UI actions no longer depend on `ItemCommand`/`InventoryActionResultMessage`.

## 5) Descriptor Integration

- [x] Ensure view payloads include descriptor references and server emits required descriptor upserts before/with relevant view state.
Acceptance criteria: creator + inventory rendering has no correctness dependency on static startup catalogs.

## 6) Legacy Removal

- [x] Remove superseded legacy creator/inventory message handlers and emitters where replaced:
  - legacy creator state message wiring
  - legacy creator command/result message wiring
  - legacy inventory state message wiring
  - legacy inventory action-result specific UI wiring
Acceptance criteria: no duplicate pathways for migrated creator/inventory UI flows.

## 7) Completion Audit

- [x] Verify creator flow end-to-end by code inspection:
  - station interaction opens creator UI view,
  - edits send intents,
  - server applies/validates,
  - patches + intent results update UI.

- [x] Verify inventory flow end-to-end by code inspection:
  - view open/patch reflects server inventory,
  - actions send intents,
  - server result + view updates are authoritative.

- [x] Verify no required creator/inventory client-facing functionality depends on static catalogs for correctness.
