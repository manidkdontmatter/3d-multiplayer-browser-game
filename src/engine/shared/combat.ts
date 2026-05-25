/**
 * Purpose: This file defines canonical shared combat contracts and deterministic helpers.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same combat identity/seed rules where required.
 */

export type AttackActivationKind = "ability" | "item" | "action";

export interface AttackIntent {
  readonly attackerEid: number;
  readonly activationKind: AttackActivationKind;
  readonly activationId: number;
  readonly aimYaw: number;
  readonly aimPitch: number;
  readonly serverTick: number;
}

export interface AttackSeedInput {
  readonly worldSeed: number;
  readonly attackerEid: number;
  readonly activationId: number;
  readonly shotSequence: number;
  readonly serverTick: number;
}

export function hashU32(value: number): number {
  let x = (Math.floor(value) >>> 0) + 0x9e3779b9;
  x ^= x >>> 16;
  x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15;
  x = Math.imul(x, 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}

export function composeAttackSeed(input: AttackSeedInput): number {
  let seed = hashU32(input.worldSeed);
  seed = hashU32(seed ^ hashU32(input.attackerEid));
  seed = hashU32(seed ^ hashU32(input.activationId));
  seed = hashU32(seed ^ hashU32(input.shotSequence));
  seed = hashU32(seed ^ hashU32(input.serverTick));
  return seed >>> 0;
}

export function seedToUnitFloat(seed: number): number {
  return (hashU32(seed) & 0x00ffffff) / 0x01000000;
}

