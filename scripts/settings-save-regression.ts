/**
 * Purpose: This file validates settings save debounce and force-flush lifecycle behavior.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import process from "node:process";
import { SettingsSaveScheduler } from "../src/engine/client/runtime/SettingsSaveScheduler";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runSettingsSaveSchedulerRegression(): void {
  const scheduler = new SettingsSaveScheduler(1500);

  scheduler.markDirty(100);
  assert(!scheduler.consumeShouldFlush(1200), "Should not flush before debounce window.");
  assert(scheduler.consumeShouldFlush(1700), "Should flush at/after debounce time.");
  assert(!scheduler.consumeShouldFlush(1800), "Flush should clear dirty state.");

  scheduler.markDirty(2000);
  assert(scheduler.forceFlush(), "Force flush should flush when dirty.");
  assert(!scheduler.forceFlush(), "Force flush should be false when already clean.");
}

try {
  runSettingsSaveSchedulerRegression();
  console.log("[settings-save-regression] PASS");
} catch (error) {
  console.error("[settings-save-regression] FAIL", error);
  process.exit(1);
}
