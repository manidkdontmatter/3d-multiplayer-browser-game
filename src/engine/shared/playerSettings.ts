/**
 * Purpose: This file defines canonical player settings schema and validation helpers.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */

export const MIN_MOUSE_SENSITIVITY = 0.2;
export const MAX_MOUSE_SENSITIVITY = 2.5;
export const DEFAULT_MOUSE_SENSITIVITY = 1;
export const MIN_FIELD_OF_VIEW = 70;
export const MAX_FIELD_OF_VIEW = 110;
export const DEFAULT_FIELD_OF_VIEW = 80;
export const VOICE_CHAT_MODES = ["push_to_talk", "open_mic"] as const;

export type VoiceChatMode = typeof VOICE_CHAT_MODES[number];

export interface PlayerSettings {
  digitKeysActivateHotbar: boolean;
  mouseSensitivity: number;
  mouseSmoothing: boolean;
  fieldOfView: number;
  voiceChatMode: VoiceChatMode;
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = Object.freeze({
  digitKeysActivateHotbar: false,
  mouseSensitivity: DEFAULT_MOUSE_SENSITIVITY,
  mouseSmoothing: false,
  fieldOfView: DEFAULT_FIELD_OF_VIEW,
  voiceChatMode: "push_to_talk"
});

export function coercePlayerSettings(raw: unknown): PlayerSettings {
  const source = (raw && typeof raw === "object") ? (raw as Partial<PlayerSettings>) : {};
  return {
    digitKeysActivateHotbar: Boolean(source.digitKeysActivateHotbar),
    mouseSensitivity: clampNumber(
      source.mouseSensitivity,
      MIN_MOUSE_SENSITIVITY,
      MAX_MOUSE_SENSITIVITY,
      DEFAULT_MOUSE_SENSITIVITY
    ),
    mouseSmoothing: Boolean(source.mouseSmoothing),
    fieldOfView: Math.round(
      clampNumber(source.fieldOfView, MIN_FIELD_OF_VIEW, MAX_FIELD_OF_VIEW, DEFAULT_FIELD_OF_VIEW)
    ),
    voiceChatMode: coerceVoiceChatMode(source.voiceChatMode)
  };
}

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  if (raw <= min) {
    return min;
  }
  if (raw >= max) {
    return max;
  }
  return raw;
}

function coerceVoiceChatMode(raw: unknown): VoiceChatMode {
  if (raw === "open_mic") {
    return "open_mic";
  }
  return "push_to_talk";
}
