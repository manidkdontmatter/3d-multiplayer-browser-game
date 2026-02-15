Original prompt: we will add animations next. where do you think i can source some? you can't generate animations can you?

## Current Snapshot (2026-02-15)

- Stack is stable: authoritative nengi 2.0 server, Three.js client, Rapier physics, Playwright automation.
- Core movement/netcode path is implemented with server authority, client prediction/reconciliation, AOI, and platform carry handling.
- Runtime ability pipeline exists end-to-end and is server-authoritative:
  - hotbar selection/casting intent from client
  - server validation/execution
  - runtime ability creation via creator commands/messages
- Remote humanoid model + base animation layering are integrated (locomotion/jump + upper-body action overlay).
- Ability UI is now split into distinct systems:
  - loadout/inventory panel on `B`
  - creator panel on `N`
- UI visual language is now centralized by token-driven style rules and applied across boot overlay, HUD, hotbar, and ability panels for consistency.
- First-person combat baseline now includes:
  - shared full-body local first-person presentation rig (no separate FPS-arms asset)
  - local head/neck suppression + first-person upper-body pose offsets so the player can see their own arms/body when looking down
  - default melee `Punch` ability on hotbar slot `2`
  - server-authoritative melee hit resolution (range/radius/arc checks against player capsules)
  - melee profile synthesis for runtime-created melee abilities from the ability creator

## Latest Verified

- 2026-02-15: `npm run typecheck:client` passed.
- 2026-02-15: `npm run test:smoke` passed after ability-panel CSS + input-toggle fixes.
- 2026-02-14: `npm run test:multiplayer:quick` passed.
- 2026-02-15: `npm run test:smoke` and `npm run test:multiplayer:quick` passed after production-style ability UI redesign (separate loadout/creator systems retained).
- 2026-02-15: `npm run test:smoke` passed after shared UI style-system normalization pass.
- 2026-02-15: `npm run typecheck:client` and `npm run typecheck:server` passed after first-person local-body + melee integration.
- 2026-02-15: `npm run test:smoke` passed after first-person local-body + melee integration.
- 2026-02-15: `npm run test:multiplayer:quick` passed after first-person local-body + melee integration.

## Active Priorities

1. Ability system productization
- Persist runtime-created abilities/loadouts across reconnect/server restart.
- Extend creator/runtime execution beyond projectile+basic-melee templates (passive/utility paths).
- Add deeper creator e2e assertions (catalog/loadout replication + cast behavior).

2. Animation system expansion
- Add strafe/backpedal/turn-in-place/land/hit-react clips while preserving current layered architecture.
- Keep root motion OFF by default; allow per-clip opt-in only when explicitly needed.

3. Netcode stability and observability
- Investigate and reduce CSP/platform jitter further without regressing authoritative separation.
- Tune reconciliation thresholds with targeted long-run multiplayer checks.

4. Production-quality UX pass
- Continue replacing prototype-feel interfaces with game-ready UI quality (layout, readability, interaction polish).

## Known Issues

- Rapier startup warning still appears in server runs: `using deprecated parameters for the initialization function; pass a single object instead`.

## Handoff Notes

- On Windows, run Node/npm commands in one `cmd` chain: `nvm use 20.19.0 && npm ...`.
- Ask user before adding/upgrading dependencies.
- Commit after meaningful verified changes; push at milestone boundaries or when asked.
