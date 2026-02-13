# Project Overview

## Purpose

This repository is a production-oriented foundation for a first-person, authoritative, multiplayer 3D browser game.

Core goals:
- Server-authoritative simulation and anti-cheat-friendly trust boundaries.
- High-performance netcode using nengi 2.0 patterns.
- Browser rendering with Three.js and gameplay physics with Rapier.
- Scalable architecture targeting persistent worlds and high player counts over time.

## Current Stack

- Language/runtime: TypeScript + Node.js 20.19.x
- Build/dev: Vite
- Networking: `nengi@2.0.0-alpha.173`
- Preferred server transport: `nengi-uws-instance-adapter` (`uWebSockets.js`)
- Client networking: `nengi-websocket-client-adapter`
- Rendering: `three`
- Physics: `@dimforge/rapier3d-compat`
- Browser automation tests: Playwright

## High-Level Architecture

- Strict client/server separation.
- Server owns authoritative world state and simulation.
- Client sends intent/commands, not authoritative state.
- Client renders local prediction and reconciles against server snapshots.
- Shared protocol/types live under `src/shared`.

Entry points:
- Client: `src/client/main.ts`
- Server: `src/server/main.ts`

Key runtime modules:
- `src/server/GameServer.ts`: server lifecycle and networking setup.
- `src/server/GameSimulation.ts`: authoritative simulation/tick behavior.
- `src/client/runtime/NetworkClient.ts`: client netcode integration.
- `src/client/runtime/LocalPhysicsWorld.ts`: local prediction/collision path.
- `src/client/runtime/WorldRenderer.ts`: Three.js scene/render integration.

## Netcode Model

- Fixed server tick cadence with deterministic ordering.
- AOI/visibility via nengi spatial channels (`ChannelAABB3D` + per-user `AABB3D` views).
- Snapshot replication from server to clients.
- Client input commands include rotation deltas and movement intent.
- Client-side prediction uses Rapier KCC path to mirror server movement/collision as closely as possible.

## Current Behavioral Notes

- CSP is currently default OFF at runtime due to remaining on-platform jitter under real play.
- CSP can be toggled at runtime with `C` for testing.
- When CSP is enabled, client reconciliation uses a position-only render-side smoothing layer with correction-offset decay; yaw/pitch stay authoritative to keep camera-forward input alignment stable.
- Platform carry yaw reconciliation is now explicit: server acks include `platformYawDelta` so client can compose platform rotation without conflating it with player mouse-look yaw.
- Reconciliation metrics are exposed in runtime status text and `window.render_game_to_text` for diagnostics and automated artifact review.
- Core verification commands currently passing are recorded in `progress.md`.

## Common Commands

- `npm run dev`: start server + client
- `npm run dev:server`: start server only
- `npm run dev:client`: start client only
- `npm run typecheck`: run TS checks
- `npm run test:smoke`: Playwright smoke validation
- `npm run test:multiplayer`: two-client replication validation
- `npm run test:multiplayer:csp`: multiplayer validation in CSP-enabled mode

## Directory Guide

- `src/client`: browser client runtime and rendering
- `src/server`: authoritative simulation and network server
- `src/shared`: shared schemas/config/gameplay helpers
- `scripts`: test/automation scripts
- `docs`: local reference docs for nengi 2.0, Three.js, Rapier
- `progress.md`: active status, TODOs, and session handoff notes
- `AGENTS.md`: persistent agent instructions and memory rules
- `.codex/config.toml`: project-scoped Codex CLI defaults/profiles for this workspace
- `vision.md`: long-range product/gameplay/aesthetic direction
- `docs-map.md`: markdown file responsibilities and session read order

## Maintenance Rule

Keep this file current whenever architecture, core runtime behavior, tech stack, or core workflows materially change.
