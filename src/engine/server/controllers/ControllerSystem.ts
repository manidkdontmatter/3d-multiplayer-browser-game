/**
 * Purpose: This file defines the "controller system" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine authoritative server layer.
 * Human Summary: Runs on the authoritative server and owns truth for gameplay state changes.
 */
export const CONTROLLER_KIND_NONE = 0;
export const CONTROLLER_KIND_PLAYER = 1;
export const CONTROLLER_KIND_AI = 2;
export const CONTROLLER_KIND_SCRIPTED = 3;

export type ControllerKind =
  | typeof CONTROLLER_KIND_NONE
  | typeof CONTROLLER_KIND_PLAYER
  | typeof CONTROLLER_KIND_AI
  | typeof CONTROLLER_KIND_SCRIPTED;

export interface CharacterControllerBinding {
  readonly characterEid: number;
  readonly kind: ControllerKind;
  readonly userId: number | null;
}

export class ControllerSystem {
  private readonly bindingByCharacterEid = new Map<number, CharacterControllerBinding>();
  private readonly characterEidByUserId = new Map<number, number>();

  public attachPlayerController(userId: number, characterEid: number): void {
    this.detachUser(userId);
    this.bindingByCharacterEid.set(characterEid, {
      characterEid,
      kind: CONTROLLER_KIND_PLAYER,
      userId
    });
    this.characterEidByUserId.set(userId, characterEid);
  }

  public attachAiController(characterEid: number): void {
    this.bindingByCharacterEid.set(characterEid, {
      characterEid,
      kind: CONTROLLER_KIND_AI,
      userId: null
    });
  }

  public detachUser(userId: number): void {
    const characterEid = this.characterEidByUserId.get(userId);
    if (typeof characterEid !== "number") {
      return;
    }
    this.characterEidByUserId.delete(userId);
    this.bindingByCharacterEid.delete(characterEid);
  }

  public detachCharacter(characterEid: number): void {
    const binding = this.bindingByCharacterEid.get(characterEid);
    if (binding && binding.userId !== null) {
      this.characterEidByUserId.delete(binding.userId);
    }
    this.bindingByCharacterEid.delete(characterEid);
  }

  public getControlledCharacterEidByUserId(userId: number): number | null {
    return this.characterEidByUserId.get(userId) ?? null;
  }

  public getBindingByCharacterEid(characterEid: number): CharacterControllerBinding | null {
    return this.bindingByCharacterEid.get(characterEid) ?? null;
  }
}
