// Client interpolated snapshot cache and projection into runtime render entity slices.
import { NType } from "../../../shared/netcode";
import {
  MOVEMENT_MODE_GROUNDED,
  sanitizeMovementMode,
  MODEL_ID_PLATFORM_LINEAR,
  MODEL_ID_PLATFORM_ROTATING,
  MODEL_ID_PLAYER,
  MODEL_ID_PROJECTILE_PRIMARY,
  MODEL_ID_TRAINING_DUMMY
} from "../../../shared/index";
import type {
  PlatformState,
  ProjectileState,
  RemotePlayerState,
  TrainingDummyState
} from "../types";

export class SnapshotStore {
  private readonly entities = new Map<number, Record<string, unknown>>();

  public reset(): void {
    this.entities.clear();
  }

  public applyInterpolatedFrames(rawFrames: unknown): void {
    if (!Array.isArray(rawFrames)) {
      return;
    }

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
      }

      for (const rawNid of frame.deleteEntities ?? []) {
        if (typeof rawNid === "number") {
          this.entities.delete(rawNid);
        }
      }
    }
  }

  public getRemotePlayers(localPlayerNid: number | null): RemotePlayerState[] {
    const output: RemotePlayerState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.BaseEntity) {
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
    if (!rawEntity || rawEntity.ntype !== NType.BaseEntity) {
      return null;
    }
    return this.toPlayerState(rawEntity);
  }

  public getPlatforms(): PlatformState[] {
    const output: PlatformState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.BaseEntity) {
        continue;
      }
      const platform = this.toPlatformState(rawEntity);
      if (!platform) {
        continue;
      }
      output.push(platform);
    }
    return output;
  }

  public getProjectiles(): ProjectileState[] {
    const output: ProjectileState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.BaseEntity) {
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

  public getTrainingDummies(): TrainingDummyState[] {
    const output: TrainingDummyState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.BaseEntity) {
        continue;
      }
      const dummy = this.toTrainingDummyState(rawEntity);
      if (!dummy) {
        continue;
      }
      output.push(dummy);
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

  private toPlatformState(raw: Record<string, unknown>): PlatformState | null {
    const modelId = raw.modelId;
    if (modelId !== MODEL_ID_PLATFORM_LINEAR && modelId !== MODEL_ID_PLATFORM_ROTATING) {
      return null;
    }
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

    return {
      nid,
      modelId,
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

  private toTrainingDummyState(raw: Record<string, unknown>): TrainingDummyState | null {
    const modelId = raw.modelId;
    if (modelId !== MODEL_ID_TRAINING_DUMMY) {
      return null;
    }
    const nid = raw.nid;
    const position = this.readPosition(raw.position);
    const rotation = this.readRotation(raw.rotation);
    const health = raw.health;
    const maxHealth = raw.maxHealth;
    if (
      typeof nid !== "number" ||
      typeof modelId !== "number" ||
      position === null ||
      rotation === null ||
      typeof health !== "number" ||
      typeof maxHealth !== "number"
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
      health,
      maxHealth
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
