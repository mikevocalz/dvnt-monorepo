import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canShowProfileReminderAt,
  missingProfileSteps,
  newMemberRedirect,
} from "./profile-reminder-policy.ts";

test("photo and first post can be missing independently", () => {
  assert.deepEqual(missingProfileSteps({ avatar: "", postsCount: 0 }), { photo: true, firstPost: true });
  assert.deepEqual(missingProfileSteps({ avatar: "https://cdn.dvntapp.live/pic.jpg", postsCount: 0 }), { photo: false, firstPost: true });
  assert.deepEqual(missingProfileSteps({ avatar: null, postsCount: 3 }), { photo: true, firstPost: false });
  assert.deepEqual(missingProfileSteps({ avatar: "https://cdn.dvntapp.live/pic.jpg", postsCount: 5 }), { photo: false, firstPost: false });
});

test("unknown count and absent profile never invent local first-post evidence", () => {
  assert.deepEqual(missingProfileSteps(null), { photo: false, firstPost: false });
  assert.deepEqual(missingProfileSteps({ avatar: "a.jpg" }), { photo: false, firstPost: false });
  assert.deepEqual(missingProfileSteps({ avatar: "  ", postsCount: null }), { photo: true, firstPost: false });
});

test("ordinary app entry routes may show the mandatory gate", () => {
  for (const url of ["/", "/feed", "/feed/explore", "/feed/profile", "/feed/messages"]) {
    assert.equal(canShowProfileReminderAt(url), true, url);
  }
});

test("completion, immersive, signup, and payment routes are not covered by the gate", () => {
  for (const url of [
    "/auth/signup",
    "/auth/verify-email",
    "/feed/profile/edit",
    "/feed/onboarding/photo",
    "/feed/create",
    "/feed/events/create",
    "/feed/call/room",
    "/feed/sneaky-lynk/123",
    "/feed/story/create",
    "/feed/tickets",
    "/feed/checkout",
    "/events/123",
    "/public/create",
    "",
  ]) {
    assert.equal(canShowProfileReminderAt(url), false, url);
  }
});

test("required member remains on photo before first post, even after refresh", () => {
  assert.equal(newMemberRedirect("photo", "/feed"), "/feed/onboarding/photo");
  assert.equal(newMemberRedirect("photo", "/feed/create"), "/feed/onboarding/photo");
  assert.equal(newMemberRedirect("photo", "/feed/onboarding/photo"), null);
  assert.equal(newMemberRedirect("first_post", "/feed"), "/feed/create");
  assert.equal(newMemberRedirect("first_post", "/feed/onboarding/photo"), "/feed/create");
  assert.equal(newMemberRedirect("first_post", "/feed/create"), null);
  assert.equal(newMemberRedirect("complete", "/feed"), null);
  assert.equal(newMemberRedirect("not_required", "/feed"), null);
});

test("required member can still finish verification and purchases", () => {
  for (const path of ["/auth/signup", "/auth/verify-email", "/feed/checkout", "/feed/tickets"]) {
    assert.equal(newMemberRedirect("photo", path), null, path);
    assert.equal(newMemberRedirect("first_post", path), null, path);
  }
});
