import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPhoneRequiredError, phoneForRequest } from "./member-phone.ts";
import { PHONE_REQUIRED_CODE, PHONE_REQUIRED_MESSAGE } from "./profile-fields.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

test("the checkout refusal is recognised by code, by body and by thrown message", () => {
  assert.equal(isPhoneRequiredError({ error: PHONE_REQUIRED_MESSAGE, code: PHONE_REQUIRED_CODE }), true);
  assert.equal(isPhoneRequiredError(new Error(PHONE_REQUIRED_MESSAGE)), true);
  assert.equal(isPhoneRequiredError(PHONE_REQUIRED_MESSAGE), true);
  assert.equal(isPhoneRequiredError(new Error("Payment cancelled")), false);
  assert.equal(isPhoneRequiredError({ error: "Sold out" }), false);
  assert.equal(isPhoneRequiredError(null), false);
});

test("nothing is sent until the server asks, then a valid number is required", () => {
  assert.deepEqual(phoneForRequest(false, ""), { ok: true });
  assert.deepEqual(phoneForRequest(false, "+12125550142"), { ok: true }, "sent before it was asked for");
  assert.deepEqual(phoneForRequest(true, "  "), { ok: false, message: PHONE_REQUIRED_MESSAGE });
  const bad = phoneForRequest(true, "555");
  assert.equal(bad.ok, false);
  assert.deepEqual(phoneForRequest(true, "(212) 555-0142"), { ok: true, phone: "+12125550142" });
});

// Every signed-in checkout path sends the phone and shows the field on refusal.
test("each signed-in checkout path sends the phone and raises the field when asked", () => {
  const ticket = read("../hooks/use-ticket-checkout.ts");
  assert.match(ticket, /\.\.\.\(phone\.phone \? \{ phone: phone\.phone \} : \{\}\)/);
  assert.match(ticket, /isPhoneRequiredError\(ctx\)\) useCheckoutPhoneStore\.getState\(\)\.markNeeded\(\)/);

  for (const rel of ["../hooks/use-mixed-cart-checkout.ts", "../../features/events/checkout-review.web.tsx"]) {
    const src = read(rel);
    assert.match(src, /cartApi\.checkout\([\s\S]{0,160}phone\.phone,?\s*\)/, rel);
    assert.match(src, /isPhoneRequiredError\(err\)\) useCheckoutPhoneStore\.getState\(\)\.markNeeded\(\)/, rel);
  }
  assert.match(read("../api/cart.ts"), /\.\.\.\(phone \? \{ phone \} : \{\}\)/);

  for (const rel of [
    "../../features/events/event-detail.web.tsx",
    "../../features/events/checkout-review.web.tsx",
    "../../features/routes/screens/(protected)/checkout/review.tsx",
    "../../features/routes/screens/(protected)/events/[id]/index.tsx",
  ]) {
    assert.match(read(rel), /<CheckoutPhoneField \/>/, `${rel} never shows the phone field`);
  }
  // The field never writes a table: it only sets store state.
  for (const rel of ["../../features/events/checkout-phone-field.tsx", "../../features/events/checkout-phone-field.web.tsx"]) {
    const src = read(rel);
    assert.ok(!/supabase|\.from\(|\.rpc\(/.test(src), `${rel} talks to the database`);
  }
});
