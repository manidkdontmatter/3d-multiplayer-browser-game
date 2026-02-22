# Agent Operating Notes

## Platform and Stack

- Develop on Windows (not Linux). I am speaking to you using PowerShell.
- Project target: production-grade TypeScript/Node.js 3D browser game.
- Networking: nengi 2.0 patterns only (no nengi 1.x).
- Rendering: Three.js. Physics: Rapier.
- Humanoid runtime standards: VRM avatars + VRMA animations (no new non-canonical humanoid runtime formats unless user approves).

## Session Bootstrap

- At session start, read in this order:
  1. `AGENTS.md`
  2. `overview.md` (if present)
  3. `design-doc.md`
  4. Curated indexes: `docs/nengi2-index.md`, `docs/threejs-index.md`, `docs/rapier-index.md` (when present)
  5. Task-targeted files in `docs/` only as needed (avoid bulk-loading vendored trees)
- `AGENTS.md` and `overview.md` are memory docs and may be reorganized to improve execution quality.
- `design-doc.md` is the canonical game-design source and is only edited when explicitly requested.
- Then load only task-relevant files in `docs/`; avoid bulk-reading vendored trees.

## Markdown Roles

- `AGENTS.md`
  - What it is: persistent instructions for how the agent should operate in this repo.
  - Include: workflow rules, tooling/runtime constraints, memory behavior, decision heuristics.
  - Exclude: long-form project narrative/history and temporary task status.
- `overview.md`
  - What it is: canonical high-level description of what the project is and how it works.
  - Include: architecture, stack, core modules, netcode model, key workflows.
  - Exclude: step-by-step session logs, agent-behavior policy, and transient one-session status notes.
- `design-doc.md`
  - What it is: canonical product direction and gameplay/technical design intent.
  - Include: game direction, gameplay systems intent, architectural constraints that define the product.
  - Exclude: routine implementation logs and temporary task status.
- `README.md`
  - What it is: human-facing quickstart/onboarding for running and testing the project.
  - Include: setup commands, local run/test commands, quick operational notes.
  - Exclude: detailed architecture rationale and agent-only policies.

## Markdown Maintenance

- If architecture/tooling/workflows materially change, update `overview.md`.
- If product direction/gameplay rules materially change, update `design-doc.md`.
- If operating behavior or memory policy changes, update `AGENTS.md`.
- If run/test onboarding materially changes, update `README.md`.
- If a file starts accumulating content that belongs elsewhere, move it.

## Markdown Conflict Resolution

If docs disagree, resolve in this order:
1. Safety and production-grade engineering constraints.
2. Explicit user instruction in the active thread.
3. `design-doc.md` for product direction and canonical game rules.
4. `AGENTS.md` for agent operating behavior/memory policy.
5. `overview.md` for architecture and system behavior.
6. `README.md` for human-facing run/test onboarding details.

After deciding, update conflicting docs in the same pass so contradictions are removed, not carried forward.

## Workflow and Tooling

- Commit locally after meaningful verified changes; when the user asks to commit, stage and commit all current workspace changes (not a partial subset). Push at milestones or on request.
- Ask user approval before any dependency add/install/upgrade.
- Network can be slow (~3 mbps): prefer retries/longer timeouts and avoid unnecessary downloads.
- Use Playwright when browser automation/testing is relevant.
- Runtime is Node `20.19.0`; run `nvm use 20.19.0` before dev/test.
- Keep Node `>=20.19.x` (Vite requirement).
- Validation defaults: `test:smoke` and `test:multiplayer`; never run them in parallel (ports `5173`/`9001`).
- During active iteration, prefer fast checks first (`typecheck:*`, `test:smoke:fast`, `verify:quick`) and reserve full multiplayer suites for gates.
- Do not run TypeScript typecheck commands by default after routine edits (`npm run typecheck`, `npm run typecheck:client`, `npm run typecheck:server`). Only run them when explicitly requested by the user.
- Humanoid asset ingestion tooling:
  - `@pixiv/three-vrm`: runtime VRM support in Three.js.
  - `@pixiv/three-vrm-animation`: runtime VRMA support in Three.js.
  - `fbx2vrma-converter`: convert humanoid FBX animations (for example Mixamo) to VRMA.
  - `tools/avatar-asset-pipeline/avatar-build.exe`: Windows CLI for humanoid FBX/GLB->VRM and normalization pipelines.

## Architecture Rules

- Maintain authoritative multiplayer fundamentals: server-authoritative simulation, client intent-only input, client prediction + reconciliation, deterministic tick/order, strict client/server separation, anti-cheat boundaries.
- Keep client prediction movement/collision step order aligned with server as closely as possible.
- Preserve deterministic ESM loading and clear runtime entry hierarchy (`src/client/main.ts`, `src/server/main.ts`).
- Heavily favor composition over inheritance where applicable.

## Decision and Quality Heuristics

- Optimize for a high-quality production 3D first-person multiplayer browser game.
- Treat this game as desktop-first (mouse/keyboard) and do not optimize for mobile as a target platform unless explicitly requested.
- Prioritize scalability/high CCU.
- No full rewind lag compensation, that is out of scope for this game.
- Infer user intent beyond literal phrasing, surface assumptions early, and prefer sane outcomes.
- Prefer industry standard solutions following best practices, for authoritative multiplayer games.
- Challenge weak assumptions directly and propose better alternatives.
- Prefer high-quality existing solutions when justified; verify latest versions before package changes.
- No stop-gap core systems: do not ship temporary compatibility hacks for foundational systems (animation, netcode, physics) when a production standard path exists.
- If you notice anything in this project is just straight up retarded, tell me.
- No hacky crap, do real industry standard solutions with best practices, most problems/features/etc have known ideal solutions
- Some requests, when appropriate, should be considered full refactors instead of trying to keep compatibility with existing systems/features/architecture, in which case make existing systems align with the request, instead of making the new system align with existing systems.
- Make existing systems align with the current task, do not make the current task align with existing systems.
- If you do not know enough about a topic, use the internet to get accurate information, never just guess if your knowledge in a certain area is not extensive enough to do the task properly, because what happens if you often mess up the task instead of doing it correctly.
- do not be sycophantic ever. just be intelligent, a genius at software architecture and systems design.
- I really want you to have your own self improvement loop, so if you notice anything that will significantly improve yourself, you can add it to your AGENTS.md file on your own. Just make it very obvious to me that you have done so at the end of your task and why, so I can self improve too.

## UI and Feature Standards

- Keep UI implementation native web stack (TS/JS/CSS/HTML) unless user explicitly approves frameworks.

## UI Style System (Persistent)

- Maintain one cohesive visual style for UI

## Memory and Documentation Rules

- Memory write rule: when user says "remember" (or equivalent), or when adding memory proactively, persist it in whichever existing .md file makes the most sense.
- Memory consistency rule: every memory write/update must include immediate contradiction checks across `AGENTS.md`, `overview.md`, and `design-doc.md` (and `README.md` when onboarding/commands are affected); resolve in the same pass and ask user only if ambiguity is real.
- Treat Rapier init-params deprecation warning (`using deprecated parameters for the initialization function; pass a single object instead`) as non-actionable because it originates from Rapier internal self-usage rather than project code.
- Project authorship rule: treat this repository as agent-authored for decision-making; default to full authority to refactor/replace code and structure when it improves production outcomes.
- Ownership rule: treat `AGENTS.md` and `overview.md` as agent-managed working memory docs and improve/restructure freely when it increases execution quality.
- Scope boundaries:
  - `overview.md`: canonical high-level architecture/workflows.
  - `design-doc.md`: canonical product direction, gameplay rules, and experience/style pillars.
  - `README.md`: quickstart and test/run onboarding.
  - User preference:
    - Commit after every task completion, and if asked to commit, include all current workspace changes in that commit (no partial staging); if a task is finished, push to GitHub when the last push was over 30 minutes ago.
    - If a system is fundamentally non-standard for its domain, do not keep patching it incrementally; explicitly flag it as unsound and propose replacement with a sane, standard implementation path.
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
