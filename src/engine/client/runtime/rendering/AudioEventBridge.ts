import { PLAYER_EYE_HEIGHT } from "../../../shared/index";
import type { AbilityUseEvent } from "../types";
import type { AudioEngine } from "../audio/AudioEngine";

export interface AudioEventSource {
  x: number;
  y: number;
  z: number;
}

export interface AudioEventBridgeOptions {
  audio: AudioEngine;
  getLocalPlayerNid: () => number | null;
  getLocalPlayerSource: () => AudioEventSource | null;
  getRemotePlayerSource: (ownerNid: number) => AudioEventSource | null;
  onRemoteMeleeTriggered: (ownerNid: number) => void;
}

export class AudioEventBridge {
  public constructor(private readonly options: AudioEventBridgeOptions) {}

  public applyAbilityUseEvents(events: AbilityUseEvent[]): void {
    for (const event of events) {
      if (event.category !== "melee") {
        continue;
      }
      const localPlayerNid = this.options.getLocalPlayerNid();
      const isLocalOwner = localPlayerNid !== null && event.ownerNid === localPlayerNid;
      if (!isLocalOwner) {
        this.options.onRemoteMeleeTriggered(event.ownerNid);
      }

      const source = isLocalOwner
        ? this.options.getLocalPlayerSource()
        : this.options.getRemotePlayerSource(event.ownerNid);
      if (!source) {
        continue;
      }

      this.options.audio.play3D(
        "melee.punch.hit",
        {
          x: source.x,
          y: source.y + PLAYER_EYE_HEIGHT * 0.55,
          z: source.z
        },
        `${event.category}:${event.ownerNid}:${event.abilityId}:${event.serverTick}`
      );
    }
  }
}
