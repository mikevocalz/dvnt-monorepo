import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccessEvent, decideEventRoomAccess, eventRelationships,
} from "../../../../apps/mobile/supabase/functions/_shared/event-access.ts";

// Regression: a member the host had invited to a private event got "event not
// found". The only invitation the product actually writes is a co-organizer
// staff invite, and it lands with accepted = false until the invitee taps
// accept — which they cannot do on a screen that refuses to open. Live data at
// the time of the report: 7 of 8 event_co_organizers rows had accepted = false.
// Mirrors can_view_event in 20260916121000_private_event_access_boundary.sql.

const start = Date.parse("2026-09-20T20:00:00Z");
const privateEvent = {
  id: 87, host_id: "host", visibility: "private", status: "active",
  ticketing_enabled: false,
  start_date: new Date(start).toISOString(),
  end_date: new Date(start + 3_600_000).toISOString(),
};

function database(tables: Record<string, any[]>) {
  return { from(table: string) {
    let rows = tables[table] ?? [];
    const q: any = {
      select: () => q,
      eq(key: string, value: unknown) { rows = rows.filter((r) => r[key] === value); return q; },
      in(key: string, values: unknown[]) { rows = rows.filter((r) => values.includes(r[key])); return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: any) => unknown) => Promise.resolve(resolve({ data: rows, error: null })),
    };
    return q;
  } };
}

const pendingStaff = database({
  events: [privateEvent],
  event_co_organizers: [{ event_id: 87, user_id: "guest", accepted: false }],
});

test("a sent-but-unaccepted staff invite opens a private event", async () => {
  assert.equal(await canAccessEvent(pendingStaff, 87, "guest"), true);
  const relations = await eventRelationships(pendingStaff, privateEvent, "guest");
  assert.deepEqual(relations, { organizer: false, ticket: false, invited: true });
});

test("being invited is not being an organizer", async () => {
  // Organizer privileges skip the not-started gate and survive cancellation.
  // An invitee must get neither, or "let them in" becomes "promote them".
  const relations = await eventRelationships(pendingStaff, privateEvent, "guest");
  const early = decideEventRoomAccess(privateEvent, relations, {}, start - 1);
  assert.equal(early.ok === false && early.detail.reason, "event_not_started");
  const cancelled = decideEventRoomAccess({ ...privateEvent, status: "cancelled" }, relations, {}, start);
  assert.equal(cancelled.ok === false && cancelled.detail.reason, "event_unavailable");
});

test("a stranger and an anonymous viewer are still refused", async () => {
  assert.equal(await canAccessEvent(pendingStaff, 87, "stranger"), false);
  assert.equal(await canAccessEvent(pendingStaff, 87, null), false);
});

// Regression: a shared link to a private event opened "event not found" for
// every recipient. Sharing mints /e/<id> but writes nothing; access needs an
// event_invites row, which only event-invite-guests creates. The share path
// (Share sheet on native, InviteGuestsSheet on web) now calls it — this pins
// the access rule that makes the invite, not the link, the thing that works.
const guestListInvite = database({
  events: [privateEvent],
  event_invites: [{ event_id: 87, invited_user_id: "invitee", status: "pending" }],
});

test("a guest-list invite opens a private event for the invitee", async () => {
  assert.equal(await canAccessEvent(guestListInvite, 87, "invitee"), true);
  const relations = await eventRelationships(guestListInvite, privateEvent, "invitee");
  assert.deepEqual(relations, { organizer: false, ticket: false, invited: true });
});

test("the same link opens nothing for a guest who was never invited", async () => {
  assert.equal(await canAccessEvent(guestListInvite, 87, "stranger"), false);
  assert.equal(await canAccessEvent(guestListInvite, 87, null), false);
});
