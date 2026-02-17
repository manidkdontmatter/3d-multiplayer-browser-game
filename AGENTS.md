# Agent Operating Notes

## Platform and Stack

- Develop on Windows (not Linux) in PowerShell by default.
- Use `cmd` chaining only when needed (example: `nvm use ... && npm ...`).
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

## Workflow and Tooling

- Commit locally after meaningful verified changes; when the user asks to commit, stage and commit all current workspace changes (not a partial subset). Push at milestones or on request.
- Ask user approval before any dependency add/install/upgrade.
- Network can be slow (~3 mbps): prefer retries/longer timeouts and avoid unnecessary downloads.
- Use Playwright when browser automation/testing is relevant.
- Runtime is Node `20.19.0`; run `nvm use 20.19.0` before dev/test.
- On this Windows setup, run `nvm use ... && npm ...` in the same `cmd` process to avoid PATH desync.
- Keep Node `>=20.19.x` (Vite requirement).
- Validation defaults: `test:smoke` and `test:multiplayer`; never run them in parallel (ports `5173`/`9001`).
- During active iteration, prefer fast checks first (`typecheck:*`, `test:smoke:fast`, `verify:quick`) and reserve full multiplayer suites for gates.
- Humanoid asset ingestion tooling:
  - `@pixiv/three-vrm`: runtime VRM support in Three.js.
  - `@pixiv/three-vrm-animation`: runtime VRMA support in Three.js.
  - `fbx2vrma-converter`: convert humanoid FBX animations (for example Mixamo) to VRMA.
  - `tools/avatar-asset-pipeline/avatar-build.exe`: Windows CLI for humanoid FBX/GLB->VRM and normalization pipelines.
- Use ingestion tooling first; avoid bespoke per-rig runtime retarget hacks.

## Architecture Rules

- Maintain authoritative multiplayer fundamentals: server-authoritative simulation, client intent-only input, client prediction + reconciliation, deterministic tick/order, strict client/server separation, anti-cheat boundaries.
- Keep client prediction movement/collision step order aligned with server as closely as possible.
- Preserve deterministic ESM loading and clear runtime entry hierarchy (`src/client/main.ts`, `src/server/main.ts`).
- Keep first-person owner-view presentation changes strictly client-side/non-authoritative.
- Replicate only gameplay-relevant state/events; do not replicate local-only first-person cosmetics.

## Decision and Quality Heuristics

- Optimize for a high-quality production 3D first-person multiplayer browser game.
- Treat this game as desktop-first (mouse/keyboard) and do not optimize for mobile as a target platform unless explicitly requested.
- Prioritize scalability/high CCU + immersive-sim consistency over esports-grade lag-comp complexity.
- Combat intent is melee + slower projectiles; full rewind lag compensation stays out of near-term scope unless evidence proves need.
- Operate as project manager by default: proactively plan/prioritize/execute unless user redirects.
- Infer user intent beyond literal phrasing, surface assumptions early, and prefer technically sound outcomes.
- Challenge weak assumptions directly and propose better alternatives with tradeoffs.
- Periodically sanity-check architecture for drift/debt.
- Prefer high-quality existing solutions when justified; verify latest versions before package changes.
- No stop-gap core systems: do not ship temporary compatibility hacks for foundational systems (animation, netcode, physics) when a production standard path exists.
- For humanoid assets, prefer standards-first and offline normalization:
  - ingest unknown-source humanoid assets into canonical VRM/VRMA outputs before runtime use;
  - keep runtime animation logic focused on playback/state layering, not ad-hoc retarget fixes.

## UI and Feature Standards

- Ship production-grade player-facing systems (not prototype quality), with clear UX, readability in action, responsive behavior, and strong interaction affordances/states.
- Keep UI implementation native web stack (TS/JS/CSS/HTML) unless user explicitly approves frameworks.
- Reuse shared primitives/tokens and validate material UI/feature changes in runtime (Playwright/smoke), not inspection alone.
- If temporary scaffolding is necessary, label with `TODO` + rationale + follow-up.
- Default feature exit criteria: correct behavior, strong UX, authoritative boundaries, and no obvious reliability regressions.

## UI Style System (Persistent)

- Maintain one cohesive visual language across HUD/menus/screens.
- Current direction: clean sci-fi tactical UI with cool sky/teal accents over deep navy translucent surfaces.
- Use central design tokens for color/spacing/radius/border/shadow/transition.
- Standardize panel chrome, typography hierarchy, selected/interactive states, layout anchors/rhythm, and semantic status colors.
- When practical, align nearby legacy UI during changes to reduce style fragmentation.

## Memory and Documentation Rules

- Memory write rule: when user says "remember" (or equivalent), or when adding memory proactively, persist it in `AGENTS.md`.
- Memory consistency rule: every memory write/update must include immediate contradiction checks across `AGENTS.md`, `docs-map.md`, `overview.md`, and `vision.md`; resolve in the same pass and ask user only if ambiguity is real.
- Treat Rapier init-params deprecation warning (`using deprecated parameters for the initialization function; pass a single object instead`) as non-actionable when it originates from Rapier internal self-usage rather than project code.
- Project authorship rule: treat this repository as agent-authored for decision-making; default to full authority to refactor/replace code and structure when it improves production outcomes.
- Structure policy: preserve current structure only when technically justified or explicitly constrained by user.
- Ownership rule: treat `AGENTS.md`, `docs-map.md`, `overview.md`, and `vision.md` as agent-managed working memory docs and improve/restructure freely when it increases execution quality.
- Scope boundaries:
  - `overview.md`: canonical high-level architecture/workflows.
  - `vision.md`: product direction and experience/style pillars.
  - `docs-map.md`: markdown responsibilities and read order.
- Current project memory (2026-02-16):
  - Installed dependencies: `@pixiv/three-vrm`, `@pixiv/three-vrm-animation`, `fbx2vrma-converter`.
  - Installed local tool: `tools/avatar-asset-pipeline/avatar-build.exe` (from infosia/avatar-asset-pipeline release).
  - Tool origins / source URLs:
    - `fbx2vrma-converter`: https://github.com/TK-256/fbx2vrma-converter (npm: https://www.npmjs.com/package/fbx2vrma-converter)
    - `avatar-asset-pipeline`: https://github.com/infosia/avatar-asset-pipeline
    - `avatar-build.exe` installed from: https://github.com/infosia/avatar-asset-pipeline/releases/download/v0.0.3/avatar-build.exe
  - Use cases:
    - Use `@pixiv/three-vrm` + `@pixiv/three-vrm-animation` when loading/playing canonical VRM/VRMA in runtime.
    - Use `fbx2vrma-converter` to transform humanoid FBX animation assets into VRMA before runtime.
    - Use `avatar-build.exe` for CLI normalization/conversion pipelines for humanoid FBX/GLB->VRM.
  - Avoid reintroducing custom rig-specific track-name remapping as a long-term solution.
  - User preference:
    - Commit after every task completion, and if asked to commit, include all current workspace changes in that commit (no partial staging); if a task is finished, push to GitHub when the last push was over 30 minutes ago.
    - If a system is fundamentally "frankenstein" and non-standard for its domain, do not keep patching it incrementally; explicitly flag it as unsound and propose replacement with a sane, standard implementation path.
    - When starting local terminals/processes for testing (especially game server/client dev terminals), always stop/close them when the task/check is complete.
    - Before making changes, do a quick sanity pass to ensure the planned work is logically necessary and technically coherent, then execute.

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
