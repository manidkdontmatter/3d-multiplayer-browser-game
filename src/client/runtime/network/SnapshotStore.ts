import { NType } from "../../../shared/netcode";
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
      if (rawEntity.ntype !== NType.PlayerEntity) {
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
    if (!rawEntity || rawEntity.ntype !== NType.PlayerEntity) {
      return null;
    }
    return this.toPlayerState(rawEntity);
  }

  public getPlatforms(): PlatformState[] {
    const output: PlatformState[] = [];
    for (const rawEntity of this.entities.values()) {
      if (rawEntity.ntype !== NType.PlatformEntity) {
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
      if (rawEntity.ntype !== NType.ProjectileEntity) {
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
      if (rawEntity.ntype !== NType.TrainingDummyEntity) {
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
    const nid = raw.nid;
    const x = raw.x;
    const y = raw.y;
    const z = raw.z;
    const yaw = raw.yaw;
    const pitch = raw.pitch;
    const serverTick = raw.serverTick;
    const grounded = raw.grounded;
    const health = raw.health;

    if (
      typeof nid !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof yaw !== "number" ||
      typeof pitch !== "number" ||
      typeof serverTick !== "number"
    ) {
      return null;
    }

    return {
      nid,
      x,
      y,
      z,
      yaw,
      pitch,
      serverTick,
      grounded: typeof grounded === "boolean" ? grounded : true,
      health: typeof health === "number" ? health : 100
    };
  }

  private toPlatformState(raw: Record<string, unknown>): PlatformState | null {
    const nid = raw.nid;
    const pid = raw.pid;
    const kind = raw.kind;
    const x = raw.x;
    const y = raw.y;
    const z = raw.z;
    const yaw = raw.yaw;
    const serverTick = raw.serverTick;
    const halfX = raw.halfX;
    const halfY = raw.halfY;
    const halfZ = raw.halfZ;

    if (
      typeof nid !== "number" ||
      typeof pid !== "number" ||
      typeof kind !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof yaw !== "number" ||
      typeof serverTick !== "number" ||
      typeof halfX !== "number" ||
      typeof halfY !== "number" ||
      typeof halfZ !== "number"
    ) {
      return null;
    }

    return {
      nid,
      pid,
      kind,
      x,
      y,
      z,
      yaw,
      serverTick,
      halfX,
      halfY,
      halfZ
    };
  }

  private toProjectileState(raw: Record<string, unknown>): ProjectileState | null {
    const nid = raw.nid;
    const ownerNid = raw.ownerNid;
    const kind = raw.kind;
    const x = raw.x;
    const y = raw.y;
    const z = raw.z;
    const serverTick = raw.serverTick;
    if (
      typeof nid !== "number" ||
      typeof ownerNid !== "number" ||
      typeof kind !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof serverTick !== "number"
    ) {
      return null;
    }

    return {
      nid,
      ownerNid,
      kind,
      x,
      y,
      z,
      serverTick
    };
  }

  private toTrainingDummyState(raw: Record<string, unknown>): TrainingDummyState | null {
    const nid = raw.nid;
    const x = raw.x;
    const y = raw.y;
    const z = raw.z;
    const yaw = raw.yaw;
    const serverTick = raw.serverTick;
    const health = raw.health;
    const maxHealth = raw.maxHealth;
    if (
      typeof nid !== "number" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      typeof yaw !== "number" ||
      typeof serverTick !== "number" ||
      typeof health !== "number" ||
      typeof maxHealth !== "number"
    ) {
      return null;
    }
    return {
      nid,
      x,
      y,
      z,
      yaw,
      serverTick,
      health,
      maxHealth
    };
  }
}
