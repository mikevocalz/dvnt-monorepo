/**
 * Secure capture guard tests. Run:
 *   node --import tsx --test packages/app/lib/secure-capture/useSecureCaptureGuard.test.ts
 *
 * The tiering tests drive `bindSecureCaptureGuard` against stub targets rather
 * than jsdom + a React renderer: the guard's whole contract is "which DOM
 * signal reaches which sink", and stub targets let us assert that exactly,
 * including listener registration and teardown.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bindSecureCaptureGuard,
  isPrintScreenKey,
  isPrintShortcut,
  isSecureCaptureShortcut,
  secureCaptureKeyTier,
  shouldEnableWebSecureCapture,
  type SecureCaptureAttemptKind,
  type SecureCaptureBlackoutReason,
  type SecureCaptureEnvironment,
} from "./useSecureCaptureGuard";
import type { SecureCaptureEventName } from "./SecureCaptureProvider";

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

/** Minimal EventTarget stand-in that records add/remove and can dispatch. */
class StubTarget {
  listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    const payload = {
      type,
      target: null,
      preventDefault() {},
      stopPropagation() {},
      ...event,
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(payload);
    }
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

interface Harness {
  root: StubTarget;
  doc: StubTarget;
  win: StubTarget;
  hidden: boolean;
  attempts: Array<{ kind: SecureCaptureAttemptKind; eventName: SecureCaptureEventName }>;
  logs: SecureCaptureEventName[];
  blackouts: SecureCaptureBlackoutReason[];
  detach: () => void;
}

function harness(
  overrides: Partial<Pick<SecureCaptureEnvironment, "containsEvent" | "isFocusInsideRoot">> = {},
): Harness {
  const root = new StubTarget();
  const doc = new StubTarget();
  const win = new StubTarget();
  const state: Harness = {
    root,
    doc,
    win,
    hidden: false,
    attempts: [],
    logs: [],
    blackouts: [],
    detach: () => {},
  };

  state.detach = bindSecureCaptureGuard(
    {
      rootTarget: root,
      documentTarget: doc,
      windowTarget: win,
      containsEvent: overrides.containsEvent ?? (() => true),
      isHidden: () => state.hidden,
      isFocusInsideRoot: overrides.isFocusInsideRoot ?? (() => true),
    },
    {
      log: (eventName) => state.logs.push(eventName),
      notifyCaptureAttempt: (kind, eventName) =>
        state.attempts.push({ kind, eventName }),
      setBlackout: (reason) => state.blackouts.push(reason),
    },
    { blackoutOnBlur: true, blackoutOnVisibilityHidden: true },
  );

  return state;
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

test("PrintScreen is recognized from either key or code", () => {
  assert.equal(isPrintScreenKey(keyEvent({ key: "PrintScreen" })), true);
  assert.equal(isPrintScreenKey(keyEvent({ code: "PrintScreen" })), true);
  assert.equal(isPrintScreenKey(keyEvent({ key: "p", code: "KeyP" })), false);
});

test("print shortcut needs a command modifier", () => {
  assert.equal(isPrintShortcut(keyEvent({ key: "p", code: "KeyP", metaKey: true })), true);
  assert.equal(isPrintShortcut(keyEvent({ key: "P", code: "KeyP", ctrlKey: true })), true);
  assert.equal(isPrintShortcut(keyEvent({ key: "p", code: "KeyP" })), false);
});

test("only the PrintScreen keyup edge is broadcast-grade", () => {
  const printScreen = keyEvent({ key: "PrintScreen", code: "PrintScreen" });
  assert.equal(secureCaptureKeyTier("keyup", printScreen), "broadcast");
  // Same physical press cannot produce a second room notification.
  assert.equal(secureCaptureKeyTier("keydown", printScreen), "local");
  assert.equal(
    secureCaptureKeyTier("keydown", keyEvent({ key: "p", code: "KeyP", metaKey: true })),
    "broadcast",
  );
  assert.equal(
    secureCaptureKeyTier("keyup", keyEvent({ key: "a", code: "KeyA" })),
    "local",
  );
});

// (a) — the one screenshot action web can observe.
test("keyup PrintScreen fires the Tier A callback exactly once", () => {
  const h = harness();
  h.doc.dispatch("keyup", { key: "PrintScreen", code: "PrintScreen" });

  assert.equal(h.attempts.length, 1);
  assert.deepEqual(h.attempts[0], {
    kind: "screenshot",
    eventName: "secure_capture_print_screen_key",
  });
  assert.deepEqual(h.logs, ["secure_capture_print_screen_key"]);
});

// (a, cont.) — keydown must not double-fire the same press.
test("keydown PrintScreen never reaches the Tier A callback", () => {
  const h = harness();
  h.doc.dispatch("keydown", { key: "PrintScreen", code: "PrintScreen" });

  assert.deepEqual(h.attempts, []);
  assert.deepEqual(h.logs, ["secure_capture_keyboard_shortcut_attempt"]);
});

test("a full PrintScreen press (keydown then keyup) notifies the room once", () => {
  const h = harness();
  h.doc.dispatch("keydown", { key: "PrintScreen", code: "PrintScreen" });
  h.doc.dispatch("keyup", { key: "PrintScreen", code: "PrintScreen" });

  assert.equal(h.attempts.length, 1);
});

// (b) — the false-positive flood this whole change exists to kill.
test("blur and visibilitychange blackout and breadcrumb but never accuse", () => {
  const h = harness();

  h.win.dispatch("blur");
  h.hidden = true;
  h.doc.dispatch("visibilitychange");

  assert.deepEqual(h.attempts, [], "focus loss is not evidence of capture");
  assert.deepEqual(h.logs, [
    "secure_capture_blur",
    "secure_capture_visibility_hidden",
  ]);
  assert.deepEqual(h.blackouts, ["blur", "hidden"]);
});

test("a viewer can tab away repeatedly without ever notifying the room", () => {
  const h = harness();

  for (let i = 0; i < 10; i += 1) {
    h.win.dispatch("blur");
    h.hidden = true;
    h.doc.dispatch("visibilitychange");
    h.hidden = false;
    h.win.dispatch("focus");
  }

  assert.deepEqual(h.attempts, []);
});

test("a visibilitychange to visible does not blackout", () => {
  const h = harness();
  h.hidden = false;
  h.doc.dispatch("visibilitychange");

  assert.deepEqual(h.logs, []);
  assert.deepEqual(h.blackouts, []);
});

// (c)
test("beforeprint is Tier A and blacks out the print surface", () => {
  const h = harness();
  h.win.dispatch("beforeprint");

  assert.deepEqual(h.attempts, [
    { kind: "screenshot", eventName: "secure_capture_print_attempt" },
  ]);
  assert.deepEqual(h.blackouts, ["print"]);
});

test("Cmd+P keydown is Tier A", () => {
  const h = harness();
  h.doc.dispatch("keydown", { key: "p", code: "KeyP", metaKey: true });

  assert.deepEqual(h.attempts, [
    { kind: "screenshot", eventName: "secure_capture_print_attempt" },
  ]);
});

test("Tier B page actions block and log without accusing", () => {
  const h = harness();

  h.root.dispatch("contextmenu");
  h.root.dispatch("copy");
  h.root.dispatch("cut");
  h.root.dispatch("paste");
  h.doc.dispatch("keydown", { key: "F12", code: "F12" });
  h.doc.dispatch("keydown", { key: "I", code: "KeyI", ctrlKey: true, shiftKey: true });

  assert.deepEqual(h.attempts, []);
  assert.deepEqual(h.logs, [
    "secure_capture_context_menu_attempt",
    "secure_capture_copy_attempt",
    "secure_capture_copy_attempt",
    "secure_capture_copy_attempt",
    "secure_capture_keyboard_shortcut_attempt",
    "secure_capture_keyboard_shortcut_attempt",
  ]);
});

test("scoped page actions outside the protected subtree are ignored", () => {
  const h = harness({ containsEvent: () => false, isFocusInsideRoot: () => false });

  h.root.dispatch("contextmenu");
  h.root.dispatch("copy");
  // Ordinary chord outside the room must not be swallowed…
  h.doc.dispatch("keydown", { key: "s", code: "KeyS", metaKey: true });

  assert.deepEqual(h.logs, []);
  assert.deepEqual(h.attempts, []);

  // …but PrintScreen and print are global by design.
  h.doc.dispatch("keyup", { key: "PrintScreen", code: "PrintScreen" });
  h.doc.dispatch("keydown", { key: "p", code: "KeyP", ctrlKey: true });
  assert.equal(h.attempts.length, 2);
});

test("focus clears the blackout", () => {
  const h = harness();
  h.win.dispatch("blur");
  h.win.dispatch("focus");

  assert.deepEqual(h.blackouts, ["blur", null]);
});

test("detach removes every listener it registered", () => {
  const h = harness();
  h.detach();

  for (const type of ["contextmenu", "copy", "cut", "paste", "dragstart", "selectstart"]) {
    assert.equal(h.root.count(type), 0, `root ${type} still bound`);
  }
  for (const type of ["visibilitychange", "keydown", "keyup"]) {
    assert.equal(h.doc.count(type), 0, `document ${type} still bound`);
  }
  for (const type of ["blur", "focus", "beforeprint"]) {
    assert.equal(h.win.count(type), 0, `window ${type} still bound`);
  }
});
