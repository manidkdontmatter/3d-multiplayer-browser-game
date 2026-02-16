import {
  AdditiveAnimationBlendMode,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Object3D
} from "three";

export interface CharacterAnimationClips {
  idle: AnimationClip;
  walk: AnimationClip;
  run: AnimationClip;
  jump: AnimationClip;
  punchUpperBodyAdditive: AnimationClip;
}

export interface CharacterAnimationParams {
  horizontalSpeed: number;
  verticalSpeed: number;
  grounded: boolean;
  sprinting: boolean;
}

const WALK_ENTER_SPEED = 0.22;
const RUN_ENTER_SPEED = 4.1;
const WALK_REFERENCE_SPEED = 2.35;
const RUN_REFERENCE_SPEED = 6.35;
const LOCOMOTION_FADE_SECONDS = 0.16;
const JUMP_ENTER_VERTICAL_SPEED = 1.1;
const MIN_UPDATE_STEP = 1 / 240;
const MAX_UPDATE_STEP = 1 / 20;

type LocomotionState = "idle" | "walk" | "run" | "jump";

export class CharacterAnimationController {
  private readonly mixer: AnimationMixer;
  private readonly actions: {
    idle: AnimationAction;
    walk: AnimationAction;
    run: AnimationAction;
    jump: AnimationAction;
    punch: AnimationAction;
  };
  private locomotionState: LocomotionState = "idle";
  private groundedLastFrame = true;

  public constructor(root: Object3D, clips: CharacterAnimationClips) {
    this.mixer = new AnimationMixer(root);
    this.actions = {
      idle: this.configureBaseAction(this.mixer.clipAction(clips.idle)),
      walk: this.configureBaseAction(this.mixer.clipAction(clips.walk)),
      run: this.configureBaseAction(this.mixer.clipAction(clips.run)),
      jump: this.configureJumpAction(this.mixer.clipAction(clips.jump)),
      punch: this.configurePunchAction(this.mixer.clipAction(clips.punchUpperBodyAdditive))
    };

    // Keep locomotion actions running and blend by weight.
    this.actions.idle.enabled = true;
    this.actions.walk.enabled = true;
    this.actions.run.enabled = true;
    this.actions.idle.enabled = true;
    this.actions.idle.setEffectiveWeight(1);
    this.actions.walk.setEffectiveWeight(0);
    this.actions.run.setEffectiveWeight(0);
    this.actions.idle.play();
    this.actions.walk.play();
    this.actions.run.play();
  }

  public dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }

  public triggerPunch(): void {
    const action = this.actions.punch;
    action.enabled = true;
    action.reset();
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);
    action.fadeIn(0.04);
    action.play();
  }

  public update(deltaSeconds: number, params: CharacterAnimationParams): void {
    const dt = Math.max(MIN_UPDATE_STEP, Math.min(MAX_UPDATE_STEP, deltaSeconds));
    const targetState = this.resolveLocomotionState(params);
    if (targetState !== this.locomotionState) {
      this.transitionTo(targetState);
      this.locomotionState = targetState;
    }
    this.updateLocomotionSpeedScaling(params.horizontalSpeed);
    this.groundedLastFrame = params.grounded;
    this.mixer.update(dt);
  }

  private resolveLocomotionState(params: CharacterAnimationParams): LocomotionState {
    const airborne = !params.grounded;
    if (airborne) {
      return "jump";
    }

    if (!this.groundedLastFrame && params.grounded) {
      return "idle";
    }

    if (params.verticalSpeed > JUMP_ENTER_VERTICAL_SPEED) {
      return "jump";
    }
    if (params.horizontalSpeed >= RUN_ENTER_SPEED && params.sprinting) {
      return "run";
    }
    if (params.horizontalSpeed >= WALK_ENTER_SPEED) {
      return "walk";
    }
    return "idle";
  }

  private transitionTo(next: LocomotionState): void {
    const from = this.actions[this.locomotionState];
    const to = this.actions[next];
    if (from === to) {
      return;
    }

    if (next === "jump") {
      to.enabled = true;
      to.reset();
      to.setEffectiveWeight(1);
      to.setEffectiveTimeScale(1);
      to.fadeIn(0.06);
      to.play();
      from.fadeOut(0.08);
      return;
    }

    to.enabled = true;
    to.setEffectiveWeight(1);
    to.setEffectiveTimeScale(1);
    to.fadeIn(LOCOMOTION_FADE_SECONDS);
    to.play();
    from.fadeOut(LOCOMOTION_FADE_SECONDS);
  }

  private updateLocomotionSpeedScaling(horizontalSpeed: number): void {
    this.actions.walk.timeScale = this.clamp(horizontalSpeed / WALK_REFERENCE_SPEED, 0.75, 1.3);
    this.actions.run.timeScale = this.clamp(horizontalSpeed / RUN_REFERENCE_SPEED, 0.8, 1.35);
  }

  private configureBaseAction(action: AnimationAction): AnimationAction {
    action.setLoop(LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.enabled = false;
    action.setEffectiveWeight(0);
    action.setEffectiveTimeScale(1);
    return action;
  }

  private configureJumpAction(action: AnimationAction): AnimationAction {
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = false;
    action.setEffectiveWeight(0);
    action.setEffectiveTimeScale(1);
    return action;
  }

  private configurePunchAction(action: AnimationAction): AnimationAction {
    action.blendMode = AdditiveAnimationBlendMode;
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = false;
    action.enabled = false;
    action.setEffectiveWeight(0);
    action.setEffectiveTimeScale(1);
    action.fadeOut(0.16);
    return action;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

const UPPER_BODY_BONE_PATTERN =
  /(Spine|spine_|Chest|Neck|neck_|Head|Shoulder|clavicle|Arm|arm_|ForeArm|lowerarm|Hand|hand_|Thumb|thumb_|Index|index_|Middle|middle_|Ring|ring_|Pinky|pinky_)/i;

export function filterClipToUpperBody(source: AnimationClip): AnimationClip {
  const tracks = source.tracks.filter((track) => {
    const [nodePath] = track.name.split(".");
    if (!nodePath) {
      return false;
    }
    const normalized = nodePath.split("/").pop() ?? nodePath;
    return UPPER_BODY_BONE_PATTERN.test(normalized);
  });
  return new AnimationClip(source.name, source.duration, tracks);
}
