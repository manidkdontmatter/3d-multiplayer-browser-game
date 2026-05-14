import { SFX_HIT_ASSET_ID } from "../../assets/assetManifest";

export interface AudioEventConfig {
  readonly id: "melee.punch.hit";
  readonly assetId: string;
  readonly volume: number;
  readonly minIntervalMs: number;
  readonly group: "melee";
  readonly maxGroupVoices: number;
  readonly refDistance: number;
  readonly maxDistance: number;
  readonly rolloffFactor: number;
}

export const AUDIO_EVENT_CATALOG: Readonly<Record<AudioEventConfig["id"], AudioEventConfig>> =
  Object.freeze({
    "melee.punch.hit": Object.freeze({
      id: "melee.punch.hit",
      assetId: SFX_HIT_ASSET_ID,
      volume: 0.9,
      minIntervalMs: 50,
      group: "melee",
      maxGroupVoices: 6,
      refDistance: 2.2,
      maxDistance: 32,
      rolloffFactor: 1
    })
  });

export type AudioEventId = keyof typeof AUDIO_EVENT_CATALOG;
