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
  2. `docs-map.md` (if present)
  3. `overview.md` (if present)
  4. `vision.md` (if present)
  5. Curated indexes: `docs/nengi2-index.md`, `docs/threejs-index.md`, `docs/rapier-index.md` (when present)
- Then load only task-relevant files in `docs/`; avoid bulk-reading vendored trees.
- The aforementioned .md files are considered your memory, you are free to alter your memory however you see fit to increase your productivity and intelligence.
- Read `design-doc.md`. It is not a memory file do not alter it.

## Workflow and Tooling

- Commit locally after meaningful verified changes; when the user asks to commit, stage and commit all current workspace changes (not a partial subset). Push at milestones or on request.
- Ask user approval before any dependency add/install/upgrade.
- Network can be slow (~3 mbps): prefer retries/longer timeouts and avoid unnecessary downloads.
- Use Playwright when browser automation/testing is relevant.
- Runtime is Node `20.19.0`; run `nvm use 20.19.0` before dev/test.
- Keep Node `>=20.19.x` (Vite requirement).
- Validation defaults: `test:smoke` and `test:multiplayer`; never run them in parallel (ports `5173`/`9001`).
- During active iteration, prefer fast checks first (`typecheck:*`, `test:smoke:fast`, `verify:quick`) and reserve full multiplayer suites for gates.
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

## UI and Feature Standards

- Keep UI implementation native web stack (TS/JS/CSS/HTML) unless user explicitly approves frameworks.

## UI Style System (Persistent)

- Maintain one cohesive visual style for UI

## Memory and Documentation Rules

- Memory write rule: when user says "remember" (or equivalent), or when adding memory proactively, persist it in whichever existing .md file makes the most sense.
- Memory consistency rule: every memory write/update must include immediate contradiction checks across `AGENTS.md`, `docs-map.md`, `overview.md`, and `vision.md`; resolve in the same pass and ask user only if ambiguity is real.
- Treat Rapier init-params deprecation warning (`using deprecated parameters for the initialization function; pass a single object instead`) as non-actionable because it originates from Rapier internal self-usage rather than project code.
- Project authorship rule: treat this repository as agent-authored for decision-making; default to full authority to refactor/replace code and structure when it improves production outcomes.
- Ownership rule: treat `AGENTS.md`, `docs-map.md`, `overview.md`, and `vision.md` as agent-managed working memory docs and improve/restructure freely when it increases execution quality.
- Scope boundaries:
  - `overview.md`: canonical high-level architecture/workflows.
  - `vision.md`: product direction and experience/style pillars.
  - `docs-map.md`: markdown responsibilities and read order.
  - User preference:
    - Commit after every task completion, and if asked to commit, include all current workspace changes in that commit (no partial staging); if a task is finished, push to GitHub when the last push was over 30 minutes ago.
    - If a system is fundamentally non-standard for its domain, do not keep patching it incrementally; explicitly flag it as unsound and propose replacement with a sane, standard implementation path.
    - When starting local terminals/processes for testing (especially game server/client dev terminals), always stop/close them when the task/check is complete.

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
