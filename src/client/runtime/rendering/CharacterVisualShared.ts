import { Box3, Group, type Object3D } from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { VRMHumanoid, type VRM, type VRMCore, type VRMHumanBoneName, type VRMHumanBones } from "@pixiv/three-vrm";

export const REMOTE_CHARACTER_TARGET_HEIGHT = 1.88;
const MIN_MODEL_HEIGHT = 1e-4;

export type SourceBoneBinding = { boneName: VRMHumanBoneName; nodeName: string };

export function cloneVrmScene(source: Object3D): Group {
  return cloneSkeleton(source) as Group;
}

export function removeNormalizedHumanoidRigs(root: Object3D): void {
  const toRemove: Object3D[] = [];
  root.traverse((node) => {
    if (node.name === "VRMHumanoidRig" && node.parent) {
      toRemove.push(node);
    }
  });
  for (const node of toRemove) {
    node.parent?.remove(node);
  }
}

export function normalizeModelToGround(model: Object3D, targetHeight = REMOTE_CHARACTER_TARGET_HEIGHT): void {
  const initialBounds = new Box3().setFromObject(model);
  const initialHeight = Math.max(initialBounds.max.y - initialBounds.min.y, MIN_MODEL_HEIGHT);
  const uniformScale = targetHeight / initialHeight;
  model.scale.multiplyScalar(uniformScale);

  const scaledBounds = new Box3().setFromObject(model);
  const centerX = (scaledBounds.min.x + scaledBounds.max.x) * 0.5;
  const centerZ = (scaledBounds.min.z + scaledBounds.max.z) * 0.5;
  model.position.x -= centerX;
  model.position.y -= scaledBounds.min.y;
  model.position.z -= centerZ;
}

export function buildSourceRawBoneNames(vrm: VRM): SourceBoneBinding[] {
  const bindings: SourceBoneBinding[] = [];
  for (const [boneName, bone] of Object.entries(vrm.humanoid.humanBones) as Array<
    [VRMHumanBoneName, { node: Object3D } | undefined]
  >) {
    const nodeName = bone?.node?.name?.trim();
    if (!nodeName) {
      continue;
    }
    bindings.push({ boneName, nodeName });
  }
  return bindings;
}

export function createHumanoidForClonedModel(
  root: Object3D,
  sourceBindings: SourceBoneBinding[]
): VRMHumanoid | null {
  if (sourceBindings.length === 0) {
    return null;
  }
  const humanBones = {} as VRMHumanBones;
  for (const binding of sourceBindings) {
    const node = root.getObjectByName(binding.nodeName);
    if (!node) {
      continue;
    }
    (humanBones as Record<string, { node: Object3D }>)[binding.boneName] = { node };
  }
  if (!(humanBones as Record<string, unknown>).hips || !(humanBones as Record<string, unknown>).head) {
    return null;
  }
  const humanoid = new VRMHumanoid(humanBones, {
    autoUpdateHumanBones: true
  });
  root.add(humanoid.normalizedHumanBonesRoot);
  return humanoid;
}

export function buildVrmCoreForRoot(
  root: Group,
  humanoid: VRMHumanoid,
  sourceMetaVersion: "0" | "1"
): VRMCore {
  return {
    scene: root,
    humanoid,
    meta: { metaVersion: sourceMetaVersion }
  } as VRMCore;
}
