/**
 * Purpose: This file re-exports this module group through a single import surface, and runs core simulation state updates in tick order.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
import type RAPIER from "@dimforge/rapier3d-compat";

export class SimulationEcsIndexRegistry {
  // Global nid -> eid index for any replicated entity (players, npcs, items, projectiles, etc.).
  private readonly eidByNid = new Map<number, number>();

  // Player lookup indexes
  private readonly playerEidByUserId = new Map<number, number>();
  private readonly playerEidByNid = new Map<number, number>();
  private readonly playerEidByAccountId = new Map<number, number>();
  private readonly playerEids = new Set<number>();

  // Character (NPC) lookup indexes
  private readonly characterEids = new Set<number>();
  private readonly characterEidByNid = new Map<number, number>();

  // Rapier physics refs — stored by EID
  private readonly bodyByEid = new Map<number, RAPIER.RigidBody>();
  private readonly colliderByEid = new Map<number, RAPIER.Collider>();
  private readonly playerBodyByEid = new Map<number, RAPIER.RigidBody>();
  private readonly playerColliderByEid = new Map<number, RAPIER.Collider>();
  private readonly dummyBodyByEid = new Map<number, RAPIER.RigidBody>();
  private readonly dummyColliderByEid = new Map<number, RAPIER.Collider>();

  // ── Player indexes ────────────────────────────────────────────────────────

  public bindPlayerIndexes(userId: number, eid: number, nid: number, accountId: number): void {
    this.playerEids.add(eid);
    this.characterEids.add(eid);
    this.playerEidByUserId.set(userId, eid);
    this.playerEidByNid.set(Math.max(0, Math.floor(nid)), eid);
    this.playerEidByAccountId.set(Math.max(1, Math.floor(accountId)), eid);
  }

  public unbindPlayerIndexes(userId: number, eid: number, nid: number, accountId: number): void {
    this.playerEids.delete(eid);
    this.characterEids.delete(eid);
    this.playerEidByUserId.delete(userId);
    this.playerEidByNid.delete(Math.max(0, Math.floor(nid)));
    this.playerEidByAccountId.delete(Math.max(1, Math.floor(accountId)));
  }

  public getPlayerEidByUserId(userId: number): number | undefined {
    return this.playerEidByUserId.get(userId);
  }

  public getPlayerEidByNid(nid: number): number | undefined {
    return this.playerEidByNid.get(Math.max(0, Math.floor(nid)));
  }

  public getPlayerEidByAccountId(accountId: number): number | undefined {
    return this.playerEidByAccountId.get(Math.max(1, Math.floor(accountId)));
  }

  public getOnlinePlayerUserIds(): number[] {
    return Array.from(this.playerEidByUserId.keys());
  }

  public getOnlinePlayerCount(): number {
    return this.playerEidByUserId.size;
  }

  public updatePlayerNidIndex(eid: number, previousNid: number, nextNid: number): void {
    this.updateCharacterNidIndex(eid, previousNid, nextNid);
    if (!this.playerEids.has(eid)) return;
    if (previousNid !== nextNid) {
      this.playerEidByNid.delete(Math.max(0, Math.floor(previousNid)));
    }
    this.playerEidByNid.set(Math.max(0, Math.floor(nextNid)), eid);
  }

  public updateGlobalNidIndex(eid: number, previousNid: number, nextNid: number): void {
    const prev = Math.max(0, Math.floor(previousNid));
    const next = Math.max(0, Math.floor(nextNid));
    if (prev > 0 && prev !== next) {
      const indexed = this.eidByNid.get(prev);
      if (indexed === eid) {
        this.eidByNid.delete(prev);
      }
    }
    if (next > 0) {
      this.eidByNid.set(next, eid);
    }
  }

  public removeGlobalNidIndex(previousNid: number): void {
    const prev = Math.max(0, Math.floor(previousNid));
    if (prev <= 0) return;
    this.eidByNid.delete(prev);
  }

  public getEidByNid(nid: number): number | undefined {
    return this.eidByNid.get(Math.max(0, Math.floor(nid)));
  }

  // ── Character (NPC) indexes ───────────────────────────────────────────────

  public registerCharacterRefs(eid: number, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
    this.characterEids.add(eid);
    this.bodyByEid.set(eid, body);
    this.colliderByEid.set(eid, collider);
  }

  public updateCharacterNidIndex(eid: number, previousNid: number, nextNid: number): void {
    if (!this.characterEids.has(eid)) return;
    if (previousNid !== nextNid) {
      this.characterEidByNid.delete(Math.max(0, Math.floor(previousNid)));
    }
    this.characterEidByNid.set(Math.max(0, Math.floor(nextNid)), eid);
  }

  public getCharacterEidByNid(nid: number): number | undefined {
    return this.characterEidByNid.get(Math.max(0, Math.floor(nid)));
  }

  public getCharacterBody(eid: number): RAPIER.RigidBody | undefined {
    return this.bodyByEid.get(eid);
  }

  public getCharacterCollider(eid: number): RAPIER.Collider | undefined {
    return this.colliderByEid.get(eid);
  }

  // ── Player physics refs ───────────────────────────────────────────────────

  public registerPlayerRefs(eid: number, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
    this.registerCharacterRefs(eid, body, collider);
    this.playerBodyByEid.set(eid, body);
    this.playerColliderByEid.set(eid, collider);
  }

  public getPlayerBody(eid: number): RAPIER.RigidBody | undefined {
    return this.playerBodyByEid.get(eid);
  }

  public getPlayerCollider(eid: number): RAPIER.Collider | undefined {
    return this.playerColliderByEid.get(eid);
  }

  // ── Dummy physics refs ────────────────────────────────────────────────────

  public registerDummyRefs(eid: number, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
    this.dummyBodyByEid.set(eid, body);
    this.dummyColliderByEid.set(eid, collider);
  }

  public getDummyBody(eid: number): RAPIER.RigidBody | undefined {
    return this.dummyBodyByEid.get(eid);
  }

  public getDummyCollider(eid: number): RAPIER.Collider | undefined {
    return this.dummyColliderByEid.get(eid);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  public removeAllIndexesForEid(eid: number): void {
    for (const [userId, indexedEid] of this.playerEidByUserId.entries()) {
      if (indexedEid === eid) { this.playerEidByUserId.delete(userId); break; }
    }
    for (const [nid, indexedEid] of this.playerEidByNid.entries()) {
      if (indexedEid === eid) { this.playerEidByNid.delete(nid); break; }
    }
    for (const [accountId, indexedEid] of this.playerEidByAccountId.entries()) {
      if (indexedEid === eid) { this.playerEidByAccountId.delete(accountId); break; }
    }
    this.playerEids.delete(eid);
    this.characterEids.delete(eid);
    for (const [nid, indexedEid] of this.characterEidByNid.entries()) {
      if (indexedEid === eid) { this.characterEidByNid.delete(nid); break; }
    }
    this.bodyByEid.delete(eid);
    this.colliderByEid.delete(eid);
    this.playerBodyByEid.delete(eid);
    this.playerColliderByEid.delete(eid);
    this.dummyBodyByEid.delete(eid);
    this.dummyColliderByEid.delete(eid);
  }
}
