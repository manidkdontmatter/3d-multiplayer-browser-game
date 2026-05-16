# In-Game Creator UI Architecture for a Systemic “Anything Can Be Anything” Game

## Purpose of This Document

This document is a strict architecture and implementation guide for adding **in-game creator UIs** to a systemic TypeScript/Node.js game engine.

The game is intended to support an “anything can be anything” simulation architecture similar in spirit to games like *Caves of Qud*, *Dwarf Fortress*, *Cataclysm: Dark Days Ahead*, and other complex systemic games.

The player-facing creator systems must let players create things such as:

- Items
- Abilities
- Characters
- Bioengineered creatures
- Pets
- NPCs
- Robots
- Artificial companions
- Possibly other constructible entities in the future

However, the important architectural rule is:

> The creator UIs are player-facing convenience layers. They must not create separate hardcoded object systems.

Under the hood, all player-created things must use the same generalized simulation architecture:

- Entities
- Components
- Actions
- Events
- Effects
- Materials
- Body plans
- Status effects
- AI packages
- Factions
- Resources
- Blueprints
- Validation rules
- Runtime instances

The creator UIs should simplify the player experience by exposing only the relevant creation options for the thing being created, while still compiling into the same underlying systemic engine.

---

# Non-Negotiable Design Principles

## 1. Creator UIs Are Not Separate Engines

The game may present separate creator UIs to the player:

- Item Creator
- Ability Creator
- Character Creator

But these are **not separate gameplay architectures**.

They are filtered authoring interfaces over the same generalized simulation system.

The Item Creator should not create special “Item objects.”

The Ability Creator should not create special “Ability objects” that bypass the normal action system.

The Character Creator should not create special “Character objects” that bypass ECS, AI, body plans, factions, actions, and events.

Instead:

```text
Creator UI
  -> Player-facing design choices
  -> Validated design data
  -> Blueprint
  -> Compiler
  -> Entity/ability/content definition
  -> Runtime instance using normal simulation systems
```

The UI differs by creation type.  
The underlying architecture does not.

---

## 2. Blueprints, Not Raw Runtime Objects

Players do not directly create runtime entities.

Players create **blueprints**.

A blueprint is a saved, validated, versioned design.

A runtime entity is an actual instance in the world created from a blueprint.

Example:

```text
Blueprint:
  "Acid Hound Mk II"

Runtime Instances:
  Acid Hound #1
  Acid Hound #2
  Acid Hound #3
```

The blueprint defines the intended design.

Each runtime entity has its own current state:

- Current health
- Position
- Inventory
- Injuries
- Status effects
- AI memory
- Loyalty
- Damage
- Mutations
- Power level
- Wear and tear

Do not confuse blueprint data with runtime entity state.

---

## 3. Declarative Data Only

Player-created designs must be declarative.

Players must not be allowed to write arbitrary executable code.

The player should assemble safe building blocks:

- Components
- Traits
- Materials
- Body parts
- Modules
- Effect blocks
- Targeting rules
- AI packages
- Behavior presets
- Costs
- Drawbacks
- Requirements
- Unlock-gated options

Bad approach:

```text
Player writes custom script that runs when the ability hits.
```

Correct approach:

```text
Player chooses from allowed effect blocks:
- Targeting: cone
- Damage: electric
- Status effect: stunned
- Cost: battery charge
- Cooldown: 5 turns
```

This keeps the system:

- Serializable
- Validatable
- Multiplayer-safe
- Testable
- Balanceable
- Debuggable
- Resistant to exploits
- Compatible with AI
- Compatible with save/load

---

## 4. Player-Facing Separation, Engine-Level Unification

The player should see separate creator UIs because that reduces confusion and cognitive overload.

The player should not be forced to understand raw ECS design.

The player-facing UIs should be separated like this:

```text
Item Creator
  - exposes item-appropriate options
  - hides character-only and ability-only options

Ability Creator
  - exposes targeting, costs, effects, cooldowns, delivery methods
  - hides item-only and character-only options

Character Creator
  - exposes body plans, traits, AI, faction, equipment, biological/robotic structure
  - hides raw ability construction except through character-compatible abilities
```

But under the hood, these creator UIs all compile into the same systemic architecture.

The UI type determines which options are available to the player.

The simulation type does not become rigid.

---

## 5. Creation Type Controls Available Options

Each creator UI must define a **creation domain**.

A creation domain controls:

- Which components may be selected directly
- Which trait bundles are available
- Which materials are available
- Which effect blocks are available
- Which costs apply
- Which validation rules apply
- Which unlocks are required
- Which runtime output type is produced
- Which compiler pipeline is used

Examples:

```text
Item Creator:
  Allows:
    material, durability, equippable, weapon, armor, container, portable, tool effects

  Disallows:
    full autonomous AI, biological metabolism, personality, direct body-plan editing

Ability Creator:
  Allows:
    targeting, cost, cooldown, effect graph, activation conditions, drawbacks

  Disallows:
    physical inventory, full body plan, independent position unless ability spawns an entity

Character Creator:
  Allows:
    body, mind, AI, faction, stats, abilities, equipment, biology, robotics

  Disallows:
    arbitrary item-only crafting fields unless adding equipment or built-in modules
```

This is a player-facing constraint layer, not a limitation of the engine.

A sword could still become sentient through advanced systems if it gains the right components.  
But the basic Item Creator UI does not need to expose every possible “turn this into a full character” option by default.

---

# High-Level Architecture

## Required Layers

The creator architecture should use the following layers:

```text
1. Engine Layer
   Entities, components, actions, events, effects, scheduler, RNG, serialization.

2. Content Layer
   Developer-made materials, traits, body parts, modules, status effects, AI packages, effect blocks.

3. Creation Domain Layer
   Defines what each creator UI is allowed to expose and how designs are validated.

4. Creator UI Layer
   Player-facing in-game interfaces: item creator, ability creator, character creator.

5. Blueprint Layer
   Saved, validated, versioned player-created designs.

6. Compiler Layer
   Converts high-level player designs into engine-level entity/component/action/effect definitions.

7. Runtime Layer
   Actual spawned entities, learned abilities, equipped items, robots, creatures, and NPCs using normal systems.
```

The creator UI layer must not directly mutate the runtime simulation except through valid in-game actions.

---

# Essential Vocabulary

## Entity

A runtime world object with a stable ID.

An entity may represent:

- Player
- NPC
- Animal
- Robot
- Sword
- Door
- Corpse
- Fire
- Puddle
- Tree
- Wall
- Machine
- Drone
- Ability-created projectile
- Summoned creature
- Biological pet
- Robotic servant

An entity is not defined by a hardcoded class.  
It is defined by the components it has.

---

## Component

A serializable data object attached to an entity.

Examples:

- Position
- Name
- Description
- Appearance
- Health
- Stats
- Inventory
- Equipment
- Equippable
- Weapon
- Armor
- Material
- Flammable
- Conductive
- Actor
- Energy
- AI
- Faction
- Dialogue
- Body
- BodyPart
- Battery
- PowerConsumer
- Metabolism
- StatusEffects
- AbilityUser
- Openable
- Lockable
- Portable
- BlocksMovement
- BlocksVision

Components should mostly be data, not behavior.

---

## Action

A formal game operation resolved by the simulation.

Examples:

- Move
- Wait
- Attack
- PickUp
- Drop
- Equip
- Unequip
- Open
- Close
- Talk
- UseAbility
- UseItem
- Repair
- Feed
- CommandPet
- ProgramRobot
- ManufactureItem
- GrowCreature
- InstallModule

Creator UIs themselves should usually be accessed through actions or interaction flows.

Example:

```text
Player uses Robotics Bench
  -> Open Robotics Creator UI
  -> Submit robot design
  -> Server validates design
  -> Create robot blueprint
  -> Begin manufacturing job
  -> Runtime robot entity is created when job completes
```

---

## Event

A typed notification emitted by the simulation.

Examples:

- BeforeAction
- AfterAction
- BlueprintSubmitted
- BlueprintValidated
- BlueprintRejected
- BlueprintCreated
- BlueprintVersioned
- ManufacturingStarted
- ManufacturingCompleted
- EntityCreatedFromBlueprint
- AbilityLearnedFromBlueprint
- ItemCraftedFromBlueprint
- CharacterGrownFromBlueprint
- RobotAssembledFromBlueprint
- BeforeDamageApplied
- DamageApplied
- StatusApplied
- EntityDied

Events allow systems to react without hardcoding direct dependencies.

---

## Effect

A declarative consequence block used by abilities, items, statuses, machines, and other systems.

Examples:

- DealDamage
- ApplyStatus
- Heal
- Repair
- Push
- Pull
- Teleport
- SpawnEntity
- CreateLiquid
- EmitGas
- ModifyTemperature
- Ignite
- Freeze
- Shock
- AddComponent
- RemoveComponent
- TransformEntity
- DrainResource
- RestoreResource
- ChangeFaction
- ModifyStat
- StartDialogue

Abilities should be built from effects.

Items may contain effects.

Character traits may grant effects.

Robotic modules may expose effects.

Biological organs may provide effects.

---

## Blueprint

A saved design created by a player or developer.

Blueprints are not live world objects.

Blueprints may represent:

- Item design
- Ability design
- Biological creature design
- Robot design
- NPC/character design
- Pet design
- Drone design
- Equipment module design

Blueprints must be:

- Validated
- Versioned
- Serializable
- Owned or attributed
- Inspectable
- Reproducible
- Compatible with save/load
- Compatible with future multiplayer authority

---

## Runtime Instance

A real entity, ability, or learned capability produced from a blueprint.

Runtime instances can diverge from the blueprint over time.

Example:

A robot blueprint defines:

- Chassis
- Battery
- AI package
- Sensors
- Armor
- Arm modules

A runtime robot instance has:

- Current position
- Current battery charge
- Damaged left arm
- Current orders
- Current target
- Current owner
- Current status effects
- Current inventory
- Current event history

---

# Creator UIs

## Overview

There should be three major player-facing creator UIs at first:

```text
1. Item Creator
2. Ability Creator
3. Character Creator
```

These are separate UIs for usability.

They are not separate simulation models.

Each creator UI should:

- Present only relevant choices
- Hide irrelevant or confusing low-level engine details
- Validate incrementally as the player builds
- Display costs and constraints
- Explain why something is invalid
- Save the result as a blueprint
- Use the appropriate compiler
- Produce normal engine-compatible definitions
- Require in-game resources, stations, tools, knowledge, or unlocks as appropriate

---

# Item Creator

## Purpose

The Item Creator lets players design physical things.

Examples:

- Weapons
- Armor
- Tools
- Containers
- Consumables
- Devices
- Modules
- Implants
- Power cells
- Traps
- Machines
- Utility gadgets
- Crafting components
- Decorative objects
- Quest objects

The Item Creator should expose item-appropriate choices while hiding full character/body/mind creation options.

---

## Item Creator Should Allow

The Item Creator may expose options such as:

```text
Identity:
  - Name
  - Description
  - Appearance
  - Icon/sprite/tile symbol
  - Tags

Physical:
  - Size
  - Weight/mass
  - Material
  - Durability
  - Volume
  - Stackability
  - Fragility
  - Conductivity
  - Flammability
  - Temperature behavior

Usage:
  - Portable
  - Equippable
  - Equipment slot
  - Weapon behavior
  - Armor behavior
  - Tool behavior
  - Consumable behavior
  - Throwable behavior
  - Container behavior
  - Liquid container behavior
  - Power source behavior
  - Power consumer behavior

Effects:
  - On use
  - On equip
  - On hit
  - On throw impact
  - On break
  - On consume
  - Passive aura
  - Periodic effect
  - Triggered effect

Costs:
  - Required materials
  - Crafting time
  - Crafting station
  - Skill requirement
  - Tooling requirement
  - Energy requirement
  - Research requirement

Drawbacks:
  - Heavy
  - Fragile
  - Unstable
  - Consumes power
  - Emits heat
  - Noisy
  - Radioactive
  - Illegal
  - Requires maintenance
```

---

## Item Creator Should Usually Hide or Disallow

By default, the Item Creator should not expose:

```text
- Full biological body-plan editing
- Creature metabolism
- Animal temperament
- Sapient personality editing
- Full autonomous AI
- Faction diplomacy settings
- Reproduction
- Hunger
- Breeding
- Full dialogue trees
- Character history
- General-purpose ability construction unrelated to item use
```

However, advanced items may still indirectly use some of these systems.

Example:

A sentient sword is possible in the engine, but it should probably require an advanced creator mode, special research, or a separate “awaken item” system.

The ordinary Item Creator should not overwhelm the player with every possible component in the game.

---

## Item Creator Output

The Item Creator outputs an **Item Blueprint**.

The blueprint should include:

```text
Blueprint Type:
  item

Identity:
  blueprint ID
  display name
  description
  creator player ID
  version
  creation timestamp

Design:
  item category/presentation type
  material selections
  physical stats
  components to compile
  effect blocks
  use modes
  equipment slots
  tags
  costs
  requirements
  drawbacks

Validation:
  validation status
  validation errors/warnings
  computed balance/cost values

Runtime Output:
  entity definition or entity factory data
  components to attach
  actions granted by item
  events/effects registered by item
```

The runtime item must be a normal entity with normal components.

---

# Ability Creator

## Purpose

The Ability Creator lets players design actions/capabilities that can be used by characters, creatures, robots, items, mutations, cybernetics, magic systems, psionics, or other sources.

Examples:

- Acid spit
- Fire cone
- Electric arc
- Healing pulse
- Teleport dash
- Force push
- Summon drone
- Deploy smoke cloud
- Poison bite
- Repair nanites
- Shield burst
- Fear scream
- Mind control beam
- Radiation vent
- Grappling hook shot

The Ability Creator must integrate with the normal action system.

A custom ability should become a valid action option such as:

```text
UseAbility: AcidSpit
UseAbility: ArcBurst
UseAbility: RepairCloud
```

---

## Ability Creator Should Allow

The Ability Creator may expose:

```text
Identity:
  - Name
  - Description
  - Appearance
  - Icon/symbol
  - Thematic source

Activation:
  - Active ability
  - Passive ability
  - Toggle ability
  - Reaction ability
  - Triggered ability
  - On-hit ability
  - On-damage ability
  - On-death ability
  - Periodic ability

Source:
  - Biological organ
  - Mutation
  - Cybernetic implant
  - Robot module
  - Spell/ritual
  - Psionic power
  - Item-granted ability
  - Training/skill
  - Environmental machine

Targeting:
  - Self
  - Adjacent target
  - Single target
  - Projectile
  - Line
  - Cone
  - Burst/radius
  - Area on ground
  - Touch
  - Chain
  - Aura
  - Global, if allowed by design rules

Requirements:
  - Line of sight
  - Free hand
  - Specific body part
  - Specific item equipped
  - Power source
  - Biological organ
  - Minimum stat
  - Skill level
  - Cooldown ready
  - Resource available

Costs:
  - Stamina
  - Energy
  - Battery charge
  - Heat buildup
  - Hunger
  - Blood
  - Mana/psi/focus if the game uses it
  - Ammunition
  - Materials
  - Cooldown
  - Action time
  - Risk

Effects:
  - Damage
  - Healing
  - Repair
  - Status effect
  - Movement
  - Pull/push
  - Teleport
  - Spawn entity
  - Create liquid
  - Emit gas
  - Modify temperature
  - Ignite
  - Freeze
  - Shock
  - Transform
  - Drain resource
  - Change faction/reaction
  - Apply force
  - Modify terrain/entity

Drawbacks:
  - Self damage
  - Heat
  - Noise
  - Exhaustion
  - Instability
  - Misfire chance
  - Friendly-fire risk
  - Consumes rare resource
  - Requires recovery time
```

---

## Ability Creator Should Usually Hide or Disallow

By default, the Ability Creator should not expose:

```text
- Direct item inventory construction
- Full body-plan editing
- Persistent character personality
- Full independent AI creation
- Unbounded entity spawning
- Arbitrary scripting
- Raw event listeners without constraints
- Infinite recursive triggers
- Effects without costs
- Effects without targeting/preconditions
```

Abilities may spawn entities, but only through validated effect blocks and strict limits.

---

## Ability Effect Graph

Abilities should be represented as an effect graph or effect sequence.

Example conceptual structure:

```text
Ability:
  Targeting:
    projectile, range 6

  Cost:
    stamina 12

  Cooldown:
    4 turns

  Effects:
    1. Deal acid damage
    2. Apply corroded status
    3. Create small acid puddle on hit tile
```

The ability should not be a hardcoded function.

The ability should compile into a declarative definition used by the action/effect/event system.

---

## Ability AI Metadata

Custom abilities must include AI metadata so AI can use them later without bespoke code for each ability.

AI metadata may include:

```text
Role:
  - offensive
  - defensive
  - healing
  - escape
  - buff
  - debuff
  - crowd control
  - area denial
  - utility
  - summoning
  - repair
  - movement
  - terrain manipulation

Targeting hints:
  - preferred range
  - requires line of sight
  - avoid allies
  - prefer clustered enemies
  - prefer wounded allies
  - prefer self when low health
  - avoid flammable environments
  - avoid water
  - useful against armor
  - useful against robots
  - useful against organics

Risk hints:
  - friendly fire risk
  - self harm risk
  - environmental hazard risk
  - high resource cost
  - emergency use only
```

The AI does not need to be brilliant in the first implementation, but the data model must support future AI reasoning.

---

## Ability Creator Output

The Ability Creator outputs an **Ability Blueprint**.

The blueprint should include:

```text
Blueprint Type:
  ability

Identity:
  blueprint ID
  display name
  description
  creator player ID
  version
  creation timestamp

Activation:
  active/passive/reaction/toggle/triggered
  valid users
  source type
  required components/body parts/items

Targeting:
  targeting shape
  range
  area
  line-of-sight requirement
  targeting restrictions

Costs:
  resource costs
  cooldown
  action time
  heat/risk/exhaustion
  required materials if any

Effects:
  ordered effect blocks
  effect parameters
  status effects
  spawned entities if any
  environmental consequences

AI:
  AI metadata
  usage role
  targeting hints
  risk hints

Validation:
  validation status
  errors/warnings
  computed balance/cost values

Runtime Output:
  action definition
  effects
  event hooks
  status interactions
  granted action data
```

---

# Character Creator

## Purpose

The Character Creator lets players design entities that can act, think, obey, fight, work, live, or exist as companions, creatures, NPCs, animals, robots, or other agent-like beings.

This includes:

- Custom playable characters
- Companions
- Pets
- Bioengineered animals
- Bioengineered NPCs
- Cloned servants
- Artificial humans
- Robots
- Drones
- Androids
- Turrets with limited agency
- Constructed golems or similar entities, if the setting supports them

The Character Creator is broader than “humanoid character creation.”

It should be the player-facing creator for entities with bodies, minds, agency, AI, faction relationships, and/or command behavior.

---

## Character Creator Should Allow

The Character Creator may expose:

```text
Identity:
  - Name
  - Species/type label
  - Description
  - Appearance
  - Voice/personality flavor
  - Tags

Body:
  - Biological body
  - Mechanical body
  - Hybrid body
  - Body plan
  - Size
  - Symmetry
  - Limb count
  - Manipulators/hands
  - Movement method
  - Head/sensors
  - Natural weapons
  - Armor/hide/plating
  - Organs/modules
  - Equipment slots

Mind:
  - Intelligence level
  - AI package
  - Temperament
  - Personality traits
  - Obedience model
  - Loyalty model
  - Trainability
  - Autonomy level
  - Command permissions
  - Memory capability
  - Dialogue capability

Stats:
  - Strength
  - Agility
  - Endurance
  - Intelligence
  - Willpower
  - Perception
  - Speed
  - Accuracy
  - Durability
  - Power capacity
  - Metabolism or energy efficiency

Function:
  - Combat role
  - Labor role
  - Guard role
  - Companion role
  - Scout role
  - Mining role
  - Medical role
  - Crafting role
  - Hauling role
  - Social role
  - Utility role

Systems:
  - Faction
  - Ownership
  - Loyalty
  - Hunger/metabolism
  - Battery/power
  - Maintenance
  - Repair/healing method
  - Training
  - Skills
  - Equipment
  - Inventory
  - Abilities
  - Status vulnerabilities/resistances

Requirements:
  - Lab/bench/station
  - Resource costs
  - Samples
  - Parts
  - Research
  - Skill
  - Growth/manufacturing time
  - Risk
  - Legal/faction restrictions
```

---

## Character Creator Should Usually Hide or Disallow

By default, the Character Creator should not expose:

```text
- Arbitrary raw item crafting unrelated to the character
- Arbitrary ability graph editing unless adding a character ability through a constrained sub-flow
- Unlimited components from every engine domain
- Arbitrary scripting
- Unbounded spawning behavior
- Direct event-bus programming
- Raw ECS editing in normal player mode
```

Advanced/developer/debug modes may expose more, but the normal player-facing UI must remain constrained.

---

# Character Subtypes

The Character Creator should support different creation modes.

The main modes should include:

```text
1. Biological Creature
2. Robot / Mechanical Character
3. Hybrid / Cyborg / Bio-Mechanical Character
4. Humanoid / NPC Character
5. Pet / Animal
6. Drone / Limited-Agent Construct
```

These are UI creation modes, not hardcoded runtime classes.

They determine available options, validation rules, costs, and compiler behavior.

---

## Biological Creature Mode

This mode is used for bioengineering animals, pets, organic NPCs, monsters, clones, or other living beings.

Player-facing choices may include:

```text
Base organism:
  - mammal-like
  - reptile-like
  - insectoid
  - avian
  - aquatic
  - fungal
  - plant-like
  - custom unlocked organism

Body:
  - size
  - limb count
  - locomotion
  - jaws
  - claws
  - tail
  - wings
  - sensory organs
  - skin/hide/scales/fur
  - internal organs
  - special glands

Biology:
  - metabolism
  - diet
  - growth rate
  - fertility
  - lifespan
  - healing rate
  - disease resistance
  - temperature tolerance

Behavior:
  - temperament
  - loyalty imprinting
  - trainability
  - aggression
  - fear response
  - pack behavior
  - guard behavior
  - hunting behavior

Abilities:
  - venom bite
  - acid spit
  - pounce
  - camouflage
  - regeneration
  - echolocation
  - tracking scent
  - psychic organ, if setting supports it

Drawbacks:
  - high hunger
  - genetic instability
  - sterility
  - short lifespan
  - vulnerability to cold
  - poor obedience
  - mutation risk
  - special food requirement
```

Under the hood, this compiles into normal components such as:

```text
Body
BodyParts
Health
Stats
Actor
Energy
AI
Faction
Loyalty
Metabolism
Diet
NaturalWeapons
AbilityUser
Material: organic
StatusResistances
StatusWeaknesses
Inventory if appropriate
Equipment if appropriate
Dialogue if sapient
```

---

## Robot / Mechanical Character Mode

This mode is used for robots, drones, androids, turrets, worker bots, mechanical companions, and other artificial entities.

Player-facing choices may include:

```text
Chassis:
  - small drone
  - tracked platform
  - wheeled bot
  - walker
  - humanoid frame
  - heavy industrial frame
  - flying drone

Power:
  - battery
  - fuel cell
  - reactor
  - solar panel
  - external charging
  - disposable power pack

Compute:
  - simple controller
  - worker AI
  - combat AI
  - social AI
  - autonomous personality core
  - remote-control receiver

Sensors:
  - camera
  - infrared
  - radar
  - motion sensor
  - chemical sensor
  - microphone
  - lidar
  - targeting optics

Manipulators:
  - gripper
  - hand
  - tool arm
  - drill arm
  - weapon mount
  - medical arm
  - cargo clamp

Locomotion:
  - wheels
  - treads
  - legs
  - hover
  - flight
  - stationary turret base

Armor:
  - light plating
  - heavy plating
  - insulated shell
  - heat-resistant shell
  - stealth casing

Modules:
  - cargo bay
  - mining drill
  - repair tool
  - stun baton
  - laser emitter
  - shield generator
  - communication relay
  - medical injector
  - hacking suite

Drawbacks:
  - high power draw
  - heat buildup
  - EMP vulnerability
  - maintenance requirement
  - limited autonomy
  - noisy movement
  - expensive parts
```

Under the hood, this compiles into components such as:

```text
Mechanical
Body
BodyParts
Health or Durability
Actor
Energy
AI
Faction
Owner
PowerConsumer
Battery
Heat
Sensors
Inventory
Equipment
Weapon
Armor
Material
Conductive
Repairable
StatusWeaknesses
CommandReceiver
```

---

## Hybrid / Cyborg Mode

This mode is used for entities that combine biological and mechanical systems.

Examples:

- Cybernetic animal
- Android with organic brain
- Mutant with machine limbs
- Bio-mechanical war beast
- Human with installed modules
- Robot carrying living tissue

Validation must handle both biological and mechanical constraints.

Hybrid entities may need:

```text
biological metabolism
mechanical power
repair systems
healing systems
interface compatibility
rejection/instability risk
heat management
immune response
software control
```

Under the hood, this should still compile into ordinary components.

No special “cyborg class” is required.

---

## Pet / Companion Mode

This mode is a simplified character creator for player-owned companions.

It should hide many advanced details and focus on:

```text
role
appearance
size
temperament
loyalty
trainability
basic body traits
basic abilities
diet/fuel
maintenance
combat/noncombat role
```

This mode should still use the Character Creator architecture, but with simplified UI constraints.

---

## Drone / Limited-Agent Mode

This mode is for entities that can act but are not full characters.

Examples:

- Camera drone
- Turret
- Mine bot
- Hauling drone
- Repair drone
- Remote sensor
- Bomb drone

These may have:

```text
Actor
Energy
AI
Position
Power
Sensors
Limited commands
No full personality
No dialogue
No complex relationships
```

They are still entities.

They are still action-driven.

They are still controlled by components and AI packages.

---

# Creation Domains

## Definition

A creation domain defines what a creator UI can expose and produce.

Each domain should define:

```text
Domain ID:
  item
  ability
  character
  biological_character
  robot_character
  pet
  drone

Allowed design blocks:
  which traits/components/effects/modules can be selected

Disallowed design blocks:
  which blocks are hidden or forbidden

Required design blocks:
  minimum required elements for validity

Validation rules:
  domain-specific constraints

Cost model:
  resources, time, difficulty, instability, power, complexity

Compiler:
  how this design becomes runtime definitions/components/actions

Unlock requirements:
  tech, skills, recipes, samples, stations

UI presentation:
  how choices should be grouped for the player
```

Creation domains are essential because the engine is generalized, but the player UI must be constrained.

---

# Blueprints

## Required Blueprint Concepts

Every player-created design must become a blueprint.

Blueprints should include:

```text
Identity:
  - blueprint ID
  - blueprint type
  - blueprint version
  - name
  - description
  - creator player ID
  - created timestamp
  - modified timestamp

Domain:
  - item
  - ability
  - character
  - biological_character
  - robot_character
  - etc.

Design Data:
  - player-facing selected choices
  - selected parts/modules/traits/effects
  - chosen materials
  - chosen drawbacks
  - chosen costs
  - chosen requirements

Compiled Data:
  - generated components
  - generated actions
  - generated effects
  - generated AI metadata
  - generated entity definition
  - generated ability definition

Validation:
  - validation status
  - errors
  - warnings
  - computed complexity
  - computed costs
  - balance score
  - risk score

Ownership/Provenance:
  - creator
  - source station/lab/bench
  - source samples
  - source technology
  - source faction
  - server/mod package
  - legal status if relevant
```

---

## Blueprint Versioning

Blueprints must be versioned.

If the player edits a blueprint, the system should create a new version.

Example:

```text
Acid Hound Mk II v1
Acid Hound Mk II v2
Acid Hound Mk II v3
```

Existing runtime instances should not automatically mutate just because the blueprint changed, unless the game explicitly supports that behavior.

Recommended default:

```text
Existing runtime entities keep the version they were created from.
Newly created entities use the latest version.
Existing entities may be upgraded, modified, retrofitted, retrained, regrown, or rebuilt through explicit in-game actions.
```

This prevents confusing and exploitable behavior.

---

## Runtime Instance Link

Runtime instances created from a blueprint should store a reference to:

```text
blueprint ID
blueprint version
creator
creation method
creation timestamp
```

This supports:

- Debugging
- Reproduction
- Balance changes
- Ownership
- Trading
- Blueprint theft
- Faction reputation
- Moderation
- Save/load
- Multiplayer authority

---

# Compiler Layer

## Purpose

The compiler converts player-facing design choices into engine-facing data.

The player should not need to know raw ECS.

Example player choice:

```text
Add acid saliva.
```

The compiler may translate this into:

```text
BodyPart: acid gland
NaturalWeapon: bite
OnHitEffect: acid damage
StatusEffectSource: corroded
MetabolismCost: increased food need
RequiredSample: acid gland tissue
Instability: increased
```

Example player choice:

```text
Install stun baton arm.
```

The compiler may translate this into:

```text
BodyPart: right arm module
Weapon: stun baton
DamageType: electric
OnHitEffect: apply stunned
PowerConsumer: true
HeatGeneration: moderate
RequiredPart: stun baton module
```

The compiler layer keeps the UI simple while maintaining a rich systemic engine.

---

## Compiler Responsibilities

The compiler should:

```text
1. Receive a validated player design.
2. Resolve all selected traits/modules/effects.
3. Convert player-facing choices into component data.
4. Generate action definitions if needed.
5. Generate effect sequences if needed.
6. Generate AI metadata.
7. Generate costs and runtime requirements.
8. Generate descriptions/tooltips.
9. Generate debug-readable compiled output.
10. Preserve blueprint provenance.
```

---

## Compiler Must Not

The compiler must not:

```text
- Generate arbitrary executable code from player input.
- Bypass validation.
- Create hardcoded entity classes.
- Directly mutate live world state during design.
- Hide invalid combinations by silently deleting choices.
- Produce unserializable data.
- Depend on UI components.
```

---

# Validation

## Validation Is Mandatory

Every design must be validated before it becomes a blueprint and before anything is created in the world.

The UI should prevent invalid choices when possible.

The backend/simulation must still validate everything.

This is especially important for future multiplayer.

Never trust the client.

---

## General Validation Categories

Validation should check:

```text
Structural validity:
  - required fields exist
  - selected blocks exist
  - references are valid
  - no circular dependencies
  - no missing materials/modules/effects

Domain validity:
  - item creator does not use forbidden character-only options
  - ability creator has valid targeting/cost/effect
  - character creator has valid body/mind/agency requirements

Physical validity:
  - mass is supported
  - power draw is supported
  - body parts fit
  - equipment slots make sense
  - materials are compatible
  - locomotion supports body size

Gameplay validity:
  - has required cost
  - has required cooldown
  - no infinite loops
  - no unbounded spawning
  - no impossible action
  - no invalid effect combination

Resource validity:
  - player has materials
  - player has required samples
  - player has unlocked tech
  - player has correct station
  - player has required skill

Balance validity:
  - design budget not exceeded
  - complexity within allowed range
  - drawbacks/costs are valid
  - risk score acceptable
  - server rules allow it

Runtime validity:
  - compiled output can instantiate
  - components are serializable
  - actions reference valid effects
  - AI metadata is valid
  - save/load can preserve it
```

---

## Example Invalid Designs

Invalid item:

```text
A laser rifle with no power source, no ammunition, no cooldown, and no heat generation.
```

Invalid ability:

```text
An ability that deals area damage globally every turn with no cost, no target restrictions, and no cooldown.
```

Invalid biological character:

```text
A giant flying creature with tiny wings, no flight muscles, no metabolism, and no energy source.
```

Invalid robot:

```text
A heavy mining robot with tiny legs, no battery, and tools requiring more power than its chassis can supply.
```

Invalid character:

```text
An autonomous NPC with no AI package, no actor component, no energy/scheduler component, and no body or control interface.
```

---

# Cost and Balance Model

## Use Multiple Budgets, Not One Universal Number

Different creator UIs should use different cost models.

Do not reduce everything to one generic point total unless it is only one part of the calculation.

---

## Item Cost Axes

Items may be constrained by:

```text
material cost
weight
durability
crafting time
crafting skill
tooling requirement
power requirement
maintenance requirement
rarity
heat generation
instability
legal/faction restrictions
```

---

## Ability Cost Axes

Abilities may be constrained by:

```text
damage/effect budget
range
area
cooldown
activation cost
casting/action time
resource cost
body/module requirement
risk
friendly-fire potential
status duration
summon limits
environmental impact
```

---

## Biological Character Cost Axes

Bioengineered entities may be constrained by:

```text
biomass
genetic complexity
metabolic cost
growth time
stability
mutation risk
fertility
obedience
lifespan
required samples
lab tier
special nutrient requirements
```

---

## Robotic Character Cost Axes

Robots may be constrained by:

```text
mass
power draw
battery capacity
heat
compute capacity
chassis slots
sensor slots
manipulator slots
module slots
manufacturing time
part rarity
maintenance
EMP vulnerability
software sophistication
```

---

## Drawbacks Must Be Real

Drawbacks should not be cosmetic.

If a player takes a drawback to reduce cost or increase power, it must have real game consequences.

Examples:

```text
High hunger:
  entity needs more food and may disobey if starving

High power draw:
  robot drains battery quickly

Heat buildup:
  ability or robot risks overheating

Genetic instability:
  creature may mutate, become sick, or degrade

Fragile:
  item breaks more easily

Noisy:
  attracts enemies

Illegal:
  factions react badly if discovered

Low obedience:
  pet may ignore commands

Limited autonomy:
  robot cannot handle complex orders
```

---

# Unlocks, Stations, and Resources

## Creator UIs Should Be In-Game Systems

Players should access creator UIs through in-game objects, stations, skills, or abilities.

Examples:

```text
Item Creator:
  - workbench
  - forge
  - electronics bench
  - fabricator
  - crafting kit

Ability Creator:
  - mutation lab
  - cybernetic installer
  - spell forge
  - neural editor
  - training system
  - ritual site

Character Creator:
  - gene lab
  - cloning vat
  - robotics bench
  - drone assembler
  - android factory
  - pet breeding system
```

Using a creator UI is itself an in-game action or interaction.

---

## Gating Options

Not every option should be available immediately.

Options may require:

```text
research
technology
skill level
rare samples
blueprints
faction knowledge
special tools
special stations
materials
power
money
quests
teachers
discovered organisms
scanned enemies
salvaged robot parts
```

Example:

```text
Acid Spit requires:
  - acid gland sample
  - gene lab tier 2
  - bioengineering skill
  - stabilizer reagent
```

Example:

```text
Laser arm module requires:
  - optics research
  - high-density battery
  - focusing crystal
  - robotics bench tier 3
```

---

# Runtime Creation Flow

## Item Creation Flow

```text
Player uses item creation station.
Item Creator UI opens.
Player selects item design choices.
Game validates design.
Game calculates costs.
Player confirms.
Resources are consumed or crafting job begins.
Item Blueprint is created or selected.
Runtime item entity is created immediately or after crafting time.
Item exists in world/inventory as a normal entity.
```

---

## Ability Creation Flow

```text
Player uses ability creation system.
Ability Creator UI opens.
Player selects source, targeting, costs, effects, drawbacks.
Game validates design.
Game calculates cost/risk.
Player confirms.
Ability Blueprint is created.
Ability is installed, learned, grown, trained, encoded, or attached depending on source.
Runtime entity gains access to UseAbility action through normal components.
```

---

## Biological Character Creation Flow

```text
Player uses gene lab/cloning vat.
Character Creator opens in Biological mode.
Player selects organism, body, traits, organs, behavior, abilities, drawbacks.
Game validates biology and resources.
Game calculates biomass/genetic complexity/stability/growth time.
Player confirms.
Creature Blueprint is created.
Growth job begins.
When complete, runtime creature entity is spawned.
Creature uses normal Actor, AI, Body, Faction, Loyalty, Metabolism, Action, and Event systems.
```

---

## Robot Creation Flow

```text
Player uses robotics bench/factory.
Character Creator opens in Robot mode.
Player selects chassis, power, compute, sensors, modules, manipulators, software, armor.
Game validates mass/power/slots/parts/software.
Game calculates cost/manufacturing time/maintenance.
Player confirms.
Robot Blueprint is created.
Assembly job begins.
When complete, runtime robot entity is spawned.
Robot uses normal Actor, AI, Body, Power, Battery, Equipment, Action, and Event systems.
```

---

# AI and Control Systems

## Created Characters Need Explicit Control Models

Do not assume:

```text
created by player = perfectly obedient forever
```

Use explicit components/systems for:

```text
ownership
loyalty
obedience
training
bond
fear
hunger
pain
morale
intelligence
autonomy
command permissions
control interface
faction alignment
```

---

## Different Created Entities Should Use Different Control Models

Examples:

```text
Pet:
  - trainable
  - emotional bond
  - imperfect obedience
  - hunger and fear matter

Robot:
  - follows software/commands
  - needs power and maintenance
  - may be hacked
  - limited by sensors/compute

Sapient NPC:
  - has personality
  - can refuse orders
  - has reputation/faction logic
  - may betray or leave

Drone:
  - limited autonomy
  - direct remote control possible
  - signal range may matter

Bioengineered servant:
  - loyalty imprinting
  - instability risk
  - possible ethical/faction consequences
```

Under the hood, these are all AI/control/faction/relationship components.

---

## AI Must Use Normal Actions

AI must not directly mutate state.

AI should choose intents/actions.

Bad:

```text
AI directly changes its Position.
AI directly damages the player.
AI directly adds items to inventory.
```

Correct:

```text
AI chooses MoveIntent.
Simulation validates and resolves MoveAction.

AI chooses AttackIntent.
Simulation validates and resolves AttackAction.

AI chooses UseAbilityIntent.
Simulation validates and resolves UseAbilityAction.
```

This applies to player-created creatures and robots too.

---

## AI Metadata for Custom Designs

Blueprints for abilities, items, and characters should include AI metadata.

Examples:

```text
This ability is offensive.
This ability is defensive.
This weapon is best at adjacent range.
This robot is a miner.
This pet is a guard.
This creature should avoid fire.
This drone should flee if battery is low.
This ability should not be used near allies.
```

This allows generic AI systems to use player-created content.

---

# Save/Load Requirements

The creator system must be designed with save/load from the beginning.

Save data must include:

```text
blueprints
blueprint versions
runtime instances
runtime instance link to source blueprint/version
entity state
components
inventories
status effects
AI state
scheduler state
manufacturing/growth jobs
resources committed to jobs
creator station state
unlocks/research
player blueprint library
```

Do not store unserializable functions as blueprint or component data.

Do not make player-created content depend on closures or live class instances.

---

# Multiplayer and Server Authority

Even if multiplayer is not implemented yet, the architecture must be compatible with server authority.

Future multiplayer model:

```text
Client:
  - opens creator UI
  - displays allowed options
  - submits requested design

Server:
  - validates design
  - checks player resources/unlocks/station access
  - calculates cost
  - creates blueprint
  - starts job or creates runtime entity
  - owns all simulation state
```

The client must never be trusted to create arbitrary entities, abilities, or components.

All player designs must be validated server-side.

---

# Security and Exploit Prevention

Player-created content can become dangerous if unrestricted.

The system must prevent:

```text
arbitrary code execution
infinite event loops
infinite entity spawning
unbounded area effects
unbounded status stacking
server-crashing designs
lag machines
economy exploits
free power/resource loops
zero-cost high-power abilities
recursive triggered effects
unlimited self-replication
unmoderated offensive names/descriptions in multiplayer
```

Use:

```text
validation
budgets
server authority
effect limits
cooldowns
resource costs
recursion limits
spawn caps
area caps
status stack caps
blueprint moderation if multiplayer/shared
```

---

# UI Design Philosophy

## Reduce Cognitive Load

The point of separate creator UIs is to prevent the player from seeing every possible engine option at once.

The player should not be shown raw component lists in normal mode.

Instead of showing:

```text
Add Component: DamageOnImpact
Add Component: PowerConsumer
Add Component: EventReaction
```

Show player-facing choices:

```text
Add sharpened edge
Add battery pack
Add stun effect
Add reinforced casing
Add acid gland
Add loyalty imprinting
Add cargo module
```

The compiler translates these into engine data.

---

## Progressive Disclosure

Creator UIs should reveal complexity gradually.

Possible layers:

```text
Basic Mode:
  simple presets and obvious choices

Advanced Mode:
  more detailed traits, costs, drawbacks, modules

Expert/Debug Mode:
  raw-ish component inspection and blueprint debug output
```

Do not force every player to use expert mode.

---

## Explain Consequences

The creator UI should show:

```text
what this does
what it costs
what it requires
what drawbacks it adds
what risks it creates
why the design is invalid
how to fix the design
what runtime actions it grants
what maintenance it needs
```

Generated descriptions are important.

Example:

```text
Acid Hound Mk II

A medium quadrupedal predator with reinforced jaws, acidic saliva, and low-light vision.
It is loyal but requires frequent meat and chemical stabilizer.
It can bite nearby enemies and spit acid up to 5 tiles.
Weaknesses: vulnerable to cold, unstable genome.
```

Descriptions should be generated from blueprint data when possible.

---

# Debug and Developer Tools

The implementation should include debug tools for creators.

Useful debug tools:

```text
Blueprint inspector
Compiled output viewer
Validation report viewer
Cost breakdown viewer
Runtime instance inspector
Entity component inspector
Event log
Action log
AI decision log
Creation job inspector
Save/load smoke tester
Spawn from blueprint debug command
```

For development, it should be easy to answer:

```text
Why is this design invalid?
What did this player choice compile into?
Which components did this robot receive?
Which action did this ability create?
Which effect block caused this status?
Which blueprint version created this entity?
```

---

# Tests Required

The creator architecture must have tests.

At minimum, tests should cover:

```text
Item Creator:
  - creates valid item blueprint
  - rejects invalid item design
  - compiles item blueprint into normal entity components
  - item runtime instance is serializable

Ability Creator:
  - creates valid ability blueprint
  - rejects ability with effect but no cost/targeting
  - compiles ability into action/effect data
  - entity can use ability through normal action system

Character Creator:
  - creates valid biological creature blueprint
  - rejects biological creature with impossible body/metabolism
  - creates valid robot blueprint
  - rejects robot with power draw but no power source
  - compiles character blueprint into normal entity components
  - created character can act through scheduler/action system

Blueprints:
  - blueprint versioning works
  - runtime instance references source blueprint/version
  - save/load preserves blueprints and runtime instances

Validation:
  - domain restrictions work
  - item creator cannot directly use character-only blocks
  - ability creator cannot create unbounded zero-cost effects
  - character creator cannot bypass required body/AI/energy rules

AI:
  - created AI-controlled entity chooses normal actions
  - custom ability has AI metadata
```

---

# Integration with Existing Systemic Engine

This creator architecture assumes the engine already has or will have:

```text
Entity/component model
Action system
Event system
Effect system
Scheduler
AI system
Content definitions
Runtime validation
Serialization
Materials
Body plans
Status effects
Inventory/equipment
Faction/ownership
```

If those systems do not exist yet, implement the creator architecture in a way that prepares for them without creating incompatible shortcuts.

Do not create a one-off creator implementation that bypasses the core engine.

---

# Legacy Code Warning

The existing codebase may contain old incorrect systems.

Existing code may include:

```text
rigid item classes
rigid character classes
hardcoded object types
bad ECS patterns
category-based logic
direct state mutation
player-only logic
AI that bypasses actions
UI that mutates simulation state
hardcoded crafting systems
hardcoded abilities
hardcoded NPC definitions
```

Do not preserve bad architecture for compatibility.

If existing code conflicts with this document, the correct response is to:

```text
inspect it
classify it
reuse only the good parts
quarantine or replace the bad parts
preserve useful data/assets where practical
implement the clean architecture described here
```

Do not bend this architecture to fit old mistakes.

The goal is not backwards compatibility with flawed systems.

The goal is a clean long-term architecture.

---

# Implementation Milestones

## Milestone 1: Data Model Foundation

Implement:

```text
creation domains
blueprint model
blueprint version model
validation result model
compiler result model
cost breakdown model
creation job model
runtime instance provenance model
```

No full UI needed yet.

---

## Milestone 2: Item Creator Backend

Implement:

```text
item creation domain
allowed item blocks
item validation
item cost calculation
item compiler
item blueprint creation
runtime item instantiation
tests
```

Demonstrate with:

```text
simple sword
battery-powered stun baton
container item
invalid item rejected
```

---

## Milestone 3: Ability Creator Backend

Implement:

```text
ability creation domain
targeting definitions
cost definitions
effect blocks
ability validation
ability compiler
ability blueprint creation
UseAbility action integration
tests
```

Demonstrate with:

```text
acid spit
electric stun touch
healing pulse
invalid zero-cost global nuke rejected
```

---

## Milestone 4: Character Creator Backend

Implement:

```text
character creation domain
biological mode
robot mode
body/module choices
AI package choices
control model choices
character validation
character compiler
character blueprint creation
runtime character instantiation
tests
```

Demonstrate with:

```text
bioengineered guard pet
simple worker robot
combat drone
invalid creature rejected
invalid robot rejected
```

---

## Milestone 5: In-Game Station Integration

Implement interactions such as:

```text
Use workbench -> Item Creator
Use ability lab -> Ability Creator
Use gene lab -> Character Creator biological mode
Use robotics bench -> Character Creator robot mode
```

These interactions should go through normal actions/events.

---

## Milestone 6: UI Implementation

Implement actual player-facing UIs only after the backend is clean.

The UI should:

```text
show allowed options by domain
show cost breakdown
show validation errors
show warnings
show generated description
allow saving blueprint
allow creating instance/job
hide irrelevant options
avoid raw ECS exposure in normal mode
```

---

# Acceptance Criteria

The creator system is successful when:

```text
- Item Creator, Ability Creator, and Character Creator are separate player-facing UIs/domains.
- All three creator systems use the same underlying blueprint/validation/compiler/runtime architecture.
- Player-created things compile into normal entities/actions/effects/components.
- No creator UI creates a separate incompatible object model.
- Creation domains control what options are available to the player.
- Item Creator exposes item-appropriate choices and hides character/ability-only choices.
- Ability Creator exposes targeting/cost/effect choices and integrates with the action system.
- Character Creator exposes body/mind/AI/biological/robotic choices and creates normal actors/entities.
- Blueprints are separate from runtime instances.
- Blueprints are versioned.
- Runtime instances reference source blueprint/version.
- Designs are declarative, serializable, and validated.
- No arbitrary player-authored code is executed.
- Server-authoritative validation is possible.
- Save/load can preserve blueprints and instances.
- AI can eventually reason about custom abilities/items/characters through metadata.
- Tests prove the main flows work.
```

---

# Anti-Goals

Do not do these things:

```text
- Do not make a separate Item class hierarchy.
- Do not make a separate Ability scripting language that bypasses actions/events.
- Do not make Character Creator output rigid Creature/NPC classes.
- Do not expose every ECS component directly to normal players.
- Do not allow arbitrary code execution.
- Do not allow unvalidated player-created content.
- Do not allow the client to create runtime objects directly.
- Do not skip blueprint versioning.
- Do not merge blueprint state and runtime entity state.
- Do not make abilities impossible for AI to understand.
- Do not make creation systems impossible to save/load.
- Do not hardcode every custom creation as a bespoke case.
- Do not preserve legacy architecture if it conflicts with this document.
```

---

# Short Summary for Implementers

The player sees:

```text
Item Creator
Ability Creator
Character Creator
```

The engine sees:

```text
Creation domain
Validated design
Blueprint
Compiler
Components
Actions
Effects
Events
Runtime entities
```

The UI is specialized for player clarity.

The simulation is generalized for systemic depth.

The most important rule:

> Player-created things must become normal systemic game content, not special cases.

A player-made sword, acid-spit ability, bioengineered pet, robot worker, or custom NPC should all enter the simulation through the same architecture as developer-made content.

They should use the same:

```text
entity/component model
action system
event system
effect system
AI system
save/load system
debug tools
validation rules
server authority model
```

This is the correct long-term architecture.
