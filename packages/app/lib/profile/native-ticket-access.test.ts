import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Exercise the actual native layout's progress callback, not a second policy.
// Its only TypeScript syntax is the router destination's `as any` assertion.
const source = readFileSync(new URL("../../features/routes/screens/(protected)/_layout.tsx", import.meta.url), "utf8");
const callback = source.match(/fetchNewMemberProgress\(\)\.then\(\(progress\) => \{([\s\S]*?)\n    \}\)\.catch/);
assert.ok(callback, "native progress callback must remain covered");
const run = new Function("progress", "memberPath", "memberRouter", "cancelled", callback[1].replaceAll(" as any", ""));
function redirects(step: string, path: string, cancelled = false): string[] {
  const destinations: string[] = [];
  run({ step }, path, { replace: (to: string) => destinations.push(to) }, cancelled);
  return destinations;
}

test("native My Tickets and individual passes remain accessible at both profile stages", () => {
  for (const step of ["photo", "first_post"]) {
    for (const path of ["/events/my-tickets", "/ticket/owned-pass", "/tickets", "/checkout", "/payment", "/orders/owned-order"]) {
      assert.deepEqual(redirects(step, path), [], `${step}: ${path}`);
    }
  }
});

test("only the exact My Tickets route is added; other member routes keep their gates", () => {
  for (const path of ["/events", "/events/create", "/events/80", "/events/my-tickets-extra", "/events/my-tickets/settings", "/profile", "/messages"]) {
    assert.deepEqual(redirects("photo", path), ["/(protected)/edit-profile"], path);
    assert.deepEqual(redirects("first_post", path), ["/(protected)/(tabs)/create"], path);
  }
});

test("completion screens, pending verification and cancelled reads keep existing behavior", () => {
  assert.deepEqual(redirects("photo", "/edit-profile"), []);
  assert.deepEqual(redirects("photo", "/profile/edit"), []);
  assert.deepEqual(redirects("photo", "/create"), ["/(protected)/edit-profile"]);
  for (const path of ["/create", "/crop-preview", "/camera"]) assert.deepEqual(redirects("first_post", path), []);
  for (const step of ["not_required", "pending_verification", "complete"]) assert.deepEqual(redirects(step, "/profile"), []);
  assert.deepEqual(redirects("photo", "/profile", true), []);
});
