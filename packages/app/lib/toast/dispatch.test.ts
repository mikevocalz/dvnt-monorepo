/**
 * node --test packages/app/lib/toast/dispatch.test.ts
 *
 * On web, useUIStore.showToast called sonner-native, whose handlers exist only
 * after sonner-native's <Toaster> renders. Only the native layout mounts that;
 * Next mounts sonner's <Toaster> (apps/web/src/components/web-toaster.tsx).
 * Every showToast on web threw "ToastContext is not initialized", was caught,
 * and became a console.warn. The checkout "Invalid promo code" toast was one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { dispatchToast, type ToastApi } from "./dispatch.ts";

function recorder(): ToastApi & { calls: string[] } {
  const calls: string[] = [];
  const fn = (type: string) => (title: string, o?: { description?: string }) =>
    calls.push(`${type}:${title}:${o?.description ?? ""}`);
  return {
    calls,
    success: fn("success"),
    error: fn("error"),
    warning: fn("warning"),
    info: fn("info"),
  };
}

const unmounted: ToastApi = {
  success: () => {
    throw new Error("ToastContext is not initialized");
  },
  error: () => {
    throw new Error("ToastContext is not initialized");
  },
  warning: () => {
    throw new Error("ToastContext is not initialized");
  },
  info: () => {
    throw new Error("ToastContext is not initialized");
  },
};

test("falls through to the next host when the first has no mounted Toaster", () => {
  const web = recorder();
  const shown = dispatchToast(
    [unmounted, web],
    "error",
    "Checkout failed",
    "Invalid promo code",
  );
  assert.equal(shown, true);
  assert.deepEqual(web.calls, ["error:Checkout failed:Invalid promo code"]);
});

test("uses the first host when it works and skips the rest", () => {
  const native = recorder();
  const web = recorder();
  assert.equal(dispatchToast([native, web], "success", "Saved"), true);
  assert.deepEqual(native.calls, ["success:Saved:"]);
  assert.deepEqual(web.calls, []);
});

test("reports false instead of throwing when no host can show it", () => {
  assert.equal(dispatchToast([unmounted, null], "info", "x"), false);
});
