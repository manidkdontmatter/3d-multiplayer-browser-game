export interface PlatformSpatialEntry {
  pid: number;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

const DEFAULT_PLATFORM_SPATIAL_CELL_SIZE = 8;

export class PlatformSpatialIndex {
  private readonly buckets = new Map<string, number[]>();
  private readonly dedupe = new Set<number>();

  public constructor(private readonly cellSize = DEFAULT_PLATFORM_SPATIAL_CELL_SIZE) {}

  public clear(): void {
    this.buckets.clear();
  }

  public insert(entry: PlatformSpatialEntry): void {
    const minCellX = this.worldToCell(entry.x - entry.halfX);
    const maxCellX = this.worldToCell(entry.x + entry.halfX);
    const minCellZ = this.worldToCell(entry.z - entry.halfZ);
    const maxCellZ = this.worldToCell(entry.z + entry.halfZ);

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        const key = this.key(cellX, cellZ);
        const bucket = this.buckets.get(key);
        if (bucket) {
          bucket.push(entry.pid);
        } else {
          this.buckets.set(key, [entry.pid]);
        }
      }
    }
  }

  public queryAabb(
    centerX: number,
    centerZ: number,
    halfX: number,
    halfZ: number,
    output: number[]
  ): void {
    output.length = 0;
    this.dedupe.clear();

    const minCellX = this.worldToCell(centerX - halfX);
    const maxCellX = this.worldToCell(centerX + halfX);
    const minCellZ = this.worldToCell(centerZ - halfZ);
    const maxCellZ = this.worldToCell(centerZ + halfZ);

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        const bucket = this.buckets.get(this.key(cellX, cellZ));
        if (!bucket) {
          continue;
        }
        for (const pid of bucket) {
          if (this.dedupe.has(pid)) {
            continue;
          }
          this.dedupe.add(pid);
          output.push(pid);
        }
      }
    }

    output.sort((a, b) => a - b);
  }

  private worldToCell(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  private key(cellX: number, cellZ: number): string {
    return `${cellX},${cellZ}`;
  }
}
