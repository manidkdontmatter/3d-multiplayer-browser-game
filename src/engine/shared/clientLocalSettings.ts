/**
 * Purpose: This file defines client-device-only settings schema and validation helpers.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Used by the client to persist browser/device-specific settings outside server persistence.
 */

export const GRAPHICS_PRESETS = ["low", "medium", "high"] as const;
export const ANTI_ALIASING_MODES = ["off", "msaa"] as const;

export type GraphicsPreset = typeof GRAPHICS_PRESETS[number];
export type AntiAliasingMode = typeof ANTI_ALIASING_MODES[number];

export interface ClientLocalSettings {
  graphicsPreset: GraphicsPreset;
  antiAliasingMode: AntiAliasingMode;
}

export const DEFAULT_CLIENT_LOCAL_SETTINGS: ClientLocalSettings = Object.freeze({
  graphicsPreset: "high",
  antiAliasingMode: "msaa"
});

export function coerceClientLocalSettings(raw: unknown): ClientLocalSettings {
  const source = (raw && typeof raw === "object") ? (raw as Partial<ClientLocalSettings>) : {};
  return {
    graphicsPreset: coerceGraphicsPreset(source.graphicsPreset),
    antiAliasingMode: coerceAntiAliasingMode(source.antiAliasingMode)
  };
}

function coerceGraphicsPreset(raw: unknown): GraphicsPreset {
  if (raw === "low" || raw === "medium" || raw === "high") {
    return raw;
  }
  return DEFAULT_CLIENT_LOCAL_SETTINGS.graphicsPreset;
}

function coerceAntiAliasingMode(raw: unknown): AntiAliasingMode {
  if (raw === "off" || raw === "msaa") {
    return raw;
  }
  return DEFAULT_CLIENT_LOCAL_SETTINGS.antiAliasingMode;
}
