Original prompt: this game has an ability creator, it is extremely half baked and stupid. we are going to completely scrap it. go ahead and remove it. eventually we will plan a better one

- Removed ability creator end-to-end from client/server/shared runtime paths.
- Client: removed creator UI panel and all creation callbacks; `AbilityHud` is now loadout-only.
- Input: removed `KeyN` creator toggle and related queued state.
- Network protocol/client: removed ability-create command/result schemas, handlers, queues, and event surface.
- Server simulation: removed ability-create command processing, dynamic runtime-ability ownership map, and runtime-ability cleanup path.
- Persistence: removed runtime-ability load/save/allocation logic and related schema bootstrap tables (`player_runtime_abilities`, `meta`), while keeping character/loadout persistence.
- Smoke test: replaced creator flow assertions with deterministic loadout-panel open validation.

Validation:
- `cmd /d /s /c "nvm use 20.19.0 && npm run typecheck"` passed.
- `cmd /d /s /c "nvm use 20.19.0 && npm run test:smoke"` passed after updating panel-toggle automation.

TODO / follow-ups:
- Design and implement a new ability authoring system from scratch (no reuse of removed runtime-creation protocol).
- Decide whether to add a one-time DB migration that drops legacy runtime-ability tables for existing local databases.
