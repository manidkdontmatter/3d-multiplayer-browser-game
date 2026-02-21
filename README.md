# Vibe Coded 3D Browser Game

Authoritative server/browser-client scaffold using:

- `three` for rendering
- `@dimforge/rapier3d-compat` for client physics
- `nengi@2.0.0-alpha.173` for netcode

## Commands

- `npm run dev` starts client (`http://localhost:5173`) and server (`ws://localhost:9001`) together.
- `npm run dev:client` starts only the browser client.
- `npm run dev:server` starts only the authoritative server.
- `npm run typecheck` runs separate client/server TS checks.
- `npm run typecheck:client` and `npm run typecheck:server` run targeted TS checks for faster iteration.
- `npm run verify:quick` runs `typecheck:client` + `test:smoke:fast` (expects server/client already running).
- `npm run verify:quick:standalone` runs `typecheck:client` + `test:smoke` (spawns missing services automatically).
- `npm run build` builds client and server artifacts.
- `npm run test:smoke` boots server+client, runs a Playwright smoke test.
  - Reuses existing local services on `9001`/`5173` if already running.
  - Cleans up spawned dev processes automatically on exit.
  - Writes artifacts by default only on failure (`E2E_ARTIFACTS_ON_PASS=1` to always write).
  - Optional: override client URL with `E2E_CLIENT_URL` (example: `E2E_CLIENT_URL=http://127.0.0.1:5173/?csp=1 npm run test:smoke`).
- `npm run test:multiplayer` validates two-client replication (client A movement must be visible on client B).
  - Also asserts sprint, jump, and disconnect/reconnect behavior.
- `npm run test:multiplayer:quick` runs a faster multiplayer pass (core movement/replication only; sprint/jump/reconnect skipped).
- `npm run test:multiplayer:fast` runs the quickest multiplayer iteration pass using existing services.
  - Requires local `dev:server` on `ws://127.0.0.1:9001` and `dev:client` on `http://127.0.0.1:5173`.
  - Reuses running server/client instead of starting new processes.
  - Runs movement/replication assertions only (skips primary-action/sprint/jump/reconnect checks).
- `npm run test:multiplayer:csp` runs the same multiplayer suite with `E2E_CSP=1` (CSP-enabled client mode).

## Runtime

- Standard runtime: Node `20.19.0` (see `.nvmrc`).
- If using nvm: run `nvm use 20.19.0` before running project commands.

## Notes

- Single entry points:
  - client: `src/client/main.ts`
  - server: `src/server/main.ts`
- Shared protocol/schemas live in `src/shared`.
- Client defaults to connecting to `ws://localhost:9001`.
- Override server URL in browser with `?server=ws://HOST:PORT`.
- Server transport uses `uWebSockets` via `nengi-uws-instance-adapter` (Node 20.x in this project).

## Project Docs

- `overview.md`: canonical summary of what the project is and how it works.
- `design-doc.md`: canonical game vision/product direction/gameplay and technical intent.
- `AGENTS.md`: persistent agent operating instructions/memory.
- `public/assets/README.md`: runtime asset folder conventions (`public/assets/**` is browser-served content).
