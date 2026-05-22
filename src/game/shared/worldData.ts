/**
 * Purpose: This file defines world state, world helpers, or world orchestration behavior.
 * Scope: It belongs to the game-specific shared data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import { injectLocationDefinitions } from "../../engine/shared/worldLocations";
import { injectEnvironmentVolumeDefinitions } from "../../engine/shared/environmentVolumes";
import { injectMovingLocationCollisionExtents } from "../../engine/shared/worldPhysics";
import type { WorldAnchorDefinition, SpawnAnchor } from "../../engine/shared/worldLocations";
import type { EnvironmentVolumeDefinition } from "../../engine/shared/environmentVolumes";
import {
  ENVIRONMENT_PRESET_SKY_BLUE_DAY,
  ENVIRONMENT_PRESET_VOID_INFERNAL,
  ENVIRONMENT_PRESET_VOID_ARCANE,
  ENVIRONMENT_PRESET_VOID_NEUTRAL,
  ENVIRONMENT_PRESET_VOID_DEEP,
  LOCATION_KIND_TERRAIN_ISLAND,
  LOCATION_KIND_STATIC_CASTLE,
  LOCATION_KIND_MOVING_CASTLE,
  LOCATION_KIND_TEST_ARENA,
  LOCATION_KIND_MOVING_TEST_PLATFORM
} from "../../engine/shared/worldLocations";
import {
  MODEL_ID_LOCATION_TERRAIN_ISLAND,
  MODEL_ID_LOCATION_STATIC_CASTLE,
  MODEL_ID_LOCATION_MOVING_CASTLE,
  MODEL_ID_LOCATION_TEST_ARENA,
  MODEL_ID_LOCATION_MOVING_TEST_PLATFORM
} from "../../engine/shared/config";
import { ENVIRONMENT_PRIORITY_VOID_REGION } from "../../engine/shared/environmentVolumes";

const WORLD_ANCHOR_DEFINITIONS: readonly WorldAnchorDefinition[] = [
  {
    id: "verdant-test-island",
    mapInstanceIds: ["map-a"],
    pid: 10_001,
    archetypeId: 1,
    kind: "terrainIsland",
    kindId: LOCATION_KIND_TERRAIN_ISLAND,
    modelId: MODEL_ID_LOCATION_TERRAIN_ISLAND,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseYaw: 0,
    streamingRadius: 850,
    influenceRadius: 420,
    environmentId: "sky.blue_day",
    environmentPresetId: ENVIRONMENT_PRESET_SKY_BLUE_DAY,
    environmentVolumes: [
      {
        id: "verdant-island.open-sky",
        environmentId: "sky.blue_day",
        environmentPresetId: ENVIRONMENT_PRESET_SKY_BLUE_DAY,
        localX: 0,
        localY: 58,
        localZ: 0,
        halfX: 390,
        halfY: 260,
        halfZ: 390,
        blendDistance: 160
      }
    ],
    motion: "static",
    craftBenchSockets: [
      {
        id: "verdant-test-island.craft-bench.alpha",
        localX: 0.5,
        localY: 34,
        localZ: 3.5,
        interactRadius: 3.25,
        visualMarker: {
          geometry: "box",
          sizeX: 1.8,
          sizeY: 1.0,
          sizeZ: 1.2,
          color: 0x72c48f,
          roughness: 0.55,
          metalness: 0.08
        }
      }
    ],
    seed: 2001,
    terrain: {
      halfExtent: 128,
      halfThickness: 0.5,
      biome: "grass"
    }
  },
  {
    id: "blackstone-test-castle",
    mapInstanceIds: ["map-a"],
    pid: 10_002,
    archetypeId: 2,
    kind: "staticCastle",
    kindId: LOCATION_KIND_STATIC_CASTLE,
    modelId: MODEL_ID_LOCATION_STATIC_CASTLE,
    baseX: 620,
    baseY: 135,
    baseZ: -260,
    baseYaw: 0.35,
    streamingRadius: 950,
    influenceRadius: 360,
    environmentId: "void.infernal",
    environmentPresetId: ENVIRONMENT_PRESET_VOID_INFERNAL,
    environmentVolumes: [
      {
        id: "blackstone-castle.keep",
        environmentId: "void.infernal",
        environmentPresetId: ENVIRONMENT_PRESET_VOID_INFERNAL,
        localX: 0,
        localY: 44,
        localZ: 0,
        halfX: 210,
        halfY: 170,
        halfZ: 155,
        blendDistance: 95
      },
      {
        id: "blackstone-castle.outer-grounds",
        environmentId: "void.infernal",
        environmentPresetId: ENVIRONMENT_PRESET_VOID_INFERNAL,
        localX: 12,
        localY: 34,
        localZ: -18,
        halfX: 360,
        halfY: 220,
        halfZ: 360,
        blendDistance: 125
      }
    ],
    motion: "static",
    staticCollisionVolumes: [
      { localCenterX: 0, localCenterY: 5, localCenterZ: 0, halfX: 34, halfY: 5, halfZ: 24 },
      { localCenterX: 0, localCenterY: 18, localCenterZ: 0, halfX: 22, halfY: 8, halfZ: 14 },
      { localCenterX: -26, localCenterY: 12, localCenterZ: -18, halfX: 6, halfY: 14, halfZ: 6 },
      { localCenterX: 26, localCenterY: 12, localCenterZ: -18, halfX: 6, halfY: 14, halfZ: 6 },
      { localCenterX: -26, localCenterY: 12, localCenterZ: 18, halfX: 6, halfY: 14, halfZ: 6 },
      { localCenterX: 26, localCenterY: 12, localCenterZ: 18, halfX: 6, halfY: 14, halfZ: 6 }
    ],
    staticNavigationSurfaces: [
      { localCenterX: 0, localTopY: 5, localCenterZ: 0, halfX: 34, halfZ: 24 },
      { localCenterX: 0, localTopY: 21, localCenterZ: 0, halfX: 22, halfZ: 14 },
      { localCenterX: -26, localTopY: 26, localCenterZ: -18, halfX: 6, halfZ: 6 },
      { localCenterX: 26, localTopY: 26, localCenterZ: -18, halfX: 6, halfZ: 6 },
      { localCenterX: -26, localTopY: 26, localCenterZ: 18, halfX: 6, halfZ: 6 },
      { localCenterX: 26, localTopY: 26, localCenterZ: 18, halfX: 6, halfZ: 6 }
    ]
  },
  {
    id: "drifting-test-citadel",
    mapInstanceIds: ["map-a"],
    pid: 10_003,
    archetypeId: 3,
    kind: "movingCastle",
    kindId: LOCATION_KIND_MOVING_CASTLE,
    modelId: MODEL_ID_LOCATION_MOVING_CASTLE,
    baseX: -520,
    baseY: 170,
    baseZ: -420,
    baseYaw: -0.45,
    streamingRadius: 1050,
    influenceRadius: 84,
    environmentId: "void.arcane",
    environmentPresetId: ENVIRONMENT_PRESET_VOID_ARCANE,
    motion: "drift",
    driftX: 55,
    driftY: 16,
    driftZ: 34,
    driftFrequency: 0.175,
    referenceFrameVolumes: [
      {
        id: "drifting-citadel.main-deck",
        shape: "box",
        localX: 0,
        localY: 10,
        localZ: 0,
        halfX: 48,
        halfY: 22,
        halfZ: 36
      },
      {
        id: "drifting-citadel.keep",
        shape: "box",
        localX: 0,
        localY: 28,
        localZ: 0,
        halfX: 24,
        halfY: 24,
        halfZ: 18
      },
      {
        id: "drifting-citadel.north-towers",
        shape: "box",
        localX: 0,
        localY: 24,
        localZ: -34,
        halfX: 58,
        halfY: 28,
        halfZ: 12
      },
      {
        id: "drifting-citadel.south-towers",
        shape: "box",
        localX: 0,
        localY: 24,
        localZ: 34,
        halfX: 58,
        halfY: 28,
        halfZ: 12
      },
      {
        id: "drifting-citadel.undercroft",
        shape: "box",
        localX: 0,
        localY: -8,
        localZ: 0,
        halfX: 56,
        halfY: 12,
        halfZ: 40
      }
    ],
    pilotConsoleSockets: [
      {
        id: "drifting-citadel.console.foredeck",
        localX: 0,
        localY: 12,
        localZ: -8,
        interactRadius: 3,
        preferredReferenceFrameVolumeId: "drifting-citadel.main-deck",
        visualMarker: {
          geometry: "box",
          sizeX: 1.2,
          sizeY: 1.2,
          sizeZ: 1.2,
          color: 0xf2a65a,
          roughness: 0.45,
          metalness: 0.15
        }
      }
    ],
    movingNavigationSurfaces: [
      { localCenterX: 0, localTopY: 9, localCenterZ: 0, halfX: 42, halfZ: 28 },
      { localCenterX: 0, localTopY: 28, localCenterZ: 0, halfX: 22, halfZ: 14 }
    ]
  },
  {
    id: "single-volume-moving-slab",
    mapInstanceIds: ["map-a"],
    pid: 10_005,
    archetypeId: 5,
    kind: "movingTestPlatform",
    kindId: LOCATION_KIND_MOVING_TEST_PLATFORM,
    modelId: MODEL_ID_LOCATION_MOVING_TEST_PLATFORM,
    baseX: 96,
    baseY: 58,
    baseZ: 0,
    baseYaw: 0,
    streamingRadius: 650,
    influenceRadius: 24,
    environmentId: "void.neutral",
    environmentPresetId: ENVIRONMENT_PRESET_VOID_NEUTRAL,
    renderArchetypeScalePct: 100,
    motion: "drift",
    driftX: 28,
    driftY: 0,
    driftZ: 0,
    driftFrequency: 0.32,
    referenceFrameVolumes: [
      {
        id: "single-volume-moving-slab.reference-frame",
        shape: "box",
        localX: 0,
        localY: 4,
        localZ: 0,
        halfX: 80,
        halfY: 40,
        halfZ: 50
      }
    ],
    pilotConsoleSockets: [
      {
        id: "single-volume-moving-slab.console",
        localX: 0,
        localY: 2,
        localZ: -6,
        interactRadius: 3.25,
        preferredReferenceFrameVolumeId: "single-volume-moving-slab.reference-frame",
        visualMarker: {
          geometry: "box",
          sizeX: 1.2,
          sizeY: 1.2,
          sizeZ: 1.2,
          color: 0xf2a65a,
          roughness: 0.45,
          metalness: 0.15
        }
      }
    ],
    movingNavigationSurfaces: [
      { localCenterX: 0, localTopY: 0.5, localCenterZ: 0, halfX: 60, halfZ: 35 }
    ]
  },
  {
    id: "pilotable-flat-raft",
    mapInstanceIds: ["map-a"],
    pid: 10_006,
    archetypeId: 6,
    kind: "movingTestPlatform",
    kindId: LOCATION_KIND_MOVING_TEST_PLATFORM,
    modelId: MODEL_ID_LOCATION_MOVING_TEST_PLATFORM,
    baseX: 280,
    baseY: 54,
    baseZ: 32,
    baseYaw: 0,
    streamingRadius: 650,
    influenceRadius: 26,
    environmentId: "void.neutral",
    environmentPresetId: ENVIRONMENT_PRESET_VOID_NEUTRAL,
    renderArchetypeScalePct: 25,
    motion: "drift",
    driftX: 0,
    driftY: 0,
    driftZ: 0,
    driftFrequency: 0,
    movingCollisionHalfExtents: {
      halfX: 15,
      halfY: 0.5,
      halfZ: 8.75
    },
    referenceFrameVolumes: [
      {
        id: "pilotable-flat-raft.reference-frame",
        shape: "box",
        localX: 0,
        localY: 1.5,
        localZ: 0,
        halfX: 16,
        halfY: 8,
        halfZ: 10
      }
    ],
    pilotConsoleSockets: [
      {
        id: "pilotable-flat-raft.console",
        localX: 0,
        localY: 1.5,
        localZ: 0,
        interactRadius: 3.5,
        preferredReferenceFrameVolumeId: "pilotable-flat-raft.reference-frame",
        visualMarker: {
          geometry: "box",
          sizeX: 1.2,
          sizeY: 1.2,
          sizeZ: 1.2,
          color: 0xf2a65a,
          roughness: 0.45,
          metalness: 0.15
        }
      }
    ],
    movingNavigationSurfaces: [
      { localCenterX: 0, localTopY: 0.125, localCenterZ: 0, halfX: 10, halfZ: 5 }
    ]
  },
  {
    id: "combat-test-ring",
    mapInstanceIds: ["map-a"],
    pid: 10_004,
    archetypeId: 4,
    kind: "testArena",
    kindId: LOCATION_KIND_TEST_ARENA,
    modelId: MODEL_ID_LOCATION_TEST_ARENA,
    baseX: 260,
    baseY: 82,
    baseZ: 440,
    baseYaw: 0,
    streamingRadius: 700,
    influenceRadius: 260,
    environmentId: "void.neutral",
    environmentPresetId: ENVIRONMENT_PRESET_VOID_NEUTRAL,
    environmentVolumes: [
      {
        id: "combat-ring.neutral-box",
        environmentId: "void.neutral",
        environmentPresetId: ENVIRONMENT_PRESET_VOID_NEUTRAL,
        localX: 0,
        localY: 38,
        localZ: 0,
        halfX: 180,
        halfY: 95,
        halfZ: 180,
        blendDistance: 80
      }
    ],
    motion: "static",
    staticCollisionVolumes: [
      { localCenterX: 0, localCenterY: 2, localCenterZ: 0, halfX: 42, halfY: 2, halfZ: 42 },
      { localCenterX: 0, localCenterY: 10, localCenterZ: -34, halfX: 12, halfY: 6, halfZ: 3 }
    ],
    staticNavigationSurfaces: [
      { localCenterX: 0, localTopY: 2, localCenterZ: 0, halfX: 42, halfZ: 42 },
      { localCenterX: 0, localTopY: 16, localCenterZ: -34, halfX: 12, halfZ: 3 }
    ]
  },
  {
    id: "transfer-void-pad",
    mapInstanceIds: ["map-b"],
    pid: 20_001,
    archetypeId: 4001,
    kind: "testArena",
    kindId: LOCATION_KIND_TEST_ARENA,
    modelId: MODEL_ID_LOCATION_TEST_ARENA,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    baseYaw: 0,
    streamingRadius: 280,
    influenceRadius: 90,
    environmentId: "void.deep",
    environmentPresetId: ENVIRONMENT_PRESET_VOID_DEEP,
    environmentVolumes: [
      {
        id: "transfer-void-pad.deep-void",
        environmentId: "void.deep",
        environmentPresetId: ENVIRONMENT_PRESET_VOID_DEEP,
        localX: 0,
        localY: 48,
        localZ: 0,
        halfX: 260,
        halfY: 180,
        halfZ: 260,
        blendDistance: 120
      }
    ],
    motion: "static",
    staticCollisionVolumes: [
      { localCenterX: 0, localCenterY: 2, localCenterZ: 0, halfX: 42, halfY: 2, halfZ: 42 },
      { localCenterX: 0, localCenterY: 10, localCenterZ: -34, halfX: 12, halfY: 6, halfZ: 3 }
    ],
    staticNavigationSurfaces: [
      { localCenterX: 0, localTopY: 2, localCenterZ: 0, halfX: 42, halfZ: 42 },
      { localCenterX: 0, localTopY: 16, localCenterZ: -34, halfX: 12, halfZ: 3 }
    ]
  }
];

const DEFAULT_VOID_SPAWN_ANCHOR: SpawnAnchor = {
  id: "spawn.verdant-island.center",
  locationId: "verdant-test-island",
  x: 0,
  y: 34,
  z: 0,
  yaw: 0
};

const VOID_ENVIRONMENT_VOLUME_DEFINITIONS: readonly EnvironmentVolumeDefinition[] = [
  {
    id: "void-region.neutral-origin-expanse",
    kind: "voidRegion",
    priority: ENVIRONMENT_PRIORITY_VOID_REGION,
    environmentPresetId: ENVIRONMENT_PRESET_VOID_NEUTRAL,
    x: 0,
    y: 0,
    z: 0,
    halfX: 900,
    halfY: 760,
    halfZ: 760,
    blendDistance: 360
  },
  {
    id: "void-region.infernal-blackstone-expanse",
    kind: "voidRegion",
    priority: ENVIRONMENT_PRIORITY_VOID_REGION,
    environmentPresetId: ENVIRONMENT_PRESET_VOID_INFERNAL,
    x: 1250,
    y: 40,
    z: -760,
    halfX: 820,
    halfY: 760,
    halfZ: 780,
    blendDistance: 360
  },
  {
    id: "void-region.arcane-drift-belt",
    kind: "voidRegion",
    priority: ENVIRONMENT_PRIORITY_VOID_REGION,
    environmentPresetId: ENVIRONMENT_PRESET_VOID_ARCANE,
    x: -760,
    y: 130,
    z: -520,
    halfX: 820,
    halfY: 760,
    halfZ: 780,
    blendDistance: 360
  },
  {
    id: "void-region.deep-skybox-survey",
    kind: "voidRegion",
    priority: ENVIRONMENT_PRIORITY_VOID_REGION,
    environmentPresetId: ENVIRONMENT_PRESET_VOID_DEEP,
    x: -1420,
    y: 80,
    z: 980,
    halfX: 900,
    halfY: 760,
    halfZ: 840,
    blendDistance: 360
  }
];

const MOVING_LOCATION_COLLISION_EXTENTS = new Map([
  ["movingCastle", { halfX: 42, halfY: 9, halfZ: 28 }],
  ["movingTestPlatform", { halfX: 60, halfY: 0.5, halfZ: 35 }]
]);

export function initWorldData(): void {
  injectLocationDefinitions(WORLD_ANCHOR_DEFINITIONS, DEFAULT_VOID_SPAWN_ANCHOR);
  injectEnvironmentVolumeDefinitions(VOID_ENVIRONMENT_VOLUME_DEFINITIONS);
  injectMovingLocationCollisionExtents(MOVING_LOCATION_COLLISION_EXTENTS);
}
