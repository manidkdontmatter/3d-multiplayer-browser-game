# General
- item/inventory system. items on ground. pick up item. drop item. view in inventory. equip item. use item. consume item. holding item animation. using item animation.
- swimming movement state
- ocean, preferably with waves, synced deterministically so they match on server and client without continuous syncing, ability to sample wave height for character swimming and boats floating etc

# Missing Major Systems
- Multiple maps handling which probably means multiple nengi spatial channels and maybe as far as running separate processes of the game each told to run their own map via a cli arg so each map and thus the players on it are on a different cpu core and i guess since each process has its own nengi instance the player has to disconnect from one port and connect to another port as each port to change maps idk
- maps should be data files somewhere, telling like what objects exist on the map and where, like moving platforms and other objects that exist on a map idk, trees, etc, maps are probably made in some external 3d tool to be yet determined, have to be able to export maps to a file usable by games such as this, json for all i know idk
- Item Creator (same concept as ability creator mostly)
- Character Customizer (stats, appearance, etc)
- NPCs, Pathfinding, efficient npc despawning/inactiveness when no player around so save network traffic
- Vehicles (Spaceships, Cars, Boats)
- Guilds/Factions/Tribes
- Controllable Fortresses
- ecosystem simulation (animals that reproduce etc)
- destructable environments, destructable items and other things in general, ability for anything marked as such to be able to be destroyed/damaged and has health

# Character Appearance
- proper fps arms appearance
- proper "view your own body" appearance in first person

# Animations
- Proper "fps arms" animations for melee and firing projectiles etc

# Combat
- a melee system that feels minimally acceptable
- projectile attacks that feel minimally acceptable

# Ability Creator
- Add customizing the appearance of an ability, for example what a projectile looks like
- Add customizing the pattern of an ability, for example for projectile trajectory: straight, spiral, shotgun (multiple weaker projectiles at once), small at first but grow over time, etc, some exclusive some stackable

# Projectile System
- This concept applies to more than projectiles actually, but instead of literally syncing the position/etc of a projectile every tick (idk if that's what we do right now btw) if it's projectile follows a preset pattern, like we know it uses the spiral pattern, or shotgun pattern, we don't have to sync the projectile, just let it exist only on the server, but send the client the data they need (spawn position, direction, pattern (spiral, shotgun, etc)) and they'll replicate the visuals but they're not synced at all. if a projectile ability was given the shotgun pattern that means instead of one projectile it will shoot like 10 tiny projectiles that do less damage each, and each time you fire it it uses the exact same distribution but rotated 45 degrees, so the data the client needs to replicate that pattern would be something like {position,"shotgun",45}, really that simple. next time you fire that ability the server will send {position,"shotgun",90} for example. for shotgun projectiles this should create a very cool look even though its the same overall projectile distribution pattern but rotated 45 degrees every time you fire, this makes it deterministic which is needed for proper replication, unlike a random distribution. you know what the problem of not syncing projectile transforms is though possibly? what if the enemy deflects the projectile/beam or something like that?