import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMP_RECIPIENTS,
  canCompTickets,
  canSubmitComp,
  parseCompRecipients,
  summarizeCompResult,
} from "./comp-recipients.ts";

test("only owner and admin see the comp control", () => {
  assert.equal(canCompTickets("owner"), true);
  assert.equal(canCompTickets("admin"), true);
  // An editor can export the roster but cannot mint tickets, and a scanner
  // can do neither. Showing them the control would promise a 403.
  assert.equal(canCompTickets("editor"), false);
  assert.equal(canCompTickets("scanner"), false);
  assert.equal(canCompTickets(null), false);
});

test("recipients split on commas, semicolons and newlines", () => {
  const p = parseCompRecipients(
    " @nova, friend@example.com;\n  \n other_host \n vip@club.co.uk ",
  );
  assert.deepEqual(p.entries, [
    "@nova",
    "friend@example.com",
    "other_host",
    "vip@club.co.uk",
  ]);
  assert.equal(p.emails, 2);
  assert.equal(p.members, 2);
  assert.equal(p.overLimit, false);
});

test("an empty box parses to nothing and cannot be sent", () => {
  const p = parseCompRecipients("  ,\n ; ");
  assert.deepEqual(p.entries, []);
  assert.equal(canSubmitComp({ tierId: "t1", preview: p, sending: false }), false);
});

test("the batch cap blocks the send instead of letting the server reject it", () => {
  const p = parseCompRecipients(
    Array.from({ length: MAX_COMP_RECIPIENTS + 1 }, (_, i) => `u${i}`).join(","),
  );
  assert.equal(p.entries.length, 101);
  assert.equal(p.overLimit, true);
  assert.equal(canSubmitComp({ tierId: "t1", preview: p, sending: false }), false);
});

test("send needs a tier and an idle request", () => {
  const p = parseCompRecipients("@nova");
  assert.equal(canSubmitComp({ tierId: "t1", preview: p, sending: false }), true);
  assert.equal(canSubmitComp({ tierId: null, preview: p, sending: false }), false);
  assert.equal(canSubmitComp({ tierId: "t1", preview: p, sending: true }), false);
});

test("issued is not delivered — a bounced claim email still leaves a valid ticket", () => {
  const s = summarizeCompResult({
    issued: 2,
    guest_issued: 3,
    delivery: [
      { recipient: "a@x.com", status: "delivered" },
      { recipient: "b@x.com", status: "delivered" },
      { recipient: "c@x.com", status: "failed", error: "mailbox full" },
    ],
    skipped: [{ recipient: "@ghost", reason: "No DVNT account" }],
    tier: "GA",
  });
  assert.deepEqual(s, {
    issued: 2,
    guestIssued: 3,
    totalIssued: 5,
    delivered: 2,
    undelivered: 1,
    skipped: 1,
  });
});

test("an older edge fn that omits guest fields still summarises", () => {
  const s = summarizeCompResult({ issued: 4, skipped: [] });
  assert.deepEqual(s, {
    issued: 4,
    guestIssued: 0,
    totalIssued: 4,
    delivered: 0,
    undelivered: 0,
    skipped: 0,
  });
});
