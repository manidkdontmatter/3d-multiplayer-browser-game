# Agent Operating Notes

## Platform and Stack

- Develop on Windows (not Linux) in PowerShell by default.
- Use `cmd` chaining only when needed (example: `nvm use ... && npm ...`).
- Project target: production-grade TypeScript/Node.js 3D browser game.
- Networking: nengi 2.0 patterns only (no nengi 1.x).
- Rendering: Three.js. Physics: Rapier.

## Session Bootstrap

- At session start, read in this order:
  1. `AGENTS.md`
  2. `docs-map.md` (if present)
  3. `progress.md` (if present, before planning/coding)
  4. `overview.md` (if present)
  5. `vision.md` (if present)
  6. Curated indexes: `docs/nengi2-index.md`, `docs/threejs-index.md`, `docs/rapier-index.md` (when present)
- Then load only task-relevant files in `docs/`; avoid bulk-reading vendored trees.

## Workflow and Tooling

- Commit locally after meaningful verified changes; push at milestones or on request.
- Ask user approval before any dependency add/install/upgrade.
- Network can be slow (~3 mbps): prefer retries/longer timeouts and avoid unnecessary downloads.
- Use Playwright when browser automation/testing is relevant.
- Runtime is Node `20.19.0`; run `nvm use 20.19.0` before dev/test.
- On this Windows setup, run `nvm use ... && npm ...` in the same `cmd` process to avoid PATH desync.
- Keep Node `>=20.19.x` (Vite requirement).
- Validation defaults: `test:smoke` and `test:multiplayer`; never run them in parallel (ports `5173`/`9001`).
- During active iteration, prefer fast checks first (`typecheck:*`, `test:smoke:fast`, `verify:quick`) and reserve full multiplayer suites for gates.

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
- Memory consistency rule: every memory write/update must include immediate contradiction checks across `AGENTS.md`, `docs-map.md`, `overview.md`, `vision.md`, and `progress.md`; resolve in the same pass and ask user only if ambiguity is real.
- Project authorship rule: treat this repository as agent-authored for decision-making; default to full authority to refactor/replace code and structure when it improves production outcomes.
- Structure policy: preserve current structure only when technically justified or explicitly constrained by user.
- Ownership rule: treat `AGENTS.md`, `docs-map.md`, `overview.md`, `vision.md`, and `progress.md` as agent-managed working memory docs and improve/restructure freely when it increases execution quality.
- Scope boundaries:
  - `progress.md`: active priorities, recent verifications, blockers, handoff notes.
  - `overview.md`: canonical high-level architecture/workflows.
  - `vision.md`: product direction and experience/style pillars.
  - `docs-map.md`: markdown responsibilities and read order.
