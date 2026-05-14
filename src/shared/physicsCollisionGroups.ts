// Defines Rapier collision layers so solid geometry, characters, triggers, and dynamic bodies do not interfere accidentally.
export const PHYSICS_LAYER_SOLID = 1 << 0;
export const PHYSICS_LAYER_CHARACTER = 1 << 1;
export const PHYSICS_LAYER_CARRIER_TRIGGER = 1 << 2;
export const PHYSICS_LAYER_DYNAMIC_BODY = 1 << 3;

export const PHYSICS_GROUP_SOLID = interactionGroups(
  PHYSICS_LAYER_SOLID,
  PHYSICS_LAYER_CHARACTER | PHYSICS_LAYER_DYNAMIC_BODY
);

export const PHYSICS_GROUP_CHARACTER = interactionGroups(
  PHYSICS_LAYER_CHARACTER,
  PHYSICS_LAYER_SOLID | PHYSICS_LAYER_CHARACTER
);

export const PHYSICS_GROUP_CARRIER_TRIGGER = interactionGroups(
  PHYSICS_LAYER_CARRIER_TRIGGER,
  PHYSICS_LAYER_DYNAMIC_BODY
);

export const PHYSICS_GROUP_DYNAMIC_BODY = interactionGroups(
  PHYSICS_LAYER_DYNAMIC_BODY,
  PHYSICS_LAYER_SOLID | PHYSICS_LAYER_CARRIER_TRIGGER | PHYSICS_LAYER_DYNAMIC_BODY
);

export const PHYSICS_QUERY_GROUP_CHARACTER_SOLIDS = interactionGroups(
  PHYSICS_LAYER_CHARACTER,
  PHYSICS_LAYER_SOLID
);

export const PHYSICS_QUERY_GROUP_CHARACTER_MOVEMENT = interactionGroups(
  PHYSICS_LAYER_CHARACTER,
  PHYSICS_LAYER_SOLID | PHYSICS_LAYER_CHARACTER
);

export function interactionGroups(memberships: number, filter: number): number {
  return ((memberships & 0xffff) << 16) | (filter & 0xffff);
}
