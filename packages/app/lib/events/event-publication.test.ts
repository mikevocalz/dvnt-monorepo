import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLISH_AFTER_START_ERROR,
  publicationBadge,
  publishAtError,
} from "./event-publication.ts";

const LA = "America/Los_Angeles";
const now = Date.parse("2026-10-03T12:00:00Z");

test("the host badge says Hidden for a hidden event", () => {
  assert.equal(publicationBadge({ is_hidden: true, publish_at: null, event_tz: LA }, now), "Hidden");
  // Hidden wins over a schedule: the event stays hidden after publish_at.
  assert.equal(publicationBadge({ is_hidden: true, publish_at: "2026-10-05T03:00:00Z", event_tz: LA }, now), "Hidden");
});

test("the host badge gives the go-public time in the event's zone", () => {
  assert.equal(
    publicationBadge({ is_hidden: false, publish_at: "2026-10-05T03:00:00Z", event_tz: LA }, now),
    "Goes public Sun, Oct 4 at 8:00 PM PDT",
  );
  assert.equal(
    publicationBadge({ isHidden: false, publishAt: "2026-10-05T03:00:00Z", eventTz: LA }, now),
    "Goes public Sun, Oct 4 at 8:00 PM PDT",
  );
});

test("no badge once the event is public", () => {
  assert.equal(publicationBadge({ is_hidden: false, publish_at: null }, now), null);
  assert.equal(publicationBadge({ is_hidden: false, publish_at: "2026-10-01T00:00:00Z" }, now), null);
  assert.equal(publicationBadge(null, now), null);
});

test("a go-public time must parse and come before the start", () => {
  const start = "2026-10-10T03:00:00Z";
  assert.equal(publishAtError(null, start), null);
  assert.equal(publishAtError("", start), null);
  assert.equal(publishAtError("2026-10-09T00:00:00Z", start), null);
  assert.equal(publishAtError(start, start), null);
  assert.equal(publishAtError("2026-10-10T03:00:01Z", start), PUBLISH_AFTER_START_ERROR);
  assert.equal(publishAtError("whenever", start), "Go-public time is not a valid date");
});

test("a typed go-public time is read in the event's zone and reopens the same", async () => {
  const { publishAtLocalToInstant, publishAtInstantToLocal } = await import("./event-publication.ts");
  const typed = new Date(2026, 9, 4, 20, 0).toISOString(); // 8:00 PM Oct 4, any device zone
  const stored = publishAtLocalToInstant(typed, LA);
  assert.equal(stored, "2026-10-05T03:00:00.000Z");
  assert.equal(publishAtInstantToLocal(stored, LA), typed);
  assert.equal(publishAtLocalToInstant("", LA), null);
  assert.equal(publishAtInstantToLocal(null, LA), "");
});
