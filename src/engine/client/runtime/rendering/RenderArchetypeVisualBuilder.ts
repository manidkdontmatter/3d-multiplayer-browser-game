/**
 * Purpose: This file builds Three.js visual groups from render archetype definitions.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import { BoxGeometry, CylinderGeometry, DodecahedronGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from "three";
import { getRenderArchetype } from "./VisualRegistry";

export function buildRenderArchetypeGroup(archetypeId: number): Group | null {
  const archetype = getRenderArchetype(archetypeId);
  if (!archetype || archetype.nodes.length <= 0) {
    return null;
  }
  const group = new Group();
  for (const node of archetype.nodes) {
    const material = new MeshStandardMaterial({
      color: node.color,
      roughness: node.roughness,
      metalness: node.metalness,
      emissive: node.emissive ?? 0x000000,
      emissiveIntensity: node.emissiveIntensity ?? 0
    });
    const mesh = new Mesh(buildGeometry(node.geometry, node.geometryParams), material);
    mesh.position.set(node.localPosition?.x ?? 0, node.localPosition?.y ?? 0, node.localPosition?.z ?? 0);
    group.add(mesh);
  }
  return group;
}

export function applyGroupTint(group: Group, tintColorRgb: number): void {
  const tint = Math.max(0, Math.min(0xffffff, Math.floor(tintColorRgb)));
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.material) {
      return;
    }
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) {
        if ("color" in material) {
          (material as MeshStandardMaterial).color.setHex(tint);
        }
      }
      return;
    }
    const material = mesh.material as MeshStandardMaterial;
    if ("color" in material) {
      material.color.setHex(tint);
    }
  });
}

function buildGeometry(type: string, params: number[]) {
  switch (type) {
    case "box":
      return new BoxGeometry(params[0] ?? 0.2, params[1] ?? 0.2, params[2] ?? 0.2);
    case "dodecahedron":
      return new DodecahedronGeometry(params[0] ?? 0.22, params[1] ?? 0);
    case "cylinder":
      return new CylinderGeometry(params[0] ?? 0.2, params[1] ?? 0.2, params[2] ?? 1, params[3] ?? 12, 1);
    case "sphere":
      return new SphereGeometry(params[0] ?? 0.22, params[1] ?? 12, params[2] ?? 8);
    default:
      return new BoxGeometry(0.22, 0.22, 0.22);
  }
}
