/**
 * Purpose: This file validates deterministic hotbar digit-key intent mapping used by client input.
 * Scope: It belongs to the developer validation and maintenance scripts.
 * Human Summary: Used as an offline/developer script rather than in the realtime gameplay loop.
 */
import process from "node:process";
import { resolveDigitHotbarIntent } from "../src/engine/client/runtime/InputController";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runDigitIntentRegression(): void {
  const primaryBind = resolveDigitHotbarIntent({
    keyCode: "Digit1",
    altKey: false,
    digitKeysActivateHotbar: false
  });
  assert(primaryBind.kind === "bind", "Expected Digit1 to produce bind intent when setting disabled.");
  assert(primaryBind.kind !== "none" && primaryBind.slot === 0, "Expected Digit1 to map to slot 0.");
  assert(primaryBind.kind !== "none" && primaryBind.kind !== "activate" && primaryBind.target === "primary", "Expected primary bind.");

  const secondaryBind = resolveDigitHotbarIntent({
    keyCode: "Digit0",
    altKey: true,
    digitKeysActivateHotbar: false
  });
  assert(secondaryBind.kind === "bind", "Expected Alt+Digit0 to produce bind intent.");
  assert(secondaryBind.kind !== "none" && secondaryBind.slot === 9, "Expected Digit0 to map to slot 9.");
  assert(secondaryBind.kind !== "none" && secondaryBind.kind !== "activate" && secondaryBind.target === "secondary", "Expected secondary bind.");

  const activate = resolveDigitHotbarIntent({
    keyCode: "Digit3",
    altKey: false,
    digitKeysActivateHotbar: true
  });
  assert(activate.kind === "activate", "Expected Digit3 to activate slot when setting enabled.");
  assert(activate.kind === "activate" && activate.slot === 2, "Expected Digit3 to map to slot 2.");

  const nonDigit = resolveDigitHotbarIntent({
    keyCode: "KeyQ",
    altKey: false,
    digitKeysActivateHotbar: true
  });
  assert(nonDigit.kind === "none", "Expected non-digit keys to produce no hotbar intent.");
}

try {
  runDigitIntentRegression();
  console.log("[hotbar-input-regression] PASS");
} catch (error) {
  console.error("[hotbar-input-regression] FAIL", error);
  process.exit(1);
}
