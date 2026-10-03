import test from "node:test";
import assert from "node:assert/strict";
import {
  claimTokenFromParam,
  compClaimMessage,
  continuesQueue,
  smsHref,
  statusFromSmsResult,
  unsentLinks,
} from "./comp-claim-message.ts";

const URL = "https://dvntapp.live/ticket/claim/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ-_01234";

test("the message names the event and carries the link exactly once", () => {
  const msg = compClaimMessage("Warehouse Night", URL);
  assert.equal(msg, `I got you a ticket to Warehouse Night on DVNT. Tap to claim it, the link works once: ${URL}`);
  assert.equal(msg.split(URL).length, 2);
});

test("a missing title still reads as a sentence", () => {
  assert.equal(
    compClaimMessage("   ", URL),
    `I got you a ticket on DVNT. Tap to claim it, the link works once: ${URL}`,
  );
  assert.equal(compClaimMessage(null, URL).includes("a ticket on DVNT"), true);
});

test("long titles are cut and whitespace collapsed, the link never is", () => {
  const msg = compClaimMessage(`Big\n\nNight ${"x".repeat(200)}`, URL);
  assert.ok(msg.endsWith(URL));
  assert.ok(msg.includes("Big Night"));
  assert.ok(msg.includes("…"));
  assert.ok(msg.length < 220);
});

test("the sms: fallback addresses one E.164 number with an encoded body", () => {
  const href = smsHref("+14155550134", "hi & bye https://x.y/z?a=1");
  assert.equal(href, "sms:+14155550134?&body=hi%20%26%20bye%20https%3A%2F%2Fx.y%2Fz%3Fa%3D1");
  assert.throws(() => smsHref("4155550134", "x"));
  assert.throws(() => smsHref("+14155550134,+14155550135", "x"));
});

test("Android's unknown result is 'opened', never 'sent'", () => {
  assert.equal(statusFromSmsResult("sent"), "sent");
  assert.equal(statusFromSmsResult("cancelled"), "cancelled");
  assert.equal(statusFromSmsResult("unknown"), "opened");
  assert.equal(statusFromSmsResult(undefined), "opened");
});

test("Text all stops when the host cancels a composer", () => {
  assert.equal(continuesQueue("sent"), true);
  assert.equal(continuesQueue("opened"), true);
  assert.equal(continuesQueue("shared"), true);
  assert.equal(continuesQueue("cancelled"), false);
  assert.equal(continuesQueue("failed"), false);
});

test("unsent links keep server order and include cancelled or failed ones", () => {
  const links = [{ ticket_id: "a" }, { ticket_id: "b" }, { ticket_id: "c" }, { ticket_id: "d" }];
  assert.deepEqual(
    unsentLinks(links, { a: "sent", b: "cancelled", d: "opened" }).map((l) => l.ticket_id),
    ["b", "c"],
  );
});

test("only a 43-character base64url token is accepted from the route", () => {
  const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ-_01234";
  assert.equal(claimTokenFromParam(token), token);
  assert.equal(claimTokenFromParam([token, "x"]), token);
  assert.equal(claimTokenFromParam(`${token}/../x`), null);
  assert.equal(claimTokenFromParam(undefined), null);
  assert.equal(claimTokenFromParam("short"), null);
});
