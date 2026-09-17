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
