import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFirstPostDraft,
  findAdmissionEventId,
  isAdmissionLine,
  isPublicEventVisibility,
  type ConfirmedEvent,
} from "./first-post-draft.ts";

const EVENT_ID = 4821;
const admission = { event_id: EVENT_ID, category: "admission" };
const coatCheck = { event_id: EVENT_ID, category: "coat_check" };
const addon = { event_id: EVENT_ID, category: "product" };

const publicEvent: ConfirmedEvent = {
  id: EVENT_ID,
  title: "Deviant DC",
  visibility: "public",
  cityName: "Washington",
};

test("a public event turns the first admission purchase into a draft", () => {
  const draft = buildFirstPostDraft({ event: publicEvent, lines: [admission] });
  assert.equal(draft?.eventId, EVENT_ID);
  assert.equal(
    draft?.content,
    'Hey, I just punched my ticket for "Deviant DC" 🎟️\n\n#DeviantDC #Washington #DVNT #DeviantEvents',
  );
});

test("private and link_only events produce nothing at all", () => {
  for (const visibility of ["private", "link_only", "unlisted"]) {
    assert.equal(isPublicEventVisibility(visibility), false);
    assert.equal(
      buildFirstPostDraft({
        event: { ...publicEvent, visibility },
        lines: [admission],
      }),
      null,
    );
  }
});

test("unknown or unreadable visibility fails closed", () => {
  for (const visibility of [undefined, null, "", "Public", "draft"]) {
    assert.equal(isPublicEventVisibility(visibility), false);
    assert.equal(
      buildFirstPostDraft({
        event: { ...publicEvent, visibility },
        lines: [admission],
      }),
      null,
    );
  }
  // No confirmed event at all, and an event that is not the one bought.
  assert.equal(buildFirstPostDraft({ event: null, lines: [admission] }), null);
  assert.equal(
    buildFirstPostDraft({ event: { ...publicEvent, id: 9 }, lines: [admission] }),
    null,
  );
});

test("a missing city omits its hashtag rather than guessing one", () => {
  for (const cityName of [undefined, null, "", "   ", "!!!"]) {
    const draft = buildFirstPostDraft({
      event: { ...publicEvent, cityName },
      lines: [admission],
    });
    assert.equal(
      draft?.content,
      'Hey, I just punched my ticket for "Deviant DC" 🎟️\n\n#DeviantDC #DVNT #DeviantEvents',
    );
  }
});

test("no event title means no draft — there is no fallback name", () => {
  for (const title of [undefined, null, "", "  "]) {
    assert.equal(
      buildFirstPostDraft({ event: { ...publicEvent, title }, lines: [admission] }),
      null,
    );
  }
});

test("only the first admission purchase is eligible", () => {
  assert.ok(buildFirstPostDraft({ event: publicEvent, lines: [admission] }));
  assert.equal(
    buildFirstPostDraft({
      event: publicEvent,
      lines: [admission],
      hasPriorAdmissionPurchase: true,
    }),
    null,
  );
});

test("a coat-check or add-on line is not an admission ticket", () => {
  assert.equal(isAdmissionLine(coatCheck), false);
  assert.equal(isAdmissionLine(addon), false);
  assert.equal(isAdmissionLine({ event_id: EVENT_ID, category: "service" }), false);
  // Rows written before `category` existed were admission, and still are.
  assert.equal(isAdmissionLine({ event_id: EVENT_ID }), true);

  assert.equal(findAdmissionEventId([coatCheck, addon]), null);
  assert.equal(findAdmissionEventId([coatCheck, admission]), EVENT_ID);
  assert.equal(findAdmissionEventId([]), null);
  assert.equal(findAdmissionEventId(undefined), null);
  assert.equal(
    buildFirstPostDraft({ event: publicEvent, lines: [coatCheck, addon] }),
    null,
  );
});

test("no ticket, order, QR or address identifier can reach the draft", () => {
  const draft = buildFirstPostDraft({
    event: publicEvent,
    lines: [
      {
        ...admission,
        // Fields a cart line carries in real life. None are inputs to the copy.
        ...({
          id: "9f2b1c44-0000-4000-8000-000000000000",
          cart_id: "cart_7Yh2",
          qr_token: "QR-SECRET-TOKEN",
          invite_token: "inv_abc123",
          event_location: "1234 U St NW, Washington DC",
        } as Record<string, unknown>),
      },
    ],
  });
  const content = draft?.content ?? "";
  for (const secret of [
    "9f2b1c44",
    "cart_7Yh2",
    "QR-SECRET-TOKEN",
    "inv_abc123",
    "1234 U St NW",
  ]) {
    assert.equal(content.includes(secret), false, `leaked ${secret}`);
  }
  assert.ok(content.length > 0);
});
