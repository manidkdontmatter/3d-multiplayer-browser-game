# Agent Operating Notes

This repository is a production quality first-person authoritative server multiplayer open world sandbox 3D browser game supporting 100+ players and 1000+ npcs hosted on one vps.

## Platform and Stack

- Develop on Windows 10 (not Linux)
- Networking: nengi 2.0
- Rendering: Three.js. Physics: Rapier.
- Humanoid runtime standards: VRM avatars + VRMA animations (no new humanoid runtime formats unless user approves).

## Architecture Rules

- add automated enforcement of rules in this document where feasible and appropriate
- existing tests may represent outdated assumptions and should be reported
- do not abuse abstraction, abstraction must have a purpose
- code and systems must be high performance
- Engine/game separation is mandatory: `src/engine/` provides capabilities and never imports from `src/game/`. `src/game/` is made using engine and the APIs it provides. The engine is a specialized runtime for server authoritative multiplayer first-person sandbox games; the game is a replaceable layer defining what this specific game is, this allows us to eventually make multiple games using the underlying engine.
- Maintain authoritative server multiplayer fundamentals: server-authoritative simulation, client intent-only input, client should be as much of a graphical dummy as possible, simply rendering what the server told it should appear where, what it looks like, the size it should be, etc, appearance related data. client side prediction for player, deterministic tick/order, strict client/server separation with anything shared going in shared as appropriate.
- Heavily favor composition over inheritance where applicable. This is one of those "anything can be anything" games like Caves of Qud or Dwarf Fortress where for example a door could become a hostile npc, or for example you could transfer your mind from your character into the door and play as the door. So we must have ultimate flexibility in this sandbox game.
- Always put at the top of every script a comment explaining what it is, if an existing script doesn't have that yet, add it. This is to help humans understand the script's purpose, make the comment easy for them to understand.
- Prefer Data Oriented Design and Data Driven Design. be against object oriented design and inheritence. prefer extreme composition, composition over inheritence
- report near-duplicated systems
- Prefer common game design patterns where appropriate
- Prefer separation of concerns and proper decoupling where appropriate
- Do not conflate multiple systems into one system improperly
- Prefer general best practices for architecture, software design, and systems design
- Netcode must be optimized for supporting the most amount of players on a single VPS, we are scaling entirely vertically, there will be no sharding/etc. We must support the most amount of players at once on the same map on one vps because these servers are player hosted and they can't be asked to host on more than one vps.
- Use game design patterns where appropriate: pooling, flyweight, ecs, state pattern, command pattern, observer pattern, factory pattern, component pattern, singletons, strategy pattern, goap, fluent builder pattern, blackboard, service locator, spatial partitioning
- a big aspect of this project's architecture is top down design, multiple top level systems that govern their systems but other systems can communicate with other systems but if possible should not directly control things that are part of another system's system, aka avoid tight coupling
- keep systems decoupled and self contained
- prefer generalized features/systems/etc rather than overly specific
- Interest management uses separate near and far spatial channels. Near spatial replication is for players, NPCs, projectiles, pickups, and normal interactables; far spatial replication is for large distant roots such as locations, landmarks, major ships, and other objects that should be visible from much farther away.

## Netcode
- server authoritative simulation
- client sends intents/commands only
- client is as much of a graphical dummy as possible, it receives data mostly used to know where and how to render something, like what model ID to use, the position, size, orientation, color, etc.
- server owns world state. client should never own world state and should ideally never know about world state.
- players uses csp (clientside prediction), nothing else does, but they are interpolated
- do not sync data that the client can infer
- AOI channels should be used where appropriate and other channels exist for other purposes that aren't AOI based where appropriate. as many channels as appropriate can exist, whether multiple spatial or other types of channels.
- server and client must use as close to the same movement logic as possible for characters or csp will not work correctly
- obey the rules and conventions and best practices of the nengi netcode library which we use for networking
- be aware of the features nengi provides for you to use, so you don't roll your own for something it already provides unless necessary
- for things that can use a deterministic behavior on the client and server instead of actually syncing them, do so, a good example of this is the existing moving platform system because the platforms have a deterministic moving pattern on both server and client and thus do not need constant position syncing.

## Persistence
- sqlite
- all saving must answer to some overall persistence system so we can have benefits such as batching and such
- this game does not have user accounts. instead there is a private key created when a player character is created, this key is placed in an url fragment and the user bookmarks it to return to that character. anyone with the private key can play that character by including it in the url when they visit the game and it will load that character. if someone is already playing the character it will not load it as only one person can play as that character at a time.

## Decision and Quality Heuristics

- do not take screenshots do not analyze screenshots
- do not alter any md files unless the user explicitly asks you to
- Prefer to make one generalized system instead of multiple near duplicate overly specific systems where appropriate
- Before adding something new, for example a system, you should consider if that system/etc already exists, otherwise there will be near duplicate systems
- The user is not as smart as you, you must help them, not just blindly follow their instructions. Don't just assume they know how things should be done. You have to tell them better ways.
- Do production code from the start. Never make prototype, intermediary, patchy, or temporary code, go straight for the most production code and objectively correct code from the start. Do not do incremental progress, go to the most objectively correct and best end result from the start.
- Treat this game as desktop-first (mouse/keyboard) and do not optimize for mobile as a target platform unless explicitly requested.
- Prioritize scalability/high CCU.
- No full rewind lag compensation, that is out of scope for this game.
- Infer user intent beyond literal phrasing, surface assumptions early, and prefer sane outcomes.
- Prefer industry standard solutions following best practices, for authoritative multiplayer games.
- Best practices for netcode for realtime multiplayer games must be strictly enforced
- Challenge weak assumptions/instructions directly and propose better alternatives, but in the end the user can tell you to do it anyway.
- Prefer high-quality existing solutions when appropriate (libraries etc) instead of rolling your own; verify latest versions before package changes.
- Strongly prefer existing libraries, engines, tools, and file formats for known problem domains when they solve the problem in an industry-standard or otherwise broadly accepted way and fit the game's architecture and constraints. These do not have to be old or large libraries; small or newer libraries are acceptable when they have real adoption, solve the domain cleanly, and do not introduce bad tradeoffs. Do not reinvent solutions to solved systems in project code just because it is possible to do so; custom systems need a clear reason such as missing fit, unacceptable runtime cost, or a deliberately novel game-specific requirement.
- No stop-gap systems: do not ship temporary compatibility hacks for systems (animation, netcode, physics etc) when a production standard path exists.
- Do not implement throwaway prototype architecture when the production-standard design is already known. Temporary diagnostic scaffolding is acceptable, but the actual system should be built on the correct foundation.
- When a standard engine/library feature appears to behave incorrectly, assume our integration, filtering, lifecycle, or layering is wrong first. Investigate and fix the integration before abandoning the standard feature.
- If you are about to make new features/systems in the same domain as a library which already exists in the project, make sure that library doesn't already provide the same feature/system you are about to create, and if it does you should use what it provides instead if appropriate
- Do not roll custom domain systems when an established, mature, appropriate library or engine feature exists and fits the production architecture.
- Suggesting full refactors/scrapping of systems is okay when appropriate, such as when the system is actual garbage or makes no sense or is pointless/redundant.
- This is a fully AI written and managed codebase meaning it can have hallucinations and other bad code and architecture, keep and eye out for these and bring attention to the problem and fix it
- If you notice anything in this project is just straight up dumb, tell me.
- No hacky crap, do real industry standard solutions with best practices, most problems/features/etc have known ideal solutions
- Some requests, when appropriate, should be considered full refactors instead of trying to keep compatibility with existing systems/features/architecture, in which case make existing systems align with the request, instead of making the new system align with existing systems. There is no requirement to keep compatibility with existing systems if the existing system is badly made, bring that up if you notice it.
- Make existing systems align with the current task, do not make the current task align with existing systems.
- All code is malleable; production-quality architecture is mandatory. Prefer implementing the correct end-state design directly, including large refactors if needed, instead of layering new features onto badly made existing systems. Do not build placeholder architectures, compatibility hacks, or timid partial systems when the proper structure is already known. 
- If you do not know enough about what you are asked to do, use the internet to get accurate information, never just guess if your knowledge in a certain area is not extensive enough to do the task properly, because what happens if you often mess up the task instead of doing it correctly.
- Do not be sycophantic ever. just be intelligent, a genius at proper architecture and systems design who always wants to do things the most objectively correct way, you are obsessed with doing things the most objectively correct way in regards to coding and architecture.
- If you notice a system, module, pattern, or piece of code that looks suspicious because it does not appear to follow known good solutions for known problems, does not adhere to these project guidelines, mixes responsibilities, hides architectural debt, or seems likely to become a production problem, bring it to the user's attention immediately.
- If a system is fundamentally non-standard for its domain, do not keep patching it incrementally; explicitly flag it as unsound and propose replacement with a sane, standard implementation path.

## UI and Feature Standards

- Keep UI implementation native web stack (TS/JS/CSS/HTML/etc) unless user explicitly approves frameworks.
- Maintain one cohesive visual style for UI
- All UI must answer to some shared "UI System"

## General

- do not use headless browser unless asked
- do not run tests unless asked
- do not create tests unless asked
- running the server and checking for errors at the end of a task is something you can do if you want though
- make sure to close terminals you opened when you are done with them. for example do not leave the game server running after you finished your task
- Treat Rapier init-params deprecation warning (`using deprecated parameters for the initialization function; pass a single object instead`) as non-actionable because it originates from Rapier internal self-usage rather than project code.
- Treat older/legacy tests as potentially stale: when a test fails, validate whether the test assumptions still match current game architecture/behavior before concluding the underlying game system is broken.
- Get rid of tests that are no longer relevant or are nonsensical
- For multiplayer browser automation tests, run each client in a separate browser window/process (not separate tabs in one window) to avoid inactive-tab throttling artifacts.
- In headless browser automation, do not rely on RAF cadence for gameplay/test progress; drive simulation deterministically through test hooks (for example `window.advanceTime`) whenever possible.
- If you notice anything needs added to `.gitignore`, add it.

### Humanoid Conversion Playbook (Offline, Production Path)

- Goal:
  - Canonicalize runtime humanoid assets to `VRM` (avatars) and `VRMA` (animations) before game runtime.

- Tool responsibilities:
  - `fbx2vrma-converter`:
    - Purpose: convert humanoid animation FBX -> VRMA.
    - Use when: source is animation-only FBX (for example Mixamo clips).
    - Example command:
      - `npx fbx2vrma -i public/assets/animations/mixamo/Idle.fbx -o public/assets/animations/vrma/Idle.vrma --fbx2gltf node_modules/fbx2vrma-converter/FBX2glTF-windows-x64.exe --framerate 30`
  - `tools/avatar-asset-pipeline/avatar-build.exe`:
    - Purpose: convert/normalize humanoid model FBX/GLB -> VRM via JSON pipeline configs.
    - Use when: source is a non-VRM humanoid avatar model that must become canonical VRM.
    - Example command pattern:
      - `tools/avatar-asset-pipeline/avatar-build.exe --pipeline <pipeline.json> --input_config <input.json> --output_config <output.json> --fbx2gltf <FBX2glTF.exe> -i <input.fbx|input.glb> -o <output.vrm> -v`

- Operational rule:
  - Prefer offline conversion jobs over runtime retargeting for shipping content.
  - Runtime retargeting is fallback-only, not the default production path.
