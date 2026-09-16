import test from "node:test";
import assert from "node:assert/strict";
import {
  ANON_VIEWER_ID,
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
