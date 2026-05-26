/**
 * Purpose: This file defines the "netcode" module so this responsibility has a dedicated, discoverable file.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */
import { Binary, Context, defineSchema } from "nengi";

export enum NType {
  InputCommand = 1,
  RuntimeEntity = 2,
  IdentityMessage = 3,
  InputAckMessage = 5,
  AbilityDefinitionMessage = 8,
  AbilityStateMessage = 9,
  // 10 reserved for retired legacy item-definition descriptor wire message.
  AbilityCommand = 11,
  AbilityUseMessage = 13,
  ServerPopulationMessage = 14,
  AbilityOwnershipMessage = 15,
  MapTransferCommand = 18,
  MapTransferMessage = 19,
  WorldAnchorEntity = 20,
  // 21-24 reserved for retired legacy creator/inventory wire messages.
  ServerNetDiagnosticsMessage = 25,
  ReferenceFrameVolumeEnteredMessage = 26,
  ReferenceFrameVolumeExitedMessage = 27,
  // 28 reserved for retired legacy inventory action-result wire message.
  PlayerSettingsCommand = 29,
  PlayerSettingsMessage = 30,
  ServerAlertMessage = 31,
  // 32 reserved for retired legacy creator action-result wire message.
  UiViewOpenMessage = 33,
  UiViewPatchMessage = 34,
  UiViewCloseMessage = 35,
  UiIntentCommand = 36,
  UiIntentResultMessage = 37
}

export const inputCommandSchema = defineSchema({
  sequence: Binary.UInt16,
  forward: Binary.Float32,
  strafe: Binary.Float32,
  jump: Binary.Boolean,
  toggleFlyPressed: Binary.Boolean,
  sprint: Binary.Boolean,
  usePrimaryPressed: Binary.Boolean,
  usePrimaryHeld: Binary.Boolean,
  useSecondaryPressed: Binary.Boolean,
  useSecondaryHeld: Binary.Boolean,
  castSlotPressed: Binary.Boolean,
  castSlotIndex: Binary.UInt8,
  yaw: Binary.Rotation32,
  yawDelta: Binary.Float32,
  pitch: Binary.Rotation32
});

export const abilityCommandSchema = defineSchema({
  applyPrimaryMouseSlot: Binary.Boolean,
  primaryMouseSlot: Binary.UInt8,
  applySecondaryMouseSlot: Binary.Boolean,
  secondaryMouseSlot: Binary.UInt8,
  applyForgetAbility: Binary.Boolean,
  forgetAbilityId: Binary.UInt16
});

export const mapTransferCommandSchema = defineSchema({
  targetMapInstanceId: Binary.String
});

export const runtimeEntitySchema = defineSchema({
  modelId: Binary.UInt16,
  renderArchetypeId: Binary.UInt16,
  materialVariantId: Binary.UInt16,
  tintColorRgb: Binary.UInt32,
  uniformScalePct: Binary.UInt16,
  equippedWeaponArchetypeId: Binary.UInt16,
  equippedWeaponTintColorRgb: Binary.UInt32,
  equippedHeadArchetypeId: Binary.UInt16,
  equippedHeadTintColorRgb: Binary.UInt32,
  equippedBodyArchetypeId: Binary.UInt16,
  equippedBodyTintColorRgb: Binary.UInt32,
  equippedLegsArchetypeId: Binary.UInt16,
  equippedLegsTintColorRgb: Binary.UInt32,
  equippedAccessoryArchetypeId: Binary.UInt16,
  equippedAccessoryTintColorRgb: Binary.UInt32,
  position: { type: Binary.Vector3, interp: true },
  rotation: { type: Binary.Quaternion, interp: true },
  grounded: Binary.Boolean,
  movementMode: Binary.UInt8,
  health: Binary.UInt8,
  maxHealth: Binary.UInt8,
  pickupDefinitionId: Binary.UInt16,
  itemQuantity: Binary.UInt16
});

export const worldAnchorEntitySchema = defineSchema({
  modelId: Binary.UInt16,
  worldAnchorId: Binary.Int32,
  worldAnchorKind: Binary.UInt8,
  worldAnchorArchetypeId: Binary.UInt16,
  worldAnchorSeed: Binary.Int32,
  worldAnchorEnvironmentId: Binary.UInt8,
  worldAnchorStreamingRadius: Binary.Float32,
  worldAnchorInfluenceRadius: Binary.Float32,
  // Backward compatibility during migration.
  locationPid: Binary.Int32,
  locationKind: Binary.UInt8,
  locationArchetypeId: Binary.UInt16,
  locationSeed: Binary.Int32,
  locationEnvironmentId: Binary.UInt8,
  locationStreamingRadius: Binary.Float32,
  locationInfluenceRadius: Binary.Float32,
  position: { type: Binary.Vector3, interp: true },
  rotation: { type: Binary.Quaternion, interp: true }
});

export const identityMessageSchema = defineSchema({
  playerNid: Binary.UInt16
});

export const inputAckMessageSchema = defineSchema({
  sequence: Binary.UInt16,
  serverTick: Binary.UInt32,
  x: Binary.Float32,
  y: Binary.Float32,
  z: Binary.Float32,
  vx: Binary.Float32,
  vy: Binary.Float32,
  vz: Binary.Float32,
  grounded: Binary.Boolean,
  groundedPlatformPid: Binary.Int16,
  carriedFramePid: Binary.Int32,
  movementMode: Binary.UInt8
});

export const abilityDefinitionMessageSchema = defineSchema({
  abilityId: Binary.UInt16,
  name: Binary.String,
  category: Binary.UInt8,
  creatorTier: Binary.UInt8,
  creatorCoreExampleStat: Binary.UInt8,
  creatorFlags: Binary.UInt8,
  pointsPower: Binary.UInt8,
  pointsVelocity: Binary.UInt8,
  pointsEfficiency: Binary.UInt8,
  pointsControl: Binary.UInt8,
  attributeMask: Binary.UInt16,
  kind: Binary.UInt8,
  speed: Binary.Float32,
  damage: Binary.Float32,
  radius: Binary.Float32,
  cooldownSeconds: Binary.Float32,
  lifetimeSeconds: Binary.Float32,
  spawnForwardOffset: Binary.Float32,
  spawnVerticalOffset: Binary.Float32,
  meleeRange: Binary.Float32,
  meleeArcDegrees: Binary.Float32
});

export const abilityStateMessageSchema = defineSchema({
  primaryMouseSlot: Binary.UInt8,
  secondaryMouseSlot: Binary.UInt8
});

export const abilityUseMessageSchema = defineSchema({
  ownerNid: Binary.UInt16,
  abilityId: Binary.UInt16,
  category: Binary.UInt8,
  serverTick: Binary.UInt32,
  x: Binary.Float32,
  y: Binary.Float32,
  z: Binary.Float32
});

export const abilityOwnershipMessageSchema = defineSchema({
  unlockedAbilityIds: Binary.UInt16Array
});

export const serverPopulationMessageSchema = defineSchema({
  onlinePlayers: Binary.UInt16
});

export const mapTransferMessageSchema = defineSchema({
  wsUrl: Binary.String,
  joinTicket: Binary.String,
  mapId: Binary.String,
  instanceId: Binary.String,
  seed: Binary.Int32,
  groundHalfExtent: Binary.Float32,
  groundHalfThickness: Binary.Float32,
  cubeCount: Binary.UInt16
});

// Runtime descriptor convention:
// - Authoritative server sends descriptor messages on-demand for dynamic/runtime-authored content.
// - Client caches descriptors as render/UI metadata only (not gameplay authority).
// - Snapshot payloads reference ids; descriptor messages provide presentation fields by id.
// - Additional descriptor channels (ability/appearance/etc) should follow the same pattern.
export const playerSettingsCommandSchema = defineSchema({
  settingsJson: Binary.String
});
export const playerSettingsMessageSchema = defineSchema({
  settingsJson: Binary.String
});
export const serverAlertMessageSchema = defineSchema({
  text: Binary.String,
  severity: Binary.UInt8
});
export const uiViewOpenMessageSchema = defineSchema({
  viewId: Binary.UInt16,
  viewType: Binary.String,
  revision: Binary.UInt16,
  stateJson: Binary.String
});
export const uiViewPatchMessageSchema = defineSchema({
  viewId: Binary.UInt16,
  baseRevision: Binary.UInt16,
  revision: Binary.UInt16,
  patchJson: Binary.String
});
export const uiViewCloseMessageSchema = defineSchema({
  viewId: Binary.UInt16,
  reason: Binary.String
});
export const uiIntentCommandSchema = defineSchema({
  viewId: Binary.UInt16,
  sequence: Binary.UInt16,
  intentJson: Binary.String
});
export const uiIntentResultMessageSchema = defineSchema({
  viewId: Binary.UInt16,
  sequence: Binary.UInt16,
  ok: Binary.Boolean,
  message: Binary.String,
  resultJson: Binary.String
});

export const serverNetDiagnosticsMessageSchema = defineSchema({
  connectedPlayers: Binary.UInt16,
  windowSeconds: Binary.UInt8,
  avgInboundBytesPerSecond: Binary.Float32,
  avgOutboundBytesPerSecond: Binary.Float32,
  avgInboundMessagesPerSecond: Binary.Float32,
  avgOutboundMessagesPerSecond: Binary.Float32,
  p95InboundBytesPerSecond: Binary.Float32,
  p95OutboundBytesPerSecond: Binary.Float32,
  p95InboundMessagesPerSecond: Binary.Float32,
  p95OutboundMessagesPerSecond: Binary.Float32,
  warningMask: Binary.UInt8
});

export const referenceFrameVolumeEnteredMessageSchema = defineSchema({
  framePid: Binary.Int32,
  volumeId: Binary.String
});

export const referenceFrameVolumeExitedMessageSchema = defineSchema({
  framePid: Binary.Int32,
  volumeId: Binary.String
});

export const ncontext = new Context();
ncontext.register(NType.InputCommand, inputCommandSchema);
ncontext.register(NType.AbilityCommand, abilityCommandSchema);
ncontext.register(NType.RuntimeEntity, runtimeEntitySchema);
ncontext.register(NType.WorldAnchorEntity, worldAnchorEntitySchema);
ncontext.register(NType.IdentityMessage, identityMessageSchema);
ncontext.register(NType.InputAckMessage, inputAckMessageSchema);
ncontext.register(NType.AbilityDefinitionMessage, abilityDefinitionMessageSchema);
ncontext.register(NType.AbilityStateMessage, abilityStateMessageSchema);
ncontext.register(NType.AbilityUseMessage, abilityUseMessageSchema);
ncontext.register(NType.ServerPopulationMessage, serverPopulationMessageSchema);
ncontext.register(NType.AbilityOwnershipMessage, abilityOwnershipMessageSchema);
ncontext.register(NType.MapTransferCommand, mapTransferCommandSchema);
ncontext.register(NType.MapTransferMessage, mapTransferMessageSchema);
ncontext.register(NType.PlayerSettingsCommand, playerSettingsCommandSchema);
ncontext.register(NType.PlayerSettingsMessage, playerSettingsMessageSchema);
ncontext.register(NType.ServerAlertMessage, serverAlertMessageSchema);
ncontext.register(NType.UiViewOpenMessage, uiViewOpenMessageSchema);
ncontext.register(NType.UiViewPatchMessage, uiViewPatchMessageSchema);
ncontext.register(NType.UiViewCloseMessage, uiViewCloseMessageSchema);
ncontext.register(NType.UiIntentCommand, uiIntentCommandSchema);
ncontext.register(NType.UiIntentResultMessage, uiIntentResultMessageSchema);
ncontext.register(NType.ServerNetDiagnosticsMessage, serverNetDiagnosticsMessageSchema);
ncontext.register(NType.ReferenceFrameVolumeEnteredMessage, referenceFrameVolumeEnteredMessageSchema);
ncontext.register(NType.ReferenceFrameVolumeExitedMessage, referenceFrameVolumeExitedMessageSchema);

export interface InputCommand {
  ntype: NType.InputCommand;
  sequence: number;
  forward: number;
  strafe: number;
  jump: boolean;
  toggleFlyPressed: boolean;
  sprint: boolean;
  usePrimaryPressed: boolean;
  usePrimaryHeld: boolean;
  useSecondaryPressed: boolean;
  useSecondaryHeld: boolean;
  castSlotPressed: boolean;
  castSlotIndex: number;
  yaw: number;
  yawDelta: number;
  pitch: number;
}

export interface AbilityCommand {
  ntype: NType.AbilityCommand;
  applyPrimaryMouseSlot: boolean;
  primaryMouseSlot: number;
  applySecondaryMouseSlot: boolean;
  secondaryMouseSlot: number;
  applyForgetAbility: boolean;
  forgetAbilityId: number;
}

export interface MapTransferCommand {
  ntype: NType.MapTransferCommand;
  targetMapInstanceId: string;
}

export interface RuntimeEntity {
  nid: number;
  ntype: NType.RuntimeEntity;
  modelId: number;
  renderArchetypeId: number;
  materialVariantId: number;
  tintColorRgb: number;
  uniformScalePct: number;
  equippedWeaponArchetypeId: number;
  equippedWeaponTintColorRgb: number;
  equippedHeadArchetypeId: number;
  equippedHeadTintColorRgb: number;
  equippedBodyArchetypeId: number;
  equippedBodyTintColorRgb: number;
  equippedLegsArchetypeId: number;
  equippedLegsTintColorRgb: number;
  equippedAccessoryArchetypeId: number;
  equippedAccessoryTintColorRgb: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  grounded: boolean;
  movementMode: number;
  health: number;
  maxHealth: number;
  pickupDefinitionId: number;
  itemQuantity: number;
}

export interface WorldAnchorEntity {
  nid: number;
  ntype: NType.WorldAnchorEntity;
  modelId: number;
  worldAnchorId: number;
  worldAnchorKind: number;
  worldAnchorArchetypeId: number;
  worldAnchorSeed: number;
  worldAnchorEnvironmentId: number;
  worldAnchorStreamingRadius: number;
  worldAnchorInfluenceRadius: number;
  locationPid: number;
  locationKind: number;
  locationArchetypeId: number;
  locationSeed: number;
  locationEnvironmentId: number;
  locationStreamingRadius: number;
  locationInfluenceRadius: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}

export interface IdentityMessage {
  ntype: NType.IdentityMessage;
  playerNid: number;
}

export interface InputAckMessage {
  ntype: NType.InputAckMessage;
  sequence: number;
  serverTick: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  groundedPlatformPid: number;
  carriedFramePid: number;
  movementMode: number;
}

export interface AbilityDefinitionMessage {
  ntype: NType.AbilityDefinitionMessage;
  abilityId: number;
  name: string;
  category: number;
  creatorTier: number;
  creatorCoreExampleStat: number;
  creatorFlags: number;
  pointsPower: number;
  pointsVelocity: number;
  pointsEfficiency: number;
  pointsControl: number;
  attributeMask: number;
  kind: number;
  speed: number;
  damage: number;
  radius: number;
  cooldownSeconds: number;
  lifetimeSeconds: number;
  spawnForwardOffset: number;
  spawnVerticalOffset: number;
  meleeRange: number;
  meleeArcDegrees: number;
}

export interface AbilityStateMessage {
  ntype: NType.AbilityStateMessage;
  primaryMouseSlot: number;
  secondaryMouseSlot: number;
}

export interface AbilityUseMessage {
  ntype: NType.AbilityUseMessage;
  ownerNid: number;
  abilityId: number;
  category: number;
  serverTick: number;
  x: number;
  y: number;
  z: number;
}

export interface AbilityOwnershipMessage {
  ntype: NType.AbilityOwnershipMessage;
  unlockedAbilityIds: number[];
}

export interface ServerPopulationMessage {
  ntype: NType.ServerPopulationMessage;
  onlinePlayers: number;
}

export interface MapTransferMessage {
  ntype: NType.MapTransferMessage;
  wsUrl: string;
  joinTicket: string;
  mapId: string;
  instanceId: string;
  seed: number;
  groundHalfExtent: number;
  groundHalfThickness: number;
  cubeCount: number;
}

export interface PlayerSettingsCommand {
  ntype: NType.PlayerSettingsCommand;
  settingsJson: string;
}

export interface PlayerSettingsMessage {
  ntype: NType.PlayerSettingsMessage;
  settingsJson: string;
}

export interface ServerAlertMessage {
  ntype: NType.ServerAlertMessage;
  text: string;
  severity: number;
}


export interface UiViewOpenMessage {
  ntype: NType.UiViewOpenMessage;
  viewId: number;
  viewType: string;
  revision: number;
  stateJson: string;
}

export interface UiViewPatchMessage {
  ntype: NType.UiViewPatchMessage;
  viewId: number;
  baseRevision: number;
  revision: number;
  patchJson: string;
}

export interface UiViewCloseMessage {
  ntype: NType.UiViewCloseMessage;
  viewId: number;
  reason: string;
}

export interface UiIntentCommand {
  ntype: NType.UiIntentCommand;
  viewId: number;
  sequence: number;
  intentJson: string;
}

export interface UiIntentResultMessage {
  ntype: NType.UiIntentResultMessage;
  viewId: number;
  sequence: number;
  ok: boolean;
  message: string;
  resultJson: string;
}

export type CreatorCommandAction =
  | { kind: "set_name"; name: string }
  | { kind: "select_base_blueprint"; blueprintId: number }
  | { kind: "step_field"; fieldId: string; delta: number }
  | { kind: "set_field"; fieldId: string; valueJson: string }
  | { kind: "submit_create" }
  | { kind: "submit_create_and_instantiate" }
  | { kind: "fork_item_instance_blueprint"; itemInstanceId: number; name?: string }
  | { kind: "inspect_actor_capabilities" }
  | { kind: "set_actor_capability"; key: string; value: number }
  | { kind: "forget_blueprint"; blueprintId: number };

export interface CreatorCommandPayload {
  sessionId: number;
  sequence: number;
  actions: CreatorCommandAction[];
}

export interface NormalizedCreatorCommand {
  sessionId: number;
  sequence: number;
  setName?: boolean;
  name?: string;
  selectBaseBlueprint?: boolean;
  baseBlueprintId?: number;
  stepField?: boolean;
  fieldId?: string;
  fieldDelta?: number;
  setField?: boolean;
  fieldValueJson?: string;
  submitCreate?: boolean;
  instantiateCreatedBlueprint?: boolean;
  forkItemInstanceBlueprint?: boolean;
  itemInstanceId?: number;
  inspectActorCapabilities?: boolean;
  setActorCapability?: boolean;
  capabilityKey?: string;
  capabilityValue?: number;
  forgetBlueprintId?: number;
}

export function encodeCreatorCommandPayload(payload: CreatorCommandPayload): string {
  return JSON.stringify(payload);
}

export function decodeCreatorCommandPayloadJson(
  commandJson: string,
  maxBytes: number
): CreatorCommandPayload | null {
  if (typeof commandJson !== "string" || commandJson.length <= 0 || commandJson.length > maxBytes) {
    return null;
  }
  try {
    const payload = JSON.parse(commandJson) as CreatorCommandPayload;
    if (
      !payload ||
      typeof payload !== "object" ||
      !Number.isFinite(payload.sessionId) ||
      !Number.isFinite(payload.sequence) ||
      !Array.isArray(payload.actions)
    ) {
      return null;
    }
    return {
      sessionId: Math.max(0, Math.min(0xffff, Math.floor(payload.sessionId))),
      sequence: Math.max(0, Math.min(0xffff, Math.floor(payload.sequence))),
      actions: payload.actions
    };
  } catch {
    return null;
  }
}

export function normalizeCreatorCommandFromPayload(payload: CreatorCommandPayload): NormalizedCreatorCommand {
  const normalized: NormalizedCreatorCommand = {
    sessionId: payload.sessionId,
    sequence: payload.sequence
  };
  for (const action of payload.actions) {
    if (action.kind === "set_name") {
      normalized.setName = true;
      normalized.name = action.name;
      continue;
    }
    if (action.kind === "select_base_blueprint") {
      normalized.selectBaseBlueprint = true;
      normalized.baseBlueprintId = action.blueprintId;
      continue;
    }
    if (action.kind === "step_field") {
      normalized.stepField = true;
      normalized.fieldId = action.fieldId;
      normalized.fieldDelta = action.delta;
      continue;
    }
    if (action.kind === "set_field") {
      normalized.setField = true;
      normalized.fieldId = action.fieldId;
      normalized.fieldValueJson = action.valueJson;
      continue;
    }
    if (action.kind === "submit_create") {
      normalized.submitCreate = true;
      continue;
    }
    if (action.kind === "submit_create_and_instantiate") {
      normalized.submitCreate = true;
      normalized.instantiateCreatedBlueprint = true;
      continue;
    }
    if (action.kind === "fork_item_instance_blueprint") {
      normalized.forkItemInstanceBlueprint = true;
      normalized.itemInstanceId = action.itemInstanceId;
      normalized.name = action.name;
      continue;
    }
    if (action.kind === "inspect_actor_capabilities") {
      normalized.inspectActorCapabilities = true;
      continue;
    }
    if (action.kind === "set_actor_capability") {
      normalized.setActorCapability = true;
      normalized.capabilityKey = action.key;
      normalized.capabilityValue = action.value;
      continue;
    }
    if (action.kind === "forget_blueprint") {
      normalized.forgetBlueprintId = action.blueprintId;
    }
  }
  return normalized;
}

export interface CreatorStatePayload {
  sessionId: number;
  ackSequence: number;
  profileId: string;
  stationSessionId?: string | null;
  draftJson: string;
  fieldDefinitionsJson: string;
  renderBundleJson: string;
  capacityJson: string;
  validationJson: string;
  productionPreviewJson?: string;
  itemDescriptorsJson?: string;
  availableBlueprintCount: number;
  availableBlueprintsJson: string;
}

export interface ServerNetDiagnosticsMessage {
  ntype: NType.ServerNetDiagnosticsMessage;
  connectedPlayers: number;
  windowSeconds: number;
  avgInboundBytesPerSecond: number;
  avgOutboundBytesPerSecond: number;
  avgInboundMessagesPerSecond: number;
  avgOutboundMessagesPerSecond: number;
  p95InboundBytesPerSecond: number;
  p95OutboundBytesPerSecond: number;
  p95InboundMessagesPerSecond: number;
  p95OutboundMessagesPerSecond: number;
  warningMask: number;
}

export interface ReferenceFrameVolumeEnteredMessage {
  ntype: NType.ReferenceFrameVolumeEnteredMessage;
  framePid: number;
  volumeId: string;
}

export interface ReferenceFrameVolumeExitedMessage {
  ntype: NType.ReferenceFrameVolumeExitedMessage;
  framePid: number;
  volumeId: string;
}

export const NET_DIAGNOSTICS_WARNING_AVG_OUT_BYTES = 1 << 0;
export const NET_DIAGNOSTICS_WARNING_AVG_IN_BYTES = 1 << 1;
export const NET_DIAGNOSTICS_WARNING_AVG_OUT_MESSAGES = 1 << 2;
export const NET_DIAGNOSTICS_WARNING_AVG_IN_MESSAGES = 1 << 3;
export const NET_DIAGNOSTICS_WARNING_P95_OUT_BYTES = 1 << 4;
export const NET_DIAGNOSTICS_WARNING_P95_IN_BYTES = 1 << 5;
export const NET_DIAGNOSTICS_WARNING_P95_OUT_MESSAGES = 1 << 6;
export const NET_DIAGNOSTICS_WARNING_P95_IN_MESSAGES = 1 << 7;

