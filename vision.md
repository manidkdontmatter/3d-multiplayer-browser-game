# Game Vision

## Product Direction

Build a full-fledged, high-quality, production-grade first-person 3D multiplayer browser game with authoritative networking and strong engineering discipline.

Long-range target:
- 100+ simultaneous players in a persistent world.
- Player-hosted servers as a first-class model.
- A separate server-list web app (later) that links players to each host's game URL/IP.

## Player Flow

- On join, players spawn immediately as a default human character.
- Character customization and starter stat allocation happen in-game afterward, not as a blocking front-loaded character creator.

## Gameplay Pillars

- First-person only.
- Baseline movement starts as snappy boomer-shooter/immersive-sim style:
  - walk, run, jump, sprint
  - streamlined feel over heavy cinematic movement systems
- Long-term progression unlocks superhuman/anime-scale abilities:
  - advanced movement states (including flight)
  - energy beams, energy weapons, melee
- Adapt anime-inspired power escalation into first-person gameplay.

## Visual Pillars

- Low-poly/retro presentation with realistic proportions.
- Light/optimistic overall tone (not dark, yet not cartoony).
- Practical asset-delivery awareness (lighter texture/asset footprint where possible).

## Architecture Alignment

- Strict client/server separation.
- Authoritative server model.
- Design choices should remain compatible with high-player-count netcode.
- Only syncronize data over the network that actually needs syncronized and would be syncronized in a professionally made multiplayer game, if it doesn't make sense to syncronize it, don't.

