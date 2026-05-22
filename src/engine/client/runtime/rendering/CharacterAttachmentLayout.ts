/**
 * Purpose: This file defines canonical character attachment transforms by equipment slot.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and keeps slot attachment placement consistent for local and remote avatars.
 */
import type { EquipmentSlot } from "../../../shared";
import type { Group } from "three";

type AttachmentTransform = {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: number;
};

const CHARACTER_ATTACHMENT_TRANSFORMS: Readonly<Record<EquipmentSlot, AttachmentTransform>> = Object.freeze({
  weapon: Object.freeze({
    position: [0.28, 0.96, -0.28] as const,
    rotation: [-0.1, 0.2, 1.15] as const,
    scale: 0.6
  }),
  head: Object.freeze({
    position: [0, 1.58, 0] as const,
    rotation: [0, 0, 0] as const,
    scale: 0.72
  }),
  body: Object.freeze({
    position: [0, 1.05, 0] as const,
    rotation: [0, 0, 0] as const,
    scale: 0.9
  }),
  legs: Object.freeze({
    position: [0, 0.54, 0] as const,
    rotation: [0, 0, 0] as const,
    scale: 0.82
  }),
  accessory: Object.freeze({
    position: [0.22, 1.25, -0.18] as const,
    rotation: [0, 0.45, 0.15] as const,
    scale: 0.5
  })
});

export function applyCharacterAttachmentTransform(slot: EquipmentSlot, attachment: Group): void {
  const transform = CHARACTER_ATTACHMENT_TRANSFORMS[slot];
  const [px, py, pz] = transform.position;
  const [rx, ry, rz] = transform.rotation;
  attachment.position.set(px, py, pz);
  attachment.rotation.set(rx, ry, rz);
  attachment.scale.setScalar(transform.scale);
}
