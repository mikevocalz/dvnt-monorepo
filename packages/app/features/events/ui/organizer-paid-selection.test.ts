import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript");
const source = fs.readFileSync(new URL("../../routes/screens/(protected)/events/[id]/attendees.tsx", import.meta.url), "utf8");
const functionSource = source.slice(source.indexOf("export function isOrganizerPaidRefundCandidate"), source.indexOf("export default function EventAttendeesScreen"));
const exports: any = {};
vm.runInNewContext(ts.transpileModule(functionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
const eligible = exports.isOrganizerPaidRefundCandidate;
test("monetary refund selection excludes free, unknown, malformed and used tickets", () => {
  for (const amount of [0, null, undefined, -1, NaN, Infinity, "100", 1.5]) {
    assert.equal(eligible({ status: "active", purchase_amount_cents: amount }), false);
  }
  for (const status of ["scanned", "void", "refunded"]) assert.equal(eligible({ status, purchase_amount_cents: 100 }), false);
  assert.equal(eligible({ status: "active", purchase_amount_cents: 100, checked_in_at: "now" }), false);
});
test("positive paid ticket selection preserves existing active and pending status semantics", () => {
  assert.equal(eligible({ status: "active", purchase_amount_cents: 100 }), true);
  assert.equal(eligible({ status: "transfer_pending", purchase_amount_cents: 100 }), true);
});
test("submission derives selected IDs from current paid eligibility instead of stale selected IDs", () => {
  assert.match(source, /flat\.filter\(\(ticket\) => selected\.has\(ticket\.id\) && isOrganizerPaidRefundCandidate\(ticket\)\)/);
  assert.match(source, /disabled=\{selectedIds\.length === 0\}/);
});
