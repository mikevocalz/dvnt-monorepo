import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkFullName,
  checkUsername,
  normalizePhoneE164,
  parseCheckoutProfileFields,
} from "./profile-fields.ts";
import { parseCheckoutProfileFields as parseServer } from "../../../../apps/mobile/supabase/functions/_shared/checkout-profile-fields.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("the client copy is byte-identical to the edge-function copy", () => {
  const client = readFileSync(join(here, "profile-fields.ts"), "utf8");
  const server = readFileSync(
    join(here, "../../../../apps/mobile/supabase/functions/_shared/checkout-profile-fields.ts"),
    "utf8",
  );
  assert.equal(client, server, "edit both copies of the checkout field rules together");
});

test("phone numbers normalize to E.164", () => {
  const cases: [string, string | null][] = [
    ["(212) 555-0142", "+12125550142"],
    ["212.555.0142", "+12125550142"],
    ["1 212 555 0142", "+12125550142"],
    ["+1 212 555 0142", "+12125550142"],
    ["+44 20 7946 0958", "+442079460958"],
    ["0044 20 7946 0958", "+442079460958"],
    ["+33 6 12 34 56 78", "+33612345678"],
  ];
  for (const [input, expected] of cases) assert.equal(normalizePhoneE164(input), expected, input);
});

test("phone numbers that would need a guess are refused", () => {
  for (const input of [
    "",
    "   ",
    "555-0142", // seven digits, no area code
    "020 7946 0958", // UK national format without +44
    "+0 123 456 7890", // E.164 country codes never start with 0
    "+1 212 555 0142 99999", // over 15 digits
    "212-555-0142 ext 4",
    "+1+2125550142",
    "21+25550142",
    "call me",
  ]) {
    assert.equal(normalizePhoneE164(input), null, JSON.stringify(input));
  }
  assert.equal(normalizePhoneE164(undefined), null);
  assert.equal(normalizePhoneE164(2125550142 as unknown as string), null);
});

test("usernames follow the Better Auth character set, lowercased", () => {
  assert.deepEqual(checkUsername("  @Night.Owl_99 "), { ok: true, value: "night.owl_99" });
  for (const bad of ["ab", "a".repeat(31), "night owl", "night-owl", "émile", ".owl", "owl.", "ni..ght", ""]) {
    const result = checkUsername(bad);
    assert.equal(result.ok, false, bad);
    if (!result.ok) assert.equal(result.code, "invalid_username", bad);
  }
});

test("brand and staff handles are never offered", () => {
  for (const handle of ["DeviantEvents", "dvnt", "@support", "admin"]) {
    const result = checkUsername(handle);
    assert.equal(result.ok, false, handle);
    if (!result.ok) assert.equal(result.code, "reserved_username");
  }
});

test("full names accept mononyms and collapse whitespace", () => {
  assert.deepEqual(checkFullName("  Grace   Jones "), { ok: true, value: "Grace Jones" });
  assert.deepEqual(checkFullName("Prince"), { ok: true, value: "Prince" });
  assert.equal(checkFullName("").ok, false);
  assert.equal(checkFullName("12345").ok, false);
  assert.equal(checkFullName("x".repeat(121)).ok, false);
});

test("a request with no profile fields is a legacy checkout, not an error", () => {
  for (const parse of [parseCheckoutProfileFields, parseServer]) {
    assert.deepEqual(parse({ guest_email: "a@b.co" }), { ok: true, fields: null });
    assert.deepEqual(parse({ guest_email: "a@b.co", username: "  ", phone: "" }), { ok: true, fields: null });
  }
});

test("any profile field present makes all four required", () => {
  const missingPhone = parseCheckoutProfileFields({
    guest_email: "a@b.co",
    username: "owl",
    full_name: "Night Owl",
  });
  assert.equal(missingPhone.ok, false);
  if (!missingPhone.ok) assert.equal(missingPhone.code, "invalid_phone");

  const missingName = parseCheckoutProfileFields({ guest_email: "a@b.co", username: "owl", phone: "2125550142" });
  assert.equal(missingName.ok, false);
  if (!missingName.ok) assert.equal(missingName.code, "invalid_full_name");

  const badEmail = parseCheckoutProfileFields({ guest_email: "nope", username: "owl", full_name: "N O", phone: "2125550142" });
  assert.equal(badEmail.ok, false);
  if (!badEmail.ok) assert.equal(badEmail.code, "invalid_email");
});

test("a complete request comes back normalized", () => {
  assert.deepEqual(
    parseCheckoutProfileFields({
      guest_email: "  Night.Owl@Example.COM ",
      username: "@NightOwl",
      full_name: " Night  Owl ",
      phone: "(212) 555-0142",
    }),
    {
      ok: true,
      fields: {
        email: "night.owl@example.com",
        username: "nightowl",
        fullName: "Night Owl",
        phoneE164: "+12125550142",
      },
    },
  );
});
