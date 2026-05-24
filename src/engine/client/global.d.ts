/**
 * Purpose: This file defines the "global" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
declare global {
  interface RenderGameStatePlayer {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    nid: number | null;
    movementMode?: "grounded" | "flying";
    groundedPlatformPid?: number | null;
    carriedFramePid?: number | null;
  }

  interface RenderGameStateRemotePlayer {
    nid: number;
    x: number;
    y: number;
    z: number;
    grounded: boolean;
    movementMode?: "grounded" | "flying";
    health: number;
  }

  interface RenderGameStatePerf {
    fps: number;
    lowFpsFrameCount: number;
  }

  interface RenderGameStatePayload {
    mode: "connected" | "local-only";
    pointerLock: boolean;
    coordinateSystem: string;
    player: RenderGameStatePlayer;
    remotePlayers: RenderGameStateRemotePlayer[];
    perf: RenderGameStatePerf;
    [key: string]: unknown;
  }

  interface TestMovementInput {
    forward: number;
    strafe: number;
    jump: boolean;
    toggleFlyPressed?: boolean;
    sprint: boolean;
  }

  interface Window {
    render_game_to_text?: () => string;
    render_game_state?: (scope?: "full" | "minimal") => RenderGameStatePayload;
    advanceTime?: (ms: number) => void;
    set_test_movement?: (movement: TestMovementInput | null) => void;
    trigger_test_primary_action?: (count?: number) => void;
    trigger_test_secondary_action?: (count?: number) => void;
    trigger_test_interact?: (count?: number, slot?: number) => void;
    drop_first_inventory_item?: () => void;
    use_first_inventory_item?: () => void;
    equip_first_equipment_item?: () => void;
    set_test_primary_hold?: (held: boolean) => void;
    set_test_secondary_hold?: (held: boolean) => void;
    set_test_look_angles?: (yaw: number, pitch: number) => void;
    request_map_transfer?: (targetMapInstanceId: string) => void;
    get_creator_state?: () => {
      sessionId: number;
      profileId: string;
      baseBlueprintId: number;
      draft: {
        name: string;
        profileId: string;
        baseBlueprintId: number;
        fieldValues: Record<string, unknown>;
      };
      capacity: {
        statBudgetTotal: number;
        statBudgetSpent: number;
        statBudgetRemaining: number;
        attributeBudget: { total: number; spent: number; remaining: number };
        attributeSlots: { upsideUsed: number; downsideUsed: number; upsideMax: number; downsideMax: number };
      };
      availableBlueprintIds: number[];
      availableBlueprintCount: number;
      validation: { valid: boolean; message: string; errors: string[] };
      productionPreview: unknown;
    } | null;
    send_creator_command?: (command: {
      sessionId?: number;
      sequence?: number;
      setName?: boolean;
      name?: string;
      selectBaseBlueprint?: boolean;
      baseBlueprintId?: number;
      stepField?: boolean;
      fieldId?: string;
      fieldDelta?: number;
      setField?: boolean;
      fieldValueJson?: string;
      submitCreate?: boolean;
      submitCreateAndInstantiate?: boolean;
    }) => void;
    get_recent_alerts?: () => Array<{ text: string; severity: string }>;
    inspect_creator_appearance_rollout?: () => {
      appearanceBindings: Array<{
        appearanceId: string;
        ready: {
          equipped: { assetId: string | null; renderArchetypeId: number | null; previewTextureUrl: string | null };
          pickup: { assetId: string | null; renderArchetypeId: number | null; previewTextureUrl: string | null };
        };
        activation: { assetId: string | null; projectileKind: number; previewTextureUrl: string | null };
      }>;
      equippedItems: Array<{
        slot: string;
        itemInstanceId: number;
        definitionId: number;
        key: string;
        name: string;
        readyAppearanceId: string | null;
        readyAppearanceEquippedAssetId: string | null;
        readyAppearancePickupAssetId: string | null;
      }>;
      worldPickups: Array<{
        nid: number;
        definitionId: number;
        key: string;
        name: string;
        readyAppearanceId: string | null;
        readyAppearancePickupAssetId: string | null;
      }>;
      ownedAbilities: Array<{
        abilityId: number;
        key: string;
        name: string;
        activationAppearanceId: string | null;
        activationAppearanceAssetId: string | null;
      }>;
    };
    validate_creator_appearance_rollout?: () => {
      ok: boolean;
      issues: string[];
      counts: {
        bindings: number;
        equippedItems: number;
        worldPickups: number;
        ownedAbilities: number;
      };
    };
    inspect_actor_capabilities?: () => void;
    set_actor_capability?: (key: string, value: number) => void;
    __runtimeMapConfig?: {
      mapId: string;
      instanceId: string;
      seed: number;
      groundHalfExtent: number;
      groundHalfThickness: number;
      cubeCount: number;
    };
  }

  var __runtimeMapConfig:
    | {
        mapId: string;
        instanceId: string;
        seed: number;
        groundHalfExtent: number;
        groundHalfThickness: number;
        cubeCount: number;
      }
    | undefined;
}

export {};
