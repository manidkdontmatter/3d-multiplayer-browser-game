// Shared deterministic ocean sampling used by server authority and client rendering/prediction.
import type { RuntimeMapConfig } from "./world";

export const OCEAN_BUOYANCY_ACCEL = 15;
export const OCEAN_VERTICAL_DRAG = 1.6;

const WAVE_COMPONENTS = [
  { dirX: 0.92, dirZ: 0.38, ampMul: 1.0, speedMul: 1.0, lengthMul: 1.35, phase: 0.7, crestMul: 0.12 },
  { dirX: -0.51, dirZ: 0.86, ampMul: 0.46, speedMul: 1.16, lengthMul: 1.05, phase: 2.1, crestMul: 0.14 },
  { dirX: 0.17, dirZ: -0.98, ampMul: 0.18, speedMul: 1.32, lengthMul: 0.88, phase: 4.0, crestMul: 0.18 }
] as const;

export function sampleOceanHeightAt(
  mapConfig: RuntimeMapConfig,
  x: number,
  z: number,
  timeSeconds: number
): number {
  const amplitude = Math.max(0, mapConfig.oceanWaveAmplitude);
  if (amplitude <= 0) {
    return mapConfig.oceanBaseHeight;
  }
  const waveSpeed = Math.max(0, mapConfig.oceanWaveSpeed);
  const baseLength = Math.max(1, mapConfig.oceanWaveLength);
  let wave = 0;

  for (const component of WAVE_COMPONENTS) {
    const wavelength = Math.max(1, baseLength * component.lengthMul);
    const k = (Math.PI * 2) / wavelength;
    const omega = k * waveSpeed * component.speedMul;
    const projection = x * component.dirX + z * component.dirZ;
    const phase = projection * k + timeSeconds * omega + component.phase;
    const primary = Math.sin(phase);
    const crest = Math.sin(phase * 2 + component.phase * 0.37) * component.crestMul;
    wave += (primary + crest) * amplitude * component.ampMul;
  }

  return mapConfig.oceanBaseHeight + wave;
}
