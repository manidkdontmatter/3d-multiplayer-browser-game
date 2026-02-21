import {
  MODEL_ID_PLATFORM_LINEAR,
  MODEL_ID_PLATFORM_ROTATING,
  PLATFORM_DEFINITIONS,
  samplePlatformTransform
} from "../../shared/index";
import type { PlatformState } from "./types";

const PLATFORM_MODEL_ID_BY_KIND: Record<1 | 2, number> = {
  1: MODEL_ID_PLATFORM_LINEAR,
  2: MODEL_ID_PLATFORM_ROTATING
};

export class DeterministicPlatformTimeline {
  public sampleStates(serverTimeSeconds: number): PlatformState[] {
    const states: PlatformState[] = [];
    const time = Number.isFinite(serverTimeSeconds) ? Math.max(0, serverTimeSeconds) : 0;
    for (const definition of PLATFORM_DEFINITIONS) {
      const pose = samplePlatformTransform(definition, time);
      states.push({
        nid: definition.pid,
        modelId: PLATFORM_MODEL_ID_BY_KIND[definition.kind],
        x: pose.x,
        y: pose.y,
        z: pose.z,
        rotation: {
          x: 0,
          y: Math.sin(pose.yaw * 0.5),
          z: 0,
          w: Math.cos(pose.yaw * 0.5)
        }
      });
    }
    return states;
  }
}

