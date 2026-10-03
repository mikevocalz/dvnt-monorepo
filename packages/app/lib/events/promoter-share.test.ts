import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPromoterShareMessage,
  promoterEventLink,
  promoterSmsHref,
  truncateDescription,
} from "./promoter-share.ts";

const EVENT_URL = "https://dvntapp.live/e/42";

test("the message carries the code, the tracked event link and the description", () => {
  const share = buildPromoterShareMessage({
    code: "Tre151Share",
    eventUrl: EVENT_URL,
    eventTitle: "Deviant DC Halloween",
    eventDescription: "Costumes, two floors, DJs till 4.",
  });
  assert.equal(share.url, "https://dvntapp.live/e/42?ref=Tre151Share");
  assert.equal(
    share.message,
    "Deviant DC Halloween\nCostumes, two floors, DJs till 4.\n\nUse my code Tre151Share for tickets: https://dvntapp.live/e/42?ref=Tre151Share",
  );
  assert.equal(share.title, "Deviant DC Halloween");
});

test("a long description is cut at a word with an ellipsis", () => {
  const long = "word ".repeat(80);
  const out = truncateDescription(long);
  assert.ok(out.length <= 140, `length ${out.length}`);
  assert.ok(out.endsWith("…"));
  assert.doesNotMatch(out, /\s…$/);
  assert.equal(truncateDescription("  line one\n\nline two  "), "line one line two");
});

test("no title or description still gives a usable message", () => {
  const share = buildPromoterShareMessage({ code: "ABC", eventUrl: EVENT_URL });
  assert.equal(share.message, "Use my code ABC for tickets: https://dvntapp.live/e/42?ref=ABC");
  assert.equal(share.title, "Tickets on DVNT");
});

test("the ref is encoded and appended to an existing query", () => {
  assert.equal(promoterEventLink("https://x.test/e/1?utm=a", "A B"), "https://x.test/e/1?utm=a&ref=A%20B");
});

test("the sms fallback encodes the whole message as the body", () => {
  assert.equal(promoterSmsHref("Hi & bye\nnow"), "sms:?&body=Hi%20%26%20bye%0Anow");
});
