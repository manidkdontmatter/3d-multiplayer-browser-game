# Browser Game

Authoritative server/browser-client scaffold using:

- `three` for rendering
- `@dimforge/rapier3d-compat` for client physics
- `nengi@2.0.0-alpha.173` for netcode

## Commands

- `npm run dev` starts client (`http://localhost:5173`) and server (`ws://localhost:9001`) together.
- `npm run dev:client` starts only the browser client.
- `npm run dev:server` starts orchestrator + map processes (multi-map local runtime).
- `npm run dev:server:single` starts only one legacy standalone server process.
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
- `npm run test:multiplayer:csp` runs the same multiplayer suite with `E2E_CSP=1` (CSP-enabled client mode).

## Runtime

- Standard runtime: Node `20.19.0` (see `.nvmrc`).
- If using nvm: run `nvm use 20.19.0` before running project commands.

## Notes

- Single entry points:
  - client: `src/client/main.ts`
  - server: `src/server/main.ts`
- Shared protocol/schemas live in `src/shared`.
- Client defaults to orchestrator bootstrap at `http://localhost:9000` and then connects to assigned map WS endpoint.
- Override direct map server URL in browser with `?server=ws://HOST:PORT`.
- Override orchestrator URL in browser with `?orchestrator=http://HOST:PORT`.
- Local debug transfer trigger in browser console: `window.request_map_transfer?.('map-b')` (or `'map-a'`).
- Server transport uses `uWebSockets` via `nengi-uws-instance-adapter` (Node 20.x in this project).

## Production Deploy (Nginx)

- Build artifacts:
  - `npm run build`
  - Client output: `dist/` (static files, including generated runtime manifests/assets).
  - Server output: `dist/server/` (orchestrator + server entrypoints).
- Example Nginx config:
  - `deploy/nginx.browser-game.example.conf`
- Run orchestrator/map runtime behind Nginx:
  - Nginx serves static files from `dist/`.
  - Nginx proxies `/bootstrap` (and optional `/health`) to orchestrator HTTP on `127.0.0.1:9000`.
  - Nginx stream block proxies a public TCP port range (example `9001-9300`) to the same localhost ports for map WS processes.

### Required orchestrator env for browser-visible WS URLs

Set:

- `ORCH_PUBLIC_WS_URL_TEMPLATE`

Example:

- `ORCH_PUBLIC_WS_URL_TEMPLATE=wss://game.example.com:{port}`

Behavior:

- Orchestrator `/bootstrap` and transfer responses will return `wsUrl` based on this template.
- `{instanceId}` is replaced with the map instance id (for example `map-a`) when present in the template.
- `{port}` is replaced with the map process WS port.

Important:

- If your map port allocation range changes, keep Nginx stream listen range and firewall rules in sync.
- Without `ORCH_PUBLIC_WS_URL_TEMPLATE`, orchestrator returns internal map ws URLs (for example `ws://localhost:9001`), which are not suitable for internet deployment.

## Project Docs

- `overview.md`: canonical summary of what the project is and how it works.
- `design-doc.md`: canonical game vision/product direction/gameplay and technical intent.
- `AGENTS.md`: persistent agent operating instructions/memory.
- `public/assets/README.md`: source runtime asset folder conventions and generated runtime asset output notes.
