import assert from "node:assert/strict";
import { test } from "node:test";
import { canShowProfileReminderAt, missingProfileSteps } from "./profile-reminder-policy.ts";

test("photo and first post can be missing independently", () => {
  assert.deepEqual(missingProfileSteps({ avatar: "", postsCount: 0 }), { photo: true, firstPost: true });
  assert.deepEqual(missingProfileSteps({ avatar: "https://cdn.dvntapp.live/pic.jpg", postsCount: 0 }), { photo: false, firstPost: true });
  assert.deepEqual(missingProfileSteps({ avatar: null, postsCount: 3 }), { photo: true, firstPost: false });
  assert.deepEqual(missingProfileSteps({ avatar: "https://cdn.dvntapp.live/pic.jpg", postsCount: 5 }), { photo: false, firstPost: false });
});

test("unknown count and absent profile never trigger a first-post prompt", () => {
  assert.deepEqual(missingProfileSteps(null), { photo: false, firstPost: false });
  assert.deepEqual(missingProfileSteps({ avatar: "a.jpg" }), { photo: false, firstPost: false });
  assert.deepEqual(missingProfileSteps({ avatar: "  ", postsCount: null }), { photo: true, firstPost: false });
});

test("site entry routes are eligible, immersive and signup/payment routes are not", () => {
  for (const url of ["/", "/feed", "/feed/explore", "/feed/profile", "/feed/messages"]) {
    assert.equal(canShowProfileReminderAt(url), true, url);
  }
  for (const url of [
    "/auth/signup", "/auth/verify-email", "/feed/profile/edit",
    "/feed/create", "/feed/events/create", "/feed/call/room",
    "/feed/sneaky-lynk/123", "/feed/story/create", "/feed/tickets",
    "/feed/checkout", "/events/123", "/public/create", "",
  ]) {
    assert.equal(canShowProfileReminderAt(url), false, url);
  }
});
