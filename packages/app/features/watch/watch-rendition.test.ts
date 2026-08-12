/**
 * Rendition rewriting. Run:
 *   node --import tsx --test packages/app/features/watch/watch-rendition.test.ts
 *
 * The failure this guards against is the one the repo has already had once: a
 * transform param appended to a URL that does not honour it, producing a
 * "thumbnail" that is the full asset. Every branch that returns the input
 * unchanged is load-bearing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { watchRendition, WATCH_RENDITION } from "./watch-rendition";

const CDN = "https://dvnt.b-cdn.net/avatar/u/2026/02/a.png";

test("appends width on the optimizer zone", () => {
  assert.equal(watchRendition(CDN, 96), `${CDN}?width=96`);
});

test("preserves an existing query string", () => {
  const withQuery = `${CDN}?v=2`;
  assert.equal(watchRendition(withQuery, 96), `${CDN}?v=2&width=96`);
});

test("never double-applies width", () => {
  const already = `${CDN}?width=64`;
  assert.equal(watchRendition(already, 96), already);
});

test("leaves foreign hosts alone", () => {
  // Google/Apple profile images arrive on their own hosts and do not run
  // through Bunny — a width param there is at best ignored, at worst breaks a
  // signed URL.
  const foreign = "https://lh3.googleusercontent.com/a/abc123";
  assert.equal(watchRendition(foreign, 96), foreign);
});

test("empty and nullish yield undefined, not a bare query string", () => {
  assert.equal(watchRendition(undefined, 96), undefined);
  assert.equal(watchRendition(null, 96), undefined);
  assert.equal(watchRendition("   ", 96), undefined);
});

test("a malformed URL degrades to itself rather than throwing", () => {
  assert.equal(watchRendition("not a url", 96), "not a url");
});

test("both surfaces request a width that covers 22pt at 3x", () => {
  for (const w of Object.values(WATCH_RENDITION)) {
    assert.ok(w >= 66, `${w} is under 22pt @3x`);
  }
});
