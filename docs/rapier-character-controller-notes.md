# Rapier Character Controller Notes (JS)

This is the local project note for how we should use Rapier for first-person kinematic movement.

## What Rapier already gives us

- Hit-and-slide motion resolution for a kinematic collider.
- Grounding output after movement query.
- Slope config (climb and slide angles).
- Auto-step support.
- Snap-to-ground support.

## What we still own at game level

- Input to desired velocity mapping (boomer-shooter style feel).
- Sprint/jump rules and gameplay state.
- Platform carry behavior details (especially rotating platform frame transforms).
- Networking concerns: server authority, client prediction/reconciliation, replication.

## Recommended usage pattern in this project

1. Server: hold authoritative player capsule collider(s) in Rapier.
2. Per tick: convert command input -> desired translation delta.
3. Call Rapier character controller query for movement solve.
4. Apply computed translation to authoritative state.
5. Replicate resulting transforms through nengi.
6. Client: run matching prediction model; reconcile against authoritative snapshots.

## Why this is preferred

- Keeps collision correctness in a proven engine.
- Avoids fragile hand-rolled full collision stack.
- Preserves our ability to keep movement feel simple/snappy.

