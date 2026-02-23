# Project Overview

## Purpose

This repository is a production-oriented foundation for a first-person, authoritative, multiplayer 3D browser game.

Core goals:
- Server-authoritative simulation.
- High-performance netcode using nengi 2.0 patterns.
- Three.js rendering
- Rapier physics.
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
- Server networking boundary is explicitly layered in `src/server/net`:
  - `ServerNetworkHost`: nengi instance/channels/adapter lifecycle
  - `ServerNetworkEventRouter`: queue event/auth/command dispatch boundary
  - `ServerCommandRouter`: wire command split (`InputCommand` vs `LoadoutCommand`)
  - `ServerReplicationCoordinator`: replication bridge + messaging facade
- Client networking boundary is explicitly layered in `src/client/runtime/network`:
  - `NetTransportClient`: nengi client transport/interpolator adapter surface
  - `InboundMessageRouter`: protocol message routing boundary
  - `ClientNetworkOrchestrator`: CSP/reconciliation/platform-carry orchestration boundary
- Server simulation state is BitECS-backed (`src/server/ecs/SimulationEcs.ts`) with nengi replication bridged separately (`src/server/netcode/NetReplicationBridge.ts`) and keyed by ECS eid.
- Core content definitions are data-driven via JSON archetype catalogs in `data/archetypes/` (world/platform/projectile/server defaults and base ability definitions/default unlock/loadout).

Runtime entry points:
- Client: `src/client/main.ts`
- Server: `src/server/main.ts`

## Netcode Model

- Fixed server tick cadence with deterministic ordering.
- AOI/visibility via nengi spatial channels.
- Client prediction mirrors server movement/collision as closely as possible.
- Inbound wire commands are parsed at the net boundary (not simulation core), then applied as typed operations (`applyInputCommands`, `applyLoadoutCommand`).
- Simulation code does not directly parse raw nengi queue payloads.
- Client app loop delegates reconciliation + deterministic platform yaw carry to `ClientNetworkOrchestrator` instead of inlining netcode logic in `GameClientApp`.
- Local first-person camera look (`yaw`/`pitch`) is client-owned presentation state and updates immediately from local input regardless of CSP mode; reconciliation/acks correct authoritative movement state, not free-look camera orientation.
- Moving/rotating platforms are sampled deterministically from shared platform definitions on both server and client using synchronized server-time estimation; platform visuals no longer depend on per-tick replicated platform transform snapshots.
- Input acks carry authoritative player reconciliation state (`sequence`, `serverTick`, transform/velocity/grounded) only; platform yaw carry is derived from deterministic local platform deltas rather than ack payloads.

## Key Gameplay Systems (Current)

- Access-key-based auth (`#k=...` URL fragment + local storage fallback).
- SQLite persistence for account/character/loadout state.

## Common Commands

- `npm run dev`: start server + client
- `npm run dev:server`: start server only
- `npm run dev:client`: start client only
- `npm run typecheck`: run all TS checks
- `npm run verify:quick`: fast local loop (`typecheck:client` + `test:smoke:fast`, expects running services)
- `npm run test:smoke`: Playwright smoke validation
- `npm run test:multiplayer`: two-client replication validation
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
- `design-doc.md`: canonical game vision/product direction/gameplay and technical intent
