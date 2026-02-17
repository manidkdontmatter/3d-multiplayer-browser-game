import RAPIER from "@dimforge/rapier3d-compat";
import type { ChannelAABB3D } from "nengi";
import {
  applyPlatformCarry,
  findGroundedPlatformPid,
  NType,
  PLATFORM_DEFINITIONS,
  PlatformSpatialIndex,
  PLAYER_CAPSULE_HALF_HEIGHT,
  PLAYER_CAPSULE_RADIUS,
  samplePlatformTransform,
  normalizeYaw
} from "../../shared/index";

type PlatformEntity = {
  nid: number;
  ntype: NType.PlatformEntity;
  pid: number;
  kind: 1 | 2;
  x: number;
  y: number;
  z: number;
  yaw: number;
  serverTick: number;
  halfX: number;
  halfY: number;
  halfZ: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  prevYaw: number;
  definition: (typeof PLATFORM_DEFINITIONS)[number];
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
};

type PlatformCarry = { x: number; y: number; z: number; yaw: number };

export interface PlatformCarryActor {
  grounded: boolean;
  groundedPlatformPid: number | null;
  body: RAPIER.RigidBody;
}

export interface PlatformSystemOptions {
  readonly world: RAPIER.World;
  readonly spatialChannel: ChannelAABB3D;
  readonly getTickNumber: () => number;
}

export class PlatformSystem {
  private readonly platformsByPid = new Map<number, PlatformEntity>();
  private readonly platformSpatialIndex = new PlatformSpatialIndex();
  private readonly platformQueryScratch: number[] = [];

  public constructor(private readonly options: PlatformSystemOptions) {}

  public initializePlatforms(): void {
    for (const definition of PLATFORM_DEFINITIONS) {
      const pose = samplePlatformTransform(definition, 0);
      const body = this.options.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pose.x, pose.y, pose.z)
      );
      const collider = this.options.world.createCollider(
        RAPIER.ColliderDesc.cuboid(definition.halfX, definition.halfY, definition.halfZ),
        body
      );

      const platform: PlatformEntity = {
        nid: 0,
        ntype: NType.PlatformEntity,
        pid: definition.pid,
        kind: definition.kind,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        serverTick: this.options.getTickNumber(),
        halfX: definition.halfX,
        halfY: definition.halfY,
        halfZ: definition.halfZ,
        prevX: pose.x,
        prevY: pose.y,
        prevZ: pose.z,
        prevYaw: pose.yaw,
        definition,
        body,
        collider
      };
      this.platformsByPid.set(platform.pid, platform);
      this.options.spatialChannel.addEntity(platform);
    }
    this.rebuildPlatformSpatialIndex();
  }

  public updatePlatforms(previousElapsedSeconds: number, elapsedSeconds: number): void {
    for (const platform of this.platformsByPid.values()) {
      const previousPose = samplePlatformTransform(platform.definition, previousElapsedSeconds);
      const currentPose = samplePlatformTransform(platform.definition, elapsedSeconds);
      platform.prevX = previousPose.x;
      platform.prevY = previousPose.y;
      platform.prevZ = previousPose.z;
      platform.prevYaw = previousPose.yaw;
      platform.x = currentPose.x;
      platform.y = currentPose.y;
      platform.z = currentPose.z;
      platform.yaw = currentPose.yaw;
      platform.serverTick = this.options.getTickNumber();

      platform.body.setTranslation({ x: platform.x, y: platform.y, z: platform.z }, true);
      platform.body.setRotation(
        { x: 0, y: Math.sin(platform.yaw * 0.5), z: 0, w: Math.cos(platform.yaw * 0.5) },
        true
      );
    }
    this.rebuildPlatformSpatialIndex();
  }

  public samplePlayerPlatformCarry(player: PlatformCarryActor): PlatformCarry {
    if (!player.grounded || player.groundedPlatformPid === null) {
      return { x: 0, y: 0, z: 0, yaw: 0 };
    }

    const platform = this.platformsByPid.get(player.groundedPlatformPid);
    if (!platform) {
      player.groundedPlatformPid = null;
      return { x: 0, y: 0, z: 0, yaw: 0 };
    }

    const bodyPos = player.body.translation();
    const carried = applyPlatformCarry(
      { x: platform.prevX, y: platform.prevY, z: platform.prevZ, yaw: platform.prevYaw },
      { x: platform.x, y: platform.y, z: platform.z, yaw: platform.yaw },
      { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z }
    );

    return {
      x: carried.x - bodyPos.x,
      y: carried.y - bodyPos.y,
      z: carried.z - bodyPos.z,
      yaw: normalizeYaw(platform.yaw - platform.prevYaw)
    };
  }

  public findGroundedPlatformPid(
    bodyX: number,
    bodyY: number,
    bodyZ: number,
    preferredPid: number | null
  ): number | null {
    return findGroundedPlatformPid({
      bodyX,
      bodyY,
      bodyZ,
      preferredPid,
      playerCapsuleHalfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
      playerCapsuleRadius: PLAYER_CAPSULE_RADIUS,
      queryNearbyPlatformPids: (centerX, centerZ, halfX, halfZ, output) =>
        this.platformSpatialIndex.queryAabb(centerX, centerZ, halfX, halfZ, output),
      resolvePlatformByPid: (pid) => this.platformsByPid.get(pid),
      queryScratch: this.platformQueryScratch
    });
  }

  private rebuildPlatformSpatialIndex(): void {
    this.platformSpatialIndex.clear();
    for (const platform of this.platformsByPid.values()) {
      this.platformSpatialIndex.insert({
        pid: platform.pid,
        x: platform.x,
        z: platform.z,
        halfX: platform.halfX,
        halfZ: platform.halfZ
      });
    }
  }
}
