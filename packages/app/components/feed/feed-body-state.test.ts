import test from "node:test";
import assert from "node:assert/strict";
import { feedBodyState } from "./feed-body-state.ts";

const base = { isLoading: false, isError: false, spicy: false, postCount: 0 };

test("first load with nothing cached shows the skeleton", () => {
  assert.equal(feedBodyState({ ...base, isLoading: true }), "loading");
});

test("posts on screen win over a failed background refetch", () => {
  assert.equal(feedBodyState({ ...base, postCount: 3, isError: true }), "posts");
});

test("a failed fetch with no posts is an error, never 'No posts yet'", () => {
  assert.equal(feedBodyState({ ...base, isError: true }), "error");
  assert.equal(feedBodyState({ ...base, isError: true, spicy: true }), "error");
});

test("an empty Spicy feed says so instead of the global empty copy", () => {
  assert.equal(feedBodyState({ ...base, spicy: true }), "spicy-empty");
});

test("an empty normal feed keeps the regular empty state", () => {
  assert.equal(feedBodyState(base), "empty");
});
