/**
 * Purpose: This file maps gameplay/network state to renderable visual objects.
 * Scope: It belongs to the game-specific client composition layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { Color } from "three";
import {
  injectVisualPalette,
  type EntityVisualDef,
  type LocationVisualDef,
  type RenderArchetypeDef
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
  MODEL_ID_TRAINING_DUMMY,
  MODEL_ID_LOCATION_STATIC_CASTLE,
  MODEL_ID_LOCATION_MOVING_CASTLE,
  MODEL_ID_LOCATION_MOVING_TEST_PLATFORM,
  MODEL_ID_LOCATION_TEST_ARENA
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
  [MODEL_ID_NPC_HOSTILE_GUARD, { geometry: "cylinder", geometryParams: [0.35, 0.35, 1.9, 14, 1], color: 0x8a8a8a, roughness: 0.82, metalness: 0.08 }],
  [MODEL_ID_NPC_DOCILE_FLEE, { geometry: "cylinder", geometryParams: [0.35, 0.35, 1.9, 14, 1], color: 0x8a8a8a, roughness: 0.82, metalness: 0.08 }],
  [MODEL_ID_NPC_WANDERER, { geometry: "cylinder", geometryParams: [0.35, 0.35, 1.9, 14, 1], color: 0x8a8a8a, roughness: 0.82, metalness: 0.08 }],
  // Training dummy
  [MODEL_ID_TRAINING_DUMMY, { geometry: "cylinder", geometryParams: [0.42, 0.42, 1.9, 12, 1], color: 0xa6c9d8, roughness: 0.88, metalness: 0.08 }],
  // World items
  [MODEL_ID_ITEM_VITALITY_SHARD, { geometry: "dodecahedron", geometryParams: [0.22, 0], color: 0x74f2b2, roughness: 0.42, metalness: 0.06, emissive: 0x74f2b2, emissiveIntensity: 0.28 }],
  [MODEL_ID_ITEM_FOCUS_BLADE, { geometry: "box", geometryParams: [0.18, 0.9, 0.18], color: 0xbfc7d5, roughness: 0.42, metalness: 0.06 }],
  [MODEL_ID_ITEM_ETHER_CRYSTAL, { geometry: "dodecahedron", geometryParams: [0.28, 0], color: 0x8fb7ff, roughness: 0.42, metalness: 0.2, emissive: 0x8fb7ff, emissiveIntensity: 0.28 }],
  [47, { geometry: "dodecahedron", geometryParams: [0.23, 0], color: 0xff3f2a, roughness: 0.48, metalness: 0.06, emissive: 0xff3f2a, emissiveIntensity: 0.26 }],
  [48, { geometry: "dodecahedron", geometryParams: [0.23, 0], color: 0x40ff59, roughness: 0.48, metalness: 0.06, emissive: 0x40ff59, emissiveIntensity: 0.26 }],
  [49, { geometry: "dodecahedron", geometryParams: [0.23, 0], color: 0xffd300, roughness: 0.48, metalness: 0.06, emissive: 0xffd300, emissiveIntensity: 0.26 }]
]);

const renderArchetypes = new Map<number, RenderArchetypeDef>();
for (const [id, visual] of entities) {
  renderArchetypes.set(id, {
    id,
    nodes: [
      {
        geometry: visual.geometry,
        geometryParams: visual.geometryParams,
        color: visual.color,
        roughness: visual.roughness,
        metalness: visual.metalness,
        emissive: visual.emissive,
        emissiveIntensity: visual.emissiveIntensity
      }
    ]
  });
}
renderArchetypes.set(MODEL_ID_TRAINING_DUMMY, {
  id: MODEL_ID_TRAINING_DUMMY,
  nodes: [
    {
      geometry: "cylinder",
      geometryParams: [0.42, 0.42, 1.9, 12, 1],
      color: 0xa6c9d8,
      roughness: 0.88,
      metalness: 0.08,
      localPosition: { x: 0, y: 0, z: 0 }
    },
    {
      geometry: "sphere",
      geometryParams: [0.26, 14, 10],
      color: 0xd2edf2,
      roughness: 0.72,
      metalness: 0.04,
      localPosition: { x: 0, y: 1.15, z: 0 }
    }
  ]
});
renderArchetypes.set(MODEL_ID_LOCATION_STATIC_CASTLE, {
  id: MODEL_ID_LOCATION_STATIC_CASTLE,
  nodes: [
    { geometry: "box", geometryParams: [68, 10, 48], color: 0x24222d, roughness: 0.86, metalness: 0.05, localPosition: { x: 0, y: 0, z: 0 } },
    { geometry: "box", geometryParams: [42, 16, 28], color: 0x24222d, roughness: 0.86, metalness: 0.05, localPosition: { x: 0, y: 18, z: 0 } },
    { geometry: "box", geometryParams: [12, 28, 12], color: 0x5d526e, roughness: 0.76, metalness: 0.12, localPosition: { x: -52, y: 12, z: -34 } },
    { geometry: "box", geometryParams: [12, 28, 12], color: 0x5d526e, roughness: 0.76, metalness: 0.12, localPosition: { x: 52, y: 12, z: -34 } },
    { geometry: "box", geometryParams: [12, 28, 12], color: 0x5d526e, roughness: 0.76, metalness: 0.12, localPosition: { x: -52, y: 12, z: 34 } },
    { geometry: "box", geometryParams: [12, 28, 12], color: 0x5d526e, roughness: 0.76, metalness: 0.12, localPosition: { x: 52, y: 12, z: 34 } },
    { geometry: "box", geometryParams: [92, 5, 64], color: 0x5d526e, roughness: 0.76, metalness: 0.12, localPosition: { x: 0, y: -8, z: 0 } }
  ]
});
renderArchetypes.set(MODEL_ID_LOCATION_MOVING_CASTLE, {
  id: MODEL_ID_LOCATION_MOVING_CASTLE,
  nodes: [
    { geometry: "box", geometryParams: [68, 10, 48], color: 0x253d55, roughness: 0.86, metalness: 0.05, localPosition: { x: 0, y: 0, z: 0 } },
    { geometry: "box", geometryParams: [42, 16, 28], color: 0x253d55, roughness: 0.86, metalness: 0.05, localPosition: { x: 0, y: 18, z: 0 } },
    { geometry: "box", geometryParams: [12, 28, 12], color: 0x75a7c4, roughness: 0.76, metalness: 0.12, localPosition: { x: -52, y: 12, z: -34 } },
    { geometry: "box", geometryParams: [12, 28, 12], color: 0x75a7c4, roughness: 0.76, metalness: 0.12, localPosition: { x: 52, y: 12, z: -34 } },
    { geometry: "box", geometryParams: [12, 28, 12], color: 0x75a7c4, roughness: 0.76, metalness: 0.12, localPosition: { x: -52, y: 12, z: 34 } },
    { geometry: "box", geometryParams: [12, 28, 12], color: 0x75a7c4, roughness: 0.76, metalness: 0.12, localPosition: { x: 52, y: 12, z: 34 } },
    { geometry: "box", geometryParams: [92, 5, 64], color: 0x75a7c4, roughness: 0.76, metalness: 0.12, localPosition: { x: 0, y: -8, z: 0 } }
  ]
});
renderArchetypes.set(MODEL_ID_LOCATION_TEST_ARENA, {
  id: MODEL_ID_LOCATION_TEST_ARENA,
  nodes: [
    { geometry: "box", geometryParams: [84, 4, 84], color: 0x4e625f, roughness: 0.84, metalness: 0.08, localPosition: { x: 0, y: 0, z: 0 } },
    { geometry: "box", geometryParams: [24, 12, 6], color: 0xd8b691, roughness: 0.82, metalness: 0.1, localPosition: { x: 0, y: 10, z: -68 } }
  ]
});
renderArchetypes.set(MODEL_ID_LOCATION_MOVING_TEST_PLATFORM, {
  id: MODEL_ID_LOCATION_MOVING_TEST_PLATFORM,
  nodes: [
    { geometry: "box", geometryParams: [120, 1, 70], color: 0x7fc7d9, roughness: 0.72, metalness: 0.08, localPosition: { x: 0, y: 0, z: 0 } },
    { geometry: "box", geometryParams: [1.25, 0.1, 70.2], color: 0xf2d16b, roughness: 0.68, metalness: 0.05, localPosition: { x: -40, y: 0.55, z: 0 } },
    { geometry: "box", geometryParams: [1.25, 0.1, 70.2], color: 0xf2d16b, roughness: 0.68, metalness: 0.05, localPosition: { x: 40, y: 0.55, z: 0 } }
  ]
});

const locations = new Map<string, LocationVisualDef>([
  ["terrainIsland", { kind: "terrainIsland", terrainColor: 0xffffff, terrainRoughness: 0.95, bowlColor: 0x8ed8ff }],
  ["staticCastle", { kind: "staticCastle", castleBaseColor: 0x24222d, castleAccentColor: 0x5d526e }],
  ["movingCastle", { kind: "movingCastle", castleBaseColor: 0x253d55, castleAccentColor: 0x75a7c4 }],
  ["movingTestPlatform", { kind: "movingTestPlatform", slabColor: 0x7fc7d9, stripeColor: 0xf2d16b }],
  ["testArena", { kind: "testArena", arenaColor: 0x4e625f, arenaAccentColor: 0xd8b691 }]
]);

const projectilePalettes = new Map<number, Readonly<ProjectilePalette>>([
  [1, Object.freeze({
    coreColor: 0xff7b7b, emissiveColor: 0xc53939, glowColor: 0xff6666, burstColor: 0xffb0b0
  })],
  [2, Object.freeze({
    coreColor: 0x68ff9e, emissiveColor: 0x2ea85b, glowColor: 0x57ff94, burstColor: 0xa8ffca
  })],
  [3, Object.freeze({
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
  injectVisualPalette({ entities, renderArchetypes, locations });
  injectEnvironmentPresets(environmentPresets);
  injectProjectilePalettes(projectilePalettes);
}
