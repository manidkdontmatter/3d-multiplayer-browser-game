export interface StaticWorldBlock {
  x: number;
  y: number;
  z: number;
  halfX: number;
  halfY: number;
  halfZ: number;
  rotationZ?: number;
}

const BLOCK_HALF = 0.6;

export const STATIC_WORLD_BLOCKS: StaticWorldBlock[] = (() => {
  const blocks: StaticWorldBlock[] = [];
  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2;
    const radius = 10 + (i % 7) * 4;
    blocks.push({
      x: Math.sin(angle) * radius,
      y: 0.6,
      z: Math.cos(angle) * radius,
      halfX: BLOCK_HALF,
      halfY: BLOCK_HALF,
      halfZ: BLOCK_HALF
    });
  }
  blocks.push({
    x: 16,
    y: 1.2,
    z: -10,
    halfX: 9,
    halfY: 3,
    halfZ: 9,
    rotationZ: (-24 * Math.PI) / 180
  });
  return blocks;
})();
