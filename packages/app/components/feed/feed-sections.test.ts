import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeedSections, EVENT_INTERVAL } from "./feed-sections.ts";

const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const events = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));

const kinds = (s: ReturnType<typeof buildFeedSections>) => s.map((x) => x.type);

test("an event card lands after every interval posts", () => {
  const sections = buildFeedSections(posts(21), events(5), 7);
  assert.deepEqual(kinds(sections), [
    "masonry", "event",
    "masonry", "event",
    "masonry", "event",
  ]);
});

test("no post is dropped, whatever the remainder", () => {
  for (const count of [0, 1, 6, 7, 8, 13, 14, 20, 100]) {
    const sections = buildFeedSections(posts(count), events(10), 7);
    const seen = sections
      .filter((s) => s.type === "masonry")
      .flatMap((s) => (s as any).posts.map((p: any) => p.id));
    assert.equal(seen.length, count, `lost posts at count ${count}`);
    assert.deepEqual(seen, posts(count).map((p) => p.id), `order changed at ${count}`);
  }
});

test("running out of events just stops interleaving", () => {
  const sections = buildFeedSections(posts(50), events(2), 7);
  assert.equal(sections.filter((s) => s.type === "event").length, 2);
  // Everything after the last event still renders.
  assert.equal(sections[sections.length - 1].type, "masonry");
});

test("no events means a single masonry run", () => {
  assert.deepEqual(kinds(buildFeedSections(posts(30), [], 7)), ["masonry"]);
});

test("no posts renders nothing rather than a bare event card", () => {
  assert.deepEqual(buildFeedSections([], events(5), 7), []);
});

test("keys are unique so React does not reuse the wrong node", () => {
  const sections = buildFeedSections(posts(40), events(5), 7);
  const keys = sections.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("a nonsense interval falls back to no interleaving instead of looping", () => {
  for (const bad of [0, -3, NaN]) {
    const sections = buildFeedSections(posts(10), events(3), bad);
    assert.deepEqual(kinds(sections), ["masonry"]);
  }
});

test("the shared interval is what native shipped", () => {
  assert.equal(EVENT_INTERVAL, 7);
});
