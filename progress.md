## Current Status

- Core stack is running: authoritative nengi server + three.js client + Rapier physics.
- AOI is active via `ChannelAABB3D` and per-user `AABB3D` views.
- Client/server movement uses shared FPS movement helpers.
- Deterministic moving/rotating platforms are implemented and replicated.
- CSP is platform-aware: on-platform local rendering uses server local pose; off-platform CSP prediction/replay resumes.
- Input netcode now sends `yawDelta` (not absolute yaw) so platform yaw carry and look input compose correctly.
- Remote player capsules now include a visor cube to indicate facing direction.
- Fast iteration check is available: `npm run test:smoke:fast` (expects server/client already running).
- Client netcode inbound processing is now FIFO, and input-ack trimming is wrap-safe for UInt16 sequence rollover.
- Server tick interval metrics sampling is now bounded (ring buffer) to avoid unbounded long-run memory growth.
- Server per-second tick summary logging can now be disabled with `SERVER_TICK_LOG=0` (test scripts set this by default).
- Multiplayer test now always writes debug artifacts (`state.json`, `client-a.png`, `client-b.png`, `console-a.json`, `console-b.json`) even on failure.
- Join spawn is now occupancy-based, so newly connecting players do not spawn inside existing player capsules.
- Multiplayer test now enforces spawn non-overlap directly using the player capsule diameter threshold (old "move player B away from overlap" workaround removed).
- Client CSP prediction now uses Rapier KCC (kinematic collider + `computeColliderMovement`) to mirror server collision path and reduce reconciliation jitter against static geometry.
- Server moving-platform carry regression fixed after KCC refactor: platform attachment no longer drops during upward motion, and rotating-platform yaw carry remains stable.
- Fixed post-platform `WASD` direction drift by synchronizing input look angles with authoritative yaw while platform-carried and resetting `NetworkClient` yaw-delta baseline (`lastSentYaw`) when look is externally realigned.
- Refined platform yaw handling: switched from per-ack absolute look snapping to additive authoritative platform yaw deltas + thresholded exit reconcile to reduce camera/input discontinuities.
- Removed the client platform-CSP bypass: CSP now runs on-platform too, with LocalPhysicsWorld applying platform carry and grounded-platform attachment logic mirroring server behavior.
- CSP reconciliation now preserves camera/input alignment by shifting queued replay input yaw when external yaw corrections are applied (platform carry + dismount reconcile).
- CSP reconciliation smoothing is now position-only (no render yaw/pitch offsets), while still tracking yaw/pitch error metrics and hard-snap thresholds.
- Fixed on-platform CSP look/movement drift: server input-ack now sends explicit `platformYawDelta`, and client applies only that carry delta (instead of inferring carry from total ack yaw change that also includes mouse-look).
- Added client-side predicted platform yaw carry on CSP frames with residual ack correction (`ack.platformYawDelta - predictedCarrySinceAck`) to reduce visible on-platform rotational jitter.
- Server authority hardening: `GameSimulation.applyCommands` now ignores client-provided `delta` for movement integration, merges only fresh command sequences, and integrates velocity updates using `SERVER_TICK_SECONDS`.
- Client reconciliation hardening: `NetworkClient` now accepts only strictly newer ack sequences (wrap-safe), dropping stale/out-of-order acks that could rewind CSP state.
- Runtime policy update: when CSP is user-enabled, it is now auto-suppressed while server-authoritatively platform-grounded (`csp=auto-off` in HUD), then automatically resumes after dismount.
- Adaptive interpolation delay is now runtime-tuned from observed ack inter-arrival jitter + latency (replacing the fixed 100ms interpolation delay).
- Snapshot tick stamping added to replicated `PlayerEntity` and `PlatformEntity` (`serverTick`) to improve frame-age visibility and interpolation diagnostics.
- Added opt-in ack chaos simulation in client netcode (`?netsim=1&ackDrop=...&ackDelayMs=...&ackJitterMs=...`) for out-of-order/drop resilience testing.
- Added `npm run test:multiplayer:chaos` for CSP multiplayer validation under simulated ack drop/reorder conditions.
- Added reconciliation observability in client status + `render_game_to_text` payload (last correction error, smoothing offset magnitude, replay depth, hard-snap counts).
- Added project-scoped Codex config at `.codex/config.toml` with workspace-write sandbox defaults, live web search, official OpenAI docs MCP server wiring, and opt-in `full_auto` / `safe_audit` profiles.
- Updated project-scoped Codex config defaults for higher throughput: `approval_policy = "never"` with `sandbox_mode = "workspace-write"`, plus a `profiles.yolo` alias for explicit danger-full-access runs.
- Expanded `test:multiplayer` assertions: sprint movement, jump height gain, and disconnect/reconnect remote reappearance are now validated and recorded in `output/multiplayer/state.json`.
- Added `test:multiplayer:csp` command and validated the multiplayer suite under `E2E_CSP=1`.
- Multiplayer automation now includes a post-connect warmup window and bounded retry windows for remote movement/jump checks to reduce startup/throttling false negatives.
- Tooling note captured: on Windows `nvm use` PATH updates are shell-scoped; run `nvm use ... && npm ...` in one `cmd` invocation for reliable automation commands.
- Latest verification (2026-02-13): `npm run typecheck`, `npm run test:smoke`, `npm run test:multiplayer`, `npm run test:multiplayer:csp`, and `npm run test:multiplayer:chaos` all pass after adaptive interpolation + snapshot tick stamping + chaos-net simulation updates.
- Client boot now has a staged loading overlay with progress bar (`#boot-overlay`) that tracks manifest preload and startup phases (physics -> network -> ready).
- Asset pipeline now uses Three.js loaders (`GLTFLoader`, `TextureLoader`, `AudioLoader`, `FileLoader`) through `src/client/assets/assetLoader.ts`, with a runtime cache for preloaded assets.
- Latest verification (2026-02-13, asset-loading pass): `npm run typecheck`, `npm run test:smoke`, and `npm run test:multiplayer` pass after boot overlay + asset preloader integration.

## Session Close Notes (2026-02-13)

- Runtime default changed: CSP is now OFF by default. Players can still toggle CSP ON/OFF in runtime with `C`.
- Reason: platform behavior is currently too jittery with CSP enabled in real play despite recent parity work.
- Follow-up TODO: revisit CSP on-platform jitter with deeper instrumentation and stabilization pass; keep current authoritative server path unchanged.

## Active TODO

- Tune reconciliation smoothing/hard-snap thresholds using targeted `?csp=1` multiplayer validation and capture jitter metrics over longer movement/platform runs.
- Add combat/state channel scaffolding for next gameplay systems.
- Expand automated tests further with combat-state assertions and longer-duration stability checks.
- Investigate Rapier startup warning (`using deprecated parameters for the initialization function`) and identify exact call site in dependency/runtime path.
- When character assets are selected, register them in `ASSET_MANIFEST` (with stable IDs/labels) and switch remote/local rendering from capsule placeholders to loaded GLTF rigs.
