/**
 * Purpose: This file defines canonical creator appearance channels and placeholder runtime resolution rules.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use one appearance vocabulary and deterministic resolution.
 */
export const CREATOR_APPEARANCE_COMPONENT_ID = "CreatorAppearanceProfile";
export const CREATOR_READY_APPEARANCE_FIELD_ID = "ready_appearance";
export const CREATOR_ACTIVATION_APPEARANCE_FIELD_ID = "activation_appearance";

export type CreatorAppearanceId = "red" | "green" | "blue";

export interface CreatorAppearanceProfile {
  readyAppearanceId?: string;
  activationAppearanceId?: string;
}

export type ReadyAppearanceContext = "equipped" | "pickup";
export interface ReadyAppearanceRuntimeBinding {
  readonly equipped: {
    readonly tintColorRgb: number;
    readonly renderArchetypeId: number | null;
    readonly assetId: string | null;
    readonly previewTextureUrl: string | null;
  };
  readonly pickup: {
    readonly tintColorRgb: number;
    readonly renderArchetypeId: number | null;
    readonly assetId: string | null;
    readonly previewTextureUrl: string | null;
  };
}

export interface ActivationAppearanceRuntimeBinding {
  readonly projectileKind: number;
  readonly previewTintColorRgb: number;
  readonly assetId: string | null;
  readonly previewTextureUrl: string | null;
}

export interface CreatorAppearanceBindingCatalog {
  readonly readyBindings?: Record<string, {
    readonly equipped?: {
      readonly tintColorRgb?: number;
      readonly renderArchetypeId?: number | null;
      readonly assetId?: string | null;
      readonly previewTextureUrl?: string | null;
    };
    readonly pickup?: {
      readonly tintColorRgb?: number;
      readonly renderArchetypeId?: number | null;
      readonly assetId?: string | null;
      readonly previewTextureUrl?: string | null;
    };
  }>;
  readonly activationBindings?: Record<string, {
    readonly projectileKind?: number;
    readonly previewTintColorRgb?: number;
    readonly assetId?: string | null;
    readonly previewTextureUrl?: string | null;
  }>;
}

let READY_APPEARANCE_BINDINGS = getDefaultReadyAppearanceBindings();
let ACTIVATION_APPEARANCE_BINDINGS = getDefaultActivationAppearanceBindings();

export function getCreatorAppearanceOptions(): ReadonlyArray<{
  value: CreatorAppearanceId;
  label: string;
  description: string;
}> {
  return Object.freeze([
    { value: "red", label: "Red", description: "Placeholder red appearance preset." },
    { value: "green", label: "Green", description: "Placeholder green appearance preset." },
    { value: "blue", label: "Blue", description: "Placeholder blue appearance preset." }
  ]);
}

export function injectCreatorAppearanceBindingCatalog(raw: CreatorAppearanceBindingCatalog): void {
  READY_APPEARANCE_BINDINGS = parseReadyAppearanceBindings(raw.readyBindings);
  ACTIVATION_APPEARANCE_BINDINGS = parseActivationAppearanceBindings(raw.activationBindings);
}

export function supportsCreatorReadyAppearance(profileId: AppearanceCapableCreatorProfileId): boolean {
  return profileId === "ability_creator" || profileId === "item_creator" || profileId === "character_creator";
}

export function supportsCreatorActivationAppearance(profileId: AppearanceCapableCreatorProfileId): boolean {
  return profileId === "ability_creator" || profileId === "item_creator";
}

export function normalizeCreatorAppearanceId(value: unknown): CreatorAppearanceId {
  if (value === "red" || value === "green" || value === "blue") {
    return value;
  }
  return "blue";
}

export function resolveReadyAppearanceTintColorRgb(readyAppearanceId: string | null | undefined): number {
  const normalized = normalizeCreatorAppearanceId(readyAppearanceId);
  if (normalized === "red") return 0xff3f3f;
  if (normalized === "green") return 0x45ff66;
  return 0x4da3ff;
}

export function resolveCreatorAppearanceTintColorRgb(appearanceId: string | null | undefined): number {
  return resolveReadyAppearanceTintColorRgb(appearanceId);
}

export function resolveReadyAppearanceTintColorByContext(
  readyAppearanceId: string | null | undefined,
  context: ReadyAppearanceContext
): number {
  return context === "pickup"
    ? resolveReadyAppearanceRuntimeBinding(readyAppearanceId).pickup.tintColorRgb
    : resolveReadyAppearanceRuntimeBinding(readyAppearanceId).equipped.tintColorRgb;
}

export function resolveActivationAppearanceProjectileKind(activationAppearanceId: string | null | undefined): number {
  return resolveActivationAppearanceRuntimeBinding(activationAppearanceId).projectileKind;
}

export function resolveReadyAppearanceRuntimeBinding(
  readyAppearanceId: string | null | undefined
): ReadyAppearanceRuntimeBinding {
  const normalized = normalizeCreatorAppearanceId(readyAppearanceId);
  return READY_APPEARANCE_BINDINGS.get(normalized) ?? READY_APPEARANCE_BINDINGS.get("blue") ?? {
    equipped: { tintColorRgb: 0x4da3ff, renderArchetypeId: 42, assetId: null, previewTextureUrl: null },
    pickup: { tintColorRgb: 0x8fc7ff, renderArchetypeId: 42, assetId: null, previewTextureUrl: null }
  };
}

export function resolveActivationAppearanceRuntimeBinding(
  activationAppearanceId: string | null | undefined
): ActivationAppearanceRuntimeBinding {
  const normalized = normalizeCreatorAppearanceId(activationAppearanceId);
  return ACTIVATION_APPEARANCE_BINDINGS.get(normalized) ?? ACTIVATION_APPEARANCE_BINDINGS.get("blue") ?? {
    projectileKind: 3,
    previewTintColorRgb: 0x78dfff,
    assetId: null,
    previewTextureUrl: null
  };
}

function parseReadyAppearanceBindings(
  raw: CreatorAppearanceBindingCatalog["readyBindings"]
): Map<string, ReadyAppearanceRuntimeBinding> {
  const defaults = getDefaultReadyAppearanceBindings();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  const parsed = new Map<string, ReadyAppearanceRuntimeBinding>();
  for (const [appearanceId, binding] of Object.entries(raw)) {
    const normalizedId = normalizeCreatorAppearanceId(appearanceId);
    const defaultBinding = defaults.get(normalizedId) ?? defaults.get("blue");
    if (!binding || typeof binding !== "object" || !defaultBinding) {
      parsed.set(normalizedId, defaultBinding ?? {
        equipped: { tintColorRgb: 0x4da3ff, renderArchetypeId: 42, assetId: null, previewTextureUrl: null },
        pickup: { tintColorRgb: 0x8fc7ff, renderArchetypeId: 42, assetId: null, previewTextureUrl: null }
      });
      continue;
    }
    parsed.set(normalizedId, {
      equipped: {
        tintColorRgb: sanitizeTintColorRgb(binding.equipped?.tintColorRgb, defaultBinding.equipped.tintColorRgb),
        renderArchetypeId: sanitizeOptionalRenderArchetypeId(binding.equipped?.renderArchetypeId, defaultBinding.equipped.renderArchetypeId),
        assetId: sanitizeOptionalAssetId(binding.equipped?.assetId, defaultBinding.equipped.assetId),
        previewTextureUrl: sanitizeOptionalPublicAssetUrl(
          binding.equipped?.previewTextureUrl,
          defaultBinding.equipped.previewTextureUrl
        )
      },
      pickup: {
        tintColorRgb: sanitizeTintColorRgb(binding.pickup?.tintColorRgb, defaultBinding.pickup.tintColorRgb),
        renderArchetypeId: sanitizeOptionalRenderArchetypeId(binding.pickup?.renderArchetypeId, defaultBinding.pickup.renderArchetypeId),
        assetId: sanitizeOptionalAssetId(binding.pickup?.assetId, defaultBinding.pickup.assetId),
        previewTextureUrl: sanitizeOptionalPublicAssetUrl(
          binding.pickup?.previewTextureUrl,
          defaultBinding.pickup.previewTextureUrl
        )
      }
    });
  }
  for (const [defaultId, defaultBinding] of defaults.entries()) {
    if (!parsed.has(defaultId)) {
      parsed.set(defaultId, defaultBinding);
    }
  }
  return parsed;
}

function parseActivationAppearanceBindings(
  raw: CreatorAppearanceBindingCatalog["activationBindings"]
): Map<string, ActivationAppearanceRuntimeBinding> {
  const defaults = getDefaultActivationAppearanceBindings();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }
  const parsed = new Map<string, ActivationAppearanceRuntimeBinding>();
  for (const [appearanceId, binding] of Object.entries(raw)) {
    const normalizedId = normalizeCreatorAppearanceId(appearanceId);
    const defaultBinding = defaults.get(normalizedId) ?? defaults.get("blue") ?? {
      projectileKind: 3,
      previewTintColorRgb: 0x78dfff,
      assetId: null,
      previewTextureUrl: null
    };
    parsed.set(normalizedId, {
      projectileKind: sanitizeProjectileKind(binding?.projectileKind, defaultBinding.projectileKind),
      previewTintColorRgb: sanitizeTintColorRgb(binding?.previewTintColorRgb, defaultBinding.previewTintColorRgb),
      assetId: sanitizeOptionalAssetId(binding?.assetId, defaultBinding.assetId),
      previewTextureUrl: sanitizeOptionalPublicAssetUrl(binding?.previewTextureUrl, defaultBinding.previewTextureUrl)
    });
  }
  for (const [defaultId, defaultBinding] of defaults.entries()) {
    if (!parsed.has(defaultId)) {
      parsed.set(defaultId, defaultBinding);
    }
  }
  return parsed;
}

function getDefaultReadyAppearanceBindings(): Map<string, ReadyAppearanceRuntimeBinding> {
  return new Map<string, ReadyAppearanceRuntimeBinding>([
    ["red", { equipped: { tintColorRgb: 0xff3f3f, renderArchetypeId: 40, assetId: null, previewTextureUrl: null }, pickup: { tintColorRgb: 0xff877f, renderArchetypeId: 40, assetId: null, previewTextureUrl: null } }],
    ["green", { equipped: { tintColorRgb: 0x45ff66, renderArchetypeId: 41, assetId: null, previewTextureUrl: null }, pickup: { tintColorRgb: 0x93ffab, renderArchetypeId: 41, assetId: null, previewTextureUrl: null } }],
    ["blue", { equipped: { tintColorRgb: 0x4da3ff, renderArchetypeId: 42, assetId: null, previewTextureUrl: null }, pickup: { tintColorRgb: 0x8fc7ff, renderArchetypeId: 42, assetId: null, previewTextureUrl: null } }]
  ]);
}

function getDefaultActivationAppearanceBindings(): Map<string, ActivationAppearanceRuntimeBinding> {
  return new Map<string, ActivationAppearanceRuntimeBinding>([
    ["red", { projectileKind: 1, previewTintColorRgb: 0xff7b7b, assetId: null, previewTextureUrl: null }],
    ["green", { projectileKind: 2, previewTintColorRgb: 0x68ff9e, assetId: null, previewTextureUrl: null }],
    ["blue", { projectileKind: 3, previewTintColorRgb: 0x78dfff, assetId: null, previewTextureUrl: null }]
  ]);
}

function sanitizeTintColorRgb(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(0, Math.min(0xffffff, Math.floor(raw)));
}

function sanitizeOptionalRenderArchetypeId(raw: unknown, fallback: number | null): number | null {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  const normalized = Math.max(0, Math.floor(raw));
  return normalized > 0 ? normalized : null;
}

function sanitizeProjectileKind(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  const normalized = Math.max(1, Math.floor(raw));
  return normalized;
}

function sanitizeOptionalAssetId(raw: unknown, fallback: string | null): string | null {
  if (raw === null || raw === undefined) {
    return fallback ?? null;
  }
  if (typeof raw !== "string") {
    return fallback ?? null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : (fallback ?? null);
}

function sanitizeOptionalPublicAssetUrl(raw: unknown, fallback: string | null): string | null {
  if (raw === null || raw === undefined) {
    return fallback ?? null;
  }
  if (typeof raw !== "string") {
    return fallback ?? null;
  }
  const normalized = raw.trim();
  if (normalized.length <= 0) {
    return fallback ?? null;
  }
  if (!normalized.startsWith("/assets/")) {
    return fallback ?? null;
  }
  if (normalized.includes("..")) {
    return fallback ?? null;
  }
  return normalized;
}
type AppearanceCapableCreatorProfileId =
  | "ability_creator"
  | "character_creator"
  | "item_creator"
  | "mind_creator"
  | "tile_creator";
