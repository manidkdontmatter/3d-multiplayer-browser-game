import type RAPIER from "@dimforge/rapier3d-compat";

export class SimulationEcsIndexRegistry {
  private readonly objectToEid = new WeakMap<object, number>();
  private readonly eidToObject = new Map<number, object>();
  private readonly playerEidByUserId = new Map<number, number>();
  private readonly playerEidByNid = new Map<number, number>();
  private readonly playerEidByAccountId = new Map<number, number>();
  private readonly playerEids = new Set<number>();
  private readonly playerBodyByEid = new Map<number, RAPIER.RigidBody>();
  private readonly playerColliderByEid = new Map<number, RAPIER.Collider>();
  private readonly dummyBodyByEid = new Map<number, RAPIER.RigidBody>();
  private readonly dummyColliderByEid = new Map<number, RAPIER.Collider>();

  public bindObject(entity: object, eid: number): void {
    this.objectToEid.set(entity, eid);
    this.eidToObject.set(eid, entity);
  }

  public getOrCreateEid(entity: object, createEid: () => number): number {
    const existing = this.objectToEid.get(entity);
    if (typeof existing === "number") {
      return existing;
    }
    const eid = createEid();
    this.bindObject(entity, eid);
    return eid;
  }

  public getEid(entity: object): number {
    const eid = this.objectToEid.get(entity);
    if (typeof eid !== "number") {
      throw new Error("SimulationEcs entity was not registered");
    }
    return eid;
  }

  public getEidOrNull(entity: object): number | null {
    const eid = this.objectToEid.get(entity);
    return typeof eid === "number" ? eid : null;
  }

  public getObjectByEid<T extends object>(eid: number): T | undefined {
    return this.eidToObject.get(eid) as T | undefined;
  }

  public registerPlayerRuntimeRefs(eid: number, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
    this.playerBodyByEid.set(eid, body);
    this.playerColliderByEid.set(eid, collider);
  }

  public registerDummyRuntimeRefs(eid: number, body: RAPIER.RigidBody, collider: RAPIER.Collider): void {
    this.dummyBodyByEid.set(eid, body);
    this.dummyColliderByEid.set(eid, collider);
  }

  public getPlayerBody(eid: number): RAPIER.RigidBody | undefined {
    return this.playerBodyByEid.get(eid);
  }

  public getPlayerCollider(eid: number): RAPIER.Collider | undefined {
    return this.playerColliderByEid.get(eid);
  }

  public getDummyBody(eid: number): RAPIER.RigidBody | undefined {
    return this.dummyBodyByEid.get(eid);
  }

  public getDummyCollider(eid: number): RAPIER.Collider | undefined {
    return this.dummyColliderByEid.get(eid);
  }

  public bindPlayerLookupIndexes(userId: number, eid: number, nid: number, accountId: number): void {
    this.playerEids.add(eid);
    this.playerEidByUserId.set(userId, eid);
    this.playerEidByNid.set(Math.max(0, Math.floor(nid)), eid);
    this.playerEidByAccountId.set(Math.max(1, Math.floor(accountId)), eid);
  }

  public updatePlayerNidIndex(eid: number, previousNid: number, nextNid: number): void {
    if (!this.playerEids.has(eid)) {
      return;
    }
    if (previousNid !== nextNid) {
      this.playerEidByNid.delete(Math.max(0, Math.floor(previousNid)));
    }
    this.playerEidByNid.set(Math.max(0, Math.floor(nextNid)), eid);
  }

  public unbindPlayerLookupIndexesByEntity(userId: number, eid: number, nid: number, accountId: number): void {
    this.playerEids.delete(eid);
    this.playerEidByUserId.delete(userId);
    this.playerEidByNid.delete(Math.max(0, Math.floor(nid)));
    this.playerEidByAccountId.delete(Math.max(1, Math.floor(accountId)));
  }

  public unbindPlayerLookupIndexesByUserId(userId: number): void {
    this.playerEidByUserId.delete(userId);
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

  public removeAllIndexesForEid(eid: number): void {
    const entity = this.eidToObject.get(eid);
    if (entity) {
      this.objectToEid.delete(entity);
      this.eidToObject.delete(eid);
    }

    for (const [userId, indexedEid] of this.playerEidByUserId.entries()) {
      if (indexedEid === eid) {
        this.playerEidByUserId.delete(userId);
        break;
      }
    }
    for (const [nid, indexedEid] of this.playerEidByNid.entries()) {
      if (indexedEid === eid) {
        this.playerEidByNid.delete(nid);
        break;
      }
    }
    for (const [accountId, indexedEid] of this.playerEidByAccountId.entries()) {
      if (indexedEid === eid) {
        this.playerEidByAccountId.delete(accountId);
        break;
      }
    }
    this.playerEids.delete(eid);

    this.playerBodyByEid.delete(eid);
    this.playerColliderByEid.delete(eid);
    this.dummyBodyByEid.delete(eid);
    this.dummyColliderByEid.delete(eid);
  }
}
