# Markdown File Map

This file defines the role of each top-level Markdown file so context stays clean and useful.

## Read Order (Session Start)

1. `AGENTS.md` (operating instructions + durable memory rules)
2. `docs-map.md` (this file; role/read-order and conflict policy)
3. `overview.md` (canonical system/architecture summary)
4. `vision.md` (product/game direction)
5. `docs/*-index.md` (curated technical entry points)
6. Task-targeted files in `docs/` only as needed (avoid bulk-loading vendored docs trees by default)

## File Responsibilities

- `AGENTS.md`
  - What it is: persistent instructions for how the agent should operate on this repo.
  - Include: workflow rules, tooling/runtime constraints, memory behavior, decision heuristics.
  - Exclude: long-form project narrative/history and temporary task status.

- `overview.md`
  - What it is: canonical high-level description of what the project is and how it works.
  - Include: architecture, stack, core modules, netcode model, key workflows.
  - Exclude: step-by-step session logs, agent-behavior policy, and transient one-session status notes.

- `vision.md`
  - What it is: product direction and gameplay/aesthetic goals.
  - Include: target player experience, style pillars, long-range game goals.
  - Exclude: low-level implementation details and day-to-day status.

- `README.md`
  - What it is: human-facing quickstart/onboarding for running and testing the project.
  - Include: setup commands, local run/test commands, quick operational notes.
  - Exclude: detailed internal architecture rationale and agent-only rules.

## Maintenance Rules

- If architecture/tooling/workflows materially change, update `overview.md`.
- If goals/game direction materially change, update `vision.md`.
- If operating behavior or memory policy changes, update `AGENTS.md`.
- If a file starts accumulating content that belongs elsewhere, move it and leave a pointer.

## Conflict Resolution

If two docs disagree, resolve in this order:
1. Safety and production-grade engineering constraints.
2. `AGENTS.md` for agent operating behavior/memory policy.
3. `overview.md` for architecture and system behavior.
4. `vision.md` for product direction.
5. If needed, the latest user instruction in the active thread for current status/TODO context.

After deciding, update the conflicting files so the contradiction is removed instead of carried forward.
