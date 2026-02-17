import { toPlatformLocal } from "../platforms";

export interface GroundingPlatformShape {
  pid: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}

const BASE_VERTICAL_TOLERANCE = 0.25;
const PREFERRED_VERTICAL_TOLERANCE = 0.45;
const MAX_BELOW_TOP_TOLERANCE = 0.2;

export function findGroundedPlatformPid(options: {
  bodyX: number;
  bodyY: number;
  bodyZ: number;
  preferredPid: number | null;
  playerCapsuleHalfHeight: number;
  playerCapsuleRadius: number;
  queryNearbyPlatformPids: (
    centerX: number,
    centerZ: number,
    halfX: number,
    halfZ: number,
    output: number[]
  ) => void;
  resolvePlatformByPid: (pid: number) => GroundingPlatformShape | undefined;
  queryScratch: number[];
}): number | null {
  const footY = options.bodyY - (options.playerCapsuleHalfHeight + options.playerCapsuleRadius);
  const horizontalMargin = options.playerCapsuleRadius * 0.75;

  options.queryNearbyPlatformPids(
    options.bodyX,
    options.bodyZ,
    horizontalMargin,
    horizontalMargin,
    options.queryScratch
  );

  if (options.preferredPid !== null && !options.queryScratch.includes(options.preferredPid)) {
    options.queryScratch.push(options.preferredPid);
    options.queryScratch.sort((a, b) => a - b);
  }

  let selectedPid: number | null = null;
  let closestVerticalGapAbs = Number.POSITIVE_INFINITY;

  for (const platformPid of options.queryScratch) {
    const platform = options.resolvePlatformByPid(platformPid);
    if (!platform) {
      continue;
    }

    const local = toPlatformLocal(platform, options.bodyX, options.bodyZ);
    const withinX = Math.abs(local.x) <= platform.halfX + horizontalMargin;
    const withinZ = Math.abs(local.z) <= platform.halfZ + horizontalMargin;
    if (!withinX || !withinZ) {
      continue;
    }

    const topY = platform.y + platform.halfY;
    const signedGap = footY - topY;
    if (signedGap < -MAX_BELOW_TOP_TOLERANCE) {
      continue;
    }

    const maxGap =
      options.preferredPid !== null && platform.pid === options.preferredPid
        ? PREFERRED_VERTICAL_TOLERANCE
        : BASE_VERTICAL_TOLERANCE;
    if (signedGap > maxGap) {
      continue;
    }

    const gapAbs = Math.abs(signedGap);
    if (gapAbs >= closestVerticalGapAbs) {
      continue;
    }

    closestVerticalGapAbs = gapAbs;
    selectedPid = platform.pid;
  }

  return selectedPid;
}
