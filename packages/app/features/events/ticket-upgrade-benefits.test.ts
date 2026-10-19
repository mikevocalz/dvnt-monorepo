import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";
import { ticketUpgradeBenefits } from "./ticket-upgrade-benefits.ts";

test("VIP, premium, table, GA, and free names never imply benefits", () => {
  for (const name of ["VIP", "Premium", "Bottle Service", "Table", "GA", "Free"]) {
    assert.deepEqual(ticketUpgradeBenefits({ name, price_cents: 5000 }), []);
    assert.deepEqual(ticketUpgradeBenefits({ name, price_cents: 0, perks: [] }), []);
  }
});

test("missing, empty, and malformed benefits leave the section hidden", () => {
  for (const tier of [
    undefined,
    null,
    {},
    { perks: null },
    { perks: "Complimentary welcome drink" },
    { perks: { label: "VIP lounge" } },
    { perks: [null, undefined, false, 10, "", "  ", {}, [], { label: true }] },
  ]) {
    assert.deepEqual(ticketUpgradeBenefits(tier), []);
  }
});

test("only this event's explicit ticket benefits are shown", () => {
  assert.deepEqual(
    ticketUpgradeBenefits({
      name: "VIP",
      perks: ["Dungeon access", "Coat check"],
    }),
    ["Dungeon access", "Coat check"],
  );
  assert.deepEqual(ticketUpgradeBenefits({ name: "VIP", perks: ["Balcony access"] }), ["Balcony access"]);
  assert.deepEqual(ticketUpgradeBenefits({ name: "VIP" }), []);
});

test("legacy label/text benefits are normalized without inventing text", () => {
  const tier = {
    perks: [
      " Coat check ",
      { label: "Dungeon access" },
      { text: "Balcony access" },
      { label: "", text: "Not a fallback promise" },
      { label: null, text: "Water station" },
      { text: false },
      { value: "Unrecognized shape" },
      "Coat check",
    ],
  };
  const before = structuredClone(tier);
  assert.deepEqual(ticketUpgradeBenefits(tier), [
    "Coat check", "Dungeon access", "Balcony access", "Water station",
  ]);
  assert.deepEqual(tier, before);
});

test("ticket description and event-wide perks are not inferred as upgrade gains", () => {
  const tier = {
    name: "VIP",
    description: "Skip the Line + Admission + Dungeon Access + Coat Check",
    event: { perks: ["Welcome drink"] },
  };
  assert.deepEqual(ticketUpgradeBenefits(tier), []);
  assert.equal(tier.description, "Skip the Line + Admission + Dungeon Access + Coat Check");
});

test("upgrade differences contain only configured benefits absent from the owned tier", () => {
  const current = new Set(ticketUpgradeBenefits({ perks: ["Admission"] }));
  const upgrades = ticketUpgradeBenefits({ perks: ["Admission", "Coat check"] });
  assert.deepEqual(upgrades.filter((perk) => !current.has(perk)), ["Coat check"]);
});

test("web upgrade cards and success state use configured benefits, preserving descriptions", () => {
  const screen = readFileSync(new URL("./ticket-upgrade.web.tsx", import.meta.url), "utf8");
  assert.match(screen, /perks: ticketUpgradeBenefits\(match\)/);
  assert.match(screen, /perks: ticketUpgradeBenefits\(t\)/);
  assert.match(screen, /\{diffPerks\.length > 0 \? \(/);
  assert.match(screen, /newTier && newTier\.perks\.length > 0 \? \(/);
  assert.match(screen, /\{tier\.description \? \([\s\S]*?\{tier\.description\}[\s\S]*?\) : null\}/);
  assert.doesNotMatch(screen, /defaultPerks|VIP entrance|Access to VIP lounge|Complimentary welcome drink|Priority bar service|Dedicated server|Private coat check/);
});
