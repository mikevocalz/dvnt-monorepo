/** node --test packages/app/lib/web-chrome.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeIsImmersive, routeOwnsHeader } from "./web-chrome.ts";

test("Sneaky Lynk live rooms hide the site sidebar and app chrome", () => {
  for (const route of [
    "/feed/sneaky-lynk/room/123",
    "/feed/lynk/123",
    "/feed/call/123",
  ]) {
    assert.equal(routeIsImmersive(route), true, route);
  }
});

test("creating, browsing and billing for Lynks retain normal navigation", () => {
  for (const route of [
    "/feed/sneaky-lynk/create",
    "/feed/sneaky-lynk/billing",
    "/feed/messages",
    "/feed/events",
  ]) {
    assert.equal(routeIsImmersive(route), false, route);
  }
  assert.equal(routeOwnsHeader("/feed/sneaky-lynk/room/123"), false);
});
