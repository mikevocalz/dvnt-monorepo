/** node --import tsx --test packages/ui/src/media/qr/camera-issues.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyCameraError, detectPreflightIssue, isInAppBrowser } from "./camera-issues.ts";

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const INSTAGRAM = SAFARI.replace("Safari/604.1", "Instagram 380.0.0.30.75 (iPhone15,2; iOS 18_5)");

test("preflight: secure page with getUserMedia → no issue", () => {
  assert.equal(detectPreflightIssue({ isSecureContext: true, hasGetUserMedia: true, userAgent: SAFARI }), null);
});
test("preflight: http page → insecure_context, retry cannot help", () => {
  const i = detectPreflightIssue({ isSecureContext: false, hasGetUserMedia: true, userAgent: SAFARI });
  assert.equal(i?.kind, "insecure_context"); assert.equal(i?.canRetry, false);
});
test("preflight: no getUserMedia inside Instagram → tells staff to open Safari", () => {
  const i = detectPreflightIssue({ isSecureContext: true, hasGetUserMedia: false, userAgent: INSTAGRAM });
  assert.equal(i?.kind, "in_app_browser"); assert.match(i!.message, /Open in Safari/);
  assert.equal(isInAppBrowser(SAFARI), false);
});
test("preflight: no getUserMedia in an ordinary browser → unsupported", () => {
  assert.equal(detectPreflightIssue({ isSecureContext: true, hasGetUserMedia: false, userAgent: SAFARI })?.kind, "unsupported");
});
test("getUserMedia errors classify by DOMException name", () => {
  assert.equal(classifyCameraError({ name: "NotAllowedError", message: "x" }).kind, "denied");
  assert.equal(classifyCameraError({ name: "NotFoundError" }).kind, "no_camera");
  assert.equal(classifyCameraError({ name: "OverconstrainedError" }).kind, "no_camera");
  assert.equal(classifyCameraError({ name: "NotReadableError" }).kind, "busy");
});
test("decoder load failures classify as engine and are retryable", () => {
  const i = classifyCameraError(new Error("WebAssembly.instantiate(): failed to fetch zxing_reader.wasm"));
  assert.equal(i.kind, "engine"); assert.equal(i.canRetry, true);
});
test("denied copy tells staff where the switch is; unknown still offers a retry", () => {
  assert.match(classifyCameraError({ name: "NotAllowedError" }).message, /Website Settings/);
  const u = classifyCameraError({ name: "WeirdError", message: "??" });
  assert.equal(u.kind, "unknown"); assert.equal(u.canRetry, true);
});
