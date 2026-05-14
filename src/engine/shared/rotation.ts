export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const IDENTITY_QUATERNION: Readonly<QuaternionLike> = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  w: 1
});

export function quaternionFromYawPitchRoll(
  yaw: number,
  pitch: number,
  roll = 0
): QuaternionLike {
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);

  return {
    x: cy * sp * cr + sy * cp * sr,
    y: sy * cp * cr - cy * sp * sr,
    z: cy * cp * sr - sy * sp * cr,
    w: cy * cp * cr + sy * sp * sr
  };
}

export function quaternionFromYaw(yaw: number): QuaternionLike {
  return quaternionFromYawPitchRoll(yaw, 0, 0);
}
