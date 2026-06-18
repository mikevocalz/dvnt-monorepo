/**
 * Secure capture helper tests. Run:
 *   node --import tsx --test packages/app/lib/secure-capture/useSecureCaptureGuard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  isSecureCaptureShortcut,
  shouldEnableWebSecureCapture,
} from "./useSecureCaptureGuard";

function keyEvent(
  patch: Partial<Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey">>,
) {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...patch,
  } as Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey">;
}

test("secure capture feature flag honors explicit values", () => {
  assert.equal(shouldEnableWebSecureCapture("true"), true);
  assert.equal(shouldEnableWebSecureCapture("false"), false);
});

test("secure capture shortcut detector blocks print, save, screenshot, and devtools chords", () => {
  assert.equal(isSecureCaptureShortcut(keyEvent({ key: "PrintScreen" })), true);
  assert.equal(isSecureCaptureShortcut(keyEvent({ key: "p", code: "KeyP", metaKey: true })), true);
  assert.equal(isSecureCaptureShortcut(keyEvent({ key: "s", code: "KeyS", ctrlKey: true })), true);
  assert.equal(
    isSecureCaptureShortcut(keyEvent({ key: "3", code: "Digit3", metaKey: true, shiftKey: true })),
    true,
  );
  assert.equal(
    isSecureCaptureShortcut(keyEvent({ key: "I", code: "KeyI", ctrlKey: true, shiftKey: true })),
    true,
  );
  assert.equal(isSecureCaptureShortcut(keyEvent({ key: "F12", code: "F12" })), true);
});

test("secure capture shortcut detector allows ordinary room typing", () => {
  assert.equal(isSecureCaptureShortcut(keyEvent({ key: "a", code: "KeyA" })), false);
  assert.equal(isSecureCaptureShortcut(keyEvent({ key: "Enter", code: "Enter" })), false);
  assert.equal(isSecureCaptureShortcut(keyEvent({ key: "v", code: "KeyV", metaKey: true })), false);
});
