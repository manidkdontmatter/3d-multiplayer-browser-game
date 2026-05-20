# Blueprint System

## Still Needs Done

- Expose the `item_creator` and `character_creator` UIs in the live client. Right now the shipped UI path is still the ability creator surface.
- Wire generic blueprint access into non-ability gameplay domains. The real access model exists now, but the actively consumed runtime path is still mainly `ability.use`.
- Add the future gameplay consumers for non-physical blueprint domains. A `mind` blueprint should feed AI/controller systems, and a `tile` blueprint should feed tile/world systems, not the physical entity spawn path.
- Replace remaining legacy naming in some persistence/runtime paths where `ability` or `player` names still exist for historical reasons, even though the underlying blueprint/access model is now generic.
- Add explicit gameplay systems for teaching, science-bench crafting, character spawning, and any other mechanics that should grant or revoke blueprint access tags in-world.
- Add runtime verification passes beyond typecheck. The architecture is in place, but broader in-game path coverage still depends on real gameplay testing.

## Purpose

This system exists to support an "anything can be anything" content model without enforcing gameplay object types at the blueprint layer or runtime ECS layer.

The important rule is:

- `type` exists only at the creator UI / validation profile layer.
- Blueprints are universal.
- Runtime ECS entities are universal.
- What something is at runtime is determined by components and systems, not by an authoritative type field.

In practice:

- Ability creator, item creator, character creator, mind creator, and tile creator are creator profiles.
- A creator profile constrains what the user can author and how the UI behaves.
- The resulting blueprint is just a universal component bag plus metadata.

## High-Level Architecture

The implemented stack is:

1. Shared universal blueprint format
2. Shared creator profile compile/decompile/validation logic
3. Server-authoritative creator session system
4. SQLite persistence for global blueprint records
5. SQLite persistence for per-character blueprint access tags
6. Server memory cache for runtime blueprint lookup
7. Client UI as a thin presentation/input layer

The main code is here:

- [src/engine/shared/blueprint.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/shared/blueprint.ts)
- [src/engine/shared/creator.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/shared/creator.ts)
- [src/game/shared/blueprints.json](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/game/shared/blueprints.json)
- [src/engine/server/creator/CreatorSystem.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/creator/CreatorSystem.ts)
- [src/engine/server/persistence/PersistenceService.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/persistence/PersistenceService.ts)
- [src/engine/server/GameSimulation.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/GameSimulation.ts)
- [src/engine/client/ui/CreatorPanel.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/client/ui/CreatorPanel.ts)

## Core Concepts

### Blueprint

A blueprint is the universal authored object definition.

It contains:

- `id`
- `key`
- `name`
- `description`
- `components`
- optional metadata
- optional creator-profile template data
- optional editor projection data for decompile / template reuse

Important rule:

- A blueprint does not have an authoritative gameplay type.

### Creator Profile

A creator profile is the only place where "type-like" restrictions exist.

Current profile ids:

- `ability_creator`
- `item_creator`
- `character_creator`
- `mind_creator`
- `tile_creator`

A creator profile defines:

- which blueprints can be used as templates
- which editable fields are shown
- which other editor fields are shown
- compile rules
- decompile rules
- validation rules

Important rule:

- A creator profile is a presentation and validation surface, not a gameplay object type.
- After creation, the blueprint does not become an authoritative "ability", "item", "character", "mind", or "tile" object in the type-system sense.
- The profile only explains which authoring rules were used and how the UI should interpret a blueprint for editing.

### Blueprint Access Tag

Blueprint access is how a character is allowed to interact with a blueprint.

Current access tags:

- `ability.use`
- `item.craft`
- `character.spawn`
- `mind.assign`
- `tile.paint`
- `blueprint.template`

These are permissions, not types.

Examples:

- A character can have `ability.use` for blueprint `123`.
- A character can have `item.craft` for blueprint `456`.
- A character can have `blueprint.template` for a blueprint so that a creator UI can use it as a base template.

### Character Identity

In the current implementation, the persistence identity used for blueprint access is the same persistent character identity already used elsewhere in the game, which is currently named `accountId` in much of the code.

That means:

- the DB tables say `player_id` or `character_id` depending on age of the table
- the runtime often still says `accountId`
- semantically, this is the persistent playable character identity

This naming is legacy and should eventually be cleaned up, but the behavior is correct.

## Blueprint Data Model

The universal blueprint model is defined in [src/engine/shared/blueprint.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/shared/blueprint.ts).

Relevant pieces:

- `BlueprintDefinition`
- `BlueprintTemplateProfile`
- `BlueprintTemplateFieldDefinition`
- `BlueprintEditorProjection`
- `buildAbilityDefinitionFromBlueprint`
- `buildItemDefinitionFromBlueprint`
- `buildPlatformDefinitionFromBlueprint`
- `coerceBlueprintDefinition`

The game-authored shared blueprint catalog lives in [src/game/shared/blueprints.json](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/game/shared/blueprints.json).

This is now the real authored content source instead of the deleted archetype catalog.

## Creator Profile Model

The creator system is defined in [src/engine/shared/creator.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/shared/creator.ts).

Important concepts:

- `CreatorDraft`
- `CreatorFieldDefinition`
- `CreatorCapacity`
- `CreatorValidation`
- `CreatorSessionSnapshot`
- `compileBlueprintFromCreatorDraft`
- `createDraftFromBlueprint`
- `validateCreatorDraft`
- `creatorProfileIdToKind`
- `creatorProfileIdToGrantedAccessTags`

The creator-profile system is now registry-driven instead of hardcoded by one giant branch chain.

Each profile definition now owns:

- runtime-kind hint for shared derivation rules
- granted access tags
- field-definition generation
- capacity policy
- validation policy
- compile behavior

The current implementation lives in [src/engine/shared/creator.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/shared/creator.ts).

Compile direction:

- UI draft -> validated canonical blueprint

Decompile direction:

- blueprint -> creator draft for template editing

This is what allows selecting an existing blueprint as a template, editing it through a creator profile, and creating a derived blueprint.

## Creator Draft Field Model

The creator draft is no longer limited to:

- numeric stat values
- numeric attribute stacks

The current `CreatorDraft` stores a generic `fieldValues` bag keyed by creator field id.

Supported field kinds in the current support layer are:

- `number`
- `string`
- `boolean`
- `enum`
- `json`

Template-defined creator fields can now also declare canonical blueprint bindings, so a field can map into a real blueprint component payload path instead of existing only as editor-only metadata.

This is important because future creators will need more than numbers:

- `mind_creator` will likely want toggles, enums, strings, and structured behavior parameters
- `tile_creator` will likely want sprite refs, booleans, ids, and structured hazard/property data

Current profile implementations still derive numeric stat budgets and attribute budgets from field ids such as stat-like and attribute-like entries, but the underlying draft model is now more general.

## Planned Creator Profiles

The main creator-profile surfaces the game is expected to support are:

- `ability_creator`
- `item_creator`
- `character_creator`
- `mind_creator`
- `tile_creator`

These should all share the same top-level architecture:

- one universal blueprint persistence model
- one server-authoritative creator session model
- one access-tag permission model
- one compile/decompile validation pipeline

What changes between them is not the existence of a separate object system. What changes is:

- the editor fields
- the validation rules
- the compile/decompile rules
- the gameplay system that consumes the resulting blueprint

The first support-layer step for this is already done:

- the shared creator registry knows about `mind_creator` and `tile_creator`
- the blueprint template profile format can now declare richer field definitions
- blueprint template field definitions can now bind creator fields into real component payload paths
- the creator draft/editor projection format can now carry richer field values

That does not mean the gameplay runtime consumers for minds or tiles are implemented yet. It means the foundation will not have to be ripped up again when those creators are added.

## Physical And Non-Physical Blueprint Domains

Not every blueprint should be treated as "spawn a physical ECS entity."

That distinction matters for the planned future creators.

### Body-Like Blueprints

These are consumed by physical runtime systems and may produce or configure live ECS entities.

Examples:

- character blueprints
- many item blueprints
- some placeable or interactive world objects

### Non-Physical Blueprints

These are still authored and persisted through the same blueprint system, but their runtime consumer is not the physical entity-construction path.

Examples:

- mind blueprints
- some tile blueprints
- future social, faction, ritual, or behavior templates if those ever exist

The universal blueprint model must support both categories.

## Mind Creator Direction

`mind_creator` should reuse the blueprint/access/session system, but a mind should not be treated as a normal world entity.

Recommended model:

- a body is a physical ECS entity
- a mind is a persisted authored blueprint
- a runtime controller uses that mind blueprint to drive a body
- live AI state is transient runtime state, not persisted in the blueprint

In practice:

- the blueprint stores authored mind/personality/behavior inputs
- a character or NPC can be assigned a permitted mind blueprint id
- the AI/controller layer compiles or resolves the blueprint into live blackboard/controller state

Important rule:

- a mind blueprint is a template for control behavior, not a physical object in the world

This means the future runtime consumer for mind blueprints should be an AI/controller system, not the same path used for spawning a projectile, item pickup, or humanoid body.

## Tile Creator Direction

`tile_creator` should also reuse the same blueprint/access/session system, but the runtime consumer should be the tile or world system.

Expected authored fields for tiles will likely include things such as:

- sprite or tileset reference
- density / passability
- damage-over-time or hazard parameters
- interaction flags
- visual metadata

Important rule:

- a tile blueprint is not automatically a normal ECS entity

Some tiles may have runtime ECS consequences when instantiated in the world, but the authored tile definition itself should be consumed by the tilemap/world layer first.

## Compile / Decompile Requirements

The future creators strengthen the need for reversible authoring projections.

The system must keep supporting:

- `compile(profile, draft) -> blueprint`
- `decompile(profile, blueprint) -> draft`

This matters because a character should be able to:

- choose an existing blueprint as a template
- open it through the relevant creator UI
- see the UI-facing interpreted values again
- modify them
- create a new derived blueprint

For future creators, the draft model cannot stay limited to only:

- flat numeric stats
- flat numeric attribute stacks

Some creators will need richer editor field types such as:

- booleans
- enum-like selections
- asset ids
- references to other blueprint ids
- structured parameter objects

The universal blueprint model should stay generic. The creator-draft model and blueprint template profile format are now expressive enough to start accommodating these common field kinds without another top-level refactor.

Important rule:

- editor projection data is for reversible UI reconstruction
- canonical authored gameplay data must live in blueprint component payloads

That means if a creator field matters to gameplay, the field should compile into a real bound component payload, not live only in `editorProjectionByProfile`.

## Authoritative Server Flow

The active creator authority path is:

1. Client receives creator session state from server.
2. Client shows only the server-provided available template blueprints.
3. Client sends creator commands as intent only.
4. Server validates and applies creator command to the draft.
5. Server compiles the draft into a blueprint on submit.
6. Server persists the blueprint globally in SQLite.
7. Server grants character access tags in SQLite.
8. Server updates its in-memory blueprint/access caches.
9. Server replicates the updated creator state and any relevant ability data back to the client.

Key files:

- [src/engine/server/creator/CreatorSystem.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/creator/CreatorSystem.ts)
- [src/engine/server/GameSimulation.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/GameSimulation.ts)
- [src/engine/server/net/ServerNetworkEventRouter.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/net/ServerNetworkEventRouter.ts)
- [src/engine/server/netcode/ReplicationMessagingSystem.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/netcode/ReplicationMessagingSystem.ts)

## SQLite Persistence Model

The server persistence layer lives in [src/engine/server/persistence/PersistenceService.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/persistence/PersistenceService.ts).

### Global Blueprint Table

Current table:

- `blueprints`

Fields:

- `blueprint_id`
- `blueprint_json`
- `authored_via_profile`
- `created_by_player_id`
- `created_at`
- `updated_at`
- `archived`

Meaning:

- This stores the canonical universal blueprint definition exactly once.
- The actual blueprint payload is stored as JSON because the blueprint is a universal component bag.

### Character Blueprint Access Table

Current table:

- `character_blueprint_access`

Fields:

- `character_id`
- `blueprint_id`
- `access_tag`
- `granted_at`
- `granted_by_character_id`

Meaning:

- This stores per-character permissions to interact with blueprints.
- This is the real gameplay gate.
- It replaces the old ownership idea.

### Why JSON In SQLite

The blueprint itself is stored as JSON because:

- the blueprint is universal and component-bag shaped
- the schema needs to stay flexible
- SQLite is already the authoritative persistence backend
- the hot runtime path uses server memory, not direct SQL lookups

This is the correct tradeoff for the current system.

## Migration Behavior

The old ability ownership table is not the active model anymore, but existing data is migrated forward.

During schema initialization:

- rows from `player_ability_ownership` are copied into `character_blueprint_access`
- they become `ability.use`
- they also become `blueprint.template`

That means existing persisted ability access can be carried into the new access-tag model without depending on the old table at runtime.

## Runtime Caching Model

The server does not query SQLite every time a blueprint is needed.

Instead:

- SQLite is the durable source of truth
- the server hydrates blueprint definitions into memory
- the server hydrates per-character access ids into memory
- runtime lookups use the in-memory caches

This behavior is implemented across:

- [src/engine/server/creator/CreatorSystem.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/creator/CreatorSystem.ts)
- [src/engine/server/GameSimulation.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/GameSimulation.ts)
- [src/engine/server/persistence/PersistenceService.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/server/persistence/PersistenceService.ts)

## Client Model

The client remains a mostly graphical dummy.

It does not own the authoritative blueprint store.

The client currently receives:

- creator session id
- creator profile id
- current draft
- validation/capacity info
- the list of available template blueprints for that session
- replicated ability definitions where needed for the ability book / hotbar UI

This path is implemented in:

- [src/engine/shared/netcode.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/shared/netcode.ts)
- [src/engine/client/runtime/network/CreatorStateStore.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/client/runtime/network/CreatorStateStore.ts)
- [src/engine/client/runtime/network/CreatorNetworkBridge.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/client/runtime/network/CreatorNetworkBridge.ts)
- [src/engine/client/ui/CreatorPanel.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/client/ui/CreatorPanel.ts)
- [src/engine/client/ui/AbilityHud.ts](/C:/Users/Main/OneDrive/Desktop/3d-browser-game/src/engine/client/ui/AbilityHud.ts)

## Current Ability Flow

The ability path is the most complete live runtime integration.

Current behavior:

- ability blueprints can be used as creator templates if the character has `blueprint.template`
- submitting the ability creator creates a new global blueprint
- the creating character is granted:
  - `ability.use`
  - `blueprint.template`
- the new ability blueprint is converted to an `AbilityDefinition`
- the player's unlocked ability id set is refreshed from `ability.use`
- hotbar / ability replication is updated

Forget behavior:

- forgetting an ability revokes `ability.use`
- forgetting an ability also revokes `blueprint.template`
- the blueprint itself is not deleted
- the hotbar is cleaned if it referenced the revoked ability id

This matches the intended model much better than the old fake ownership system.

## Item And Character Profiles

The generic profile architecture supports:

- `item_creator`
- `character_creator`

The shared compile/decompile and persistence model already support them as creator profiles.

What is not fully done yet is the live gameplay/UI path:

- no exposed item creator UI
- no exposed character creator UI
- no live item craft / character spawn access-consumer path wired through the game yet

So the architecture is generic, but the currently exercised gameplay flow is still primarily abilities.

## Future Mind And Tile Runtime Consumers

The current implementation should not be misread as "every blueprint must become a physical ECS entity."

The correct future direction is:

- abilities are consumed by the ability runtime
- items are consumed by inventory/crafting/equipment/runtime world-item systems
- characters are consumed by body/spawn systems
- minds are consumed by AI/controller systems
- tiles are consumed by tilemap/world systems

This preserves the one-blueprint-system rule without conflating all gameplay consumers into one bad mega-system.

## Current Architectural State

The creator support layer is now in the intended shape:

- one creator registry instead of hardcoded profile branch sprawl
- one generic field-value draft model instead of fixed `statValues` plus `selectedAttributes`
- one canonical blueprint path where bound fields can write into real component payloads
- one editor-projection path for reversible template editing

The remaining work is now domain implementation work, not another foundational refactor.

## ECS Relationship

This system is intentionally separate from the low-level runtime ECS.

Important rule:

- creator profiles are not ECS
- blueprints are not ECS entities
- runtime entities are constructed from blueprint-relevant data and gameplay systems

The ECS side remains composition-based and type-less at runtime.

The refactor also removed the misleading old path where the ECS factory pretended to instantiate authored archetypes directly.

## What Was Removed

The following old authored-content path is no longer the real system:

- shared archetype module
- shared archetype JSON catalogs
- legacy creator/archetype command vocabulary
- dead duplicate dynamic-ability persistence API

Those were removed or bypassed because they were structurally wrong for the intended design.

## Important Current Constraints

- Blueprint ids are globally unique and allocated on the server.
- Custom blueprints are persisted server-side only.
- Guest/transient characters do not persist blueprint writes.
- The server still uses some legacy names like `accountId`, `player_loadout_slots`, and `unlockedAbilityIds` in places where the semantics are now "character identity" or "ability-access ids".
- The live creator UI currently mounted in the HUD is still the ability creator surface.
- The current runtime consumers are still mostly ability-specific even though the creator-profile support layer is now broader.

## Summary

The system is now built around the correct foundation:

- one universal blueprint model
- one creator-profile validation/compile/decompile model
- one authoritative server pipeline
- global blueprint persistence in SQLite
- per-character access tags instead of ownership
- server memory caches for runtime use
- client as a thin presentation/input layer

What remains is mostly expansion and cleanup work, not a fundamental architecture replacement. The bad foundation has been replaced. The remaining tasks are about finishing gameplay coverage across the planned creator profiles and their runtime consumer systems.
