export const SERVER_PORT = 9001;
export const SERVER_TICK_RATE = 30;
// Keep the target interval exact; rounding to 33ms makes 30hz run at ~30.3hz.
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;
export const SERVER_TICK_SECONDS = 1 / SERVER_TICK_RATE;
export const PLAYER_WALK_SPEED = 6;
export const PLAYER_SPRINT_SPEED = 9;
export const PLAYER_GROUND_ACCEL = 60;
export const PLAYER_AIR_ACCEL = 20;
export const PLAYER_GROUND_FRICTION = 10;
export const MAX_COMMAND_DELTA_SECONDS = 0.1;
export const PLAYER_EYE_HEIGHT = 1.8;
export const PLAYER_CAPSULE_HALF_HEIGHT = 0.45;
export const PLAYER_CAPSULE_RADIUS = 0.35;
export const PLAYER_BODY_CENTER_HEIGHT = PLAYER_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS;
export const PLAYER_CAMERA_OFFSET_Y = PLAYER_EYE_HEIGHT - PLAYER_BODY_CENTER_HEIGHT;
export const PLAYER_GROUND_Y = PLAYER_EYE_HEIGHT;
export const PLAYER_JUMP_VELOCITY = 12;
export const GRAVITY = -18;
// Keep only a tiny downward bias while grounded to maintain contact without visible sink/pop jitter.
export const PLAYER_GROUND_STICK_VELOCITY = -0.05;
export const PLAYER_MAX_HEALTH = 100;
export const PRIMARY_FIRE_COOLDOWN_SECONDS = 0.2;
export const MAGIC_BOLT_KIND_PRIMARY = 1;
export const MAGIC_BOLT_SPEED = 24;
export const MAGIC_BOLT_RADIUS = 0.2;
export const MAGIC_BOLT_DAMAGE = 25;
export const MAGIC_BOLT_LIFETIME_SECONDS = 2.2;
export const MAGIC_BOLT_SPAWN_FORWARD_OFFSET = 0.75;
export const MAGIC_BOLT_SPAWN_VERTICAL_OFFSET = -0.08;

export const MODEL_ID_PLAYER = 1;
export const MODEL_ID_PLATFORM_LINEAR = 2;
export const MODEL_ID_PLATFORM_ROTATING = 3;
export const MODEL_ID_PROJECTILE_PRIMARY = 4;
export const MODEL_ID_TRAINING_DUMMY = 5;
