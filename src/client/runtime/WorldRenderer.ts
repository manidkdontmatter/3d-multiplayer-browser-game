import { Vector3 } from "three";
import { AudioEngine } from "./audio/AudioEngine";
import type {
  AbilityUseEvent,
  PlayerPose,
  PlatformState,
  ProjectileState,
  RemotePlayerState,
  TrainingDummyState
} from "./types";
import { AudioEventBridge } from "./rendering/AudioEventBridge";
import { LocalCharacterVisualSystem } from "./rendering/LocalCharacterVisualSystem";
import { ProjectileVisualSystem } from "./rendering/ProjectileVisualSystem";
import { RemoteCharacterVisualSystem } from "./rendering/RemoteCharacterVisualSystem";
import { WorldEntityVisualSystem } from "./rendering/WorldEntityVisualSystem";
import { WorldEnvironment } from "./rendering/WorldEnvironment";

export class WorldRenderer {
  private readonly environment: WorldEnvironment;
  private readonly audio: AudioEngine;
  private readonly projectileVisuals: ProjectileVisualSystem;
  private readonly worldEntities: WorldEntityVisualSystem;
  private readonly remoteCharacters: RemoteCharacterVisualSystem;
  private readonly localCharacter: LocalCharacterVisualSystem;
  private readonly audioEventBridge: AudioEventBridge;
  private disposed = false;
  private localPlayerNid: number | null = null;

  public constructor(canvas: HTMLCanvasElement) {
    this.environment = new WorldEnvironment(canvas);
    this.audio = new AudioEngine(this.environment.camera, this.environment.scene);
    this.projectileVisuals = new ProjectileVisualSystem(this.environment.scene);
    this.worldEntities = new WorldEntityVisualSystem(this.environment.scene);
    this.remoteCharacters = new RemoteCharacterVisualSystem(this.environment.scene);
    this.localCharacter = new LocalCharacterVisualSystem(this.environment.scene);
    this.audioEventBridge = new AudioEventBridge({
      audio: this.audio,
      getLocalPlayerNid: () => this.localPlayerNid,
      getLocalPlayerSource: () => this.localCharacter.getPlayerPosition(),
      getRemotePlayerSource: (ownerNid) => this.remoteCharacters.getPlayerPosition(ownerNid),
      onRemoteMeleeTriggered: (ownerNid) => this.remoteCharacters.triggerMeleeForOwner(ownerNid)
    });
  }

  public resize(width: number, height: number): void {
    this.environment.resize(width, height);
  }

  public syncRemotePlayers(players: RemotePlayerState[], frameDeltaSeconds: number): void {
    this.remoteCharacters.syncRemotePlayers(players, frameDeltaSeconds);
  }

  public syncLocalPlayer(localPose: PlayerPose, options: { frameDeltaSeconds: number; grounded: boolean }): void {
    this.localCharacter.syncLocalPlayer(localPose, options);
  }

  public setLocalPlayerNid(nid: number | null): void {
    this.localPlayerNid = typeof nid === "number" ? nid : null;
  }

  public triggerLocalMeleePunch(): void {
    this.localCharacter.triggerLocalMeleePunch();
  }

  public applyAbilityUseEvents(events: AbilityUseEvent[]): void {
    this.audioEventBridge.applyAbilityUseEvents(events);
  }

  public syncPlatforms(platformStates: PlatformState[]): void {
    this.worldEntities.syncPlatforms(platformStates);
  }

  public syncProjectiles(projectiles: ProjectileState[], frameDeltaSeconds = 1 / 60): void {
    this.projectileVisuals.syncProjectiles(projectiles, frameDeltaSeconds);
  }

  public syncTrainingDummies(dummies: TrainingDummyState[]): void {
    this.worldEntities.syncTrainingDummies(dummies);
  }

  public render(localPose: PlayerPose): void {
    this.environment.render(localPose);
  }

  public getForwardDirection(): Vector3 {
    return this.environment.getForwardDirection();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.audio.dispose();
    this.projectileVisuals.dispose();
    this.worldEntities.dispose();
    this.remoteCharacters.dispose();
    this.localCharacter.dispose();
    this.environment.dispose();
  }
}
