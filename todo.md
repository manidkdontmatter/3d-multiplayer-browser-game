# Priority

get some performance metrics or tests or something idk to ensure performance and scalability of the server's netcode to ensure certain netcode requirements such as bytes sent/received per second as a whole and per player and we should pick sensible limits on for example what the maximum bytes should be sent per player per second on average as a whole so that we know if we go above those limits we need to optimize netcode and sanity check it 

## What the engine is

The engine is a specialized runtime for authoritative multiplayer sandbox first-person 3D browser games. It provides capabilities; the game decides what to do with them.

The engine provides:
- ECS via bitecs (entities are just bags of components)
- Physics (Rapier), networking (nengi), rendering (Three.js), persistence (SQLite), navigation (Recast)
- Core systems that process component combinations: movement, combat, damage, projectiles, AI, inventory, abilities, etc.
- A **single archetype system** that spawns any entity from a component template
- The component library — what each component means and which systems process it
- Networking infrastructure (message routing, replication, command handling)
- Rendering pipeline, input handling, UI framework, asset loading
- Shared deterministic math, type interfaces, collision groups

The engine never imports from `src/game/`. It exposes APIs (registries, events) for the game to hook into.

## What the game is

The game is a replaceable layer that defines what this specific game is:
- Archetype definitions (JSON templates describing what components entities get)
- What items, abilities, characters, NPCs, platforms, locations exist
- What stats and attributes are available per archetype
- Asset manifests (which models/textures/sounds map to which archetypes)
- Game-specific UI (HUD layout, creator panels, inventory screen)
- Map definitions (what objects exist where)
- Game-specific server behaviors

## The archetype system — not separate "creators"

We do NOT need separate Character Creator, Item Creator, and Ability Creator systems. In an ECS, there is no difference between a character, an item, an ability, a door, or a projectile — they are all just entities with different component sets.

A goblin is `Entity + [Health, AI, CharacterController, Inventory, Combat, Model]`.
A sword is `Entity + [Item, Weapon, Damage, Pickupable, Icon, Model]`.
A door that's also an enemy is `Entity + [Openable, Collider, Health, AI, Combat, Model]`.

The engine provides ONE archetype spawner. You give it a template name, it assembles the entity from the component definitions in that template. The game provides the templates.

The player-facing "ability creator" is a game-layer UI that lets players customize an ability archetype's parameters, which the engine's archetype spawner then materializes. The creator is a UI feature, not a separate engine system.

## Stats and attributes

All entities have stats and attributes defined by their archetype. A gun archetype defines different stats than a hat archetype. The engine provides the stat/attribute storage and computation; the game registers which stats exist per archetype. The engine doesn't know what "magazineSize" means — it just knows it's a float stat on the gun archetype.

## Engine/game communication

- Game → Engine: The game registers archetypes, components, systems, and asset mappings via engine APIs at startup. This is dependency injection — the engine defines interfaces, the game implements and passes instances in.
- Engine → Game: The engine emits events ("item_used", "ability_created", "player_died"). The game listens and decides what happens. The engine never calls `game.onItemUsed()` directly.

## Directory structure

```
src/
  engine/
    shared/     # Type interfaces, netcode schemas, deterministic math, collision groups
    client/     # Rendering, input, UI framework, prediction, asset loading
    server/     # ECS, physics, networking, all systems, persistence, navigation
  game/
    shared/     # Archetype definitions (JSON), asset manifests, game constants
    client/     # Game-specific UI, HUD, visual customization
    server/     # Map configs, game-specific server behavior
  orchestrator/ # Control-plane HTTP server (unchanged)
```

Both engine and game have client/server/shared because the separation axis is orthogonal to the network boundary. Engine shared/ contains type interfaces and protocols — never authoritative logic. Game shared/ contains archetype data that both client and server need to agree on (what items exist, what models they use).

# General
- Item/inventory system. Items on ground. Pick up item. Drop item. View in inventory. Equip item. Use item. Consume item. Holding item animation. Using item animation.
- Swimming movement state
- Ocean, preferably with waves, synced deterministically so they match on server and client without continuous syncing, ability to sample wave height for character swimming and boats floating etc.

# Missing Major Systems
- Archetype system: one unified system that spawns any entity from JSON component templates, replacing the flawed idea of separate creators. The player-facing ability creator UI is a game-layer feature built on top of this.
- Multiple maps handling which probably means multiple nengi spatial channels and maybe as far as running separate processes of the game each told to run their own map via a CLI arg so each map and thus the players on it are on a different CPU core. Each process has its own nengi instance; the player disconnects from one port and connects to another to change maps.
- Maps should be data files (likely JSON) defining what objects exist and where — trees, moving platforms, etc. Maps are probably authored in an external 3D tool and exported to a format usable by the game.
- Character customization (stats, appearance) — this is archetype parameterization, not a separate creator system
- NPCs, Pathfinding, efficient NPC despawning/inactiveness when no player around to save network traffic
- Vehicles (Spaceships, Cars, Boats)
- Guilds/Factions/Tribes
- Controllable Fortresses
- Ecosystem simulation (animals that reproduce etc.)
- Destructible environments, destructible items and other things in general — anything with a Health component can be destroyed

# Character Appearance
- Proper FPS arms appearance
- Proper "view your own body" appearance in first person

# Animations
- Proper FPS arms animations for melee and firing projectiles etc.

# Combat
- A melee system that feels minimally acceptable
- Projectile attacks that feel minimally acceptable

# Ability Creator (player-facing UI)
- The ability creator is a game-layer UI that lets players customize ability archetypes by adjusting stats and adding attributes. It produces an archetype definition that the engine's archetype spawner materializes.
- Customizing the appearance of an ability (e.g., what a projectile looks like)
- Customizing the pattern of an ability (e.g., straight, spiral, shotgun spread, small-to-large). Patterns are deterministic so the client can replicate visuals from pattern data alone without per-tick syncing.
- Attributes on abilities include status effects like stun, bleed (damage over time)

# Projectile System
- For projectiles following preset patterns (spiral, shotgun, etc.), the server sends spawn position + direction + pattern data. The client replicates visuals deterministically — no per-tick syncing needed. For shotgun: `{position, "shotgun", rotationOffset}` where rotationOffset increments by 45 degrees each shot.
- Problem to solve: what if an enemy deflects the projectile? That breaks determinism and would require the server to take over replication for that projectile.
