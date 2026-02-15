# Current Progress

Last updated: 2026-02-15

## Recent Verified

- 2026-02-15: `npm run typecheck:client` passed.
- 2026-02-15: `npm run typecheck:server` passed.
- 2026-02-15: `npm run test:smoke` passed.
- 2026-02-15: `npm run test:multiplayer:quick` passed.
- 2026-02-15: `npm run test:melee` passed.
- 2026-02-15: `node scripts/projectile-fx-check.js` passed.

## Active Priorities

1. Ability system expansion
- Extend runtime creator execution beyond projectile + basic melee templates (passive/utility paths).
- Add stronger creator end-to-end assertions (catalog/loadout replication + cast behavior).

2. Persistence hardening
- Add schema migration/versioning workflow with rollback-safe upgrade notes.
- Add reconnect/restart persistence e2e coverage, including reconnect before flush.
- Add operator docs for flush cadence, DB path, and backup cadence.

3. Animation expansion
- Add strafe/backpedal/turn-in-place/land/hit-react clips on top of current layered architecture.
- Keep root motion OFF by default; allow per-clip opt-in only when explicitly needed.

4. Netcode stability/observability
- Continue reducing CSP/platform jitter without weakening authoritative boundaries.
- Tune reconciliation thresholds with targeted long-run multiplayer checks.

## Current Blockers / Known Issues

- Server startup still logs Rapier warning: `using deprecated parameters for the initialization function; pass a single object instead`.

## Handoff Notes

- On Windows, run Node/npm commands in one `cmd` chain: `nvm use 20.19.0 && npm ...`.
- Ask user before adding/upgrading dependencies.
- Commit after meaningful verified changes; push at milestone boundaries or when asked.
