import test from "node:test";
import assert from "node:assert/strict";
import {
  isEventShareToken,
  resolveEventByPathSegment,
  resolveEventByShareToken,
  resolveEventBySlug,
} from "./event-discovery.ts";

/**
 * The link_only promise: not listed, but anyone with the LINK can open it.
 * The link is the token — the title slug must not be a second door.
 */
const TOKEN = "a".repeat(32);
const OTHER_TOKEN = "b".repeat(32);

const publicEvent = {
  id: 24,
  title: "Wine & Whiskey WEDNESDAY",
  status: "active",
  visibility: "public",
  share_slug: OTHER_TOKEN,
};
const linkOnly = { ...publicEvent, id: 25, visibility: "link_only", share_slug: TOKEN };
const privateEvent = { ...linkOnly, id: 26, visibility: "private" };
const draftLinkOnly = { ...linkOnly, id: 27, status: "draft" };
const titleSlug = "wine-whiskey-wednesday";

test("a token opens a link_only event", () => {
  assert.equal(isEventShareToken(TOKEN), true);
  assert.equal(isEventShareToken(titleSlug), false);
  assert.equal(resolveEventByShareToken([linkOnly], TOKEN)?.id, 25);
  assert.equal(resolveEventByPathSegment([linkOnly], TOKEN)?.id, 25);
});

test("the title slug does NOT open a link_only event", () => {
  assert.equal(resolveEventBySlug([linkOnly], titleSlug), undefined);
  assert.equal(resolveEventByPathSegment([linkOnly], titleSlug), undefined);
});

test("the title slug still opens a public event", () => {
  assert.equal(resolveEventBySlug([publicEvent], titleSlug)?.id, 24);
  assert.equal(resolveEventByPathSegment([publicEvent], titleSlug)?.id, 24);
  // Legacy rows selected without a visibility column keep resolving — every
  // currently-shared URL is one of these, and breaking them is not allowed.
  assert.equal(
    resolveEventByPathSegment([{ id: 9, title: publicEvent.title, status: "active" }], titleSlug)?.id,
    9,
  );
  // A link_only event sharing the title never shadows the public one.
  assert.equal(resolveEventByPathSegment([linkOnly, publicEvent], titleSlug)?.id, 24);
});

test("nothing opens a private event or a hidden status, by token or by title", () => {
  assert.equal(resolveEventByShareToken([privateEvent], TOKEN), undefined);
  assert.equal(resolveEventByPathSegment([privateEvent], TOKEN), undefined);
  assert.equal(resolveEventByPathSegment([privateEvent], titleSlug), undefined);
  assert.equal(resolveEventByShareToken([draftLinkOnly], TOKEN), undefined);
  assert.equal(
    resolveEventByPathSegment([{ ...draftLinkOnly, status: "cancelled" }], TOKEN),
    undefined,
  );
  // A wrong-shaped or wrong-valued token resolves to nothing rather than
  // falling through to the title lane.
  assert.equal(resolveEventByShareToken([linkOnly], OTHER_TOKEN), undefined);
  assert.equal(resolveEventByShareToken([linkOnly], "abc"), undefined);
});
