import type RAPIER from "@dimforge/rapier3d-compat";

export const PLAYER_CHARACTER_CONTROLLER_OFFSET = 0.01;
export const PLAYER_CHARACTER_CONTROLLER_SNAP_TO_GROUND = 0.2;
export const PLAYER_CHARACTER_CONTROLLER_MAX_SLOPE_CLIMB_ANGLE = (60 * Math.PI) / 180;
export const PLAYER_CHARACTER_CONTROLLER_MIN_SLOPE_SLIDE_ANGLE = (80 * Math.PI) / 180;

export function configurePlayerCharacterController(controller: RAPIER.KinematicCharacterController): void {
  controller.setSlideEnabled(true);
  controller.enableSnapToGround(PLAYER_CHARACTER_CONTROLLER_SNAP_TO_GROUND);
  controller.disableAutostep();
  controller.setMaxSlopeClimbAngle(PLAYER_CHARACTER_CONTROLLER_MAX_SLOPE_CLIMB_ANGLE);
  controller.setMinSlopeSlideAngle(PLAYER_CHARACTER_CONTROLLER_MIN_SLOPE_SLIDE_ANGLE);
}
