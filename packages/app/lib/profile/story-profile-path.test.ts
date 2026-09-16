import test from "node:test";
import assert from "node:assert/strict";
import { storyProfilePath } from "./story-profile-path.ts";

test("renamed member's own story opens their own profile by stable identity", () => {
  const story = { userId: "12", username: "old_handle" };
  const viewer = { id: 12, username: "new_handle" };
  assert.equal(storyProfilePath(story, viewer, "web"), "/feed/profile");
  assert.equal(storyProfilePath(story, viewer, "native"), "/(protected)/(tabs)/profile");
});

test("another member sharing a stale handle is not treated as the viewer", () => {
  const story = { userId: "99", username: "myhandle" };
  assert.equal(storyProfilePath(story, { id: 12, username: "myhandle" }, "web"), "/profile/myhandle");
});

test("profile routes encode handles and cannot become another route", () => {
  assert.equal(storyProfilePath({ username: "a/b?#" }, null, "native"), "/(protected)/profile/a%2Fb%3F%23");
  assert.equal(storyProfilePath({ username: "  " }, null, "web"), null);
  assert.equal(storyProfilePath({ username: "Me" }, { username: "me" }, "web"), "/feed/profile");
});
