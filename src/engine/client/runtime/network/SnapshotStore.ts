/**
 * Purpose: This file stores or assembles timeline snapshots for smooth network playback, and keeps module state organized and queryable in memory.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { NType } from "../../../shared/netcode";
import {
  MOVEMENT_MODE_GROUNDED,
  sanitizeMovementMode,
  LOCATION_KIND_NONE,
  MODEL_ID_PLAYER,
  MODEL_ID_PROJECTILE_PRIMARY,
} from "../../../shared/index";
import type {
  LocationRootState,
  ProjectileState,
  RemotePlayerState,
  WorldEntityState
} from "../types";

export class SnapshotStore {
  private readonly entities = new Map<number, Record<string, unknown>>();

  public reset(): void {
    this.entities.clear();
  }

  public applyInterpolatedFrames(rawFrames: unknown): number {
    if (!Array.isArray(rawFrames)) {
      return 0;
    }

    let appliedChanges = 0;
    for (const rawFrame of rawFrames) {
      const frame = rawFrame as {
        createEntities?: unknown[];
        updateEntities?: unknown[];
        deleteEntities?: unknown[];
      };

      for (const rawEntity of frame.createEntities ?? []) {
        if (!rawEntity || typeof rawEntity !== "object") {
          continue;
        }
        const entity = rawEntity as Record<string, unknown>;
        const nid = entity.nid;
        if (typeof nid !== "number") {
          continue;
        }
        this.entities.set(nid, { ...entity });
        appliedChanges += 1;
      }

      for (const rawPatch of frame.updateEntities ?? []) {
        if (!rawPatch || typeof rawPatch !== "object") {
          continue;
        }
        const patch = rawPatch as { nid?: unknown; prop?: unknown; value?: unknown };
        if (typeof patch.nid !== "number" || typeof patch.prop !== "string") {
          continue;
        }
        const entity = this.entities.get(patch.nid);
        if (!entity) {
          continue;
        }
        entity[patch.prop] = patch.value;
        this.entities.set(patch.nid, entity);
        appliedChanges += 1;
      }

      for (const rawNid of frame.deleteEntities ?? []) {
        if (typeof rawNid === "number") {
          this.entities.delete(rawNid);
          appliedChanges += 1;
        }
      }
    }
    return appliedChanges;
  }

  public getRemotePlayers(localPlayerNid: number | null): RemotePlayerState[] {
    const output: RemotePlayerState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.RuntimeEntity) {
        continue;
      }
      const player = this.toPlayerState(rawEntity);
      if (!player) {
        continue;
      }
      if (localPlayerNid !== null && player.nid === localPlayerNid) {
        continue;
      }
      output.push(player);
    }
    return output;
  }

  public getLocalPlayerPose(localPlayerNid: number | null): RemotePlayerState | null {
    if (localPlayerNid === null) {
      return null;
    }
    const rawEntity = this.entities.get(localPlayerNid);
    if (!rawEntity || rawEntity.ntype !== NType.RuntimeEntity) {
      return null;
    }
    return this.toPlayerState(rawEntity);
  }

  public getLocationRoots(): LocationRootState[] {
    const output: LocationRootState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.WorldAnchorEntity) {
        continue;
      }
      const location = this.toLocationRootState(rawEntity);
      if (!location) {
        continue;
      }
      output.push(location);
    }
    return output;
  }

  public getProjectiles(): ProjectileState[] {
    const output: ProjectileState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.RuntimeEntity) {
        continue;
      }
      const projectile = this.toProjectileState(rawEntity);
      if (!projectile) {
        continue;
      }
      output.push(projectile);
    }
    return output;
  }

  public getWorldEntities(): WorldEntityState[] {
    const output: WorldEntityState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.RuntimeEntity) {
        continue;
      }
      const modelId = rawEntity.modelId;
      if (modelId === MODEL_ID_PLAYER || modelId === MODEL_ID_PROJECTILE_PRIMARY) {
        continue;
      }
      const entity = this.toWorldEntity(rawEntity);
      if (!entity) {
        continue;
      }
      output.push(entity);
    }
    return output;
  }

  private toPlayerState(raw: Record<string, unknown>): RemotePlayerState | null {
    const modelId = raw.modelId;
    if (modelId !== MODEL_ID_PLAYER) {
      return null;
    }
    const nid = raw.nid;
    const position = this.readPosition(raw.position);
    const rotation = this.readRotation(raw.rotation);
    const grounded = raw.grounded;
    const health = raw.health;
    const maxHealth = raw.maxHealth;

    if (
      typeof nid !== "number" ||
      typeof modelId !== "number" ||
      position === null ||
      rotation === null
    ) {
      return null;
    }

    return {
      nid,
      modelId,
      x: position.x,
      y: position.y,
      z: position.z,
      rotation,
      grounded: typeof grounded === "boolean" ? grounded : true,
      movementMode: sanitizeMovementMode(raw.movementMode, MOVEMENT_MODE_GROUNDED),
      health: typeof health === "number" ? health : 100,
      maxHealth: typeof maxHealth === "number" ? maxHealth : 100
    };
  }

  private toLocationRootState(raw: Record<string, unknown>): LocationRootState | null {
    const locationKind = raw.locationKind;
    if (typeof locationKind !== "number" || locationKind <= LOCATION_KIND_NONE) {
      return null;
    }
    const modelId = raw.modelId;
    const nid = raw.nid;
    const locationPid = raw.locationPid;
    const position = this.readPosition(raw.position);
    const rotation = this.readRotation(raw.rotation);
    const locationArchetypeId = raw.locationArchetypeId;
    const locationSeed = raw.locationSeed;
    const locationEnvironmentId = raw.locationEnvironmentId;
    const locationStreamingRadius = raw.locationStreamingRadius;
    const locationInfluenceRadius = raw.locationInfluenceRadius;

    if (
      typeof nid !== "number" ||
      typeof modelId !== "number" ||
      typeof locationPid !== "number" ||
      typeof locationArchetypeId !== "number" ||
      typeof locationSeed !== "number" ||
      typeof locationEnvironmentId !== "number" ||
      typeof locationStreamingRadius !== "number" ||
      typeof locationInfluenceRadius !== "number" ||
      position === null ||
      rotation === null
    ) {
      return null;
    }

    return {
      nid,
      modelId,
      locationPid,
      locationKind,
      locationArchetypeId,
      locationSeed,
      locationEnvironmentId,
      locationStreamingRadius,
      locationInfluenceRadius,
      x: position.x,
      y: position.y,
      z: position.z,
      rotation
    };
  }

  private toProjectileState(raw: Record<string, unknown>): ProjectileState | null {
    const modelId = raw.modelId;
    if (modelId !== MODEL_ID_PROJECTILE_PRIMARY) {
      return null;
    }
    const nid = raw.nid;
    const position = this.readPosition(raw.position);
    if (
      typeof nid !== "number" ||
      typeof modelId !== "number" ||
      position === null
    ) {
      return null;
    }

    return {
      nid,
      modelId,
      x: position.x,
      y: position.y,
      z: position.z
    };
  }

  private toWorldEntity(raw: Record<string, unknown>): WorldEntityState | null {
    const modelId = raw.modelId;
    const nid = raw.nid;
    const position = this.readPosition(raw.position);
    const rotation = this.readRotation(raw.rotation);
    if (
      typeof nid !== "number" ||
      typeof modelId !== "number" ||
      position === null ||
      rotation === null
    ) {
      return null;
    }
    const health = typeof raw.health === "number" ? raw.health : 0;
    const maxHealth = typeof raw.maxHealth === "number" ? raw.maxHealth : 0;
    const pickupDefinitionId = typeof raw.pickupDefinitionId === "number" ? raw.pickupDefinitionId : 0;
    const itemQuantity = typeof raw.itemQuantity === "number" ? raw.itemQuantity : 0;
    return {
      nid,
      modelId,
      x: position.x,
      y: position.y,
      z: position.z,
      rotationX: rotation.x,
      rotationY: rotation.y,
      rotationZ: rotation.z,
      rotationW: rotation.w,
      health,
      maxHealth,
      pickupDefinitionId,
      itemQuantity
    };
  }

  private readPosition(raw: unknown): { x: number; y: number; z: number } | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const position = raw as { x?: unknown; y?: unknown; z?: unknown };
    if (
      typeof position.x !== "number" ||
      typeof position.y !== "number" ||
      typeof position.z !== "number"
    ) {
      return null;
    }
    return {
      x: position.x,
      y: position.y,
      z: position.z
    };
  }

  private readRotation(raw: unknown): { x: number; y: number; z: number; w: number } | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const rotation = raw as { x?: unknown; y?: unknown; z?: unknown; w?: unknown };
    if (
      typeof rotation.x !== "number" ||
      typeof rotation.y !== "number" ||
      typeof rotation.z !== "number" ||
      typeof rotation.w !== "number"
    ) {
      return null;
    }
    return {
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w
    };
  }
}

