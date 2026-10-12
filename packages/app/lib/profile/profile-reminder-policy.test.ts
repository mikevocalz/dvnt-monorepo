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

test("exact verification, purchase, photo and active-room routes remain reachable", () => {
  for (const url of [
    "/auth/signup",
    "/auth/verify-email",
    "/feed/onboarding/photo",
    "/feed/call/room",
    "/feed/sneaky-lynk/room/123",
    "/feed/tickets",
    "/feed/checkout",
    "/auth/onboarding",
    "/legal/terms",
    "/settings/privacy-policy",
    "/settings/eligibility",
    "/settings/identity-protection",
    "/settings/order/123",
    "/public/tickets/claim/token",
    "/public/tickets/guest/token",
    "/video/room/123",
    "/game-night/room/123",
    "/events/123",
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


test("real wallet and purchase entry routes stay open for incomplete members", () => {
  for (const path of [
    "/feed/events/my-tickets", "/feed/events/my-tickets/",
    "/feed/events/42", "/feed/events/42/",
    "/feed/ticket/42", "/feed/ticket/upgrade/42",
    "/feed/checkout/review", "/feed/checkout/success",
    "/feed/events/42/embed/checkout",
  ]) {
    assert.equal(canShowProfileReminderAt(path), false, path);
  }
});

test("ticket carve-outs do not exempt event participation or management routes", () => {
  for (const path of [
    "/feed/events", "/feed/events/host", "/feed/events/organizer-setup",
    "/feed/events/42/comments", "/feed/events/42/attendees",
    "/feed/events/42/organizer", "/feed/events/42/analytics",
    "/feed/events/42/promoter", "/feed/events/42/scanner",
    "/feed/events/my-tickets/comments",
  ]) {
    assert.equal(canShowProfileReminderAt(path), true, path);
  }
});


test("ordinary routes outside feed and broad create/edit segments cannot bypass the gate", () => {
  for (const path of [
    "/settings", "/settings/account", "/notifications", "/events", "/events/create",
    "/game-night", "/game-night/join", "/video/rooms", "/profile/person",
    "/public", "/public/create", "/public/events", "/public/search",
    "/feed/events/create", "/feed/events/42/edit", "/feed/profile/edit",
    "/feed/edit-profile", "/feed/post/edit/42", "/feed/story/create",
    "/feed/story/editor", "/feed/story/42", "/feed/sneaky-lynk/create",
    "/feed/profile/checkout", "/feed/profile/tickets", "/feed/profile/camera",
  ]) {
    assert.equal(canShowProfileReminderAt(path, "photo"), true, path);
    assert.equal(canShowProfileReminderAt(path, "first_post"), true, path);
  }
});

test("first-post completion paths only open after authoritative photo completion", () => {
  for (const path of ["/feed/create", "/feed/camera", "/feed/crop-preview"]) {
    assert.equal(canShowProfileReminderAt(path), true, `${path}: pending`);
    assert.equal(canShowProfileReminderAt(path, "photo"), true, `${path}: photo`);
    assert.equal(canShowProfileReminderAt(path, "pending_verification"), true, `${path}: verification`);
    assert.equal(canShowProfileReminderAt(path, "first_post"), false, `${path}: first post`);
  }
  assert.equal(canShowProfileReminderAt("/feed/create/unrelated", "first_post"), true);
});
