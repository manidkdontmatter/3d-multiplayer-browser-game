# Markdown File Map

This file defines the role of each top-level Markdown file so context stays clean and useful.

## Read Order (Session Start)

1. `AGENTS.md` (operating instructions + durable memory rules)
2. `docs-map.md` (this file; role/read-order and conflict policy)
3. `progress.md` (active status/TODO/handoff)
4. `overview.md` (canonical system/architecture summary)
5. `vision.md` (product/game direction)
6. `docs/` (local technical reference docs; recurse per AGENTS rules)

## File Responsibilities

- `AGENTS.md`
  - What it is: persistent instructions for how the agent should operate on this repo.
  - Include: workflow rules, tooling/runtime constraints, memory behavior, decision heuristics.
  - Exclude: long-form project narrative/history and temporary task status.

- `progress.md`
  - What it is: short-lived working memory for current status and near-term TODOs.
  - Include: what changed recently, what is verified, open tasks, handoff notes.
  - Exclude: timeless architecture explanations and permanent operating policy.

- `overview.md`
  - What it is: canonical high-level description of what the project is and how it works.
  - Include: architecture, stack, core modules, netcode model, key workflows.
  - Exclude: step-by-step session logs and agent-behavior policy.

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
5. `progress.md` for latest status/TODO context.

After deciding, update the conflicting files so the contradiction is removed instead of carried forward.
