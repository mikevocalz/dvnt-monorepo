/** node --test packages/app/lib/web-chrome.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeIsImmersive, routeOwnsHeader, routeUsesVisualViewportBottom } from "./web-chrome.ts";

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

test("event detail and editor aliases recover their visible viewport", () => {
  for (const route of [
    "/events/game-night-in-la", "/events/game-night-in-la/",
    "/events/abcdef0123456789abcdef0123456789", "/feed/events/42",
    "/feed/events/42/", "/feed/events/create", "/feed/events/create/",
    "/feed/edit-event/42", "/feed/edit-event/42/",
  ]) assert.equal(routeUsesVisualViewportBottom(route), true, route);
});

test("viewport recovery does not change separate composers or non-event routes", () => {
  for (const route of [
    "", "/feed", "/events", "/events/", "/feed/events",
    "/feed/events/42/comments", "/feed/events/42/attendees",
    "/feed/messages/123", "/feed/post/42", "/feed/edit-event/42/tickets",
    "/feed/events/host", "/feed/events/my-tickets", "/feed/events/organizer-setup",
    "/public/events/42", "/feed/events/42/comments/",
  ]) assert.equal(routeUsesVisualViewportBottom(route), false, route);
});
