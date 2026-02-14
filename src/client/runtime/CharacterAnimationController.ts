import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Euler,
  LoopOnce,
  LoopRepeat,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack
} from "three";
import { PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from "../../shared/index";

export interface CharacterAnimationUpdateInput {
  deltaSeconds: number;
  horizontalSpeed: number;
  verticalSpeed: number;
  grounded: boolean;
  upperBodyAction: number;
  upperBodyActionNonce: number;
}

export interface CharacterAnimationControllerOptions {
  clips?: Partial<{
    idle: AnimationClip;
    walk: AnimationClip;
    run: AnimationClip;
    jump: AnimationClip;
    upperCast: AnimationClip;
  }>;
  rootMotion?: {
    defaultEnabled?: boolean;
    perClip?: Record<string, boolean>;
  };
}

type BoneOffsetTrack = Array<[x: number, y: number, z: number]>;

const PRIMARY_UPPER_BODY_ACTION_ID = 1;
const SPEED_SMOOTH_RATE = 10;
const ROOT_MOTION_BONE_NAMES = new Set(["root", "armature", "pelvis", "mixamorig:hips"]);
const UPPER_BODY_BONE_PREFIXES = [
  "spine_",
  "neck_",
  "head",
  "clavicle_",
  "upperarm_",
  "lowerarm_",
  "hand_",
  "thumb_",
  "index_",
  "middle_",
  "ring_",
  "pinky_"
];

export class CharacterAnimationController {
  private readonly mixer: AnimationMixer;
  private readonly bindPoseQuaternions = new Map<string, Quaternion>();
  private readonly tempEuler = new Euler(0, 0, 0, "XYZ");
  private readonly tempQuat = new Quaternion();
  private readonly composedQuat = new Quaternion();
  private readonly rootMotionDefaultEnabled: boolean;
  private readonly rootMotionPerClip: Readonly<Record<string, boolean>>;
  private readonly locomotionActions: {
    idle: AnimationAction;
    walk: AnimationAction;
    run: AnimationAction;
    jump: AnimationAction;
  };
  private readonly upperBodyActions = new Map<number, AnimationAction>();
  private smoothedHorizontalSpeed = 0;
  private lastUpperBodyActionNonce = 0;
  private activeUpperBodyAction: AnimationAction | null = null;

  public constructor(root: Object3D, options: CharacterAnimationControllerOptions = {}) {
    this.mixer = new AnimationMixer(root);
    this.rootMotionDefaultEnabled = options.rootMotion?.defaultEnabled ?? false;
    this.rootMotionPerClip = options.rootMotion?.perClip ?? {};
    this.captureBindPose(root);

    const clipOverrides = options.clips ?? {};
    const idleClip = clipOverrides.idle ?? this.makeIdleClip();
    const walkClip = clipOverrides.walk ?? this.makeWalkClip();
    const runClip = clipOverrides.run ?? this.makeRunClip();
    const jumpClip = clipOverrides.jump ?? this.makeJumpClip();
    const castClip = clipOverrides.upperCast ?? this.makeUpperBodyCastClip();
    const maskedCastClip = this.maskClipToUpperBody(castClip, "upperCast");

    this.locomotionActions = {
      idle: this.configureLoopingAction(idleClip, "idle"),
      walk: this.configureLoopingAction(walkClip, "walk"),
      run: this.configureLoopingAction(runClip, "run"),
      jump: this.configureLoopingAction(jumpClip, "jump")
    };

    this.locomotionActions.idle.setEffectiveWeight(1);
    this.locomotionActions.walk.setEffectiveWeight(0);
    this.locomotionActions.run.setEffectiveWeight(0);
    this.locomotionActions.jump.setEffectiveWeight(0);
    this.locomotionActions.walk.setEffectiveTimeScale(1);
    this.locomotionActions.run.setEffectiveTimeScale(1);

    const castAction = this.mixer.clipAction(this.applyRootMotionPolicy(maskedCastClip, "upperCast"));
    castAction.setLoop(LoopOnce, 1);
    castAction.clampWhenFinished = false;
    castAction.setEffectiveWeight(0);
    this.upperBodyActions.set(PRIMARY_UPPER_BODY_ACTION_ID, castAction);
  }

  public update(input: CharacterAnimationUpdateInput): void {
    const dt = this.clamp(input.deltaSeconds, 1 / 240, 1 / 20);
    this.updateLocomotion(input, dt);
    this.updateUpperBodyActions(input);
    this.mixer.update(dt);
    this.cleanupFinishedUpperBodyAction();
  }

  private updateLocomotion(input: CharacterAnimationUpdateInput, dt: number): void {
    const targetSpeed = Math.max(0, input.horizontalSpeed);
    const speedSmoothing = 1 - Math.exp(-SPEED_SMOOTH_RATE * dt);
    this.smoothedHorizontalSpeed += (targetSpeed - this.smoothedHorizontalSpeed) * speedSmoothing;

    if (!input.grounded) {
      this.locomotionActions.idle.setEffectiveWeight(0);
      this.locomotionActions.walk.setEffectiveWeight(0);
      this.locomotionActions.run.setEffectiveWeight(0);
      this.locomotionActions.jump.setEffectiveWeight(1);
      this.locomotionActions.jump.setEffectiveTimeScale(input.verticalSpeed >= 0 ? 1.05 : 0.9);
      return;
    }

    const moveBlend = this.clamp(
      (this.smoothedHorizontalSpeed - 0.15) / (PLAYER_WALK_SPEED - 0.15),
      0,
      1
    );
    const runBlend = this.clamp(
      (this.smoothedHorizontalSpeed - PLAYER_WALK_SPEED * 0.85) /
        (PLAYER_SPRINT_SPEED - PLAYER_WALK_SPEED * 0.85),
      0,
      1
    );
    const idleWeight = 1 - moveBlend;
    const walkWeight = moveBlend * (1 - runBlend);
    const runWeight = moveBlend * runBlend;

    this.locomotionActions.idle.setEffectiveWeight(idleWeight);
    this.locomotionActions.walk.setEffectiveWeight(walkWeight);
    this.locomotionActions.run.setEffectiveWeight(runWeight);
    this.locomotionActions.jump.setEffectiveWeight(0);

    const walkScale = this.clamp(this.smoothedHorizontalSpeed / PLAYER_WALK_SPEED, 0.72, 1.32);
    const runScale = this.clamp(this.smoothedHorizontalSpeed / PLAYER_SPRINT_SPEED, 0.85, 1.28);
    this.locomotionActions.walk.setEffectiveTimeScale(walkScale);
    this.locomotionActions.run.setEffectiveTimeScale(runScale);
  }

  private updateUpperBodyActions(input: CharacterAnimationUpdateInput): void {
    if (input.upperBodyActionNonce === this.lastUpperBodyActionNonce) {
      return;
    }
    this.lastUpperBodyActionNonce = input.upperBodyActionNonce;
    this.triggerUpperBodyAction(input.upperBodyAction);
  }

  private triggerUpperBodyAction(actionId: number): void {
    const action = this.upperBodyActions.get(actionId);
    if (!action) {
      return;
    }
    if (this.activeUpperBodyAction && this.activeUpperBodyAction !== action) {
      this.activeUpperBodyAction.stop();
    }
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.fadeIn(0.06);
    action.play();
    this.activeUpperBodyAction = action;
  }

  private cleanupFinishedUpperBodyAction(): void {
    if (!this.activeUpperBodyAction) {
      return;
    }
    if (this.activeUpperBodyAction.isRunning()) {
      return;
    }
    this.activeUpperBodyAction.fadeOut(0.08);
    this.activeUpperBodyAction.stop();
    this.activeUpperBodyAction = null;
  }

  private configureLoopingAction(clip: AnimationClip, clipName: string): AnimationAction {
    const action = this.mixer.clipAction(this.applyRootMotionPolicy(clip, clipName));
    action.setLoop(LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.enabled = true;
    action.play();
    return action;
  }

  private captureBindPose(root: Object3D): void {
    root.traverse((node) => {
      if (!(node as Object3D & { isBone?: boolean }).isBone) {
        return;
      }
      if (!node.name) {
        return;
      }
      this.bindPoseQuaternions.set(node.name, node.quaternion.clone());
    });
  }

  private makeIdleClip(): AnimationClip {
    const duration = 1.9;
    const phases = [0, 0.5, 1];
    return this.makeQuaternionClip("idle", duration, phases, {
      spine_01: [
        [0.01, 0, 0],
        [0.04, 0, 0],
        [0.01, 0, 0]
      ],
      spine_02: [
        [0.01, 0, 0],
        [-0.01, 0, 0],
        [0.01, 0, 0]
      ],
      clavicle_l: [
        [0, 0, -0.05],
        [0.02, 0, -0.04],
        [0, 0, -0.05]
      ],
      clavicle_r: [
        [0, 0, 0.05],
        [0.02, 0, 0.04],
        [0, 0, 0.05]
      ],
      upperarm_l: [
        [0.08, 0, -1.42],
        [0.12, 0, -1.38],
        [0.08, 0, -1.42]
      ],
      upperarm_r: [
        [0.08, 0, 1.42],
        [0.12, 0, 1.38],
        [0.08, 0, 1.42]
      ],
      lowerarm_l: [
        [0.18, 0, -0.2],
        [0.2, 0, -0.16],
        [0.18, 0, -0.2]
      ],
      lowerarm_r: [
        [0.18, 0, 0.2],
        [0.2, 0, 0.16],
        [0.18, 0, 0.2]
      ]
    });
  }

  private makeWalkClip(): AnimationClip {
    const duration = 0.84;
    const phases = [0, 0.25, 0.5, 0.75, 1];
    return this.makeQuaternionClip("walk", duration, phases, {
      pelvis: [
        [0, 0.03, 0],
        [0, -0.03, 0],
        [0, 0.03, 0],
        [0, -0.03, 0],
        [0, 0.03, 0]
      ],
      thigh_l: [
        [0.52, 0, 0],
        [0.1, 0, 0],
        [-0.52, 0, 0],
        [0.1, 0, 0],
        [0.52, 0, 0]
      ],
      thigh_r: [
        [-0.52, 0, 0],
        [0.1, 0, 0],
        [0.52, 0, 0],
        [0.1, 0, 0],
        [-0.52, 0, 0]
      ],
      calf_l: [
        [0.08, 0, 0],
        [0.3, 0, 0],
        [0.2, 0, 0],
        [0.34, 0, 0],
        [0.08, 0, 0]
      ],
      calf_r: [
        [0.2, 0, 0],
        [0.34, 0, 0],
        [0.08, 0, 0],
        [0.3, 0, 0],
        [0.2, 0, 0]
      ],
      foot_l: [
        [-0.08, 0, 0],
        [0.16, 0, 0],
        [0.1, 0, 0],
        [-0.12, 0, 0],
        [-0.08, 0, 0]
      ],
      foot_r: [
        [0.1, 0, 0],
        [-0.12, 0, 0],
        [-0.08, 0, 0],
        [0.16, 0, 0],
        [0.1, 0, 0]
      ],
      upperarm_l: [
        [-0.36, 0, -0.1],
        [0, 0, -0.05],
        [0.36, 0, -0.1],
        [0, 0, -0.05],
        [-0.36, 0, -0.1]
      ],
      upperarm_r: [
        [0.36, 0, 0.1],
        [0, 0, 0.05],
        [-0.36, 0, 0.1],
        [0, 0, 0.05],
        [0.36, 0, 0.1]
      ],
      lowerarm_l: [
        [0.1, 0, 0],
        [0.2, 0, 0],
        [0.1, 0, 0],
        [0.2, 0, 0],
        [0.1, 0, 0]
      ],
      lowerarm_r: [
        [0.1, 0, 0],
        [0.2, 0, 0],
        [0.1, 0, 0],
        [0.2, 0, 0],
        [0.1, 0, 0]
      ]
    });
  }

  private makeRunClip(): AnimationClip {
    const duration = 0.62;
    const phases = [0, 0.25, 0.5, 0.75, 1];
    return this.makeQuaternionClip("run", duration, phases, {
      pelvis: [
        [0, 0.06, 0],
        [0, -0.06, 0],
        [0, 0.06, 0],
        [0, -0.06, 0],
        [0, 0.06, 0]
      ],
      thigh_l: [
        [0.88, 0, 0],
        [0.14, 0, 0],
        [-0.88, 0, 0],
        [0.14, 0, 0],
        [0.88, 0, 0]
      ],
      thigh_r: [
        [-0.88, 0, 0],
        [0.14, 0, 0],
        [0.88, 0, 0],
        [0.14, 0, 0],
        [-0.88, 0, 0]
      ],
      calf_l: [
        [0.12, 0, 0],
        [0.52, 0, 0],
        [0.22, 0, 0],
        [0.48, 0, 0],
        [0.12, 0, 0]
      ],
      calf_r: [
        [0.22, 0, 0],
        [0.48, 0, 0],
        [0.12, 0, 0],
        [0.52, 0, 0],
        [0.22, 0, 0]
      ],
      foot_l: [
        [-0.12, 0, 0],
        [0.24, 0, 0],
        [0.14, 0, 0],
        [-0.22, 0, 0],
        [-0.12, 0, 0]
      ],
      foot_r: [
        [0.14, 0, 0],
        [-0.22, 0, 0],
        [-0.12, 0, 0],
        [0.24, 0, 0],
        [0.14, 0, 0]
      ],
      upperarm_l: [
        [-0.55, 0, -0.16],
        [0, 0, -0.1],
        [0.55, 0, -0.16],
        [0, 0, -0.1],
        [-0.55, 0, -0.16]
      ],
      upperarm_r: [
        [0.55, 0, 0.16],
        [0, 0, 0.1],
        [-0.55, 0, 0.16],
        [0, 0, 0.1],
        [0.55, 0, 0.16]
      ]
    });
  }

  private makeJumpClip(): AnimationClip {
    const duration = 0.55;
    const phases = [0, 1];
    return this.makeQuaternionClip("jump", duration, phases, {
      spine_01: [
        [-0.12, 0, 0],
        [-0.12, 0, 0]
      ],
      spine_02: [
        [-0.06, 0, 0],
        [-0.06, 0, 0]
      ],
      thigh_l: [
        [0.3, 0, 0],
        [0.3, 0, 0]
      ],
      thigh_r: [
        [0.3, 0, 0],
        [0.3, 0, 0]
      ],
      calf_l: [
        [0.5, 0, 0],
        [0.5, 0, 0]
      ],
      calf_r: [
        [0.5, 0, 0],
        [0.5, 0, 0]
      ],
      upperarm_l: [
        [0.18, 0, -0.1],
        [0.18, 0, -0.1]
      ],
      upperarm_r: [
        [0.18, 0, 0.1],
        [0.18, 0, 0.1]
      ]
    });
  }

  private makeUpperBodyCastClip(): AnimationClip {
    const duration = 0.48;
    const phases = [0, 0.2, 0.45, 0.7, 1];
    return this.makeQuaternionClip("upperCastFullBody", duration, phases, {
      spine_02: [
        [0, 0, 0],
        [0.05, 0.08, 0],
        [0.1, 0.2, 0],
        [0.04, 0.05, 0],
        [0, 0, 0]
      ],
      spine_03: [
        [0, 0, 0],
        [0.05, 0.16, 0],
        [0.12, 0.35, 0],
        [0.06, 0.08, 0],
        [0, 0, 0]
      ],
      clavicle_r: [
        [0, 0, 0.04],
        [-0.1, 0.08, 0.2],
        [-0.2, 0.18, 0.34],
        [-0.08, 0.06, 0.12],
        [0, 0, 0.04]
      ],
      upperarm_r: [
        [0.08, 0, 0.1],
        [-0.6, 0.2, 0.4],
        [-1.05, 0.28, 0.52],
        [-0.2, 0.06, 0.18],
        [0.08, 0, 0.1]
      ],
      lowerarm_r: [
        [0.04, 0, 0.06],
        [-0.35, 0.05, 0.24],
        [-0.95, 0.12, 0.34],
        [-0.18, 0.03, 0.12],
        [0.04, 0, 0.06]
      ],
      hand_r: [
        [0, 0, 0],
        [0.2, 0, 0.1],
        [0.45, 0, 0.25],
        [0.14, 0, 0.05],
        [0, 0, 0]
      ],
      clavicle_l: [
        [0, 0, -0.04],
        [0.05, 0.03, -0.08],
        [0.1, 0.04, -0.12],
        [0.03, 0.01, -0.05],
        [0, 0, -0.04]
      ],
      upperarm_l: [
        [0.08, 0, -0.1],
        [0.2, 0.02, -0.22],
        [0.28, 0.05, -0.3],
        [0.12, 0.01, -0.13],
        [0.08, 0, -0.1]
      ]
    });
  }

  private makeQuaternionClip(
    name: string,
    durationSeconds: number,
    normalizedPhases: number[],
    boneOffsets: Record<string, BoneOffsetTrack>
  ): AnimationClip {
    const times = normalizedPhases.map((phase) => phase * durationSeconds);
    const tracks: QuaternionKeyframeTrack[] = [];

    for (const [boneName, offsets] of Object.entries(boneOffsets)) {
      const bindPoseQuat = this.bindPoseQuaternions.get(boneName);
      if (!bindPoseQuat || offsets.length !== times.length) {
        continue;
      }
      const values: number[] = [];
      for (const [x, y, z] of offsets) {
        this.tempEuler.set(x, y, z, "XYZ");
        this.tempQuat.setFromEuler(this.tempEuler);
        this.composedQuat.copy(bindPoseQuat).multiply(this.tempQuat);
        values.push(this.composedQuat.x, this.composedQuat.y, this.composedQuat.z, this.composedQuat.w);
      }
      tracks.push(new QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
    }

    return new AnimationClip(name, durationSeconds, tracks);
  }

  private maskClipToUpperBody(clip: AnimationClip, targetName: string): AnimationClip {
    const filteredTracks = clip.tracks
      .filter((track) => {
        const boneName = this.extractTrackBoneName(track.name);
        if (!boneName) {
          return false;
        }
        const normalized = boneName.toLowerCase();
        return UPPER_BODY_BONE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
      })
      .map((track) => track.clone());
    return new AnimationClip(targetName, clip.duration, filteredTracks);
  }

  private applyRootMotionPolicy(clip: AnimationClip, clipName: string): AnimationClip {
    const allowRootMotion = this.rootMotionPerClip[clipName] ?? this.rootMotionDefaultEnabled;
    if (allowRootMotion) {
      return clip;
    }

    const filteredTracks = clip.tracks
      .filter((track) => !this.isRootMotionTrack(track.name))
      .map((track) => track.clone());
    return new AnimationClip(clip.name, clip.duration, filteredTracks);
  }

  private isRootMotionTrack(trackName: string): boolean {
    const propertyDelimiterIndex = trackName.lastIndexOf(".");
    if (propertyDelimiterIndex < 0) {
      return false;
    }
    const propertyName = trackName.slice(propertyDelimiterIndex + 1).toLowerCase();
    if (propertyName !== "position" && propertyName !== "quaternion") {
      return false;
    }
    const boneName = this.extractTrackBoneName(trackName);
    return boneName ? ROOT_MOTION_BONE_NAMES.has(boneName.toLowerCase()) : false;
  }

  private extractTrackBoneName(trackName: string): string | null {
    const boneMatch = /\.bones\[([^\]]+)\]/i.exec(trackName);
    if (boneMatch?.[1]) {
      return boneMatch[1];
    }

    const propertyDelimiterIndex = trackName.lastIndexOf(".");
    if (propertyDelimiterIndex < 0) {
      return null;
    }
    const bindingPath = trackName.slice(0, propertyDelimiterIndex);
    const pathSegments = bindingPath.split(/[/.]/).filter(Boolean);
    if (pathSegments.length === 0) {
      return null;
    }
    return pathSegments[pathSegments.length - 1] ?? null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
