import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccessEvent, decideEventRoomAccess, resolveEventRoomAccess,
} from "../../../../apps/mobile/supabase/functions/_shared/event-access.ts";
import {
  normalizeCompRecipient, dedupeCompAccounts,
} from "../../../../apps/mobile/supabase/functions/_shared/comp-recipients.ts";

const start = Date.parse("2026-09-20T20:00:00Z");
const event = { id: 12, host_id: "host", visibility: "private", ticketing_enabled: true,
  status: "published", start_date: new Date(start).toISOString(), end_date: new Date(start + 3_600_000).toISOString() };
const room = { created_at: "2026-09-16T12:00:00Z", ends_at: "2026-09-16T12:05:00Z" };
const noAccess = { organizer: false, ticket: false, invited: false };

function reason(result: ReturnType<typeof decideEventRoomAccess>) {
  return result.ok ? "allowed" : result.detail.reason;
}

test("a room invite cannot replace a paid-event admission ticket", () => {
  assert.equal(reason(decideEventRoomAccess(event, { ...noAccess, invited: true }, room, start)), "event_ticket_required");
});
test("ticket holders wait until the scheduled instant", () => {
  assert.equal(reason(decideEventRoomAccess(event, { ...noAccess, ticket: true }, room, start - 1)), "event_not_started");
  assert.equal(reason(decideEventRoomAccess(event, { ...noAccess, ticket: true }, room, start)), "allowed");
});
test("free-plan duration starts at event start, not advance room creation", () => {
  const result = decideEventRoomAccess(event, { ...noAccess, ticket: true }, room, start);
  assert.deepEqual(result, { ok: true, linked: true, endsAt: new Date(start + 300_000).toISOString() });
  assert.equal(reason(decideEventRoomAccess(event, { ...noAccess, ticket: true }, room, start + 300_000)), "session_expired");
});
test("event end caps an unlimited room", () => {
  assert.equal(reason(decideEventRoomAccess(event, { ...noAccess, ticket: true }, {}, start + 3_600_000)), "session_expired");
});
test("cancelled events deny the host as well", () => {
  assert.equal(reason(decideEventRoomAccess({ ...event, status: "cancelled" }, { ...noAccess, organizer: true }, {}, start)), "event_unavailable");
});
test("host can prepare before start, but missing schedule fails closed", () => {
  assert.equal(reason(decideEventRoomAccess(event, { ...noAccess, organizer: true }, room, start - 10_000)), "allowed");
  assert.equal(reason(decideEventRoomAccess({ ...event, start_date: null }, { ...noAccess, organizer: true }, room, start)), "event_schedule_missing");
});
test("free invited events admit invitees and reject strangers", () => {
  const free = { ...event, ticketing_enabled: false };
  assert.equal(reason(decideEventRoomAccess(free, { ...noAccess, invited: true }, room, start)), "allowed");
  assert.equal(reason(decideEventRoomAccess(free, noAccess, room, start)), "event_invite_required");
});
test("ordinary rooms preserve their original expiry", () => {
  assert.deepEqual(decideEventRoomAccess(null, noAccess, room, start), { ok: true, linked: false, endsAt: room.ends_at });
});

// Query fake applies real equality / IN filters; it exercises access resolution,
// including multiple tickets, retired tickets and declined invites.
function database(tables: Record<string, any[]>, failedTable?: string) {
  return { from(table: string) {
    let rows = tables[table] ?? [];
    const q: any = {
      select() { return q; },
      eq(key: string, value: unknown) { rows = rows.filter((r) => r[key] === value); return q; },
      in(key: string, values: unknown[]) { rows = rows.filter((r) => values.includes(r[key])); return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: failedTable === table ? new Error("offline") : null }),
      then(resolve: (v: any) => unknown) { return Promise.resolve(resolve({ data: rows, error: failedTable === table ? new Error("offline") : null })); },
    };
    return q;
  } };
}

test("private checkout rejects anonymous users and declined invitees", async () => {
  const db = database({ events: [event], event_invites: [{ event_id: 12, invited_user_id: "buyer", status: "declined" }] });
  assert.equal(await canAccessEvent(db, 12, null), false);
  assert.equal(await canAccessEvent(db, 12, "buyer"), false);
});
test("active admission allows access, refunded/product tickets do not", async () => {
  for (const [status, category, expected] of [["active", "admission", true], ["scanned", "admission", true], ["refunded", "admission", false], ["transfer_pending", "admission", false], ["active", "product", false]] as const) {
    const db = database({ events: [event], tickets: [{ event_id: 12, user_id: "buyer", status, category }] });
    assert.equal(await canAccessEvent(db, 12, "buyer"), expected);
  }
});
test("pending event invite and accepted staff can view private checkout", async () => {
  assert.equal(await canAccessEvent(database({ events: [event], event_invites: [{ event_id: 12, invited_user_id: "buyer", status: "pending" }] }), 12, "buyer"), true);
  assert.equal(await canAccessEvent(database({ events: [event], event_co_organizers: [{ event_id: 12, user_id: "staff", accepted: true }] }), 12, "staff"), true);
  assert.equal(await canAccessEvent(database({ events: [event], event_co_organizers: [{ event_id: 12, user_id: "staff", accepted: false }] }), 12, "staff"), false);
});
test("lookup failure never becomes public event access", async () => {
  await assert.rejects(canAccessEvent(database({ events: [event] }, "events"), 12, "buyer"));
  await assert.rejects(canAccessEvent(database({ events: [event] }, "tickets"), 12, "buyer"));
  await assert.rejects(resolveEventRoomAccess(database({}, "events"), { uuid: "room" }, "buyer"));
});
test("ambiguous linked event relation fails closed", async () => {
  await assert.rejects(resolveEventRoomAccess(database({ events: [{ ...event, lynk_room_id: "room" }, { ...event, id: 13, lynk_room_id: "room" }] }), { uuid: "room" }, "buyer"));
});
test("comp recipients normalize valid accounts and reject phone/ambiguous inputs", () => {
  assert.deepEqual(normalizeCompRecipient(" @Micah "), { kind: "username", value: "micah" });
  assert.deepEqual(normalizeCompRecipient(" Name@Example.com "), { kind: "email", value: "name@example.com" });
  for (const input of ["+1 (202) 555-0123", "2025550123", "@bad@email.com", {}, null])
    assert.equal(normalizeCompRecipient(input), null);
});
test("username and email aliases receive one comp, retaining a skipped explanation", () => {
  const result = dedupeCompAccounts([{ authId: "user1", raw: "@micah" }, { authId: "user1", raw: "micah@example.com" }, { authId: "user2", raw: "@friend" }]);
  assert.deepEqual(result.unique.map((r) => r.authId), ["user1", "user2"]);
  assert.equal(result.skipped[0].recipient, "micah@example.com");
});
