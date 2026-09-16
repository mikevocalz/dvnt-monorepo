import test from "node:test";
import assert from "node:assert/strict";
import {
  canInviteGuests,
  guestInviteGrantsAccess,
  parseGuestRecipients,
  planGuestInviteRows,
  routeGuestRecipient,
} from "../../../../apps/mobile/supabase/functions/_shared/guest-invites.ts";

// The bug: selecting "Private" on the create screen offered no way to say who
// is invited, so the only route in was a comped ticket — which needs a tier and
// only exists after publish. These are the decisions the guest list rests on.
// The SQL half lives in 20260916193000_event_guest_invites.sql; keep them level.

test("only the owner and an accepted admin may edit the guest list", () => {
  assert.equal(canInviteGuests("owner"), true);
  assert.equal(canInviteGuests("admin"), true);
  // Editing the event's copy is not the same power as handing out the keys.
  assert.equal(canInviteGuests("editor"), false);
  assert.equal(canInviteGuests("scanner"), false);
  assert.equal(canInviteGuests(null), false);
});

test("a username normalises without its @ and an email lowercases", () => {
  assert.deepEqual(routeGuestRecipient("@Deviant"), {
    route: "member",
    username: "deviant",
    raw: "@Deviant",
  });
  assert.deepEqual(routeGuestRecipient("  Guest@Example.COM "), {
    route: "email",
    email: "guest@example.com",
    raw: "Guest@Example.COM",
  });
});

test("junk and phone numbers are skipped, never guessed into an account", () => {
  for (const input of ["", "   ", "+1 (415) 555-0134", "not a handle"]) {
    assert.equal(routeGuestRecipient(input).route, "skip", input);
  }
});

test("the same guest typed twice is one invite", () => {
  const { routes, skipped } = parseGuestRecipients([
    "@deviant",
    "Deviant",
    "guest@example.com",
    "GUEST@EXAMPLE.COM",
    "+14155550134",
  ]);
  assert.deepEqual(
    routes.map((r) => (r.route === "member" ? r.username : (r as any).email)),
    ["deviant", "guest@example.com"],
  );
  assert.equal(skipped.length, 1);
});

test("re-inviting someone already on the list inserts nothing", () => {
  const existing = [
    { invited_user_id: "auth-deviant", status: "pending" },
    { invited_email: "Guest@Example.com", status: "accepted" },
  ];
  const plan = planGuestInviteRows(
    [
      { raw: "@deviant", authId: "auth-deviant" },
      { raw: "guest@example.com", email: "guest@example.com" },
      { raw: "@newbie", authId: "auth-newbie" },
    ],
    existing,
  );
  assert.deepEqual(
    plan.insert.map((g) => g.raw),
    ["@newbie"],
  );
  assert.deepEqual(
    plan.alreadyInvited.map((g) => g.recipient),
    ["@deviant", "guest@example.com"],
  );
  // Idempotent: replaying the same batch against the same rows is still a no-op.
  assert.deepEqual(planGuestInviteRows(plan.insert, existing).insert.length, 1);
});

test("a member invite admits that member and nobody else", () => {
  const row = { invited_user_id: "auth-guest", status: "pending" };
  assert.equal(guestInviteGrantsAccess(row, { authId: "auth-guest" }), true);
  // A stranger, an anonymous viewer, and a spoofed id all stay refused.
  assert.equal(guestInviteGrantsAccess(row, { authId: "auth-stranger" }), false);
  assert.equal(guestInviteGrantsAccess(row, {}), false);
  assert.equal(guestInviteGrantsAccess(row, { authId: null }), false);
});

test("an email string alone never grants access", () => {
  const row = { invited_email: "guest@example.com", status: "pending" };
  // No session at all.
  assert.equal(guestInviteGrantsAccess(row, {}), false);
  // Signed in, claims the address, but Auth has not confirmed it.
  assert.equal(
    guestInviteGrantsAccess(row, { authId: "auth-impostor" }),
    false,
  );
  assert.equal(
    guestInviteGrantsAccess(row, {
      authId: "auth-impostor",
      verifiedEmail: "someone.else@example.com",
    }),
    false,
  );
  // Only a real account with that address verified gets in.
  assert.equal(
    guestInviteGrantsAccess(row, {
      authId: "auth-claimant",
      verifiedEmail: "GUEST@example.com",
    }),
    true,
  );
});

test("a declined invite grants nothing; a null status reads as pending", () => {
  assert.equal(
    guestInviteGrantsAccess(
      { invited_user_id: "auth-guest", status: "declined" },
      { authId: "auth-guest" },
    ),
    false,
  );
  assert.equal(
    guestInviteGrantsAccess(
      { invited_user_id: "auth-guest", status: null },
      { authId: "auth-guest" },
    ),
    true,
  );
});

test("revoke removes access: with the row gone, nothing admits the guest", () => {
  const rows = [
    { invited_user_id: "auth-guest", status: "pending" },
    { invited_email: "guest@example.com", status: "pending" },
  ];
  const viewer = { authId: "auth-guest", verifiedEmail: "guest@example.com" };
  assert.equal(
    rows.some((r) => guestInviteGrantsAccess(r, viewer)),
    true,
  );
  const afterRevoke = rows.filter(
    (r) =>
      r.invited_user_id !== "auth-guest" &&
      r.invited_email?.toLowerCase() !== "guest@example.com",
  );
  assert.equal(afterRevoke.length, 0);
  assert.equal(
    afterRevoke.some((r) => guestInviteGrantsAccess(r, viewer)),
    false,
  );
});
