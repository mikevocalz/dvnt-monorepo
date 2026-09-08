import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDrawerSections,
  drawerAvailableOn,
  drawerGestureEnabled,
} from "./drawer-destinations.ts";

const NONE = { upcomingEvents: 0, upcomingPasses: 0, needsAttention: 0 };

test("hosting only appears for an account the server says can host", () => {
  const guest = buildDrawerSections({ canHost: false }, NONE);
  assert.equal(guest.some((s) => s.id === "hosting"), false);
  const host = buildDrawerSections({ canHost: true }, NONE);
  assert.equal(host.some((s) => s.id === "hosting"), true);
});

test("every row points at a route, and My Tickets is the first thing offered", () => {
  const sections = buildDrawerSections({ canHost: true }, NONE);
  const rows = sections.flatMap((s) => s.rows);
  assert.equal(rows[0].id, "my-tickets");
  for (const row of rows) {
    assert.ok(row.href.startsWith("/"), `${row.id} has no route`);
    assert.ok(row.label.length > 0, `${row.id} has no label`);
  }
});

test("the ticket detail distinguishes events from passes and never shows a bare number", () => {
  const detail = (counts: typeof NONE) =>
    buildDrawerSections({ canHost: false }, counts)[0].rows[0].detail;

  assert.equal(detail(NONE), undefined, "nothing to say when there is nothing");
  assert.equal(detail({ upcomingEvents: 1, upcomingPasses: 1, needsAttention: 0 }), "1 event · 1 pass");
  assert.equal(detail({ upcomingEvents: 2, upcomingPasses: 3, needsAttention: 0 }), "2 events · 3 passes");
});

test("an incoming transfer gets actionable words, not a count that reads as owned tickets", () => {
  const row = buildDrawerSections(
    { canHost: false },
    { upcomingEvents: 0, upcomingPasses: 0, needsAttention: 1 },
  )[0].rows[0];
  assert.equal(row.detail, "1 needs your attention");
  assert.equal(row.badge, 1);
});

test("drawer gestures yield to screens that own the horizontal swipe", () => {
  for (const path of [
    "/(protected)/checkout/review",
    "/(protected)/story/123",
    "/(protected)/camera",
    "/(protected)/call/room-1",
    "/(protected)/events/42/scanner",
    "/(protected)/events/create",
    "/(protected)/chat/9",
  ]) {
    assert.equal(drawerGestureEnabled(path), false, path);
  }
  assert.equal(drawerGestureEnabled("/(protected)/(tabs)/events"), true);
});

test("the drawer belongs to top-level surfaces, not to pushed screens", () => {
  assert.equal(drawerAvailableOn("/(protected)/(tabs)/index"), true);
  assert.equal(drawerAvailableOn("/(protected)/(tabs)/events"), true);
  assert.equal(drawerAvailableOn("/events"), true);
  assert.equal(drawerAvailableOn("/(protected)/events/my-tickets"), false);
  assert.equal(drawerAvailableOn("/(protected)/ticket/abc"), false);
});
