/**
 * Run with the repo's runner (no new framework):
 *   node --import tsx --test packages/app/lib/tickets/scan-verdict.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  isScanFailure,
  scanFailureReasonForStatus,
  scanVerdictMessage,
  scanVerdictTitle,
  OFFLINE_UNVERIFIED,
} from "./scan-verdict.ts";

test("HTTP statuses map to no-verdict reasons, never to a ticket verdict", () => {
  assert.equal(scanFailureReasonForStatus(401), "unauthorized");
  assert.equal(scanFailureReasonForStatus(403), "forbidden");
  assert.equal(scanFailureReasonForStatus(429), "rate_limited");
  assert.equal(scanFailureReasonForStatus(500), "server_error");
  assert.equal(scanFailureReasonForStatus(502), "server_error");
});

test("a failure is never confused with a bad ticket", () => {
  for (const r of ["unauthorized", "forbidden", "rate_limited", "server_error", "network_error"]) {
    assert.equal(isScanFailure(r), true, r);
  }
  // Real verdicts from redeem_ticket / ticket-scan stay verdicts.
  for (const r of ["already_scanned", "refunded", "wrong_event", "voided", "transfer_pending", "ticket_not_found", "invalid_status", undefined, null]) {
    assert.equal(isScanFailure(r as string | undefined), false, String(r));
  }
});

test("failure copy tells staff the ticket was NOT checked", () => {
  for (const r of ["unauthorized", "rate_limited", "server_error", "network_error"]) {
    assert.match(scanVerdictMessage(r), /NOT checked/);
  }
  assert.match(scanVerdictMessage("forbidden"), /door staff/);
});

test("each server verdict gets its own sentence; unknown stays 'not a valid ticket'", () => {
  assert.match(scanVerdictMessage("wrong_event"), /different event/);
  assert.match(scanVerdictMessage("voided"), /voided/);
  assert.match(scanVerdictMessage("transfer_pending"), /mid-transfer/);
  assert.match(scanVerdictMessage("refunded"), /refunded/);
  assert.equal(scanVerdictMessage("ticket_not_found"), "This QR code is not a valid ticket");
});

test("a rejection and a no-verdict never share a title", () => {
  // The bug this exists to prevent: "Scan Error" was rendered for BOTH an
  // already-scanned ticket and a server we could not reach, leaving colour as
  // the only difference between "turn them away" and "try again".
  const rejected = scanVerdictTitle("rejected", "already_scanned");
  const noVerdict = scanVerdictTitle("no_verdict", "server_error");
  assert.notEqual(rejected, noVerdict);
  assert.match(rejected, /already scanned/i);
  assert.match(noVerdict, /^Not checked in/);
});

test("every no-verdict title states the ticket was not checked in, first", () => {
  for (const reason of [
    "unauthorized",
    "forbidden",
    "rate_limited",
    "network_error",
    "server_error",
    undefined,
  ]) {
    assert.match(
      scanVerdictTitle("no_verdict", reason),
      /^Not checked in/,
      `no-verdict title for ${String(reason)} must open with "Not checked in"`,
    );
  }
});

test("red titles name the rejection, because each sends the guest elsewhere", () => {
  assert.match(scanVerdictTitle("rejected", "refunded"), /refunded/i);
  assert.match(scanVerdictTitle("rejected", "wrong_event"), /wrong event/i);
  assert.match(scanVerdictTitle("rejected", "voided"), /cancelled/i);
  // An unknown rejection must not claim more than the server said.
  assert.equal(scanVerdictTitle("rejected", null), "Not a ticket for tonight");
});

test("admitted leads with the verdict, and add-ons are their own outcome", () => {
  assert.match(scanVerdictTitle("success", null), /^Admitted/);
  assert.equal(scanVerdictTitle("success", null, "addon"), "Add-on redeemed");
});

test("an unknown token while offline is a no-verdict, never a rejection", () => {
  // The bug: the downloaded token list is active tickets as of the last
  // refresh and is frozen for as long as the door is offline, so a ticket sold
  // at the door is absent from it. Rendering that red told a paying guest
  // their ticket was fake — a refusal the server never made, which is exactly
  // what the brief's "zero red for anything the server did not reject" forbids.
  assert.equal(isScanFailure(OFFLINE_UNVERIFIED), true);
  assert.match(scanVerdictTitle("no_verdict", OFFLINE_UNVERIFIED), /^Not checked in/);
  assert.match(scanVerdictMessage(OFFLINE_UNVERIFIED), /may be out of date/i);
  // It must never read as a claim about the ticket's authenticity.
  assert.doesNotMatch(scanVerdictMessage(OFFLINE_UNVERIFIED), /not a valid ticket/i);
});
