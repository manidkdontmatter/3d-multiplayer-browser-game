/**
 * Purpose: This file defines world state, world helpers, or world orchestration behavior, and turns server-auth state into visible world rendering output.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { Vector3 } from "three";
import type { ClientLocalSettings, GraphicsPreset } from "../../shared";
import { AudioEngine } from "./audio/AudioEngine";
import type { RenderFrameSnapshot } from "./types";
import { AudioEventBridge } from "./rendering/AudioEventBridge";
import { LocalCharacterVisualSystem } from "./rendering/LocalCharacterVisualSystem";
import { ProjectileVisualSystem } from "./rendering/ProjectileVisualSystem";
import { RemoteCharacterVisualSystem } from "./rendering/RemoteCharacterVisualSystem";
import { WorldEntityVisualSystem } from "./rendering/WorldEntityVisualSystem";
import { WorldEnvironment } from "./rendering/WorldEnvironment";

export interface WorldRendererOptions {
  clientLocalSettings?: ClientLocalSettings;
}

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

  public constructor(canvas: HTMLCanvasElement, options: WorldRendererOptions = {}) {
    this.environment = new WorldEnvironment(canvas, {
      clientLocalSettings: options.clientLocalSettings
    });
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

  public setFieldOfView(fieldOfView: number): void {
    this.environment.setFieldOfView(fieldOfView);
  }

  public setGraphicsPreset(preset: GraphicsPreset): void {
    this.environment.setGraphicsPreset(preset);
  }

  public triggerLocalMeleePunch(): void {
    this.localCharacter.triggerLocalMeleePunch();
  }

  public apply(snapshot: RenderFrameSnapshot): void {
    this.localPlayerNid = typeof snapshot.localPlayerNid === "number" ? snapshot.localPlayerNid : null;
    this.localCharacter.syncLocalPlayer(snapshot.localPose, {
      frameDeltaSeconds: snapshot.frameDeltaSeconds,
      grounded: snapshot.localGrounded,
      movementMode: snapshot.localMovementMode,
      equippedWeaponArchetypeId: snapshot.localEquippedWeaponArchetypeId,
      equippedWeaponTintColorRgb: snapshot.localEquippedWeaponTintColorRgb,
      equippedHeadArchetypeId: snapshot.localEquippedHeadArchetypeId,
      equippedHeadTintColorRgb: snapshot.localEquippedHeadTintColorRgb,
      equippedBodyArchetypeId: snapshot.localEquippedBodyArchetypeId,
      equippedBodyTintColorRgb: snapshot.localEquippedBodyTintColorRgb,
      equippedLegsArchetypeId: snapshot.localEquippedLegsArchetypeId,
      equippedLegsTintColorRgb: snapshot.localEquippedLegsTintColorRgb,
      equippedAccessoryArchetypeId: snapshot.localEquippedAccessoryArchetypeId,
      equippedAccessoryTintColorRgb: snapshot.localEquippedAccessoryTintColorRgb
    });
    this.remoteCharacters.syncRemotePlayers(snapshot.remotePlayers, snapshot.frameDeltaSeconds);
    this.audioEventBridge.applyAbilityUseEvents(snapshot.abilityUseEvents);
    this.worldEntities.syncLocationRoots(snapshot.locationRoots, snapshot.frameDeltaSeconds);
    this.worldEntities.syncWorldEntities(snapshot.worldEntities);
    this.projectileVisuals.syncProjectiles(snapshot.projectiles, snapshot.frameDeltaSeconds);
    this.environment.render(
      snapshot.localPose,
      snapshot.renderServerTimeSeconds,
      snapshot.locationRoots
    );
  }

  public getForwardDirection(): Vector3 {
    return this.environment.getForwardDirection();
  }

  public getRenderedLocationRootByLocationPid(locationPid: number): {
    x: number;
    y: number;
    z: number;
    rotation: { x: number; y: number; z: number; w: number };
  } | null {
    return this.worldEntities.getRenderedLocationRootByLocationPid(locationPid);
  }

  public getRenderedLocationFrameSnapshot(): ReadonlyMap<
    number,
    { x: number; y: number; z: number; rotation: { x: number; y: number; z: number; w: number } }
  > {
    return this.worldEntities.getRenderedLocationFrameSnapshot();
  }

  public getLocationPresentationTuning(): {
    enabled: boolean;
    smoothRate: number;
    snapDistance: number;
    snapDot: number;
  } {
    return this.worldEntities.getLocationPresentationTuning();
  }

  public setLocationPresentationTuning(
    tuning: Partial<{ enabled: boolean; smoothRate: number; snapDistance: number; snapDot: number }>
  ): void {
    this.worldEntities.setLocationPresentationTuning(tuning);
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
