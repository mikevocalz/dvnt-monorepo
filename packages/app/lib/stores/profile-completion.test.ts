/**
 * Profile completion must only ever ask for things edit-profile can change,
 * and must not ask twice for something already given.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProfileCompletion } from "./profile-completion";

const complete = {
  avatar: "https://cdn/a.jpg",
  bio: "hi",
  sexuality: ["queer"],
  eventAudience: "everyone",
  location: "Brooklyn",
  links: ["https://example.com"],
};

test("a filled profile is 100% and the card hides", () => {
  const { percent, missing } = computeProfileCompletion(complete);
  assert.equal(percent, 100);
  assert.deepEqual(missing, []);
});

test("a website counts as a link, because edit-profile saves it as one", () => {
  // The reported bug: profile sat at 90% asking for a link when a link was
  // already there. edit-profile keeps a links list AND a website box, and
  // merges the website into links on save.
  const { percent, missing } = computeProfileCompletion({
    ...complete,
    links: [],
    website: "www.be.net/someone",
  });
  assert.equal(percent, 100);
  assert.equal(
    missing.find((m) => m.key === "links"),
    undefined,
  );
});

test("a blank website is not a link", () => {
  const { percent, missing } = computeProfileCompletion({
    ...complete,
    links: [],
    website: "   ",
  });
  assert.equal(percent, 90);
  assert.equal(missing[0].key, "links");
});

test("weights total exactly 100, so the ring can reach full", () => {
  const { missing } = computeProfileCompletion({});
  assert.equal(
    missing.reduce((sum, item) => sum + item.weight, 0),
    100,
  );
});

test("every item maps to a field edit-profile actually saves", () => {
  // Guards the mismatch this test file exists for: an item whose field the edit
  // screen cannot change is a checklist row the user can never satisfy.
  // Keys here mirror the updateData payload in edit-profile.tsx.
  const editable = new Set([
    "photo", // avatar
    "bio",
    "identity", // sexuality
    "audience", // eventAudience
    "location",
    "links", // links + website
  ]);
  const { missing } = computeProfileCompletion({});
  for (const item of missing) {
    assert.ok(editable.has(item.key), `"${item.key}" is not editable`);
    assert.ok(item.label.trim().length > 0, `"${item.key}" has no label`);
  }
});

test("an empty profile is 0% and a missing user does not crash", () => {
  assert.equal(computeProfileCompletion({}).percent, 0);
  assert.deepEqual(computeProfileCompletion(null), { percent: 0, missing: [] });
});

test("missing items are ordered by weight so the photo is asked for first", () => {
  const { missing } = computeProfileCompletion({});
  assert.equal(missing[0].key, "photo");
  const weights = missing.map((m) => m.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
});

test("whitespace-only bio and location do not count as filled", () => {
  const { percent } = computeProfileCompletion({
    ...complete,
    bio: "   ",
    location: "  ",
  });
  assert.equal(percent, 70); // bio 20 + location 10 withheld
});
