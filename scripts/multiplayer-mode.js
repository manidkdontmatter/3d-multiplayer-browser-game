// Launcher for multiplayer E2E modes so package scripts stay concise and avoid duplicated inline env strings.
import process from "node:process";

const mode = (process.argv[2] ?? "base").trim().toLowerCase();

function applyBaseFastDefaults() {
  process.env.E2E_CSP = "0";
  process.env.E2E_NETSIM = "0";
  process.env.E2E_USE_EXISTING_SERVER = "0";
  process.env.E2E_USE_EXISTING_CLIENT = "0";
  if (!process.env.E2E_ENABLE_PRIMARY_ACTION_TEST) {
    process.env.E2E_ENABLE_PRIMARY_ACTION_TEST = "0";
  }
  if (!process.env.E2E_ENABLE_SPRINT_TEST) {
    process.env.E2E_ENABLE_SPRINT_TEST = "0";
  }
  if (!process.env.E2E_ENABLE_JUMP_TEST) {
    process.env.E2E_ENABLE_JUMP_TEST = "0";
  }
  if (!process.env.E2E_ENABLE_RECONNECT_TEST) {
    process.env.E2E_ENABLE_RECONNECT_TEST = "0";
  }
}

function configureForMode(selectedMode) {
  applyBaseFastDefaults();

  if (selectedMode === "base") {
    return;
  }

  if (selectedMode === "csp") {
    process.env.E2E_CSP = "1";
    return;
  }

  if (selectedMode === "chaos") {
    process.env.E2E_CSP = "1";
    process.env.E2E_NETSIM = "1";
    process.env.E2E_MIN_REMOTE_MOVEMENT = process.env.E2E_MIN_REMOTE_MOVEMENT ?? "0.4";
    process.env.E2E_REMOTE_MOVEMENT_TIMEOUT_MS = process.env.E2E_REMOTE_MOVEMENT_TIMEOUT_MS ?? "22000";
    process.env.E2E_MIN_SPRINT_MOVEMENT = process.env.E2E_MIN_SPRINT_MOVEMENT ?? "1.0";
    process.env.E2E_MIN_JUMP_HEIGHT = process.env.E2E_MIN_JUMP_HEIGHT ?? "0.35";
    return;
  }

  if (selectedMode === "profile-5s") {
    process.env.E2E_USE_EXISTING_SERVER = "1";
    process.env.E2E_USE_EXISTING_CLIENT = "1";
    process.env.E2E_SIM_ONLY = process.env.E2E_SIM_ONLY ?? "1";
    process.env.E2E_VIEWPORT_WIDTH = process.env.E2E_VIEWPORT_WIDTH ?? "800";
    process.env.E2E_VIEWPORT_HEIGHT = process.env.E2E_VIEWPORT_HEIGHT ?? "450";
    process.env.E2E_MAX_WALLTIME_MS = process.env.E2E_MAX_WALLTIME_MS ?? "20000";
    process.env.E2E_ARTIFACTS_ON_PASS = process.env.E2E_ARTIFACTS_ON_PASS ?? "0";
    process.env.E2E_ARTIFACTS_ON_FAIL = process.env.E2E_ARTIFACTS_ON_FAIL ?? "0";
    process.env.E2E_PROFILE_CAPTURE_MS = process.env.E2E_PROFILE_CAPTURE_MS ?? "5000";
    return;
  }

  throw new Error(
    `Unknown multiplayer mode '${selectedMode}'. Expected one of: base, csp, chaos, profile-5s.`
  );
}

configureForMode(mode);
await import("./multiplayer-e2e.js");