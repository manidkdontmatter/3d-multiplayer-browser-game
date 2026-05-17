# AGENTS.md

This file defines how AI coding agents should work in this repository.

The project is a production-oriented, first-person, authoritative-server, multiplayer open-world sandbox 3D browser game. It is designed to support 100+ concurrent players and 1000+ NPCs on a single player-hosted VPS, with no sharding as the default scaling assumption.

The codebase is AI-written and AI-maintained, so agents must actively guard against hallucinated architecture, duplicate systems, unnecessary abstraction, fake production readiness, and non-standard solutions to solved problems.

---

# 0. Priority Order

When rules conflict, follow this priority order:

1. **Server authority, security, and data integrity**
2. **Performance and scalability for high-CCU single-server gameplay**
3. **Engine/game separation and architectural boundaries**
4. **Correct use of existing libraries and established domain solutions**
5. **Maintainability, clarity, and simplicity**
6. **User preference and local style**

Do not satisfy a lower-priority rule by violating a higher-priority rule.

---

# 1. Project Stack and Platform

## Required stack

- Language: TypeScript
- Runtime/server: Node.js
- Client: browser
- Rendering: Three.js
- Physics: Rapier
- Networking: nengi 2.0
- Persistence: SQLite
- Humanoid avatar runtime format: VRM
- Humanoid animation runtime format: VRMA
- Primary development platform: Windows 10

## Platform assumptions

- Treat the game as desktop-first.
- Optimize for mouse and keyboard.
- Do not optimize for mobile unless explicitly requested.
- Prefer native web stack UI: TypeScript/JavaScript, HTML, CSS.
- Do not introduce a frontend UI framework unless explicitly approved.

---

# 2. Non-Negotiable Architecture Invariants

These are hard rules.

## Authoritative server

The server owns gameplay truth.

- The server owns world state, simulation state, character state, NPC state, combat state, inventory state, persistence state, and all authority-bearing decisions.
- The client sends intents/commands only.
- The client must never be trusted to decide authoritative gameplay outcomes.
- The client may hold a replicated, presentation-oriented subset of state needed for rendering, prediction, interpolation, UI, audio, and local feel, but the rule is the client must be as much of a graphical dummy as feasible.
- Never make the client authoritative because it is easier.

## Engine/game separation

The repository must preserve engine/game separation.

- `src/engine/` provides reusable capabilities.
- `src/game/` defines this specific game using engine APIs.
- `src/engine/` must never import from `src/game/`.
- Game-specific rules, content, definitions, balancing, and gameplay composition belong in `src/game/`.
- Reusable runtime capabilities belong in `src/engine/`.
- Shared types/schemas/constants used by both sides should live in an explicitly shared layer.

The engine is not a generic all-purpose engine. It is a specialized runtime for authoritative-server multiplayer first-person sandbox games. - The engine is a highly opinionated engine designed to create one genre of game: 3d first person multiplayer open world sandboxes of great flexibility and high scalability (CCU and entities) that are presumed to have standard features associated with this genre, for example hotbar and inventory, thus because the engine is so opinionated it provides these genre staples so 'game' doesn't have to.

## No duplicate parallel systems

Before adding a system, service, manager, component, network message, persistence path, UI path, asset path, or gameplay mechanism:

1. Search for an existing owner of that responsibility.
2. Decide whether the existing system should be extended, replaced, or deleted.
3. Do not create a near-duplicate path just to avoid refactoring.

If the existing system is bad, say so and replace it with the correct architecture instead of building around it.

## Production architecture only

Do not create throwaway solutions when the production solution or industry standard (game dev) solution is known.

Not allowed:
- prototype systems that become permanent
- compatibility hacks around broken architecture
- placeholder abstractions
- fake facades
- partial systems that knowingly fight the target architecture
- ai hallucinated nonsense

---

# 3. Dependency Direction

Use explicit dependency direction.

Allowed direction:

- `src/shared/` may be used by client, server, engine, and game.
- `src/engine/` may depend on `src/shared/` and external libraries.
- `src/game/` may depend on `src/engine/` and `src/shared/`.
- Client code may depend on client-facing engine APIs, shared schemas, and presentation code.
- Server code may depend on server-facing engine APIs, shared schemas, and game simulation code.

Forbidden:

- engine importing game
- server trusting client-owned state
- client importing server-only authority modules
- gameplay systems directly controlling UI implementation
- persistence code directly controlling gameplay behavior
- netcode code reaching randomly into unrelated gameplay internals
- UI code becoming the owner of gameplay state

If dependency direction becomes awkward, fix the boundary instead of adding a bridge.

---

# 4. Architecture Style

## Composition-first sandbox design

This is an "anything can be anything" sandbox game. A door might become hostile. A player might transfer their mind into an object. Items, characters, NPCs, structures, interactables, vehicles, and world objects should be composed from capabilities instead of forced into rigid inheritance trees.

Prefer:

- composition
- ECS-style data and systems
- data-driven definitions
- explicit capabilities
- tags/markers where appropriate
- stable IDs and handles
- systems that operate over data

Avoid:

- deep inheritance hierarchies
- one class per gameplay concept
- large object graphs in hot paths
- per-entity polymorphic behavior
- hardcoded type checks for every feature
- gameplay logic hidden inside rendering objects

Classes are allowed for services, adapters, resource managers, tooling, and external library integration when they improve clarity and do not create per-entity object-oriented gameplay architecture.

## Abstraction rules

Abstraction must earn its existence.

Good abstractions:

- enforce engine/game boundaries
- isolate external libraries
- protect authority/security boundaries
- centralize replication, persistence, asset loading, scheduling, or UI ownership
- reduce real coupling
- simplify hot-path code
- define stable APIs between major systems

Bad abstractions:

- pass-through wrappers that only rename calls
- bridge layers between modules that should not know each other
- managers that merely forward to other managers
- service locators used to hide dependency problems
- abstractions created before there is a real boundary or second implementation
- "future-proofing" that makes current code worse

Do not create bridge/facade/manager layers unless there is a concrete architectural reason.

## Patterns

Use known game and software patterns when they fit the problem.

Useful patterns may include:

- ECS/component pattern
- command pattern
- observer/event queues
- state machines
- strategy pattern
- object pooling
- flyweight/data-definition patterns
- spatial partitioning
- blackboards for AI
- factories for controlled construction
- explicit service composition roots

Do not cargo-cult patterns. A pattern is good only when it reduces complexity, improves correctness, preserves boundaries, or improves performance.

Avoid global singletons and service locators except for carefully controlled composition-root style infrastructure.

---

# 5. ECS and Simulation Rules

The gameplay simulation should favor data-oriented ECS-style design.

## ECS principles

- Components are data, not behavior.
- Systems own behavior.
- Entity IDs are stable handles, not object references.
- Avoid direct references between entities when IDs, queries, events, or relations are sufficient.
- Components should be serializable or explicitly marked runtime-only.
- Avoid "God components" that accumulate unrelated state.
- Avoid "God systems" that own unrelated domains.
- Prefer small focused components and systems with clear ownership.
- Prefer data-driven definitions over hardcoded special cases.

## Simulation phases

Prefer explicit simulation phases such as:

1. receive input / commands
2. validate commands
3. apply command buffers
4. run gameplay simulation
5. run AI
6. run movement/physics integration
7. resolve interactions/combat/effects
8. update spatial structures/AOI
9. build replication snapshot
10. queue persistence flushes

Do not mutate query membership unpredictably during iteration. Use command buffers or controlled mutation points when needed.

## Entity and component design

When adding a component, answer:

- What system owns this data?
- Is it authoritative, replicated, persistent, runtime-only, or presentation-only?
- Does it belong in engine or game?
- Is it generalized enough for the sandbox without becoming vague?
- Is there an existing component that already represents this concept?
- Does it create unwanted coupling?

---

# 6. Hot Path vs Cold Path

Not all code needs the same optimization style.

## Hot path code

Hot path code includes:

- server tick simulation
- ECS queries
- movement
- combat
- AI
- physics integration
- interest management
- replication
- serialization/deserialization
- packet handling
- high-frequency client prediction/interpolation

Hot path rules:

- avoid per-tick allocations
- avoid per-entity closures in loops
- avoid deep object graphs
- avoid string lookups in tight loops
- avoid JSON serialization for realtime network payloads
- prefer stable numeric IDs where practical
- prefer dense arrays, typed arrays, pools, and cache-friendly layouts where practical
- batch work by system/phase
- avoid O(players * all_entities), O(players * all_npcs), or O(all_entities^2) behavior in normal gameplay
- measure before claiming performance wins

## Cold path code

Cold path code includes:

- build scripts
- asset import/conversion
- editor/admin tooling
- debug UI
- one-time loading
- offline validation
- migration scripts

Cold path code may prioritize clarity over extreme data layout.

Do not over-engineer cold path code with hot path constraints unless it affects server runtime scalability.

---

# 7. Netcode Rules

The game uses nengi 2.0. Follow nengi conventions and use nengi features instead of replacing them with custom networking when nengi already provides the needed mechanism.

## Fundamentals

- Server-authoritative simulation.
- Client sends input intents/commands only.
- Server validates all commands.
- Server decides outcomes.
- Client renders replicated/predicted/interpolated state.
- Do not sync data the client can infer.
- Do not replicate private server-only state.
- Do not use full rewind lag compensation; it is out of scope for this game.
- Use deterministic behavior on both client and server when that avoids unnecessary sync and does not compromise authority.

## Client-side prediction

- Player-controlled characters may use client-side prediction.
- Server and client movement logic for predicted characters must stay as close as practical.
- Prediction requires reconciliation with server truth.
- Non-player entities should generally use interpolation unless there is a specific reason to predict them.
- Do not add prediction to systems that do not need it.

## Interest management

Interest management must be designed for high CCU on one VPS.

- Use AOI/spatial channels where appropriate.
- Near spatial replication is for players, NPCs, projectiles, pickups, and normal interactables.
- Far spatial replication is for large distant roots such as locations, landmarks, major ships, and other objects that should be visible from farther away.
- Other non-AOI channels are allowed when the domain requires them.
- Avoid each player scanning every entity every tick.
- Spatial structures must be updated and queried intentionally.

## Replication checklist

Every replicated entity, component, field, event, or message must answer:

- Who owns the authoritative value?
- Does the client need this value?
- Can the client infer or derive it?
- Is it state-based, event-based, command-based, or deterministic/client-derived?
- Which channel sends it?
- What is the AOI/relevance rule?
- What is the update rate?
- Does it need prediction?
- Does it need interpolation?
- Does it need reconciliation?
- Can it be quantized?
- What is the bandwidth cost per entity/player?
- What happens when it enters interest?
- What happens when it leaves interest?
- Is it persistent, transient, or presentation-only?

If these questions are not answered, the replication design is not finished.

## Client graphical dummy principle

The client should be as much of a graphical dummy as possible while still supporting good feel.

The client may know:

- replicated transforms
- visual IDs/model IDs
- animation state needed for presentation
- appearance data
- UI-facing state
- predicted local player movement state
- interpolation buffers
- audio/visual effect cues

The client must not own:

- authoritative world state
- combat outcomes
- inventory truth
- NPC decisions
- persistence truth
- anti-cheat-sensitive decisions

---

# 8. Persistence and Character Access

The game uses SQLite.

## Persistence ownership

All saving must answer to an overall persistence system.

Persistence should support:

- batching
- controlled flush timing
- schema ownership
- migrations or explicit reset behavior
- failure reporting
- avoiding disk writes from random gameplay systems

Gameplay systems should request persistence through the persistence layer. They should not directly own database writes unless that is the persistence layer's explicit design.

## Character access model

The game does not use normal user accounts.

Instead:

- a private key is created when a player character is created
- the key is placed in a URL fragment
- the user bookmarks the URL to return to that character
- anyone with the private key can play that character
- only one active session may control a character at a time

## Character key security

Treat character private keys as bearer secrets.

- Never log private keys.
- Never replicate private keys.
- Never include private keys in analytics, telemetry, crash logs, or debug dumps.
- URL fragments are client-side; the client must explicitly send the key during character claim/load.
- Server must validate character claim requests.
- Server must enforce one active session per character.
- Character session ownership must be revoked on disconnect/timeout.
- Rate-limit failed claim attempts where practical.
- Avoid revealing whether a character exists unless necessary.

## Schema rules

- Network message schemas, saved data schemas, asset manifests, and component schemas must be explicit.
- Do not rely on ad-hoc untyped objects for persisted or networked data.
- Use stable IDs for persisted definitions.
- Do not use display names as primary keys.
- Saved data changes need migration or explicit reset behavior.
- Replicated schema changes must update client and server together unless compatibility is deliberately maintained.

---

# 9. Rendering, Physics, and Assets

## Three.js

- Three.js is the rendering layer, not the gameplay authority.
- Do not store authoritative gameplay state in Three.js objects.
- Rendering objects should be derived from replicated/presentation state.
- Keep render lifecycle, asset lifecycle, and gameplay lifecycle distinct.

## Rapier

- Rapier is the physics engine.
- Physics integration must preserve server authority.
- Client physics may support presentation/prediction only where appropriate.
- Do not fork or replace physics behavior without a strong reason.
- Treat the Rapier init-params deprecation warning (`using deprecated parameters for the initialization function; pass a single object instead`) as non-actionable if it originates from Rapier internal self-usage rather than project code.

## Humanoid asset standard

Runtime humanoid avatars must be VRM.
Runtime humanoid animations must be VRMA.

Do not introduce new humanoid runtime formats unless the user approves.

Prefer offline conversion over runtime retargeting for shipping content.

Runtime retargeting is fallback-only, not the default production path.

---

# 10. Humanoid Conversion Playbook

## Goal

Canonicalize runtime humanoid assets before game runtime:

- avatar models -> VRM
- humanoid animations -> VRMA

## Animation FBX to VRMA

Use `fbx2vrma-converter` when the source is an animation-only FBX, such as Mixamo clips.

Example:

```bash
npx fbx2vrma -i public/assets/animations/mixamo/Idle.fbx -o public/assets/animations/vrma/Idle.vrma --fbx2gltf node_modules/fbx2vrma-converter/FBX2glTF-windows-x64.exe --framerate 30
```

## Avatar model to VRM

Use:

```text
tools/avatar-asset-pipeline/avatar-build.exe
```

Purpose:

- convert/normalize humanoid model FBX/GLB to VRM
- use JSON pipeline configs
- keep runtime assets canonical

Example command pattern:

```bash
tools/avatar-asset-pipeline/avatar-build.exe --pipeline <pipeline.json> --input_config <input.json> --output_config <output.json> --fbx2gltf <FBX2glTF.exe> -i <input.fbx|input.glb> -o <output.vrm> -v
```

---

# 11. UI Rules

- Keep UI native web stack unless the user explicitly approves a framework.
- Maintain one cohesive visual style.
- UI must answer to a shared UI system.
- Do not let gameplay systems directly own UI implementation.
- Do not let UI become gameplay authority.
- UI may request commands/intents; the server validates and decides outcomes.
- Prefer reusable UI primitives and shared styling over one-off UI implementations.

---

# 12. Agent Task Protocol

Before changing code:

1. Identify the domain: netcode, ECS, rendering, physics, persistence, UI, assets, tooling, tests, etc.
2. Search for existing systems in that domain.
3. Identify the correct owner of the change.
4. Decide whether the task is a small fix, integration fix, refactor, replacement, or new system.
5. Check whether the task affects server authority, performance, persistence, replication, or engine/game boundaries.
6. If the requested approach is architecturally weak, explain the issue and use the better path unless the user explicitly overrides.

During changes:

- keep code in the correct layer
- preserve dependency direction
- avoid duplicate systems
- avoid compatibility hacks around bad systems
- update call sites instead of leaving parallel paths
- remove obsolete code when safe
- prefer the correct end-state design over timid patches
- keep hot path code allocation-conscious
- keep server authority intact

After changes:

- report what changed
- report any suspicious architecture discovered
- report any stale tests or obsolete assumptions discovered
- report validation performed and validation not performed
- suggest AGENTS.md additions only when a new durable rule is discovered; do not edit AGENTS.md unless requested

---

# 13. Validation Policy

Validation should be useful, targeted, and not performative.

Allowed by default:

- TypeScript typecheck
- build
- lint, if already configured and relevant
- targeted tests for changed systems
- running the server briefly to check startup errors
- focused scripts that validate the touched subsystem

Do not run expensive full test suites unless asked or clearly justified.

Do not create broad new test infrastructure unless asked or unless it is obviously necessary for the task.

Existing tests may encode outdated assumptions. When a test fails:

1. Determine whether the test reflects current intended architecture.
2. If the test is stale, report it as stale.
3. If the system is broken, fix the system.
4. If the test is nonsensical or obsolete, propose deleting or replacing it.

For multiplayer browser automation tests:

- run each client in a separate browser window/process, not separate tabs in one window
- avoid inactive-tab throttling artifacts
- in headless browser automation, do not rely on RAF cadence for gameplay/test progress
- prefer deterministic test hooks such as `window.advanceTime` where available

---

# 14. Use of External Libraries and Tools

Prefer established, appropriate solutions for solved domains.

Before adding custom domain systems, check whether an existing project library, engine feature, or mature external library already solves the problem.

Use an existing solution when:

- it fits the architecture
- it has acceptable runtime cost
- it is maintained enough for the project's needs
- it solves the domain cleanly
- it does not undermine server authority, performance, or boundaries

Custom systems require a clear reason, such as:

- existing solutions do not fit authoritative multiplayer requirements
- existing solutions have unacceptable runtime cost
- the game has a genuinely novel requirement
- integrating the library would create worse architecture than a focused internal system

Before changing packages or relying on current library behavior, verify current documentation/version information when possible.

If a standard engine/library feature appears to behave incorrectly, assume our integration, filtering, lifecycle, or layering is wrong first. Investigate before replacing the standard feature.

---

# 15. AI-Codebase Sanity Rules

This codebase may contain AI-created mistakes.

Actively watch for:

- hallucinated systems
- duplicate systems
- unnecessary bridge layers
- managers that only forward calls
- abstractions with no real purpose
- mixed responsibilities
- client authority leaks
- server trusting client data
- hot path allocation problems
- O(N^2) or O(players * all_entities) scaling mistakes
- rendering objects owning gameplay truth
- persistence writes scattered across gameplay systems
- tests that lock in obsolete behavior
- dead code
- unused systems
- fake configurability
- inconsistent naming hiding duplicated concepts

If something is obviously bad, say so plainly and propose the correct replacement.

Do not preserve bad architecture just because it already exists.

---

# 16. Documentation and Comments

## File header comments

Every source file should have a short top-of-file comment explaining what it is for.

Good file header comments:

- explain the file's role
- identify the owning system
- are understandable to humans
- are short

Bad file header comments:

- repeat the filename
- contain vague filler
- describe implementation details that will drift immediately

If an existing source file lacks a useful header and you are already editing it, add one.

## Markdown/docs editing

Do not edit markdown or documentation files unless:

- the user explicitly requested it
- the task is documentation-related
- the code change requires updating docs to avoid incorrect instructions
- the file is part of the system being changed and would become misleading if left untouched

When in doubt, report the suggested documentation change instead of silently editing docs.

---

# 17. Git and Workspace Hygiene

- Do not leave terminals, dev servers, or watch processes running after the task.
- If you start a server, close it when done.
- If generated files should be ignored, update `.gitignore`.
- Do not commit changes unless explicitly asked.
- Do not rewrite unrelated files.
- Do not perform broad formatting-only changes unless asked.
- Keep diffs focused on the task and necessary architecture cleanup.

---

# 18. Browser and Screenshot Policy

- Do not use a headless browser unless asked or unless it is clearly necessary for validation.
- Do not take or analyze screenshots unless asked.
- Prefer deterministic hooks and logs for gameplay validation when available.
- Visual debugging is allowed when the task is specifically visual/rendering/UI and the user requested or approved it.

---

# 19. Performance and Observability

Important systems should expose lightweight diagnostics where appropriate.

Useful diagnostics include:

- server tick time
- entity counts by category/archetype
- replication bytes/messages per client
- AOI entity counts
- physics step time
- NPC AI time
- persistence queue size
- persistence flush time
- command queue sizes
- dropped/rejected command counts
- memory growth indicators

Do not add noisy logs in hot paths.

Prefer:

- counters
- sampled metrics
- debug overlays
- explicit diagnostic commands
- structured logs outside tight loops

---

# 20. Feature Design Checklist

Before implementing a significant feature, answer:

- Is this engine-level or game-level?
- Is it authoritative server state, client presentation, or shared schema?
- Does an existing system already own this domain?
- Does it need persistence?
- Does it need replication?
- Does it need prediction or interpolation?
- Does it affect hot path performance?
- Does it create new dependencies across boundaries?
- Does it need a data-driven definition?
- Can it be generalized cleanly without becoming vague?
- What is the deletion/replacement plan for obsolete code?

---

# 21. Definition of Done

A task is not complete until:

- the code is in the correct architectural layer
- server authority is preserved
- engine/game boundaries are preserved
- no duplicate parallel system was created
- hot path performance implications were considered
- existing libraries/features were used where appropriate
- obsolete code was removed or reported
- validation was performed or explicitly reported as not performed
- any stale tests or questionable assumptions were reported
- the final response explains the meaningful changes and any remaining risks

---

# 22. Known Explicit Project Decisions

These decisions are intentional unless the user changes them.

- The game is server-authoritative.
- Scaling target is vertical scaling on one VPS.
- No sharding as the default architecture.
- No full rewind lag compensation.
- Client sends intents/commands only.
- Player-controlled characters may use client-side prediction.
- Most non-player entities should interpolate rather than predict.
- nengi 2.0 is the networking library.
- Three.js is the rendering library.
- Rapier is the physics library.
- SQLite is the persistence database.
- Runtime humanoid avatars use VRM.
- Runtime humanoid animations use VRMA.
- Offline humanoid conversion is preferred over runtime retargeting.
- UI uses native web stack unless otherwise approved.
- Desktop-first; do not optimize for mobile unless requested.
