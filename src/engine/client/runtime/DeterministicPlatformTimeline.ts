/**
 * Purpose: This file handles deterministic moving platform data and runtime updates.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import {
  MODEL_ID_PLATFORM_LINEAR,
  MODEL_ID_PLATFORM_ROTATING,
  PLATFORM_DEFINITIONS,
  samplePlatformTransform
} from "../../shared/index";
import type { WorldEntityState } from "./types";

const PLATFORM_MODEL_ID_BY_KIND: Record<1 | 2, number> = {
  1: MODEL_ID_PLATFORM_LINEAR,
  2: MODEL_ID_PLATFORM_ROTATING
};

export class DeterministicPlatformTimeline {
  public sampleStates(serverTimeSeconds: number): WorldEntityState[] {
    const states: WorldEntityState[] = [];
    const time = Number.isFinite(serverTimeSeconds) ? Math.max(0, serverTimeSeconds) : 0;
    for (const definition of PLATFORM_DEFINITIONS) {
      const pose = samplePlatformTransform(definition, time);
      const yawHalfSin = Math.sin(pose.yaw * 0.5);
      const yawHalfCos = Math.cos(pose.yaw * 0.5);
      states.push({
        nid: definition.pid,
        modelId: PLATFORM_MODEL_ID_BY_KIND[definition.kind],
        x: pose.x,
        y: pose.y,
        z: pose.z,
        rotationX: 0,
        rotationY: yawHalfSin,
        rotationZ: 0,
        rotationW: yawHalfCos,
        health: 0,
        maxHealth: 0,
        itemArchetypeId: 0,
        itemQuantity: 0
      });
    }
    return states;
  }
}
