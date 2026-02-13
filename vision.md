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
- Adapt anime-inspired power escalation into first-person gameplay without switching genres.

## Visual Pillars

- Low-poly/retro presentation with realistic proportions.
- Light/optimistic overall tone (not dark, not cartoony).
- Practical asset-delivery awareness (lighter texture/asset footprint where possible).

## Architecture Alignment

- Strict client/server separation.
- Authoritative server trust model.
- Design choices should remain compatible with high-player-count netcode and anti-cheat boundaries.

## Guidance Level

These are directional goals that guide decisions and prioritization. They are not intended to block better technical solutions when constraints or evidence suggest adjustments.
