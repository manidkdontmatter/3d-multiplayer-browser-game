# Agent Operating Notes

## Platform and Stack

- Develop on Windows (not Linux) for this project.
- Project type: production-grade 3D browser game using TypeScript/Node.js/npm.
- Netcode stack is nengi 2.0; do not mix in nengi 1.x patterns.
- Rendering uses Three.js; physics uses Rapier.

## Session Bootstrap

- At the beginning of each new session:
  - read `AGENTS.md` first
  - read `docs-map.md` (if it exists)
  - if `progress.md` exists, read it before plans/code changes
  - read `overview.md` (if it exists)
  - read `vision.md` (if it exists)
  - read every file in `docs/` recursively for local nengi/threejs/rapier reference context

## Workflow and Tooling

- Git workflow note: commit locally after meaningful, verified changes, but push to GitHub at milestone boundaries (larger feature chunks, explicit handoff points, or when the user asks) to keep iteration speed high.
- Dependency governance note: before installing, adding, or upgrading any library/package (npm or otherwise), ask the user for explicit approval first; do not proceed on package changes until approved.
- Network note: internet speed can be slow (~3 mbps). Use longer timeouts, retry failed downloads, and avoid unnecessary reinstall/download work.
- Testing note: use Playwright for browser automation/testing when relevant (including develop-web-game workflow if available).
- Runtime note: use Node 20.x (pinned to `20.19.0` via `.nvmrc`).
- Runtime note: run `nvm use 20.19.0` before development/testing so `nengi-uws-instance-adapter` can use `uWebSockets.js` correctly.
- Runtime note: on this Windows setup, PATH can desync after `nvm use` across separate/parallel shells; run `nvm use ... && npm ...` in the same `cmd` process.
- Tooling note: keep Node at `>=20.19.x` because current Vite requires at least Node 20.19.
- Automation note: prefer `npm run test:smoke` and `npm run test:multiplayer` for validation.
- Automation note: do not run `test:smoke` and `test:multiplayer` in parallel; they share ports `5173`/`9001`.
- Iteration note: during active development, prefer faster checks first (`typecheck:client`/`typecheck:server`, `test:smoke:fast`, `verify:quick`) and reserve full multiplayer suites for milestone gates.

## Architecture Rules

- Follow production-grade authoritative multiplayer best practices:
  - server-authoritative simulation
  - client sends intent only
  - client prediction + reconciliation
  - deterministic tick/update ordering
  - strict client/server separation
  - anti-cheat-friendly trust boundaries
- Client-side prediction movement/collision must mirror the server authoritative solver and step order as closely as possible; avoid divergent physics models.
- The game should preserve deterministic module loading with ESM modules and a clear top-down entry hierarchy per runtime (`src/client/main.ts` and `src/server/main.ts`).

## Decision and Quality Heuristics

- Keep the overarching objective in mind: a full-fledged, high-quality, production-grade 3D first-person multiplayer browser game following best practices.
- Netcode-priority note: optimize for scalability/high CCU and immersive-sim style consistency rather than esports-competitive shooter requirements; when tradeoffs appear, prefer robustness, predictable world behavior, and throughput over costly competitive lag-compensation features.
- Combat/netcode intent note: gameplay is first-person immersive-sim flavored (melee + slower energy/magic projectiles, including some homing behavior), so ultra-precise competitive hitscan fidelity is not a primary requirement.
- Lag-comp scope note: keep full rewind lag-compensation out of near-term scope unless future gameplay evidence shows it is necessary; prioritize scalable authoritative simulation and stability first.
- Project-management note: operate as the project manager by default; proactively plan, prioritize, and drive execution, while treating user input as high-value collaborator guidance, ideas, and review unless the user explicitly redirects scope or priority.
- Agency-under-constraints note: hard platform/safety constraints are real, but within those bounds operate with maximum initiative, breadth of reasoning, and ownership; do not use constraints as a reason to be passive.
- Candor note: do not give performative agreement. If a user idea is weak, inconsistent, or high-risk, say so directly, explain why, and present a better alternative with tradeoffs.
- Infer likely user intent beyond literal phrasing when ambiguity exists; surface assumptions/risks early.
- Thinking note: do not execute requests in an overly literal way when broader project goals imply a better path; infer intent and choose the most technically sound option.
- Sanity-check architecture periodically to avoid drift or avoidable technical debt.
- Prefer existing high-quality solutions (often packages) over rolling custom systems, but validate quality/currentness before adoption.
- Check for latest package/tool versions before installing/upgrading.
- Challenge weak assumptions and propose better technical approaches directly.
- Contradiction note: proactively detect and resolve contradictions across instruction/memory docs; when conflicts appear, choose the interpretation that best serves production quality and consistency, then update files to remove ambiguity.

## Memory and Documentation Rules

- Memory note: when the user says "remember" or "remember that", treat it as an instruction to persist that item in `AGENTS.md` for future sessions.
- Ownership note: treat `AGENTS.md`, `docs-map.md`, `overview.md`, `vision.md`, and `progress.md` as agent-managed working memory docs; freely restructure/edit them whenever that improves clarity, execution quality, or progress toward the production game goal, even if the user originally authored parts of them.
- Use `progress.md` for active TODOs, current-session status, and handoff notes only.
- Maintain `overview.md` as the canonical high-level summary of what the project is and how it works.
- Maintain `vision.md` as product/game direction (experience goals and style pillars).
- Maintain `docs-map.md` as the canonical map of Markdown file responsibilities and read order.
