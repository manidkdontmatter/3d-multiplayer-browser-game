# Asset Loader and Serving Plan (Authoritative)

## Purpose

This document is the canonical production plan for non-code asset delivery/loading in this project.
It is intentionally replacement-oriented and does not attempt to preserve suboptimal existing asset behavior.

Primary goals:
- Lowest practical bandwidth usage for player-hosted VPS servers.
- Fast and reliable joins/rejoins with full page reload between map processes.
- Deterministic, scalable runtime behavior for authoritative multiplayer.
- Mod-friendly pipeline without requiring CDN infrastructure.

Decision policy for this document:
- This plan is intentionally unambiguous.
- Any item described as a decision is mandatory unless this file is explicitly revised.

## Constraints and Assumptions

- Browser game, desktop-only target (no mobile optimization requirement).
- Player-hosted VPS, no CDN.
- Each map runs in a separate process.
- Client performs full page reload on map transfer.
- JS/CSS/HTML are small and may load upfront.
- Main payload pressure is textures/models/animations/audio.
- Runtime humanoid standards remain VRM + VRMA.

## High-Level Architecture

- Nginx:
  - Serves all static files (`index.html`, built JS/CSS, `/assets/**`, `/manifests/**`).
  - Handles HTTP caching/compression headers.
  - Reverse-proxies API + WebSocket to Node processes.
- Node orchestrator/map processes:
  - Serve only game API/control-plane and realtime transport.
  - Do not serve heavyweight static assets.
- Browser client:
  - Uses Three.js loaders as decode backend.
  - Uses a centralized Asset Manager as orchestration layer.

Summary:
- Nginx provides files.
- Three.js loads/parses files.
- Asset Manager decides what/when/how to load.

## Static Hosting Topology (Production)

One-origin recommended (example):
- `https://host.example.com/` -> static shell
- `https://host.example.com/assets/...` -> models/textures/audio/anims
- `https://host.example.com/manifests/...` -> manifest JSON
- `https://host.example.com/api/...` -> reverse proxy to orchestrator
- `wss://host.example.com/ws/...` -> reverse proxy to map process WS

This avoids CORS complexity and keeps host setup simple.

## Asset Packaging Strategy

Important: "Logical bundles" are metadata groups, not mandatory archive packfiles.

### What to ship

- Code bundle:
  - Keep simple. No mandatory code splitting required right now.
- Content assets:
  - Shipped as individual hashed files.
  - Grouped in manifest by purpose (`core`, `map_x`, `biome_y`, `avatars`, `fx`, etc).

### Why this model

- Individual files:
  - Simple hosting/debugging.
  - Fine-grained cache reuse.
  - Easy mod replacement.
- Logical groups:
  - Lets runtime request by gameplay intent.
  - Allows optional prefetching without forcing all assets.

## Build Pipeline (Offline Asset Build)

Use a dedicated asset build step (not only Vite) to produce runtime-ready artifacts.

Pipeline responsibilities:
1. Ingest source assets.
2. Convert/compress to runtime formats.
3. Fingerprint files by content hash.
4. Emit manifest with metadata + dependency graph.

Outputs:
- `dist/client/assets/<type>/<name>.<hash>.<ext>`
- `dist/client/manifests/assets-manifest.<manifestHash>.json`
- `dist/client/manifests/runtime-bootstrap.json` (small entrypoint manifest pointer)

Vite still builds app code; asset pipeline owns heavy content artifacts.

## Runtime Formats

### Models

- Preferred container: GLB (for non-humanoid world assets).
- Compression: Meshopt only.
- Draco is out of scope for this plan and must not be introduced in implementation.

### Textures

- Preferred runtime format: KTX2/Basis-compressed textures.
- Keep source textures in authoring formats (PNG/TGA/etc) offline.
- Convert during asset build.

### Humanoids

- Avatars: VRM only.
- Animation clips: VRMA only.
- Any optimization must preserve VRM/VRMA runtime compatibility.

## Centralized Asset Manager (Client)

Create a dedicated subsystem, for example:
- `src/client/assets/AssetManager.ts`

Responsibilities:
- Manifest loading and lookup.
- Request deduplication.
- Priority scheduling.
- Concurrency limits.
- Loader dispatch (GLTFLoader, TextureLoader, AudioLoader, etc).
- Placeholder lifecycle and swap-in callbacks.
- Metrics/telemetry.

### Asset state machine

Each asset id transitions through:
- `unloaded`
- `queued`
- `loading`
- `ready`
- `failed`

### Request semantics

- `ensureAsset(assetId, priority)`:
  - Deduplicated Promise.
  - Returns immediately if already `ready`.
- `prefetchGroup(groupId)`:
  - Queues all assets in group at medium/low priority.
- `isReady(assetId)` and `get(assetId)` accessors.

### Priority tiers

- `critical`: needed now for visible gameplay element.
- `near`: likely needed very soon.
- `background`: opportunistic prefetch.

Given AOI behavior, prioritize aggressively and avoid excessive cancel/requeue churn.

## On-Demand Strategy (Sandbox-Friendly)

Because objects may appear at arbitrary times:

- Server replication includes stable `assetId`/`archetypeId` references.
- When unknown asset appears:
  1. Spawn deterministic placeholder visual immediately.
  2. Queue real asset load at `critical` priority.
  3. Atomically swap placeholder -> real render asset when ready.

Never block simulation or netcode on asset fetch.

## Map Transfer + Full Reload Behavior

Current full page reload transfer model is acceptable for phase 1 and aligns with strict isolation.

Implications:
- In-memory JS objects are dropped automatically on reload.
- Outstanding fetches are naturally cancelled by navigation.
- Runtime eviction/cancellation complexity can be deferred.

What still matters:
- Strong HTTP caching so reloads do not re-download unchanged assets.

## Caching and Versioning

### Cache model

- Hashed content files:
  - `Cache-Control: public, max-age=31536000, immutable`
- Manifest files:
  - Short TTL + revalidation (`ETag`, `must-revalidate` style).

### Result

- Reload between maps typically reuses cached assets.
- Only changed hashes are fetched.
- Excellent for player-hosted bandwidth costs over repeated sessions/transfers.

## Nginx Configuration Policy (Required)

Nginx should:
- Serve `/assets/` and `/manifests/` from static directory.
- Set strong cache headers for hashed assets.
- Set short/revalidated cache headers for manifests.
- Enable compression for text assets (`gzip`, optional `brotli`).
- Reverse proxy `/api/` and `/ws/` to Node/orchestrator/map runtime.

## Deduplication, Cancellation, Eviction

### Deduplication

Required in phase 1.
- Multiple requests for same asset id share one in-flight Promise.

### Cancellation

Phase 1:
- Keep minimal cancellation logic.
- Rely mostly on priority scheduling.
- Natural cancellation occurs on full reload map transfer.

### Eviction

Phase 1:
- Not required due to frequent map reload and desktop target.

Phase 2 (optional):
- Add memory budgets + LRU if long-lived non-reload sessions or very large modded asset sets become common.

## Compression Savings and Hitch Risk

These are practical industry ranges, not hard guarantees.

### Texture compression (KTX2/Basis)

Typical wins:
- Download size: often ~50% to 85% reduction vs PNG/JPEG-heavy runtime sets (scene-dependent).
- GPU memory footprint: often ~60% to 85% reduction vs raw RGBA uploads.

Hitch risk:
- Transcoding has CPU cost.
- Mitigation:
  - Use KTX2Loader worker path.
  - Warm transcoder early during startup.
  - Prioritize critical textures first.
  - Preload only small core texture subset.

Net: usually strongly worth it for bandwidth + VRAM, especially for host-paid bandwidth.

### Mesh compression (Meshopt only)

Meshopt:
- Typical geometry size reduction: ~30% to 60%.
- Decode cost: generally low, better for runtime streaming.

### Is "30% only" worth it?

For player-hosted servers, even 30% sustained savings can be meaningful in bandwidth costs over time.
For this project, the chosen lane is:
- KTX2/Basis for runtime textures.
- Meshopt for runtime non-humanoid model geometry.
- No Draco.

## Manifest Contract (Proposed)

Example fields:
- `manifestVersion`
- `buildId`
- `assets[]`:
  - `id`
  - `url`
  - `type` (`model`, `texture`, `audio`, `animation`)
  - `hash`
  - `bytes`
  - `deps[]`
  - `groups[]`
  - `priorityHint`
- `groups{}`:
  - `core`
  - `map:<id>`
  - `biome:<id>`
  - `avatar:<id>`
  - `fx:<id>`

Do not require downloading all assets in a group.
Groups are selection/indexing tools.

## Modded Host Safety Controls

Add validation limits at manifest ingest/load time:
- Per-asset max byte size by type.
- Per-group max byte budget.
- Allowed mime/extensions only.
- Optional hash verification.
- Hard fail or soft quarantine policy for invalid mod assets.

This prevents malicious or accidental oversized content from degrading client stability.

## Instrumentation and Acceptance Criteria

Track:
- Cache hit rate.
- Average asset fetch time by type.
- Time-to-first-playable.
- Time-to-first-real-visual-swap for placeholdered entities.
- Reload transfer bandwidth delta with warm cache.

Phase 1 acceptance:
1. Nginx serves static assets + reverse proxy works for API/WS.
2. Asset manager deduplicates in-flight requests.
3. Client supports per-asset on-demand loads.
4. Core-only preload path exists.
5. Placeholder swap path works for late assets.
6. Hashed static assets + cache headers verified.
7. Reload transfer reuses browser cache for unchanged assets.

## Phased Implementation

### Phase 1 (required)
- Introduce asset build pipeline with hashing + manifest generation.
- Implement centralized asset manager with dedup + priorities.
- Convert from "preload all" to "core preload + on-demand".
- Configure Nginx static + proxy and cache headers.
- Keep full reload transfer model.

### Phase 2 (recommended)
- KTX2/Basis rollout for texture classes.
- Meshopt rollout for world models.
- Add deeper telemetry and loading diagnostics UI.

### Phase 3 (optional)
- Memory budget + LRU eviction in long non-reload sessions.
- Advanced prefetch heuristics by gameplay context.

## Final Decisions

- No CDN dependency.
- Nginx is the production static asset server and reverse proxy.
- Three.js loaders remain the client decode backend.
- Central Asset Manager is authoritative runtime loading orchestrator.
- Use logical groups in manifest without forcing whole-group downloads.
- Keep full page reload transfer in phase 1; exploit browser cache instead of preserving runtime state.
- Runtime compression lane is fixed: KTX2/Basis textures + Meshopt geometry, no Draco.
