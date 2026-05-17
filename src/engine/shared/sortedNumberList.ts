/**
 * Purpose: This file defines the "sorted number list" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
export type NormalizeSortedUniqueUIntOptions = {
  readonly maxInclusive: number;
  readonly includeZero: boolean;
};

const DEFAULT_OPTIONS: NormalizeSortedUniqueUIntOptions = {
  maxInclusive: 0xffff,
  includeZero: false
};

export function normalizeSortedUniqueUInt(
  raw: ReadonlyArray<number>,
  options: Partial<NormalizeSortedUniqueUIntOptions> = {}
): number[] {
  const rawMaxInclusive = options.maxInclusive;
  const maxInclusive = (typeof rawMaxInclusive === "number" && Number.isFinite(rawMaxInclusive))
    ? Math.max(0, Math.floor(rawMaxInclusive))
    : DEFAULT_OPTIONS.maxInclusive;
  const includeZero = typeof options.includeZero === "boolean" ? options.includeZero : DEFAULT_OPTIONS.includeZero;

  if (!raw || raw.length === 0) {
    return [];
  }

  const normalized: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const n = Math.max(0, Math.min(maxInclusive, Math.floor(v)));
    if (!includeZero && n === 0) continue;
    normalized.push(n);
  }
  if (normalized.length <= 1) {
    return normalized;
  }

  normalized.sort((a, b) => a - b);
  let write = 1;
  for (let read = 1; read < normalized.length; read += 1) {
    const current = normalized[read]!;
    const previous = normalized[write - 1]!;
    if (current !== previous) {
      normalized[write] = current;
      write += 1;
    }
  }
  normalized.length = write;
  return normalized;
}

export function sortedUniqueContains(sortedUnique: readonly number[], value: number): boolean {
  if (!sortedUnique || sortedUnique.length === 0) return false;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const target = Math.max(0, Math.floor(value));
  let lo = 0;
  let hi = sortedUnique.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sortedUnique[mid]!;
    if (v === target) return true;
    if (v < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

export function sortedUniqueEquals(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
