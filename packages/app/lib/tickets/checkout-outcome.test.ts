import test from "node:test";
import assert from "node:assert/strict";
import {
  ISSUANCE_GRACE_MS,
  checkoutCopy,
  resolveCheckoutOutcome,
  shouldPollCheckout,
} from "./checkout-outcome.ts";

const base = { isLoading: false, isError: false, elapsedMs: 0 };

test("issued credentials win, whatever the cart status says", () => {
  const out = resolveCheckoutOutcome({
    ...base,
    status: "paying",
    tickets: [{ category: "admission" }, { category: "coat_check" }],
  });
  assert.deepEqual(out, {
    kind: "issued",
    admissionCount: 1,
    coatCheckCount: 1,
    addonCount: 0,
  });
});

test("a cart that is still paying is 'issuing', never 'Tickets ready'", () => {
  const out = resolveCheckoutOutcome({ ...base, status: "paying", tickets: [] });
  assert.equal(out.kind, "issuing");
  assert.equal(checkoutCopy(out).tone, "working");
  assert.notEqual(checkoutCopy(out).title, "Tickets ready");
});

test("only a real issuance is allowed to celebrate", () => {
  const tones = (["checking", "issuing", "issued-empty", "not-completed", "unresolved"] as const).map(
    (kind) => checkoutCopy({ kind } as never).tone,
  );
  assert.equal(tones.includes("success"), false, "no non-issued state may read as success");
  assert.equal(
    checkoutCopy({ kind: "issued", admissionCount: 1, coatCheckCount: 0, addonCount: 0 }).tone,
    "success",
  );
});

test("polling stops once the outcome is terminal", () => {
  assert.equal(shouldPollCheckout({ kind: "checking" }), true);
  assert.equal(shouldPollCheckout({ kind: "issuing" }), true);
  assert.equal(shouldPollCheckout({ kind: "issued", admissionCount: 1, coatCheckCount: 0, addonCount: 0 }), false);
  assert.equal(shouldPollCheckout({ kind: "unresolved" }), false);
  assert.equal(shouldPollCheckout({ kind: "not-completed" }), false);
  assert.equal(shouldPollCheckout({ kind: "issued-empty" }), false);
});

test("waiting past the grace window resolves to a real answer, not an endless spinner", () => {
  const late = ISSUANCE_GRACE_MS + 1;
  assert.equal(
    resolveCheckoutOutcome({ ...base, status: "paying", tickets: [], elapsedMs: late }).kind,
    "unresolved",
  );
  assert.equal(
    resolveCheckoutOutcome({ ...base, status: "completed", tickets: [], elapsedMs: late }).kind,
    "issued-empty",
  );
});

test("a failed status read is 'checking' then 'unresolved' — never 'not completed'", () => {
  assert.equal(
    resolveCheckoutOutcome({ ...base, status: null, tickets: [], isError: true }).kind,
    "checking",
  );
  assert.equal(
    resolveCheckoutOutcome({
      ...base,
      status: null,
      tickets: [],
      isError: true,
      elapsedMs: ISSUANCE_GRACE_MS,
    }).kind,
    "unresolved",
  );
});

test("no copy anywhere claims the member was not charged", () => {
  const kinds = [
    { kind: "checking" },
    { kind: "issuing" },
    { kind: "issued", admissionCount: 2, coatCheckCount: 0, addonCount: 0 },
    { kind: "issued-empty" },
    { kind: "not-completed" },
    { kind: "unresolved" },
  ] as const;
  for (const outcome of kinds) {
    const { title, body } = checkoutCopy(outcome as never);
    const text = `${title} ${body}`.toLowerCase();
    assert.equal(/not (been )?charged/.test(text), false, `"${text}" claims no charge`);
    assert.equal(/no charge/.test(text), false, `"${text}" claims no charge`);
  }
});

test("an abandoned cart is stated plainly", () => {
  const out = resolveCheckoutOutcome({ ...base, status: "abandoned", tickets: [] });
  assert.equal(out.kind, "not-completed");
  assert.match(checkoutCopy(out).body, /not completed/i);
});

test("a completed add-on-only cart is issued, and its copy never says tickets", () => {
  const out = resolveCheckoutOutcome({
    ...base,
    status: "completed",
    tickets: [],
    addons: [{ quantity: 1, status: "unfulfilled" }],
  });
  assert.deepEqual(out, {
    kind: "issued",
    admissionCount: 0,
    coatCheckCount: 0,
    addonCount: 1,
  });
  const copy = checkoutCopy(out);
  assert.equal(copy.tone, "success");
  assert.equal(copy.body, "1 add-on");
  assert.equal(/ticket/i.test(`${copy.title} ${copy.body}`), false, copy.title);
});

test("a mixed cart is issued with both counts", () => {
  const out = resolveCheckoutOutcome({
    ...base,
    status: "completed",
    tickets: [{ category: "admission" }],
    addons: [{ quantity: 2, status: "unfulfilled" }],
  });
  assert.deepEqual(out, {
    kind: "issued",
    admissionCount: 1,
    coatCheckCount: 0,
    addonCount: 2,
  });
  assert.equal(checkoutCopy(out).title, "Tickets ready");
  assert.equal(checkoutCopy(out).body, "1 admission · 2 add-ons");
});

test("a completed cart with nothing issued is still issued-empty after the grace window", () => {
  const out = resolveCheckoutOutcome({
    ...base,
    status: "completed",
    tickets: [],
    addons: [],
    elapsedMs: ISSUANCE_GRACE_MS + 1,
  });
  assert.equal(out.kind, "issued-empty");
});

test("refunded add-on rows are not counted as issued", () => {
  const out = resolveCheckoutOutcome({
    ...base,
    status: "completed",
    tickets: [],
    addons: [{ quantity: 1, status: "refunded" }],
    elapsedMs: ISSUANCE_GRACE_MS + 1,
  });
  assert.equal(out.kind, "issued-empty");
});

test("waiting copy does not promise tickets the cart may not contain", () => {
  for (const kind of ["issuing", "issued-empty"] as const) {
    const { title, body } = checkoutCopy({ kind });
    // "My Tickets" is the screen's name, not a claim about the order.
    const text = `${title} ${body}`.replaceAll("My Tickets", "");
    assert.equal(/ticket/i.test(text), false, `${kind}: ${body}`);
  }
});

test("counts pluralise", () => {
  assert.equal(
    checkoutCopy({ kind: "issued", admissionCount: 1, coatCheckCount: 0, addonCount: 0 }).body,
    "1 admission",
  );
  assert.equal(
    checkoutCopy({ kind: "issued", admissionCount: 2, coatCheckCount: 3, addonCount: 0 }).body,
    "2 admissions · 3 coat checks",
  );
});
