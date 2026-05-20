/**
 * Purpose: This file defines shared alert severity contracts and wire conversion helpers.
 * Scope: It belongs to the engine shared rules/data layer.
 * Human Summary: Shared by client and server so both sides use the same definitions where required.
 */

export const ALERT_SEVERITIES = ["info", "success", "warning", "error"] as const;
export type AlertSeverity = typeof ALERT_SEVERITIES[number];

export function coerceAlertSeverity(raw: unknown): AlertSeverity {
  if (raw === "success" || raw === "warning" || raw === "error") {
    return raw;
  }
  return "info";
}

export function alertSeverityToWireValue(severity: AlertSeverity): number {
  switch (severity) {
    case "success":
      return 1;
    case "warning":
      return 2;
    case "error":
      return 3;
    default:
      return 0;
  }
}

export function alertSeverityFromWireValue(raw: unknown): AlertSeverity {
  const value = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0;
  switch (value) {
    case 1:
      return "success";
    case 2:
      return "warning";
    case 3:
      return "error";
    default:
      return "info";
  }
}
