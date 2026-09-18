import test from "node:test";
import assert from "node:assert/strict";
import {
  ANON_VIEWER_ID,
  isAdmissible,
  isListable,
  pendingTransferTicketIds,
  resolveTicketAccess,
} from "./ticket-access.ts";

const HOLDER = "user-holder";
const ticket = (over: Record<string, unknown> = {}) =>
  ({ id: "t1", user_id: HOLDER, status: "active", ...over }) as never;

test("the holder of an active pass gets the credential and both actions", () => {
  const a = resolveTicketAccess({ ticket: ticket(), viewerId: HOLDER });
  assert.deepEqual(a, {
    isHolder: true,
    canShowCredential: true,
    canTransfer: true,
    canRefund: true,
    denial: null,
  });
});

test("a non-holder is refused the credential entirely", () => {
  const a = resolveTicketAccess({ ticket: ticket(), viewerId: "someone-else" });
  assert.equal(a.isHolder, false);
  assert.equal(a.canShowCredential, false);
  assert.equal(a.canTransfer, false);
  assert.equal(a.canRefund, false);
  assert.equal(a.denial, "not-holder");
});

test("a signed-out read is refused before the holder check runs", () => {
  for (const viewerId of [ANON_VIEWER_ID, "", null, undefined]) {
    const a = resolveTicketAccess({ ticket: ticket(), viewerId });
    assert.equal(a.canShowCredential, false, String(viewerId));
    assert.equal(a.denial, "signed-out", String(viewerId));
  }
});

test("a row with no user_id fails closed rather than matching", () => {
  const a = resolveTicketAccess({
    ticket: ticket({ user_id: null }),
    viewerId: HOLDER,
  });
  assert.equal(a.denial, "not-holder");
  assert.equal(a.canShowCredential, false);
});

test("a pass mid-transfer is not owned, transferable or refundable", () => {
  const byStatus = resolveTicketAccess({
    ticket: ticket({ status: "transfer_pending" }),
    viewerId: HOLDER,
  });
  assert.equal(byStatus.denial, "mid-transfer");
  assert.equal(byStatus.canShowCredential, false);
  assert.equal(byStatus.canTransfer, false);
  assert.equal(byStatus.canRefund, false);
  // still the holder's row — the UI says "moving", not "not yours"
  assert.equal(byStatus.isHolder, true);
});

test("a still-active row named by a pending transfer is also frozen", () => {
  const ids = pendingTransferTicketIds([
    { ticket_id: "t1", status: "pending" },
    { tickets: { id: "t9" } },
  ]);
  assert.deepEqual([...ids].sort(), ["t1", "t9"]);
  const a = resolveTicketAccess({
    ticket: ticket(),
    viewerId: HOLDER,
    transferringTicketIds: ids,
  });
  assert.equal(a.denial, "mid-transfer");
  assert.equal(a.canRefund, false);
});

test("refunded and void passes show nothing; scanned keeps the credential", () => {
  for (const status of ["refunded", "void"]) {
    const a = resolveTicketAccess({ ticket: ticket({ status }), viewerId: HOLDER });
    assert.equal(a.canShowCredential, false, status);
    assert.equal(a.denial, "spent", status);
  }
  const used = resolveTicketAccess({
    ticket: ticket({ status: "scanned" }),
    viewerId: HOLDER,
  });
  assert.equal(used.canShowCredential, true);
  assert.equal(used.canTransfer, false);
  assert.equal(used.canRefund, false);
});

test("an unknown status is treated as spent, never as active", () => {
  const a = resolveTicketAccess({
    ticket: ticket({ status: "something_new" }),
    viewerId: HOLDER,
  });
  assert.equal(a.canShowCredential, false);
  assert.equal(a.canTransfer, false);
});

test("a missing ticket is refused", () => {
  assert.equal(
    resolveTicketAccess({ ticket: null, viewerId: HOLDER }).denial,
    "not-holder",
  );
  assert.deepEqual([...pendingTransferTicketIds(null)], []);
});

// ── The production shape, which every test above misses by using one synthetic
// id on both sides. `tickets.user_id` is stamped with the Better Auth id
// (ticket-checkout/index.ts:137 → :366, and issue_rsvp_ticket's p_user_auth_id),
// while the auth store's `user.id` is the users-table integer. All 304 ticket
// rows in production carry the auth-id form, so comparing against `user.id`
// alone refuses every real holder.
const AUTH_ID = "pKa8v6movw4tdx0uhVN9v2IPiAEwD7ug";
const USERS_ROW_ID = "613";

test("a pass stamped with the auth id belongs to the viewer holding that auth id", () => {
  const a = resolveTicketAccess({
    ticket: ticket({ user_id: AUTH_ID }),
    viewerId: USERS_ROW_ID,
    viewerAuthId: AUTH_ID,
  });
  assert.equal(a.isHolder, true);
  assert.equal(a.canShowCredential, true);
  assert.equal(a.denial, null);
});

test("a legacy pass stamped with the users-table id still resolves", () => {
  const a = resolveTicketAccess({
    ticket: ticket({ user_id: USERS_ROW_ID }),
    viewerId: USERS_ROW_ID,
    viewerAuthId: AUTH_ID,
  });
  assert.equal(a.isHolder, true);
  assert.equal(a.canShowCredential, true);
});

test("another member's auth id is still refused when both ids are known", () => {
  const a = resolveTicketAccess({
    ticket: ticket({ user_id: "someone-elses-auth-id" }),
    viewerId: USERS_ROW_ID,
    viewerAuthId: AUTH_ID,
  });
  assert.equal(a.canShowCredential, false);
  assert.equal(a.denial, "not-holder");
});

test("a missing auth id never widens the match to anything falsy", () => {
  for (const user_id of ["", null, undefined]) {
    const a = resolveTicketAccess({
      ticket: ticket({ user_id }),
      viewerId: USERS_ROW_ID,
      viewerAuthId: undefined,
    });
    assert.equal(a.canShowCredential, false, String(user_id));
    assert.equal(a.denial, "not-holder", String(user_id));
  }
});

// ── Door admission. A refunded pass stayed checkable at the door because the
// list filtered only "void": it sat in the roster, in the progress
// denominator, and behind a live "Check in" button wearing nothing but a grey
// " · Refunded" suffix.
test("only active and scanned passes may be admitted", () => {
  assert.equal(isAdmissible("active"), true);
  assert.equal(isAdmissible("scanned"), true);
  for (const s of ["refunded", "void", "transfer_pending", "", null, undefined, "something_new"])
    assert.equal(isAdmissible(s), false, String(s));
});

test("a refunded pass is still listed, so staff can look the person up", () => {
  assert.equal(isListable("refunded"), true);
  assert.equal(isListable("active"), true);
  assert.equal(isListable("transfer_pending"), true);
  assert.equal(isListable("void"), false);
});

test("listable is deliberately wider than admissible", () => {
  const listedButRefused = ["refunded", "transfer_pending"].filter(
    (s) => isListable(s) && !isAdmissible(s),
  );
  assert.deepEqual(listedButRefused, ["refunded", "transfer_pending"]);
});
