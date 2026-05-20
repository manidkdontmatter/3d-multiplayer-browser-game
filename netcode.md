# Netcode Agent Guide

This document captures netcode invariants and hard-won findings so future agents do not need to rediscover them.

## Core Invariants

- Server-authoritative simulation only.
- Client sends intents/commands; server owns world state.
- Client is primarily a rendering/runtime presentation layer.

## Current Replication Model

- `RuntimeEntity` is for dynamic ECS entities in the "anything can be anything" domain.
- `WorldAnchorEntity` is for non-morphing large world anchors/roots.

## Why These Names

- `RuntimeEntity` avoids inheritance implications.
- `WorldAnchorEntity` reflects immutable, world-structure replication intent.

## nengi 2.0 Constraints and Behavior

- Schemas are compiled/static per `ntype`; dynamic runtime field additions are not replicated.
- nengi diffs only schema-listed fields each tick.
- `Binary.Vector3` and `Binary.Quaternion` are compared as whole values:
  - any component change marks the full field changed.
- Array-like schema fields are compared as one field:
  - any element change means that field is resent as a whole.
- Overlapping AOI channels are deduped for the same entity (`nid`) in a tick.
- nengi does not provide production-ready dynamic per-channel Hz replication out of the box.

## Practical Design Rules

- Keep high-frequency visual/public state on entities.
- Keep owner-private state as targeted messages only.
  - Examples already in use: inventory/hotbar-style owner state messages.
- Do not place private per-player state on public AOI entity schemas, they are synced to everyone.