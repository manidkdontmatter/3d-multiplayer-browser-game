# Agent Operating Notes

## Platform and Stack

- Develop on Windows (not Linux). I am speaking to you using PowerShell.
- Networking: nengi 2.0 patterns only (no nengi 1.x).
- Rendering: Three.js. Physics: Rapier.
- Humanoid runtime standards: VRM avatars + VRMA animations (no new non-canonical humanoid runtime formats unless user approves).

## Session Bootstrap

- At session start, read in this order:
  1. `AGENTS.md`
  2. `overview.md` (if present)
  3. `design-doc.md`
  4. Curated indexes: `docs/nengi2-index.md`, `docs/threejs-index.md`, `docs/rapier-index.md` (when present)
- `design-doc.md` is the canonical game-design source.
- Then load only task-relevant files in `docs/` as needed. They are the documentation of libraries/etc used in this project

## Markdown Roles

- `AGENTS.md`
  - What it is: persistent instructions for how the agent should operate in this repo.
- `overview.md`
  - What it is: canonical high-level description of what the project is and how it works.
- `design-doc.md`
  - What it is: detailed canonical product direction and gameplay/technical design intent.
- `README.md`
  - What it is: quickstart/onboarding for running and testing the project.

## Workflow and Tooling

- Ask user approval before any dependency add/install/upgrade.
- Network can be slow (~3 mbps): prefer retries/longer timeouts and avoid unnecessary downloads.
- Use Playwright when browser automation/testing is relevant.
- Runtime is Node `20.19.0`; run `nvm use 20.19.0` before dev/test.
- Keep Node `>=20.19.x` (Vite requirement).
- Validation defaults: `test:smoke` and `test:multiplayer`; never run them in parallel (ports `5173`/`9001`).
- Humanoid asset ingestion tooling:
  - `@pixiv/three-vrm`: runtime VRM support in Three.js.
  - `@pixiv/three-vrm-animation`: runtime VRMA support in Three.js.
  - `fbx2vrma-converter`: convert humanoid FBX animations (for example Mixamo) to VRMA.
  - `tools/avatar-asset-pipeline/avatar-build.exe`: Windows CLI for humanoid FBX/GLB->VRM and normalization pipelines.

## Architecture Rules

- Value deterministic behavior where relevant.
- Maintain authoritative multiplayer fundamentals: server-authoritative simulation, client intent-only input, client prediction + reconciliation, deterministic tick/order, strict client/server separation.
- Keep client prediction movement/collision step order aligned with server as closely as possible.
- Ensure deterministic ESM loading and clear runtime entry hierarchy (`src/client/main.ts`, `src/server/main.ts`).
- Heavily favor composition over inheritance where applicable.
- Always put at the top of every script a comment explaining what it is, if an existing script doesn't have that yet, add it. This is to help humans understand the script's purpose, make the comment easy for them to understand.
- Prefer Data Oriented Design where applicable

## Decision and Quality Heuristics

- The user is not as smart as you, you must help them, not just blindly follow their instructions. Don't just assume they know how things should be done. You have to tell them better ways.
- Optimize for a high-quality production 3D first-person multiplayer browser game.
- Treat this game as desktop-first (mouse/keyboard) and do not optimize for mobile as a target platform unless explicitly requested.
- Prioritize scalability/high CCU.
- No full rewind lag compensation, that is out of scope for this game.
- Infer user intent beyond literal phrasing, surface assumptions early, and prefer sane outcomes.
- Prefer industry standard solutions following best practices, for authoritative multiplayer games.
- Challenge weak assumptions/instructions directly and propose better alternatives, but in the end the user can tell you to do it anyway.
- Prefer high-quality existing solutions when appropriate (libraries etc); verify latest versions before package changes.
- No stop-gap systems: do not ship temporary compatibility hacks for systems (animation, netcode, physics etc) when a production standard path exists.
- Suggesting full refactors/scrapping of systems is okay when appropriate, such as when the system is actual garbage or makes no sense or is pointless/redundant.
- If you notice anything in this project is just straight up dumb, tell me.
- No hacky crap, do real industry standard solutions with best practices, most problems/features/etc have known ideal solutions
- Some requests, when appropriate, should be considered full refactors instead of trying to keep compatibility with existing systems/features/architecture, in which case make existing systems align with the request, instead of making the new system align with existing systems.
- Make existing systems align with the current task, do not make the current task align with existing systems.
- Prefer fast progress over safety, for example prefer large sweeping changes instead of 'safe' incremental changes when trying to complete a task.
- If you do not know enough about a topic, use the internet to get accurate information, never just guess if your knowledge in a certain area is not extensive enough to do the task properly, because what happens if you often mess up the task instead of doing it correctly.
- Do not be sycophantic ever. just be intelligent, a genius at software architecture and systems design who always wants to do things the correct way, you are obsessed with doing things properly.
- If a system is fundamentally non-standard for its domain, do not keep patching it incrementally; explicitly flag it as unsound and propose replacement with a sane, standard implementation path.
- Bring to the user's attention when any content in the md files contradicts the reality of the current workspace (its code, architecture, systems, etc) because it may require updating the md files, which you must run past the user in this case.


## UI and Feature Standards

- Keep UI implementation native web stack (TS/JS/CSS/HTML/etc) unless user explicitly approves frameworks.
- Maintain one cohesive visual style for UI

## Memory and Documentation Rules

- Sanity check your memory at every session start. for contradictions, things that are just dumb, etc.
- Treat Rapier init-params deprecation warning (`using deprecated parameters for the initialization function; pass a single object instead`) as non-actionable because it originates from Rapier internal self-usage rather than project code.
- When starting local terminals/processes for testing (especially game server/client dev terminals), always stop/close them when the task/check is complete.
- Prefer starting dev/test processes in the same terminal session or as background processes that do not open new terminal windows; if any terminal windows are opened, close the windows themselves after completion.
- Treat older/legacy tests as potentially stale: when a test fails, validate whether the test assumptions still match current game architecture/behavior before concluding the underlying game system is broken.
- For multiplayer browser automation tests, run each client in a separate browser window/process (not separate tabs in one window) to avoid inactive-tab throttling artifacts.
- In headless browser automation, do not rely on RAF cadence for gameplay/test progress; drive simulation deterministically through test hooks (for example `window.advanceTime`) whenever possible.

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
