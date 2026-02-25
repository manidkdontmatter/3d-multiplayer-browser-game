# Procedural Maps and Multi-Map Process Architecture Plan

## Purpose

This document is the canonical implementation plan for:

1. Procedural map generation/content loading.
2. Running multiple authoritative map simulations on one VPS.
3. Player transfer between map simulations.

It is written so a future AI can implement the systems without prior chat context.

## Canonical Constraints

- This repo is one player-hosted game server runtime on one VPS.
- The global server-list website is a separate app and out of scope here.
- Joining from the global server list means leaving that website and loading the host's own URL/domain/IP.
- No traditional account/password login exists.
- Identity is key-based (`authKey`); no key means disposable session character.
- Networking runtime for map simulation remains nengi 2.x patterns only.

## Terms

- `orchestrator`: local control-plane process on the host VPS (not the global server list).
- `map process`: one authoritative gameplay simulation process running one map instance.
- `map instance`: one running world with its own simulation state (seed/config-driven).
- `MapConfig`: deterministic generation input for a map instance.
- `transfer token`: short-lived one-time token allowing secure handoff between map processes.

## High-Level Topology (One VPS)

### Processes

1. `orchestrator` (single process)
2. `map process` instances (N processes, one per map instance)

### Responsibilities

#### Orchestrator

- Entry coordination for clients arriving on this host.
- Resolve identity from `authKey` (or mark as disposable session).
- Route initial join to default map instance.
- Supervise map processes (spawn/restart/health registry).
- Issue + validate transfer tokens.
- Single persistence writer for SQLite.
- Store latest in-memory snapshots received from map processes.
- Flush snapshots/events to DB on configured cadence and critical-event policy.

#### Map Process

- Own authoritative simulation: nengi `Instance`, AOI channels, Rapier, ECS, tick loop.
- Handle gameplay commands and replication.
- Generate map static state (same deterministic path as client).
- Generate dynamic authoritative entities server-side (NPCs/items/interactables/etc).
- Send persistence snapshots/events to orchestrator.
- Never write DB directly.

## Process vs Worker Threads Decision

Current decision: use separate processes for map simulation.

Why:

- Better fault isolation.
- Cleaner restart and supervision per map instance.
- Rare cross-map communication does not justify worker-thread shared-memory complexity.
- Node workers are isolated heaps by default anyway; shared memory is explicit opt-in.

## Networking and Connection Model

- nengi exists only inside map processes.
- Orchestrator is not a nengi simulation.
- Map transfer is reconnect-based between map processes.
- Phase 1 uses direct map WS endpoint returned by orchestrator/transfer payload.
- Optional later: front proxy can hide per-map ports behind one public endpoint.

### Control-plane transport decision

Phase-1 default for orchestrator <-> map-process control traffic is localhost HTTP JSON RPC (loopback only).

Why this is preferred over Node child-process IPC:

- Better observability with standard HTTP tooling (status codes, latency metrics, request logs, tracing hooks).
- Easier debugging and operations (`curl`/health probes) without custom IPC inspectors.
- Looser runtime coupling between processes while still keeping traffic local and cheap.
- Performance impact is negligible for low-frequency control-plane messages.

## Player Lifecycle

### Initial join

1. Browser loads host's game client.
2. Client submits `authKey` (if present) to orchestrator bootstrap endpoint.
3. Orchestrator resolves saved/default/disposable character state. If no persisted character exists, spawn default human and allow in-world customization later.
4. Orchestrator returns `JoinTicket` with target default map endpoint + one-time token.
5. Client connects to that map process via nengi handshake using the token.

### Map transfer

1. Player triggers portal/gate/cave transfer in source map.
2. Source map sends transfer request to orchestrator (`fromMapId`, `toMapId`, `characterId`).
3. Orchestrator ensures destination map exists (spawn if needed).
4. Orchestrator issues one-time short-TTL transfer token.
5. Source map sends transfer payload to client.
6. Client disconnects source and reconnects destination endpoint with token.
7. Destination validates token with orchestrator, loads state, spawns player.
8. Source process finalizes old session cleanup after success/timeout.

### Join ticket requirements (initial entry)

`JoinTicket` should follow the same security posture as transfer tokens and minimally include:

- `joinId`
- `authKeyHash` (or disposable session id)
- `characterId` (if persistent)
- `targetMapId`
- `issuedAtMs`
- `expiresAtMs`
- `nonce`
- signature/MAC

Rules:

- One-time use.
- Short TTL.
- Bound to exact target map instance and identity context.

## Transfer Token Requirements

Token intent: authorization + replay protection + handoff integrity.

Required claims:

- `transferId`
- `authKeyHash` (never raw key in logs)
- `characterId`
- `fromMapId`
- `toMapId`
- `issuedAtMs`
- `expiresAtMs`
- `nonce`
- signature/MAC

Rules:

- One-time use only.
- Short TTL (5-15 seconds target).
- Invalid after consume.
- Bound to destination map and character.
- Signed with host secret (HMAC or equivalent server-side signature verification).

### Transfer state machine invariants

Use an explicit transfer lifecycle to prevent dupes and split-brain ownership:

1. `requested` (source asked orchestrator to transfer)
2. `token_issued` (orchestrator minted transfer token)
3. `destination_accepted` (destination validated token and reserved spawn)
4. `source_released` (source removed active player authority)
5. `completed` (destination active authority)
6. `aborted` (timeout/error; player returns via fallback path)

Hard invariant:

- One character may be authoritative in at most one map process at a time.

## Procedural Map Generation Model

### Core decision

- Primary map pipeline is deterministic seed/config generation, not mandatory map-GLB files.
- Server + client both generate static deterministic world geometry/colliders from the same inputs.
- Server additionally generates mutable/dynamic gameplay entities authoritatively.
- Client does not spawn authoritative dynamic entities from seed; nengi replication handles those.

### Static generation (shared server/client)

- Terrain surface and bounds (target map size around 2km x 2km per map unless configured).
- Static non-interactive props.
- Static colliders and navigation base geometry.
- Visual-only deterministic placement from asset catalogs.

### Dynamic generation (server-only)

- NPC populations.
- Mutable items/interactables.
- Destructible/mutable gameplay objects.
- Any gameplay actor that can change state.

## No-Chunking Decision (Current Stage)

- Maps are small enough at current target to generate/load as one map payload/config.
- Chunk streaming is explicitly out of scope for Phase 1.
- If future memory/load profiling requires chunking, add later as a separate design.

## Determinism Requirements (Critical)

Shared static generation must be deterministic between server and client:

- Use a deterministic PRNG from seed (do not use `Math.random()` for generation).
- Keep generation order stable (sorted iteration where applicable).
- Prefer integer/quantized math for placement keys where possible.
- If floating noise is used, use the same implementation and parameter order on both sides.
- Generation inputs must be fully explicit (`MapConfig`, seed, bounds, asset set ids).
- Static object ids should be deterministic (derived from map seed + generator order/index).

## MapConfig Contract

Minimum `MapConfig` fields:

- `mapId`
- `instanceId`
- `seed`
- `bounds`
- `terrain` params
- `biome` params
- `propSetIds`
- `staticCollider` params
- `generationRules` knobs (npc density/interactable density/etc; server may use superset)

`MapConfig` sources:

- pre-authored data files for known maps
- runtime-generated config for newly discovered/generated maps

## Runtime Creation of New Maps

- Orchestrator can create a new map instance at runtime using generated `MapConfig`.
- New map creation is first-class and not limited to pre-existing files.
- Destination map can be spawned lazily when first transfer/join requests it.

## Persistence Strategy (Current Stage)

### Database engine

- SQLite remains current default.

### Single-writer model

- Only orchestrator writes to DB.
- Map processes send snapshot/event updates to orchestrator.
- Orchestrator maintains latest in-memory state cache.
- Orchestrator performs periodic checkpoint flushes (default target: every 5 minutes).
- Disposable sessions (no `authKey`) are not required to persist on disconnect.

### Snapshot contract (map process -> orchestrator)

- Map processes send snapshot payloads as authoritative state sections, not one global mega payload.
- Snapshot scope should be per-character/per-map-instance partitions.
- Snapshot payloads should include `instanceId`, `revision`, and server timestamp.
- Snapshot pushes are in-memory ingestion first; DB durability follows checkpoint/critical policy.
- Snapshot ingest must be idempotent by `(instanceId, revision)` or equivalent monotonic key.

### Hybrid durability policy

- Most state can be checkpointed on periodic flush.
- Critical integrity/economy events must be durably written before ack:
  - item ownership/value transfer
  - spend/drop/trade
  - map transfer boundary commit points
  - any exploit-sensitive mutation

### Idempotency and ordering

- Persistence events from map processes must include monotonic `mapTick` or `revision` and `eventId`.
- Orchestrator applies idempotent upsert/event handling to avoid duplicates on retries.
- Crash recovery should rehydrate from last durable checkpoint + critical event records.

### Storage shape guidance

- Avoid one giant monolithic JSON row for all world state.
- Use structured tables/rows (character, inventory, map-instance persistent state, etc.).
- Use WAL mode and batched transactions.

## SQLite Position

- Keep SQLite now with orchestrator single-writer model.
- Gameplay/map processes must remain DB-agnostic behind a persistence interface in case we switch away from SQLite later.

## Asset Delivery for Procedural Maps

- Primary path: ship reusable asset libraries (models/textures/material definitions), then deterministic placement from seed/config.
- Full-map GLB is optional, not required.
- Client receives/uses asset manifests and generation config; static render build comes from deterministic placement.
- Dynamic entities still come from authoritative replication.

## Security and Trust Boundaries

- Client is never authoritative for gameplay state.
- Seed/config generation on client is a rendering/prediction convenience for static world only.
- Orchestrator validates transfer tokens and map join tickets.
- Avoid exposing raw `authKey` in logs/telemetry; use redacted/hash form.
- Internal control RPC endpoints must bind to loopback only (`127.0.0.1`/`::1`) and require an internal shared secret header.

## Failure Handling

- If destination map join fails, default Phase-1 policy is:
  - return player to source map if source is still healthy, else
  - issue a fresh join ticket to default map.
- Expired/invalid transfer token returns structured transfer-denied reason and re-bootstrap path.
- Map process crash: orchestrator marks instance unhealthy and applies restart backoff.
- Persistence crash window: periodic checkpoint policy accepts bounded rollback for non-critical state.

### Phase-1 restart backoff default

- Up to 3 restart attempts per map instance within 60 seconds.
- If threshold exceeded, quarantine that instance for 60 seconds and deny new joins/transfers to it.
- Existing transfer requests targeting quarantined instances should fail fast with explicit reason.

## Phase-1 Concrete Decisions (to avoid ambiguity)

- Multi-map runtime uses separate map processes, not worker threads.
- Orchestrator is single persistence writer for SQLite.
- Map transfer is reconnect-based with one-time transfer tokens.
- Control RPC transport default: localhost HTTP JSON RPC on the same host.
- No chunked map streaming in Phase 1.
- Static world generated deterministically from `MapConfig` + seed on both server and client.
- Dynamic mutable gameplay entities are server-only generation and replicated.

## Suggested Repo Implementation Layout

- `src/orchestrator/main.ts`
- `src/orchestrator/process/MapProcessSupervisor.ts`
- `src/orchestrator/transfer/TransferTokenService.ts`
- `src/orchestrator/persistence/OrchestratorPersistenceWriter.ts`
- `src/orchestrator/ipc/contracts.ts`
- `src/server-map/main.ts`
- `src/server-map/runtime/MapRuntime.ts`
- `src/shared/maps/MapConfig.ts`
- `src/shared/maps/DeterministicMapGenerator.ts`

(Names can vary, but responsibilities should match.)

## Minimum Control RPC Contract Surface

Orchestrator -> map process:

- `StartMapInstance(MapConfig)`
- `StopMapInstance(instanceId)`
- `ValidateJoinTicket(token)`
- `PrepareIncomingTransfer(transferToken)`
- `AckTransferComplete(transferId)`

Map process -> orchestrator:

- `MapReady(instanceId, endpoint, healthMeta)`
- `MapHeartbeat(instanceId, runtimeStats)`
- `RequestTransfer(characterId, fromMapId, toMapId)`
- `PersistSnapshot(instanceId, revision, snapshotPayload)`
- `PersistCriticalEvent(instanceId, eventId, eventPayload)`
- `TransferResult(transferId, success, reason?)`

Cross-map communication rule:

- Map processes should not directly RPC each other in Phase 1.
- Cross-map coordination goes through orchestrator to keep topology simple and auditable.

### Suggested localhost HTTP route shape (Phase 1)

Map process exposes (loopback + internal secret required):

- `POST /control/start-instance`
- `POST /control/stop-instance`
- `POST /control/validate-join-ticket`
- `POST /control/prepare-incoming-transfer`
- `POST /control/ack-transfer-complete`
- `GET /health`

Orchestrator exposes (loopback + internal secret required):

- `POST /orch/map-ready`
- `POST /orch/map-heartbeat`
- `POST /orch/request-transfer`
- `POST /orch/persist-snapshot`
- `POST /orch/persist-critical-event`
- `POST /orch/transfer-result`

## Open Decisions (Still Legitimately Open)

- Whether to add a localhost WS/SSE event stream for richer map-runtime telemetry beyond HTTP request/response control RPC.
- Exact player UX on transfer loading screen/retry policy.
- Final critical-event classification list.
- Final restart/backoff parameter values after load testing (defaults are defined above).

## Acceptance Criteria for First Implementation

1. Client can join host through orchestrator and land on default map.
2. Client can transfer from map A to map B and preserve character state.
3. Transfer token replay attempt is denied.
4. Invalid/expired join ticket is denied.
5. Map process crash does not crash orchestrator or other map processes.
6. SQLite receives writes only from orchestrator process.
7. Non-critical state may roll back up to checkpoint window after crash.
8. Critical durability events survive crash/restart according to policy.
9. Static procedural geometry generated by server and client matches deterministically for same `MapConfig` + seed.

## Recommended Initial Tunables

- `ORCH_CHECKPOINT_MS=300000` (5 minutes)
- `ORCH_TRANSFER_TOKEN_TTL_MS=10000` (10 seconds)
- `ORCH_JOIN_TICKET_TTL_MS=10000` (10 seconds)
- `ORCH_HEARTBEAT_TIMEOUT_MS=15000` (15 seconds before map marked unhealthy)
- `MAP_HEARTBEAT_MS=5000` (map process heartbeat cadence)
- `MAP_SNAPSHOT_PUSH_MS=10000` (map snapshot push cadence to orchestrator memory)
- `ORCH_MAP_RESTART_WINDOW_MS=60000`
- `ORCH_MAP_RESTART_MAX_IN_WINDOW=3`
- `ORCH_MAP_QUARANTINE_MS=60000`
- `ORCH_INTERNAL_RPC_SECRET=<random-long-secret>`
- `MAP_CONTROL_PORT_BASE=9100`

These should be env-configurable; values above are starting defaults, not hard requirements.
