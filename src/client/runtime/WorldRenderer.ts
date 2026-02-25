// Renderer facade that applies frame snapshots to world visuals and audio systems.
import { Vector3 } from "three";
import { AudioEngine } from "./audio/AudioEngine";
import type { RenderFrameSnapshot } from "./types";
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

  public triggerLocalMeleePunch(): void {
    this.localCharacter.triggerLocalMeleePunch();
  }

  public apply(snapshot: RenderFrameSnapshot): void {
    this.localPlayerNid = typeof snapshot.localPlayerNid === "number" ? snapshot.localPlayerNid : null;
    this.localCharacter.syncLocalPlayer(snapshot.localPose, {
      frameDeltaSeconds: snapshot.frameDeltaSeconds,
      grounded: snapshot.localGrounded,
      movementMode: snapshot.localMovementMode
    });
    this.remoteCharacters.syncRemotePlayers(snapshot.remotePlayers, snapshot.frameDeltaSeconds);
    this.audioEventBridge.applyAbilityUseEvents(snapshot.abilityUseEvents);
    this.worldEntities.syncPlatforms(snapshot.platforms);
    this.worldEntities.syncTrainingDummies(snapshot.trainingDummies);
    this.projectileVisuals.syncProjectiles(snapshot.projectiles, snapshot.frameDeltaSeconds);
    this.environment.render(snapshot.localPose, snapshot.renderServerTimeSeconds);
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
