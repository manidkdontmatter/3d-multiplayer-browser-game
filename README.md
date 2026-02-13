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
- `npm run build` builds client and server artifacts.
- `npm run test:smoke` boots server+client, runs a Playwright smoke test, and writes artifacts to `output/smoke`.
  - Reuses existing local services on `9001`/`5173` if already running.
  - Cleans up spawned dev processes automatically on exit.
- `npm run test:multiplayer` validates two-client replication (client A movement must be visible on client B) and writes artifacts to `output/multiplayer`.

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
- Transport behavior:
  - Preferred: `uWebSockets` (`nengi-uws-instance-adapter`) for high-performance hosting.
  - Automatic fallback: `ws` adapter on unsupported Node versions.
  - Force fallback manually: set `NENGI_TRANSPORT=ws`.
