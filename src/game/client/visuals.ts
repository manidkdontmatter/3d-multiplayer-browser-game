/**
 * Purpose: This file maps gameplay/network state to renderable visual objects.
 * Scope: It belongs to the game-specific client composition layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { Color } from "three";
import {
  injectVisualPalette,
  type EntityVisualDef,
  type LocationVisualDef
} from "../../engine/client/runtime/rendering/VisualRegistry";
import {
  injectEnvironmentPresets,
  type EnvironmentPreset
} from "../../engine/client/runtime/rendering/WorldEnvironment";
import {
  injectProjectilePalettes,
  type ProjectilePalette
} from "../../engine/client/runtime/rendering/ProjectileVisualSystem";
import {
  MODEL_ID_PLATFORM_LINEAR,
  MODEL_ID_PLATFORM_ROTATING,
  MODEL_ID_NPC_HOSTILE_GUARD,
  MODEL_ID_NPC_DOCILE_FLEE,
  MODEL_ID_NPC_WANDERER,
  MODEL_ID_ITEM_VITALITY_SHARD,
  MODEL_ID_ITEM_FOCUS_BLADE,
  MODEL_ID_ITEM_ETHER_CRYSTAL,
  MODEL_ID_PROJECTILE_PRIMARY,
  MODEL_ID_TRAINING_DUMMY
} from "../../engine/shared/config";
import {
  ENVIRONMENT_PRESET_VOID_NEUTRAL,
  ENVIRONMENT_PRESET_SKY_BLUE_DAY,
  ENVIRONMENT_PRESET_VOID_INFERNAL,
  ENVIRONMENT_PRESET_VOID_ARCANE,
  ENVIRONMENT_PRESET_VOID_DEEP
} from "../../engine/shared/worldLocations";

const entities = new Map<number, EntityVisualDef>([
  // Platforms
  [MODEL_ID_PLATFORM_LINEAR, { geometry: "box", geometryParams: [4.5, 0.7, 4.5], color: 0xd8b691, roughness: 0.88, metalness: 0.06 }],
  [MODEL_ID_PLATFORM_ROTATING, { geometry: "box", geometryParams: [5.6, 0.7, 5.6], color: 0x9ea7d8, roughness: 0.88, metalness: 0.06 }],
  // NPCs
  [MODEL_ID_NPC_HOSTILE_GUARD, { geometry: "cylinder", geometryParams: [0.35, 0.35, 1.9, 14, 1], color: 0xd9463e, roughness: 0.82, metalness: 0.08 }],
  [MODEL_ID_NPC_DOCILE_FLEE, { geometry: "cylinder", geometryParams: [0.35, 0.35, 1.9, 14, 1], color: 0xf2d34f, roughness: 0.82, metalness: 0.08 }],
  [MODEL_ID_NPC_WANDERER, { geometry: "cylinder", geometryParams: [0.35, 0.35, 1.9, 14, 1], color: 0x52c96b, roughness: 0.82, metalness: 0.08 }],
  // Training dummy
  [MODEL_ID_TRAINING_DUMMY, { geometry: "cylinder", geometryParams: [0.42, 0.42, 1.9, 12, 1], color: 0xa6c9d8, roughness: 0.88, metalness: 0.08 }],
  // World items
  [MODEL_ID_ITEM_VITALITY_SHARD, { geometry: "dodecahedron", geometryParams: [0.22, 0], color: 0x74f2b2, roughness: 0.42, metalness: 0.06, emissive: 0x74f2b2, emissiveIntensity: 0.28 }],
  [MODEL_ID_ITEM_FOCUS_BLADE, { geometry: "box", geometryParams: [0.18, 0.9, 0.18], color: 0xbfc7d5, roughness: 0.42, metalness: 0.06 }],
  [MODEL_ID_ITEM_ETHER_CRYSTAL, { geometry: "dodecahedron", geometryParams: [0.28, 0], color: 0x8fb7ff, roughness: 0.42, metalness: 0.2, emissive: 0x8fb7ff, emissiveIntensity: 0.28 }]
]);

const locations = new Map<string, LocationVisualDef>([
  ["terrainIsland", { kind: "terrainIsland", terrainColor: 0xffffff, terrainRoughness: 0.95, bowlColor: 0x8ed8ff }],
  ["staticCastle", { kind: "staticCastle", castleBaseColor: 0x24222d, castleAccentColor: 0x5d526e }],
  ["movingCastle", { kind: "movingCastle", castleBaseColor: 0x253d55, castleAccentColor: 0x75a7c4 }],
  ["movingTestPlatform", { kind: "movingTestPlatform", slabColor: 0x7fc7d9, stripeColor: 0xf2d16b }],
  ["testArena", { kind: "testArena", arenaColor: 0x4e625f, arenaAccentColor: 0xd8b691 }]
]);

const projectilePalettes = new Map<number, Readonly<ProjectilePalette>>([
  [MODEL_ID_PROJECTILE_PRIMARY, Object.freeze({
    coreColor: 0x78dfff, emissiveColor: 0x2d9cc5, glowColor: 0x67d4ff, burstColor: 0x9ce8ff
  })]
]);

const environmentPresets = new Map<number, EnvironmentPreset>([
  [ENVIRONMENT_PRESET_VOID_NEUTRAL, {
    background: new Color(0x090712), fogColor: new Color(0x171126), fogNear: 420, fogFar: 1800,
    ambientColor: new Color(0xb8c7ff), ambientIntensity: 0.58, sunColor: new Color(0xd8e4ff), sunIntensity: 0.85, exposure: 0.9,
    vfx: { voidStars: 0.9, heavenMist: 0, infernalNebula: 0, arcaneMotes: 0.2 },
    sky: { skybox1: 0, skybox2: 0, skybox3: 0, skybox4: 0, skybox5: 1 }
  }],
  [ENVIRONMENT_PRESET_SKY_BLUE_DAY, {
    background: new Color(0x9fd7ff), fogColor: new Color(0xb8e4ff), fogNear: 190, fogFar: 980,
    ambientColor: new Color(0xffffff), ambientIntensity: 0.54, sunColor: new Color(0xfff2d9), sunIntensity: 1.1, exposure: 0.96,
    vfx: { voidStars: 0.15, heavenMist: 0.8, infernalNebula: 0, arcaneMotes: 0 },
    sky: { skybox1: 1, skybox2: 0, skybox3: 0, skybox4: 0, skybox5: 0 }
  }],
  [ENVIRONMENT_PRESET_VOID_INFERNAL, {
    background: new Color(0x120207), fogColor: new Color(0x3a0610), fogNear: 260, fogFar: 1200,
    ambientColor: new Color(0xff6a4f), ambientIntensity: 0.35, sunColor: new Color(0xff9b51), sunIntensity: 1.2, exposure: 0.82,
    vfx: { voidStars: 0.35, heavenMist: 0, infernalNebula: 1, arcaneMotes: 0.1 },
    sky: { skybox1: 0, skybox2: 0, skybox3: 0, skybox4: 1, skybox5: 0 }
  }],
  [ENVIRONMENT_PRESET_VOID_ARCANE, {
    background: new Color(0x070a22), fogColor: new Color(0x1f225d), fogNear: 300, fogFar: 1450,
    ambientColor: new Color(0x9bb9ff), ambientIntensity: 0.48, sunColor: new Color(0xa2f6ff), sunIntensity: 1.0, exposure: 0.88,
    vfx: { voidStars: 0.65, heavenMist: 0.1, infernalNebula: 0, arcaneMotes: 1 },
    sky: { skybox1: 0, skybox2: 0, skybox3: 1, skybox4: 0, skybox5: 0 }
  }],
  [ENVIRONMENT_PRESET_VOID_DEEP, {
    background: new Color(0x090208), fogColor: new Color(0x170711), fogNear: 330, fogFar: 1550,
    ambientColor: new Color(0xc4a4ff), ambientIntensity: 0.44, sunColor: new Color(0xffb3c4), sunIntensity: 0.95, exposure: 0.86,
    vfx: { voidStars: 0.7, heavenMist: 0, infernalNebula: 0.25, arcaneMotes: 0.35 },
    sky: { skybox1: 0, skybox2: 1, skybox3: 0, skybox4: 0, skybox5: 0 }
  }]
]);

export function initVisuals(): void {
  injectVisualPalette({ entities, locations });
  injectEnvironmentPresets(environmentPresets);
  injectProjectilePalettes(projectilePalettes);
}
