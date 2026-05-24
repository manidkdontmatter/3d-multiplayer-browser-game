/**
 * Purpose: This file defines shared spatial query helpers for world interaction sockets.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides evaluate interaction distance using the same rules.
 */
import { resolveWorldAnchorAttachmentPoint, type WorldAnchorTransform } from "./worldLocations";

export function resolveSocketInteractionDistanceSq(
  point: { x: number; y: number; z: number },
  socketPoint: { x: number; y: number; z: number },
  interactRadius: number,
  extraSlack: number,
  maxDistance: number
): number | null {
  const dx = socketPoint.x - point.x;
  const dy = socketPoint.y - point.y;
  const dz = socketPoint.z - point.z;
  const distanceSq = dx * dx + dy * dy + dz * dz;
  const socketLimit = Math.max(0.25, interactRadius) + Math.max(0, extraSlack);
  const externalLimit = Math.max(0, maxDistance);
  const allowed = Math.min(socketLimit, externalLimit);
  if (allowed <= 0) {
    return null;
  }
  return distanceSq <= allowed * allowed ? distanceSq : null;
}

export interface WorldInteractionSocketCandidate<TPayload> {
  payload: TPayload;
  socketPoint: { x: number; y: number; z: number };
  interactRadius: number;
}

export interface LocalInteractionSocketDefinition {
  localX: number;
  localY: number;
  localZ: number;
  interactRadius: number;
}

export interface WorldInteractionNearestSocketMatch<TPayload> {
  payload: TPayload;
  distanceSq: number;
}

export function findNearestInteractionSocket<TPayload>(
  point: { x: number; y: number; z: number },
  candidates: readonly WorldInteractionSocketCandidate<TPayload>[],
  options: { maxDistance: number; extraSlack: number }
): WorldInteractionNearestSocketMatch<TPayload> | null {
  let best: WorldInteractionNearestSocketMatch<TPayload> | null = null;
  for (const candidate of candidates) {
    const distanceSq = resolveSocketInteractionDistanceSq(
      point,
      candidate.socketPoint,
      candidate.interactRadius,
      options.extraSlack,
      options.maxDistance
    );
    if (distanceSq === null) {
      continue;
    }
    if (!best || distanceSq < best.distanceSq) {
      best = {
        payload: candidate.payload,
        distanceSq
      };
    }
  }
  return best;
}

export function buildWorldInteractionSocketCandidates<TSocket extends LocalInteractionSocketDefinition, TPayload>(
  root: WorldAnchorTransform,
  sockets: readonly TSocket[],
  mapPayload: (socket: TSocket) => TPayload | null
): WorldInteractionSocketCandidate<TPayload>[] {
  const candidates: WorldInteractionSocketCandidate<TPayload>[] = [];
  for (const socket of sockets) {
    const payload = mapPayload(socket);
    if (!payload) {
      continue;
    }
    const world = resolveWorldAnchorAttachmentPoint(root, {
      x: socket.localX,
      y: socket.localY,
      z: socket.localZ
    });
    candidates.push({
      payload,
      socketPoint: world,
      interactRadius: socket.interactRadius
    });
  }
  return candidates;
}
