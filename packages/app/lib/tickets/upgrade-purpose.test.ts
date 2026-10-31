import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { URL } from "node:url";
import * as purpose from "./upgrade-purpose.ts";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const tier = (id: string, category: any = "admission", price_cents = 2000) => ({ id, category, price_cents, is_active: true, quantity_total: 10, quantity_sold: 0, name: id });
const ticket = (patch: any = {}) => ({ ticket_type_id: "source", category: "admission", status: "active", purchase_amount_cents: 1000, ...patch });
const all = [tier("source", "admission", 1000), tier("vip"), tier("coat", "service", 3000), tier("product", "product", 4000)];
function actualHook() {
  const exports: any = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("../hooks/use-ticket-upgrade.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(name: string) {
    if (name === "react") return { useMemo: (fn: any) => fn() };
    if (name.endsWith("upgrade-purpose")) return purpose;
    return {};
  } });
  return exports.useTicketUpgradeOptions;
}
const hook = actualHook();
test("actual upgrade hook offers only admission targets, including free-to-paid", () => {
  for (const paid of [0, 1000]) {
    const options = hook(all, ticket({ purchase_amount_cents: paid }));
    assert.deepEqual(Array.from(options, (o: any) => o.tier.id), ["vip"]);
    assert.equal(options[0].diffCents, 2000 - paid);
  }
});
test("actual hook rejects source service, authoritative service tier, missing source and inactive/checked-in ticket", () => {
  for (const category of ["service", "product", "coat_check", "unknown"]) {
    assert.equal(hook(all, ticket({ category })).length, 0);
    assert.equal(hook([tier("source", category), tier("vip")], ticket()).length, 0);
  }
  assert.equal(hook([tier("vip")], ticket()).length, 0);
  assert.equal(hook(all, ticket({ status: "scanned" })).length, 0);
  assert.equal(hook(all, ticket({ checked_in_at: "2099-01-01" })).length, 0);
});
test("legacy nullish categories keep admission default, unknown categories fail closed", () => {
  assert.equal(purpose.isAdmissionUpgradeCategory(null), true);
  assert.equal(purpose.isAdmissionUpgradeCategory(undefined), true);
  assert.equal(purpose.isAdmissionUpgradeCategory("unknown"), false);
  assert.equal(hook([tier("source", null, 1000), tier("vip", null)], ticket({ category: undefined })).length, 1);
  assert.equal(hook([tier("vip")], ticket({ ticket_type_id: null })).length, 1);
});
for (const [label, relative] of [["web", "../../features/events/ticket-upgrade.web.tsx"], ["native", "../../features/routes/screens/(protected)/ticket/upgrade/[id].tsx"]]) {
  test(`actual ${label} upgrade screen derivation rejects service source and target`, () => {
    const filename = new URL(relative, import.meta.url);
    const source = fs.readFileSync(filename, "utf8");
    const ast = ts.createSourceFile(filename.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback: any;
    function visit(node: any) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "upgradeOptions") callback = node.initializer.arguments[0];
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(callback);
    const code = ts.transpileModule(`(${callback.getText(ast)})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const evaluate = (tiers: any[], owned: any) => vm.runInNewContext(code, { allTiers: tiers, dbTicket: owned, ...purpose, inferTier: () => "ga", TIER_ACCENT: { ga: "cyan" }, TIER_LABEL: { ga: "GA" }, ticketUpgradeBenefits: () => [], defaultPerks: () => [] });
    assert.deepEqual(Array.from(evaluate(all, ticket()), (t: any) => t.id), ["vip"]);
    assert.equal(evaluate(all, ticket({ category: "service" })).length, 0);
    assert.equal(evaluate([tier("source", "service"), tier("vip")], ticket()).length, 0);
    assert.deepEqual(Array.from(evaluate(all, ticket({ purchase_amount_cents: 0 })), (t: any) => t.id), ["vip"]);
  });
}
