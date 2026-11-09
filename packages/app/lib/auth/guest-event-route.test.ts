import { test } from "node:test";
import assert from "node:assert/strict";
import { URL } from "node:url";
import { guestEventRoute } from "./guest-event-route.ts";

test("legacy event details retain their event and safe checkout query data", () => {
  assert.equal(guestEventRoute("/feed/events/82"), "/public/events/82");
  assert.equal(guestEventRoute("/feed/events/82/"), "/public/events/82");
  const result = guestEventRoute("/feed/events/82", "?ref=HOST10&promo=SAVE+TEN&ticket_type_id=tier-fixture&quantity=2&session_id=cs_fixture&redirect_status=succeeded")!;
  const url = new URL(result, "https://fixture.invalid");
  assert.equal(url.origin, "https://fixture.invalid");
  assert.equal(url.pathname, "/public/events/82");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    ref: "HOST10", promo: "SAVE TEN", ticket_type_id: "tier-fixture", quantity: "2",
    session_id: "cs_fixture", redirect_status: "succeeded",
  });
});

test("management, member routes, malformed IDs and path tricks get no public bypass", () => {
  for (const path of ["/feed", "/feed/events", "/feed/events/create", "/feed/events/my-tickets",
    "/feed/events/82/organizer", "/feed/events/82/embed", "/feed/events/82/scanner", "/feed/events/82/comments",
    "/feed/checkout/review", "/feed/ticket/82", "/feed/events/0", "/feed/events/-1", "/feed/events/1.5",
    "/feed/events/9007199254740992", "/feed/events/82?next=x", "/feed/events/82\n", "/feed/events/%38%32", "/feed/events/82//",
    "//evil.invalid/feed/events/82", "/feed/events/82/../organizer", "/feed/events/82\\organizer", "/public/events/82"]) {
    assert.equal(guestEventRoute(path), null, path);
  }
});

test("query input cannot change origin, path or create a redirect destination", () => {
  const result = guestEventRoute("/feed/events/82", "?next=https://evil.invalid&returnTo=%2Ffeed&callbackURL=%2Fauth&redirect_uri=https://evil.invalid&ref=SAFE&promo=x%23fragment%0A")!;
  const url = new URL(result, "https://fixture.invalid");
  assert.equal(url.pathname, "/public/events/82");
  assert.equal(url.origin, "https://fixture.invalid");
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.get("ref"), "SAFE");
  assert.equal(url.searchParams.get("promo"), "x#fragment\n");
  assert.equal(url.searchParams.has("next"), false);
  assert.equal(url.searchParams.has("returnTo"), false);
  assert.equal(url.searchParams.has("callbackURL"), false);
  assert.equal(url.searchParams.has("redirect_uri"), false);
});

test("review links authenticate with a canonical event-specific return target", () => {
  for (const path of ["/feed/events/42/reviews", "/feed/events/42/reviews/", "/public/events/42/reviews"]) {
    const result = guestEventRoute(path, "?returnTo=//evil.invalid&next=/feed&event_id=99&rating=5")!;
    const url = new URL(result, "https://fixture.invalid");
    assert.equal(url.pathname, "/auth/login");
    assert.equal(url.searchParams.get("returnTo"), "/feed/events/42/reviews");
    assert.equal([...url.searchParams].length, 1);
  }
});

test("review path tricks cannot create a login return target or public bypass", () => {
  for (const path of ["/feed/events/0/reviews", "/feed/events/01/reviews", "/feed/events/-1/reviews",
    "/feed/events/1.5/reviews", "/feed/events/9007199254740992/reviews", "/feed/events/42/reviews\n",
    "/feed/events/42/reviews//", "/feed/events/42/reviews/../organizer", "/feed/events/%34%32/reviews",
    "//evil.invalid/feed/events/42/reviews", "/feed/events/42/reviews?returnTo=/feed", "/feed/events/42/reviews\\evil"]) {
    assert.equal(guestEventRoute(path), null, path);
  }
});

test('detail review section auth target excludes unrelated query instructions', () => {
  const result = guestEventRoute('/feed/events/82', '?section=reviews&returnTo=//evil.invalid&id=85&rating=5')!;
  assert.equal(new URL(result, 'https://fixture.invalid').searchParams.get('returnTo'), '/feed/events/82?section=reviews');
  assert.ok(!guestEventRoute('/feed/events/82', '?section=reviews&section=other')?.startsWith('/auth/'));
});
