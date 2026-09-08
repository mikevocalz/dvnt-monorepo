import test from "node:test";
import assert from "node:assert/strict";
import {
  canDeliver,
  canTransitionDelivery,
  canTransitionModeration,
  canTransitionPayment,
  isTerminatedByPayment,
  organizerStatus,
  organizerStatusCopy,
  type BoostLifecycle,
  type OrganizerStatus,
} from "./boost-lifecycle.ts";

const LIVE: BoostLifecycle = {
  payment: "paid",
  moderation: "approved",
  delivery: "active",
};
const OK = { eventEligible: true, scheduleCurrent: true };

test("delivery needs all five conditions — no four of them suffice", () => {
  assert.equal(canDeliver(LIVE, OK), true);
  assert.equal(canDeliver({ ...LIVE, payment: "pending_payment" }, OK), false);
  assert.equal(canDeliver({ ...LIVE, moderation: "submitted" }, OK), false);
  assert.equal(canDeliver({ ...LIVE, delivery: "paused" }, OK), false);
  assert.equal(canDeliver(LIVE, { ...OK, eventEligible: false }), false);
  assert.equal(canDeliver(LIVE, { ...OK, scheduleCurrent: false }), false);
});

test("paid but unapproved is not live, and approved but unpaid is not either", () => {
  assert.equal(
    organizerStatus({ ...LIVE, moderation: "submitted" }, OK),
    "awaiting_review",
  );
  assert.equal(
    organizerStatus({ ...LIVE, payment: "pending_payment" }, OK),
    "awaiting_payment",
  );
});

test("a refunded campaign never resumes, whatever arrives later", () => {
  assert.equal(isTerminatedByPayment({ ...LIVE, payment: "refunded" }), true);
  assert.equal(isTerminatedByPayment({ ...LIVE, payment: "charged_back" }), true);
  // A stale "succeeded" webhook cannot walk it back.
  assert.equal(canTransitionPayment("refunded", "paid"), false);
  assert.equal(canTransitionPayment("charged_back", "paid"), false);
  assert.equal(canDeliver({ ...LIVE, payment: "refunded" }, OK), false);
});

test("terminal states have no way out", () => {
  for (const to of ["paid", "failed", "pending_payment", "refunded"] as const) {
    assert.equal(canTransitionPayment("refunded", to), false, to);
  }
  assert.equal(canTransitionDelivery("completed", "active"), false);
  assert.equal(canTransitionDelivery("stopped", "active"), false);
});

test("a rejected creative can be resubmitted; an approved one can be revalidated", () => {
  assert.equal(canTransitionModeration("rejected", "submitted"), true);
  assert.equal(canTransitionModeration("approved", "revalidate"), true);
  assert.equal(canTransitionModeration("revalidate", "approved"), true);
  assert.equal(canTransitionModeration("submitted", "revalidate"), false);
});

test("a paused campaign can resume or end, but cannot skip back to scheduled", () => {
  assert.equal(canTransitionDelivery("paused", "active"), true);
  assert.equal(canTransitionDelivery("paused", "completed"), true);
  assert.equal(canTransitionDelivery("paused", "scheduled"), false);
});

test("what blocks the organizer is what they are told first", () => {
  assert.equal(
    organizerStatus(
      { payment: "paid", moderation: "rejected", delivery: "scheduled" },
      OK,
    ),
    "rejected",
  );
  assert.equal(organizerStatus({ ...LIVE, payment: "refunded" }, OK), "refunded");
});

test("submitted never reads as live, and requested never reads as refunded", () => {
  assert.notEqual(organizerStatusCopy("awaiting_review").label.toLowerCase(), "live");
  assert.match(organizerStatusCopy("awaiting_review").label, /submitted/i);
  assert.match(organizerStatusCopy("refund_requested").label, /requested/i);
  assert.match(
    organizerStatusCopy("refund_requested").detail,
    /not yet a completed refund/i,
  );
  assert.equal(organizerStatusCopy("refunded").label, "Refunded");
});

test("no status tells the organizer they were not charged", () => {
  const all: OrganizerStatus[] = [
    "awaiting_payment", "payment_failed", "awaiting_review", "rejected",
    "scheduled", "live", "paused", "ended", "stopped",
    "refund_requested", "refunded",
  ];
  for (const s of all) {
    const { label, detail } = organizerStatusCopy(s);
    const text = `${label} ${detail}`.toLowerCase();
    assert.equal(/not (been )?charged|no charge/.test(text), false, `${s}: ${text}`);
  }
});

test("an in-window campaign whose event was cancelled stops delivering", () => {
  assert.equal(canDeliver(LIVE, { eventEligible: false, scheduleCurrent: true }), false);
  assert.equal(
    organizerStatus(LIVE, { eventEligible: false, scheduleCurrent: true }),
    "scheduled",
    "it is not reported as live",
  );
});
