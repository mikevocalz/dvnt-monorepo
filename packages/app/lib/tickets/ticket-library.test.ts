import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTicketLibrary,
  groupTicketsByEvent,
  libraryCounts,
  libraryViewState,
  nextEventShortcut,
} from "./ticket-library.ts";
import type { TicketRecord } from "../api/tickets.ts";

const NOW = Date.parse("2026-03-10T20:00:00.000Z");
const T = (n: number) => `3f2504e0-4f89-41d3-9a0c-0305e82c33${String(n).padStart(2, "0")}`;

function ticket(over: Partial<TicketRecord> & { id: string }): TicketRecord {
  return {
    event_id: 91,
    ticket_type_id: "tt",
    user_id: "u1",
    status: "active",
    qr_token: `qr-${over.id}`,
    checked_in_at: null,
    checked_in_by: null,
    purchase_amount_cents: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    event_title: "Event 91",
    event_date: "2026-03-11T22:00:00.000Z",
    ...over,
  };
}

test("an admission ticket and a coat-check claim group under one event, both kept", () => {
  const groups = groupTicketsByEvent([
    ticket({ id: T(1), category: "admission" }),
    ticket({ id: T(2), category: "coat_check" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tickets.length, 2, "no dedupe by event_id");
  assert.deepEqual(groups[0].tickets.map((t) => t.category), ["admission", "coat_check"]);
});

test("an overnight event that already started is still Upcoming, not history", () => {
  // Doors 2026-03-10 22:00Z, ends 04:00Z next day. "Now" is 20:00Z — before it.
  // The case that matters is a pass read at 02:00Z, mid-event.
  const midEvent = Date.parse("2026-03-11T02:00:00.000Z");
  const lib = buildTicketLibrary(
    [ticket({ id: T(1), event_date: "2026-03-10T22:00:00.000Z" })],
    midEvent,
  );
  assert.equal(lib.upcoming.length, 1, "mid-event pass must stay in Upcoming");
  assert.equal(lib.past.length, 0);
});

test("a finished event moves to Past", () => {
  const lib = buildTicketLibrary(
    [ticket({ id: T(1), event_date: "2026-03-01T22:00:00.000Z" })],
    NOW,
  );
  assert.equal(lib.past.length, 1);
  assert.equal(lib.upcoming.length, 0);
});

test("a refunded pass is history even before the doors open", () => {
  const lib = buildTicketLibrary(
    [ticket({ id: T(1), status: "refunded", event_date: "2026-04-01T22:00:00.000Z" })],
    NOW,
  );
  assert.equal(lib.past.length, 1);
});

test("a transfer-pending pass goes to Needs attention, never under 'No tickets yet'", () => {
  const lib = buildTicketLibrary(
    [ticket({ id: T(1), status: "transfer_pending" })],
    NOW,
  );
  assert.equal(lib.needsAttention.length, 1);
  assert.equal(lib.upcoming.length, 0);
  assert.equal(lib.past.length, 0);
});

test("upcoming is ordered by the soonest event; undated passes sort last but stay visible", () => {
  const lib = buildTicketLibrary(
    [
      ticket({ id: T(1), event_id: 1, event_date: "2026-05-01T22:00:00.000Z" }),
      ticket({ id: T(2), event_id: 2, event_date: "" }),
      ticket({ id: T(3), event_id: 3, event_date: "2026-03-20T22:00:00.000Z" }),
    ],
    NOW,
  );
  assert.deepEqual(lib.upcoming.map((g) => g.eventId), ["3", "1", "2"]);
});

test("the next-event shortcut opens a pass only when there is exactly one", () => {
  const one = buildTicketLibrary([ticket({ id: T(1) })], NOW);
  assert.deepEqual(nextEventShortcut(one), { kind: "ticket", ticketId: T(1) });

  const two = buildTicketLibrary(
    [ticket({ id: T(1), category: "admission" }), ticket({ id: T(2), category: "coat_check" })],
    NOW,
  );
  assert.deepEqual(nextEventShortcut(two), { kind: "group", eventId: "91" });

  assert.equal(nextEventShortcut(buildTicketLibrary([], NOW)), null);

  const refundedOnly = buildTicketLibrary([ticket({ id: T(1), status: "refunded" })], NOW);
  assert.equal(nextEventShortcut(refundedOnly), null, "a refunded pass is not somewhere to go");
});

test("counts separate events from passes and exclude invalid credentials", () => {
  const lib = buildTicketLibrary(
    [
      ticket({ id: T(1), event_id: 1, category: "admission" }),
      ticket({ id: T(2), event_id: 1, category: "coat_check" }),
      ticket({ id: T(3), event_id: 2, status: "void" }),
      ticket({ id: T(4), event_id: 3, status: "transfer_pending" }),
    ],
    NOW,
  );
  assert.deepEqual(libraryCounts(lib), {
    upcomingEvents: 1,
    upcomingPasses: 2,
    needsAttention: 1,
  });
});

test("a failed read is never rendered as an empty library", () => {
  assert.equal(
    libraryViewState({ isLoading: false, isError: true, hasData: false, ticketCount: 0 }),
    "failed",
  );
  assert.equal(
    libraryViewState({ isLoading: false, isError: false, hasData: true, ticketCount: 0 }),
    "empty",
  );
  // A refresh that fails over loaded passes keeps them on screen.
  assert.equal(
    libraryViewState({ isLoading: false, isError: true, hasData: true, ticketCount: 3 }),
    "stale",
  );
  assert.equal(
    libraryViewState({ isLoading: true, isError: false, hasData: false, ticketCount: 0 }),
    "loading",
  );
  assert.equal(
    libraryViewState({ isLoading: false, isError: false, hasData: true, ticketCount: 2 }),
    "ready",
  );
});
