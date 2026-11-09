import assert from "node:assert/strict";
import test from "node:test";
import { isAdmissionCategory, hasAdmissionPurpose, ticketCategoryLabel, ticketTierBadge, defaultTicketTypeName } from "./ticket-category.ts";

test("service/product category wins over stale admission styling without mutating data", () => {
  for (const category of ["service", "product"]) {
    for (const tier of ["ga", "vip", "free", "table", "early_bird", null]) {
      const original = { category, tier, name: "Coat check" };
      const before = { ...original };
      assert.equal(isAdmissionCategory(category), false);
      assert.equal(ticketTierBadge(category, tier), category === "service" ? "SERVICE" : "ADD-ON");
      assert.equal(defaultTicketTypeName(category), category === "service" ? "Service" : "Add-on");
      assert.deepEqual(original, before);
    }
  }
});

test("legacy admission category and explicit admission tier styles retain their labels", () => {
  for (const category of [undefined, null, "admission"]) {
    assert.equal(isAdmissionCategory(category), true);
    assert.equal(ticketCategoryLabel(category), "Admission");
    assert.equal(ticketTierBadge(category, "vip"), "VIP");
    assert.equal(ticketTierBadge(category, "early_bird"), "EARLY BIRD");
    assert.equal(defaultTicketTypeName(category), "General Admission");
  }
});


test("legacy coat-check credentials have no admission fallback", () => {
  assert.equal(isAdmissionCategory("coat_check"), false);
  assert.equal(ticketCategoryLabel("coat_check"), "Coat check");
  assert.equal(ticketTierBadge("coat_check", "ga"), "COAT CHECK");
  assert.equal(defaultTicketTypeName("coat_check"), "Coat check");
});


test("door eligibility requires explicit admission purpose", () => {
  assert.equal(hasAdmissionPurpose("admission"), true);
  for (const category of ["service", "product", "coat_check", "unknown", null, undefined]) {
    assert.equal(hasAdmissionPurpose(category), false);
  }
});
