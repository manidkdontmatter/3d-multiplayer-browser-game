import {
  Audio,
  AudioListener,
  Object3D,
  PositionalAudio,
  Vector3,
  type Camera,
  type Scene
} from "three";
import { ensureAsset, getLoadedAsset } from "../../assets/assetLoader";
import { AUDIO_EVENT_CATALOG, type AudioEventConfig, type AudioEventId } from "./audioEventCatalog";

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface ActiveVoice {
  readonly startedAtMs: number;
  readonly eventId: AudioEventId;
  readonly group: AudioEventConfig["group"];
  readonly distanceSq: number;
  readonly stop: () => void;
}

const MAX_ACTIVE_VOICES = 14;
const MASTER_GAIN = 1.0;
const SFX_GAIN = 1.0;

export class AudioEngine {
  private readonly listener: AudioListener;
  private readonly listenerWorldPosition = new Vector3();
  private readonly activeVoices = new Set<ActiveVoice>();
  private readonly recentPlayByKey = new Map<string, number>();
  private readonly pendingAssetRequests = new Map<string, number>();
  private disposed = false;
  private unlocked = false;
  private readonly unlockHandler = () => {
    this.unlock();
  };

  public constructor(
    private readonly camera: Camera,
    private readonly scene: Scene
  ) {
    this.listener = new AudioListener();
    this.camera.add(this.listener);
    this.listener.setMasterVolume(MASTER_GAIN * SFX_GAIN);
    window.addEventListener("pointerdown", this.unlockHandler, { passive: true });
    window.addEventListener("keydown", this.unlockHandler, { passive: true });
    window.addEventListener("touchstart", this.unlockHandler, { passive: true });
  }

  public play3D(eventId: AudioEventId, position: Vec3Like, dedupKey?: string): void {
    if (this.disposed) {
      return;
    }
    const config = AUDIO_EVENT_CATALOG[eventId];
    const now = performance.now();
    const gateKey = `${eventId}:${dedupKey ?? "once"}`;
    if (!this.canPlay(config, gateKey, now)) {
      return;
    }
    const buffer = this.getBuffer(config.assetId);
    if (!buffer) {
      this.maybeRequestAsset(config.assetId);
      this.playFallbackPulse(position);
      return;
    }

    this.ensureUnlocked();
    const distanceSq = this.getDistanceSqToListener(position);
    if (!this.reserveVoice(config, distanceSq)) {
      return;
    }

    const emitter = new Object3D();
    emitter.position.set(position.x, position.y, position.z);
    const sound = new PositionalAudio(this.listener);
    emitter.add(sound);
    this.scene.add(emitter);
    sound.setBuffer(buffer);
    sound.setVolume(config.volume);
    sound.setRefDistance(config.refDistance);
    sound.setMaxDistance(config.maxDistance);
    sound.setRolloffFactor(config.rolloffFactor);
    sound.setDistanceModel("inverse");
    sound.setLoop(false);

    const cleanup = () => {
      sound.onEnded = () => {};
      if (sound.isPlaying) {
        sound.stop();
      }
      emitter.remove(sound);
      this.scene.remove(emitter);
      this.activeVoices.delete(voice);
    };
    const voice: ActiveVoice = {
      startedAtMs: now,
      eventId,
      group: config.group,
      distanceSq,
      stop: cleanup
    };
    this.activeVoices.add(voice);
    sound.onEnded = cleanup;
    try {
      sound.play();
    } catch {
      cleanup();
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.teardownUnlockHooks();
    for (const voice of Array.from(this.activeVoices)) {
      voice.stop();
    }
    this.activeVoices.clear();
    this.recentPlayByKey.clear();
    this.camera.remove(this.listener);
  }

  private ensureUnlocked(): void {
    if (this.disposed || this.unlocked) {
      return;
    }
    void this.unlock();
  }

  private async unlock(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const context = this.listener.context;
    if (context.state === "running") {
      this.unlocked = true;
      this.teardownUnlockHooks();
      return;
    }
    try {
      await context.resume();
      this.unlocked = true;
      this.teardownUnlockHooks();
    } catch {
      // Keep waiting for the next user gesture.
    }
  }

  private teardownUnlockHooks(): void {
    window.removeEventListener("pointerdown", this.unlockHandler);
    window.removeEventListener("keydown", this.unlockHandler);
    window.removeEventListener("touchstart", this.unlockHandler);
  }

  private canPlay(config: AudioEventConfig, gateKey: string, now: number): boolean {
    const lastPlayedAt = this.recentPlayByKey.get(gateKey);
    if (typeof lastPlayedAt === "number" && now - lastPlayedAt < config.minIntervalMs) {
      return false;
    }
    this.recentPlayByKey.set(gateKey, now);
    this.pruneDedupCache(now);
    return true;
  }

  private pruneDedupCache(now: number): void {
    if (this.recentPlayByKey.size <= 512) {
      return;
    }
    for (const [key, timestamp] of this.recentPlayByKey) {
      if (now - timestamp > 4_000) {
        this.recentPlayByKey.delete(key);
      }
    }
  }

  private reserveVoice(config: AudioEventConfig, distanceSq: number): boolean {
    const groupVoices = Array.from(this.activeVoices).filter((voice) => voice.group === config.group);
    if (groupVoices.length >= config.maxGroupVoices) {
      const dropCandidate = this.pickDropCandidate(groupVoices);
      if (!dropCandidate) {
        return false;
      }
      dropCandidate.stop();
    } else if (this.activeVoices.size >= MAX_ACTIVE_VOICES) {
      const dropCandidate = this.pickDropCandidate(Array.from(this.activeVoices));
      if (!dropCandidate) {
        return false;
      }
      if (dropCandidate.distanceSq < distanceSq) {
        return false;
      }
      dropCandidate.stop();
    }
    return true;
  }

  private pickDropCandidate(pool: ActiveVoice[]): ActiveVoice | null {
    if (pool.length === 0) {
      return null;
    }
    let candidate: ActiveVoice | null = null;
    for (const voice of pool) {
      if (!candidate) {
        candidate = voice;
        continue;
      }
      if (voice.distanceSq > candidate.distanceSq) {
        candidate = voice;
        continue;
      }
      if (voice.distanceSq === candidate.distanceSq && voice.startedAtMs < candidate.startedAtMs) {
        candidate = voice;
      }
    }
    return candidate;
  }

  private getDistanceSqToListener(position: Vec3Like): number {
    this.camera.getWorldPosition(this.listenerWorldPosition);
    const dx = position.x - this.listenerWorldPosition.x;
    const dy = position.y - this.listenerWorldPosition.y;
    const dz = position.z - this.listenerWorldPosition.z;
    return dx * dx + dy * dy + dz * dz;
  }

  private getBuffer(assetId: string): AudioBuffer | null {
    const loaded = getLoadedAsset(assetId);
    return loaded instanceof AudioBuffer ? loaded : null;
  }

  private maybeRequestAsset(assetId: string): void {
    const now = performance.now();
    const lastAttemptAt = this.pendingAssetRequests.get(assetId);
    if (typeof lastAttemptAt === "number" && now - lastAttemptAt < 1200) {
      return;
    }
    this.pendingAssetRequests.set(assetId, now);
    void ensureAsset(assetId, "near").catch(() => {
      // Keep fallback pulse behavior if the request fails.
    });
  }

  private playFallbackPulse(position: Vec3Like): void {
    if (this.disposed) {
      return;
    }
    this.ensureUnlocked();
    const context = this.listener.context;
    if (context.state !== "running") {
      return;
    }
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    const panner = context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 2.2;
    panner.maxDistance = 32;
    panner.rolloffFactor = 1;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    const osc = context.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 150;
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.listener.getInput());
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.start(now);
    osc.stop(now + 0.095);
  }
}
