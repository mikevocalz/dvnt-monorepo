import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMP_RECIPIENTS,
  COMP_QUANTITIES,
  isCompQuantity,
  compClaimLinkLabel,
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
    phoneIssued: 0,
    claimLinks: 0,
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
    phoneIssued: 0,
    claimLinks: 0,
    totalIssued: 4,
    delivered: 0,
    undelivered: 0,
    skipped: 0,
  });
});

test("phone numbers are counted apart from usernames and emails", () => {
  const p = parseCompRecipients("@nova\n(415) 555-0134, +44 7911 123456; friend@example.com");
  assert.equal(p.phones, 2);
  assert.equal(p.emails, 1);
  assert.equal(p.members, 1);
});

test("phone comps count as issued and their links as still to send", () => {
  const s = summarizeCompResult({
    issued: 1,
    guest_issued: 0,
    phone_guest_issued: 2,
    claim_links: [
      { recipient: "a", phone: "+14155550134", ticket_id: "t1", url: "u1", expires_at: "x", reissued: false },
      { recipient: "b", phone: "+14155550135", ticket_id: "t2", url: "u2", expires_at: "x", reissued: false },
      { recipient: "c", phone: "+14155550136", ticket_id: "t3", url: "u3", expires_at: "x", reissued: true },
    ],
    skipped: [],
  });
  assert.equal(s.phoneIssued, 2);
  assert.equal(s.claimLinks, 3);
  assert.equal(s.totalIssued, 3);
});


test("comp quantity is a desired total of 1–3, with the legacy default of one", () => {
  const base = { tierId: "t1", preview: parseCompRecipients("@nova"), sending: false };
  assert.deepEqual(COMP_QUANTITIES, [1, 2, 3]);
  assert.equal(canSubmitComp(base), true);
  for (const quantity of COMP_QUANTITIES) {
    assert.equal(isCompQuantity(quantity), true);
    assert.equal(canSubmitComp({ ...base, quantity }), true);
    assert.equal(canSubmitComp({ ...base, quantity, sending: true }), false);
  }
  for (const quantity of [0, -1, 4, 1.5, NaN, Infinity]) {
    assert.equal(isCompQuantity(quantity), false);
    assert.equal(canSubmitComp({ ...base, quantity }), false);
  }
  for (const value of ["3", null, undefined, true]) assert.equal(isCompQuantity(value), false);
});

test("three comps do not reduce the 100-recipient batch cap", () => {
  const entries = Array.from({ length: MAX_COMP_RECIPIENTS }, (_, i) => `user${i}`);
  const base = { tierId: "t1", sending: false, quantity: 3 };
  assert.equal(canSubmitComp({ ...base, preview: parseCompRecipients(entries.join(",")) }), true);
  assert.equal(canSubmitComp({ ...base, preview: parseCompRecipients([...entries, "overflow"].join(",")) }), false);
});

test("three phone tickets keep separate links, labels and issuance counts", () => {
  const links = [1, 2, 3].map((n) => ({ recipient: "+14155550134", phone: "+14155550134", ticket_id: `t${n}`, url: `u${n}`, expires_at: "x", reissued: false }));
  assert.deepEqual(links.map((link) => compClaimLinkLabel(links, link)), [
    "+14155550134 · Ticket 1 of 3", "+14155550134 · Ticket 2 of 3", "+14155550134 · Ticket 3 of 3",
  ]);
  assert.equal(compClaimLinkLabel([links[0]!], links[0]!), "+14155550134");
  const summary = summarizeCompResult({ issued: 0, phone_guest_issued: 3, claim_links: links, skipped: [] });
  assert.equal(summary.totalIssued, 3);
  assert.equal(summary.claimLinks, 3);
});
