/**
 * Purpose: This file verifies pilot seat authority invariants remain enforced.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import process from "node:process";
import { readFileSync } from "node:fs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const source = readFileSync("src/engine/server/GameSimulation.ts", "utf8");
  assert(
    source.includes("pilotUserIdByReferenceFramePid"),
    "Pilot seat ownership map must exist for per-anchor seat contention."
  );
  assert(
    source.includes('this.queueServerAlertForUser(userId, "Pilot console is in use.", "warning");'),
    "Pilot seat contention must send explicit user-facing rejection alert."
  );
  assert(
    source.includes("this.releaseUserPilotSeat(user.id);"),
    "Pilot seat must be released on disconnect/despawn paths."
  );
  assert(
    source.includes("this.locationRootSystem.applyPilotControlIntent("),
    "Pilot mode must drive authoritative world-anchor movement."
  );
  assert(
    source.includes("if (this.isUserInPilotControlMode(userId))") &&
      source.includes("this.pilotControlIntentByUserId.set(userId, this.resolvePilotIntentFromCommands(commands));"),
    "Pilot input path must capture pilot intents and bypass normal character input."
  );
  console.log("[pilot-seat-regression] PASS");
}

try {
  run();
} catch (error) {
  console.error("[pilot-seat-regression] FAIL", error);
  process.exit(1);
}

