# Guidelines
- This document is the ultimate source of truth for what this game is supposed to be. If the actual code or existing features/systems of the game contradicts this document we must make it conform to this document.
- Infer heavily the missing pieces from this document, don't think just because features are details are missing from this document that that means you can't add them, it usually just means nobody thought to add those to this document yet.

# General Summary
- An authoritative server multiplayer 3d open world persistent world first person browser sandbox game supporting 100+ players per server and 1000+ NPCs (not all spawned at once necessarily, but maybe).
- Anime game, but first person only, with gameplay that is part immersive sim part boomer shooter.
- Players start as regular humans but can increase in power until they are superhumans that fly around, shoot big energy blasts and energy beams at each other, fight with high octane melee combat, swords made out of their own energy, and other amazing and various and imaginative anime powers, including transformations that increase their power.
- All abilities in the game are player made, via an in-game ability creator allowing them to customize an ability by putting points into its stats and adding attributes to it that further augment its behavior. They can create abilities such as melee attacks, ranged attacks (usually energy attacks), passives, transformations, and much more.
- The goal is to have as many things as possible be player made using in-game systems, for example creating abilities but also items and more, as opposed to preset systems, because this game is trying to be quite procedural and flexible, having unlimited possibilities.
- Characters can change their hair and clothes and skin color. There will also be multiple races to play as including human and more, but races other than human many require unlocking.
- You can customize your character's stats and add attributes to them to further augment them beyond just stats. Attributes can be extra upsides or downsides that you add to your character that can't be accomplished merely by adding or removing points from stats. Although some races may be able to have a certain amount of good attributes added to them without adding bad attributes, generally to add more good attributes beyond that you must also choose a bad attribute, thus sacrificing something to gain something. This customization of stats then choosing attributes often applies to more than just characters, abilities and items feature similar systems.

# Player Flow
- On join, players spawn immediately as a default human character.
- Character customization and starter stat allocation happen in-game after spawn, not as a blocking front-loaded character creator.

# Setting
- The main game world is a paranormal void dimension informally understood as an otherspace/praeterspace rather than outer space. It is void-centric: players fly between sparse floating places instead of traveling across a mainland. It is almost as if the entire game takes place in the astral realm.
- The void contains regions with radically different atmospheres, from hellish and hostile to heavenly and peaceful. These regions are defined by complete environment presets rather than skyboxes alone: sky, fog, lighting, nebula layers, particle fields, post-processing, and later ambience audio.
- Environment appearance is resolved by priority layers. The neutral void is the fallback, large authored void-region volumes define the broad area aesthetic, and smaller location/interior volumes override the broader region while blending smoothly at their boundaries.
- Environment volume blending is distance-based. Broad void-region and location atmosphere changes should fade over large distances so flying between areas feels gradual rather than snapping after a short threshold.
- The primary void sky should be a space/paranormal sky system with region-specific starfields and nebula colors, not a normal Earth-atmosphere sky. Blue-sky island bubbles can exist, but even those are environment presets that blend through the same client-only sky/fog/VFX resolver.
- The game should not be built around a normal planet, Earth, or a large mainland. Terrain exists only as rare floating islands.
- A strong working premise is that player characters are soul-forms or post-mortal beings given mutable bodies in this dimension. This supports respawning, transformations, flying, and self-authored powers without requiring a normal earthly origin.

# Aesthetic
- Low-poly/retro presentation with realistic proportions.
- Light/optimistic overall tone (not dark, yet not cartoony).
- Practical asset-delivery awareness (lighter texture/asset footprint where possible).
- UI style direction keywords: astral, spiritual, etherical.

# General Details
- The game has proximity voice chat so players can communicate with nearby players

# Characters
- First person only, walking, running (same as sprinting), jumping, flying, and more.
- Baseline movement feel should stay snappy and streamlined (boomer-shooter/immersive-sim inspired), not heavy/cinematic.
- Support for multiple playable races. Everyone starts off human and can unlock the other races. The other races are then extra playable characters you can switch to during gameplay, thus you have multiple saved characters each separate from each other, but only one per each race.

# Combat
- Fight using melee attacks and ranged attacks and area of effect attacks and many more
- Open world PVP
- Any object can potentially take damage so long as it is allowed to take damage
- There are NPCs, you can fight them and they can fight you and they use pathfinding.
- When you reach 0% health you become knocked out, which means you enter an animation where you lay on the ground unable to move, 30 seconds later you recover and are put at 1% health. when you are first knocked out, health goes back to 100% but you are still knocked out
- While knocked out, if an enemy keeps attacking you until you are at 0% health again, you will die
- When you die you simply respawn fully healed

# World
- The primary world is one huge void map composed of authored floating locations. A location can be a terrain island, castle, shrine, ruin, arena, mothership, airship, mobile base, platform cluster, or other large object.
- There is no canonical mainland and no ocean-surrounded default terrain. Old mainland/ocean assumptions are deprecated unless a specific modded map intentionally uses them.
- The void map is authored as a sparse set of major location roots, likely tens rather than thousands of major places. These roots are replicated and interest-managed so clients discover and stream nearby locations.
- A location root is a lightweight authoritative object. Its children can be local/generated/rendered content such as model pieces, procedural terrain, crystal bowls, collision proxies, visual effects, and environment volumes.

# UI
- A typical inventory system of an RPG where you have a menu of items/etc you possess.
- A typical menu to view your character stats and put points into them and add/remove attributes from your character and other important information about your character
- A typical hotbar to drag your abilities and items onto
- Typical status bars to see your character's health, stamina, etc
- A menu similar to an inventory menu but for your abilities you possess instead, you can drag them from there onto your hotbar
- A menu allowing you to create new abilities, which means putting points into it and adding attributes to it, and after creating it it appears in your abilities menu

# Character Stats
- Characters have the following stats: power, durability, speed, stamina, vitality, spirit.
- Power increases damage you do but each ability drains more stamina to compensate
- Speed: move faster. reduced cooldowns on everything. projectiles abilities travel faster. abilities that have a casting time before activating have a shorter casting time.
- Stamina: abilities drain stamina generally
- Vitality: heal faster, stay buffed longer (buff abilities drain stamina, but they drain it slower the more vitality you have), resist bleed damage, resist poison (btw resist in these contexts mean the damage from them is reduced because your vitality is higher). recover stamina faster.
- Spirit: more projectile range, heal faster when standing still (standing still counts as resting/meditating), resist stun, resist fear/insanity attacks, energy shield ability is stronger, gain power as health and stamina decrease, area of effect attacks have bigger area of effect, bigger explosions from energy attacks that explode on impact
- Players can put stat points into these stats, they can add 1 stat point at a time, but 1 stat point translates to a different amount gains depending on the stat it is put in, so adding 10 stat points to power might raise it from 100 (baseline) to 150 while adding 10 points to vitality might take it from 100 (baseline) to 200. In your character's stats menu, there are two panels in the menu, on the left panel you see a list of your stats, how many points you have in them, and a minus and plus button to remove/add points to them, then on the right panel you have your actual character stats which are derived from the amount of points you put in on the left, the actual stat value is derived from the points you put in.
- health and stamina recover every second until they're full. stamina recovers by 1/20th of whatever vitality is per second. health recovers by vitality/100 per second

# Character Stat Technicals
- The maximum of health is always 100, as in 100%, it does not increase as you progress like in most games.
- Damage you deal to someone else is 10 * your power / victim's durability

# Abilities
- All abilities are created by players for their own use. They create an ability for themselves to use. They choose an ability type (melee, projectile, area of effect, energy beam, or buff), then they can put points into that ability's stats, then add attributes to the ability. Each ability type has varying stats and attributes only applicable to that type, although there are some that exist for all types. Players can teach their abilities to other players by walking up to that player and doing some sort of interaction that teaches them the ability that is yet to be figured out.
- Some attributes on abilities include status effects like stun, and bleed (damage over time)

# Items
- Items can lay on the ground, ready to be picked up by players via some interaction
- Players can also drop their items from their inventory on the ground
- There are equippables, which includes weapons, clothes, etc.
- There are consumables.
- There are other items which are neither equippable or consumable, not sure how to classify them but they're items typical of games, ones that you use but aren't consumed, ones that are just value items such as currency, etc

# Alignment System
- You are good by default, if you kill another good player you become evil for 1 hour. Anyone can kill evil without becoming evil.

# Progression
- There is a system that tracks when you are fighting by whether you have dealt damage to another player/npc AND ALSO have been dealt damage to yourself by another player/npc, meaning you are both actively fighting each other (within the past 5 seconds btw). it determines this means you are in combat and if you are in combat you gain 10 xp per second and at 100 xp you level up which gives you 1 stat point, required xp to the next level then increases by 10.
- Your character has a "battle power (BP)" rating which represents the overall power of your character, BP is derived from how many total stat points you have put into your stats, BP equals the amount of points you put into your stats to the power of 3. BP doesn't do anything itself, it is just for bragging rights and so other players can see how powerful you are in one convenient number.

# Factions / Guilds
- There are player made factions, they're the same concept as guilds, any player can make their own faction and invite other players. You can view a faction menu to see what factions you are in and click a faction for details such as who all is in the faction.

# Weather and Day Night Cycle etc
- There is a weather system containing typical weather states such as rain and sunny etc
- There is dynamic clouds
- There is a day night cycle
- The sun and moon move through the sky

# Bases
- TBD

# Transformations
- TBD

# Races
- TBD

# Locations
- TBD

# Artifacts
- TBD
