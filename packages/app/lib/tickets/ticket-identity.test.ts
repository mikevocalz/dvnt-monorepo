import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTicketRouteParam,
  orderTicketGroup,
  resolveTicketRoute,
} from "./ticket-identity.ts";
import type { TicketRecord } from "../api/tickets.ts";

const TICKET_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TICKET_B = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const TICKET_C = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";

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
    ...over,
  };
}

test("a uuid param is a ticket id, an integer is an event id", () => {
  assert.deepEqual(classifyTicketRouteParam(TICKET_A), {
    kind: "ticket",
    ticketId: TICKET_A,
  });
  assert.deepEqual(classifyTicketRouteParam("91"), {
    kind: "event",
    eventId: "91",
  });
  assert.deepEqual(classifyTicketRouteParam(["91"]), {
    kind: "event",
    eventId: "91",
  });
  for (const bad of ["", "  ", "abc", null, undefined, 91, "91a"]) {
    assert.equal(classifyTicketRouteParam(bad).kind, "invalid", String(bad));
  }
});

test("admission outranks coat check, then issue order, then id", () => {
  const group = orderTicketGroup([
    ticket({ id: TICKET_C, category: "coat_check" }),
    ticket({ id: TICKET_B, category: "admission", created_at: "2026-01-02T00:00:00.000Z" }),
    ticket({ id: TICKET_A, category: "admission", created_at: "2026-01-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(group.map((t) => t.id), [TICKET_A, TICKET_B, TICKET_C]);
});

test("a ticket id always resolves to that exact ticket, whatever else the account holds", () => {
  const tickets = [
    ticket({ id: TICKET_A, category: "admission" }),
    ticket({ id: TICKET_C, category: "coat_check" }),
  ];
  const first = resolveTicketRoute({ kind: "ticket", ticketId: TICKET_C }, tickets);
  assert.equal(first.kind, "ticket");
  assert.equal(first.kind === "ticket" && first.ticket.id, TICKET_C);
  assert.equal(first.kind === "ticket" && first.index, 1);

  // Refetch reorders the server rows. The resolution must not move.
  const second = resolveTicketRoute(
    { kind: "ticket", ticketId: TICKET_C },
    [...tickets].reverse(),
  );
  assert.equal(second.kind === "ticket" && second.ticket.id, TICKET_C);
  assert.equal(second.kind === "ticket" && second.index, 1);
});

test("an event id with several passes resolves to the group, never to one of them", () => {
  const tickets = [
    ticket({ id: TICKET_A, category: "admission" }),
    ticket({ id: TICKET_C, category: "coat_check" }),
  ];
  const resolved = resolveTicketRoute({ kind: "event", eventId: "91" }, tickets);
  assert.equal(resolved.kind, "group");
  assert.equal(resolved.kind === "group" && resolved.group.length, 2);
});

test("an event id with exactly one pass opens it", () => {
  const resolved = resolveTicketRoute(
    { kind: "event", eventId: "91" },
    [ticket({ id: TICKET_A }), ticket({ id: TICKET_B, event_id: 92 })],
  );
  assert.equal(resolved.kind === "ticket" && resolved.ticket.id, TICKET_A);
});

test("unknown ids and empty accounts are not-found, never a substitute pass", () => {
  const tickets = [ticket({ id: TICKET_A })];
  assert.equal(resolveTicketRoute({ kind: "ticket", ticketId: TICKET_B }, tickets).kind, "not-found");
  assert.equal(resolveTicketRoute({ kind: "event", eventId: "404" }, tickets).kind, "not-found");
  assert.equal(resolveTicketRoute({ kind: "invalid" }, tickets).kind, "not-found");
});
