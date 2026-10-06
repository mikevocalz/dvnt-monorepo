import { assertEquals } from "jsr:@std/assert";
import {
  parseCreatorSessionInput,
  parseEventId,
} from "./creator-session-input.ts";
import { CALL_HUMAN_CAPACITY } from "./call-capacity.ts";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const FUTURE = "2026-10-03T12:00:00.000Z";
const LATER = "2026-10-03T14:00:00.000Z";

function parse(body: Record<string, unknown>) {
  return parseCreatorSessionInput(
    { title: "Late Night", starts_at: FUTURE, ...body },
    NOW,
  );
}

Deno.test("a clean schedule request normalizes to ISO instants", () => {
  const parsed = parse({ ends_at: LATER, capacity: 8, event_id: 41 });
  if (!parsed.ok) throw new Error(parsed.error);
  assertEquals(parsed.value.title, "Late Night");
  assertEquals(parsed.value.startsAtIso, "2026-10-03T12:00:00.000Z");
  assertEquals(parsed.value.endsAtIso, "2026-10-03T14:00:00.000Z");
  assertEquals(parsed.value.capacity, 8);
  assertEquals(parsed.value.eventId, 41);
});

Deno.test("an absent ends_at, capacity and event_id are all null, not errors", () => {
  for (const body of [{}, { ends_at: null, capacity: null, event_id: null }]) {
    const parsed = parse(body);
    if (!parsed.ok) throw new Error(parsed.error);
    assertEquals(parsed.value.endsAtIso, null);
    assertEquals(parsed.value.capacity, null);
    assertEquals(parsed.value.eventId, null);
  }
});

Deno.test("capacity is bounded by the room constant, not a hardcoded 5000", () => {
  const atCap = parse({ capacity: CALL_HUMAN_CAPACITY });
  if (!atCap.ok) throw new Error(atCap.error);
  assertEquals(atCap.value.capacity, CALL_HUMAN_CAPACITY);

  for (const capacity of [CALL_HUMAN_CAPACITY + 1, 50, 5000, 5001]) {
    const parsed = parse({ capacity });
    assertEquals(parsed.ok, false, `capacity ${capacity} accepted`);
  }
});

Deno.test("capacity refuses zero, negatives, fractions and non-numbers", () => {
  for (const capacity of [0, -1, 1.5, true, [5], {}, "abc", "1e1", NaN]) {
    const parsed = parse({ capacity });
    assertEquals(parsed.ok, false, `capacity ${JSON.stringify(capacity)} accepted`);
  }
});

Deno.test("event_id refuses the values the old Number.isInteger coercion let through", () => {
  // These are the exact inputs creator-program accepted before: "0" and "-5"
  // landed as a session attached to nothing, `true` became event 1.
  for (const event_id of ["0", "-5", 0, -5, true, 1.5, "1.5", [1], {}, "", "   ", "abc"]) {
    const parsed = parse({ event_id });
    assertEquals(parsed.ok, false, `event_id ${JSON.stringify(event_id)} accepted`);
  }
});

Deno.test("event_id accepts a positive integer from either a number or a string", () => {
  for (const event_id of [1, 41, "41", " 41 "]) {
    const parsed = parse({ event_id });
    if (!parsed.ok) throw new Error(`${JSON.stringify(event_id)}: ${parsed.error}`);
    assertEquals(parsed.value.eventId, Number(String(event_id).trim()));
  }
});

Deno.test("event_id refuses anything past the safe integer range", () => {
  for (const event_id of [Number.MAX_SAFE_INTEGER + 2, 1e21, "9007199254740993"]) {
    assertEquals(
      parseEventId(event_id).ok,
      false,
      `event_id ${event_id} accepted`,
    );
  }
  assertEquals(parseEventId(Number.MAX_SAFE_INTEGER).ok, true);
});

Deno.test("parseEventId treats absent as no event and never as zero", () => {
  for (const value of [null, undefined]) {
    const parsed = parseEventId(value);
    if (!parsed.ok) throw new Error(parsed.error);
    assertEquals(parsed.eventId, null);
  }
});

Deno.test("starts_at must be a future instant and the title must survive trimming", () => {
  for (
    const body of [
      { starts_at: "2026-10-01T12:00:00.000Z" }, // past
      { starts_at: NOW }, // not a string
      { starts_at: "not a date" },
      { title: "   " },
      { title: 42 },
      { title: "" },
    ]
  ) {
    assertEquals(parse(body).ok, false, JSON.stringify(body));
  }
});

Deno.test("ends_at refuses junk instead of silently becoming null", () => {
  for (const ends_at of ["not a date", "2026-10-03T11:00:00.000Z", FUTURE, 12345]) {
    assertEquals(parse({ ends_at }).ok, false, JSON.stringify(ends_at));
  }
});

Deno.test("the title is bounded at 120 characters", () => {
  const parsed = parse({ title: "x".repeat(300) });
  if (!parsed.ok) throw new Error(parsed.error);
  assertEquals(parsed.value.title.length, 120);
});
