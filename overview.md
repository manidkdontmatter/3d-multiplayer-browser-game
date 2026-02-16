# Project Overview

## Purpose

This repository is a production-oriented foundation for a first-person, authoritative, multiplayer 3D browser game.

Core goals:
- Server-authoritative simulation with anti-cheat-friendly trust boundaries.
- High-performance netcode using nengi 2.0 patterns.
- Three.js rendering + Rapier physics in the browser.
- Scalable architecture for persistent worlds and high player counts.

## Current Stack

- Language/runtime: TypeScript + Node.js 20.19.x
- Build/dev: Vite
- Networking: `nengi@2.0.0-alpha.173`
- Server transport: `nengi-uws-instance-adapter` (`uWebSockets.js`)
- Client networking: `nengi-websocket-client-adapter`
- Rendering: `three`
- Humanoid runtime: `@pixiv/three-vrm`, `@pixiv/three-vrm-animation`
- Physics: `@dimforge/rapier3d-compat`
- Browser automation tests: Playwright

Humanoid asset ingestion/conversion tools in this repo:
- `fbx2vrma-converter` (npm CLI) for FBX animation -> VRMA conversion.
- `tools/avatar-asset-pipeline/avatar-build.exe` for pipeline-driven FBX/GLB -> VRM and pose/material normalization.

Canonical ingestion intent:
- Convert source humanoid models and animations offline to `VRM`/`VRMA` before runtime use.

## High-Level Architecture

- Strict client/server separation.
- Server owns authoritative world state + simulation.
- Client sends intent/commands only.
- Client runs local prediction and reconciles to authoritative snapshots.
- Shared schemas/protocol/helpers live in `src/shared`.

Runtime entry points:
- Client: `src/client/main.ts`
- Server: `src/server/main.ts`

Core modules:
- `src/server/GameServer.ts`: server lifecycle + networking setup.
- `src/server/GameSimulation.ts`: authoritative tick/simulation.
- `src/server/persistence/PersistenceService.ts`: SQLite-backed auth + character/loadout/runtime-ability persistence.
- `src/client/bootstrap.ts`: staged startup orchestration.
- `src/client/runtime/NetworkClient.ts`: client netcode integration.
- `src/client/runtime/LocalPhysicsWorld.ts`: local prediction/collision path.
- `src/client/runtime/WorldRenderer.ts`: Three.js scene/render runtime.
- `src/client/ui/AbilityHud.ts`: hotbar + loadout + creator panels.

## Netcode Model

- Fixed server tick cadence with deterministic ordering.
- AOI/visibility via nengi spatial channels.
- Snapshot replication includes authoritative timing data.
- Input command stream carries movement/look and primary-action intents.
- Low-frequency loadout/equip changes use explicit `LoadoutCommand`.
- Server movement integration is tick-owned (`SERVER_TICK_SECONDS`).
- Client prediction mirrors server movement/collision as closely as possible.

Authoritative combat and physics highlights:
- Projectile abilities: pooled server projectile objects.
- Projectile collision: authoritative Rapier swept shape-cast queries.
- Melee abilities: server-side range/radius/arc checks.

## Key Gameplay Systems (Current)

- Runtime ability pipeline with server-authoritative creation/validation/execution.
- Access-key-based auth (`#k=...` URL fragment + local storage fallback).
- SQLite persistence for account/character/loadout/runtime-ability state.

## Common Commands

- `npm run dev`: start server + client
- `npm run dev:server`: start server only
- `npm run dev:client`: start client only
- `npm run typecheck`: run all TS checks
- `npm run verify:quick`: fast local loop (`typecheck:client` + `test:smoke:fast`, expects running services)
- `npm run test:smoke`: Playwright smoke validation
- `npm run test:multiplayer`: two-client replication validation
- `npm run test:multiplayer:quick`: faster multiplayer sanity run
- `npm run test:multiplayer:csp`: multiplayer validation with CSP enabled
- `npm run test:multiplayer:chaos`: CSP validation under simulated ack drop/reorder jitter

## Directory Guide

- `src/client`: browser runtime + rendering
- `src/client/assets`: asset manifest + preload/cache utilities
- `public/assets`: browser-served runtime assets
- `src/server`: authoritative simulation + network server
- `src/shared`: shared schemas/config/helpers
- `scripts`: test/automation scripts
- `docs`: local reference docs for nengi/Three.js/Rapier
- `AGENTS.md`: persistent operating instructions/memory rules
- `vision.md`: product/game direction
- `docs-map.md`: markdown file responsibilities/read order

## Maintenance Rule

Update this file when architecture, core runtime behavior, stack, or primary workflows materially change.
