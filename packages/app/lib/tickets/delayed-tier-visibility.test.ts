import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { filterBuyerVisibleTiers, tierSaleHasStarted } from "./pricing.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const NOW = Date.parse("2026-11-06T08:00:00Z");
const tier = (id: string, patch: any = {}) => ({ id, name: id, category: "admission", tier_visibility: "public", price_cents: 1500, quantity_total: 10, quantity_sold: 0, ...patch });
const later = tier("later", { sale_start: new Date(NOW + 1).toISOString() });

test("buyer visibility hides delayed admission, service and unlocked tiers until exact opening", () => {
  const rows = [tier("open"), later, { ...later, id: "service", category: "service" }, { ...later, id: "locked", tier_visibility: "locked" }];
  for (const unlocked of [undefined, new Set(["locked"])]) {
    const before = filterBuyerVisibleTiers(rows, unlocked, NOW);
    assert.deepEqual(before.visible.map(t => t.id), ["open"]);
    assert.equal(before.hasLockedTiers, false);
  }
  const opened = filterBuyerVisibleTiers(rows, new Set(["locked"]), NOW + 1);
  assert.deepEqual(opened.visible.map(t => t.id), ["open", "later", "service", "locked"]);
  assert.equal(filterBuyerVisibleTiers(rows, undefined, NOW + 1).hasLockedTiers, true);
  assert.equal(rows.length, 4, "filter does not mutate organizer records");
});

test("sale visibility preserves sold-out, ended and paused tiers; malformed starts fail closed", () => {
  const rows = [tier("sold", { quantity_sold: 10 }), tier("ended", { sale_end: new Date(NOW - 1).toISOString() }), tier("paused", { status: "paused" }), tier("legacy", { sale_start: null }), tier("bad", { sale_start: "bad" })];
  assert.deepEqual(filterBuyerVisibleTiers(rows, undefined, NOW).visible.map(t => t.id), ["sold", "ended", "paused", "legacy"]);
  assert.equal(tierSaleHasStarted({ saleStart: later.sale_start }, NOW), false);
  assert.equal(tierSaleHasStarted({ sale_start: null, saleStart: later.sale_start }, NOW), true);
  assert.equal(tierSaleHasStarted({ sale_start: "2026-11-06T03:00:00-05:00" }, NOW), true);
});

function derive(relative: string, name: string, context: any) {
  const file = new URL(relative, import.meta.url);
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: any;
  function visit(node: any) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, `actual ${name} memo exists`);
  const code = ts.transpileModule(`(${callback.getText(ast)})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(code, { filterBuyerVisibleTiers, saleNow: NOW, ...context });
}

const native = "../../features/routes/screens/(protected)/events/[id]/index.tsx";
test("actual signed-in native tier list respects authoritative delayed dates and preserves expired/sold out", () => {
  const rows = [tier("open"), tier("sold", { quantity_sold: 10 }), tier("ended", { sale_end: new Date(NOW - 1).toISOString() }), tier("later"), { ...later, id: "coat", category: "service" }];
  const context = { eventData: { ticketingEnabled: true, ticketTiers: rows }, liveTicketTypes: [later], buildTicketTiers: () => { throw new Error("must not fabricate a tier"); } };
  assert.deepEqual(Array.from(derive(native, "ticketTiers", context), (t: any) => t.id), ["open", "sold", "ended"]);
  assert.deepEqual(Array.from(derive(native, "ticketTiers", { ...context, saleNow: NOW + 1 }), (t: any) => t.id), ["open", "sold", "ended", "later", "coat"]);
});

test("all-delayed native tiers never become a synthetic free tier, even with ticketing disabled", () => {
  for (const ticketingEnabled of [true, false]) {
    const tiers = derive(native, "ticketTiers", { eventData: { price: 0, ticketingEnabled, ticketTiers: [later] }, liveTicketTypes: [], buildTicketTiers: () => { throw new Error("must not fabricate a tier"); } });
    assert.equal(tiers.length, 0);
  }
});

test("actual public native list hides future tiers and opens at the boundary", () => {
  const publicScreen = "../../features/routes/screens/(public)/events/[id].tsx";
  const rows = [tier("open"), later, tier("ended", { sale_end: new Date(NOW - 1).toISOString() })];
  assert.deepEqual(Array.from(derive(publicScreen, "tiers", { tierRows: rows }), (t: any) => t.id), ["open", "ended"]);
  assert.deepEqual(Array.from(derive(publicScreen, "tiers", { tierRows: rows, saleNow: NOW + 1 }), (t: any) => t.id), ["open", "later", "ended"]);
});

test("native purchase action cannot fall back to free RSVP when configured tiers are all delayed", () => {
  const source = fs.readFileSync(new URL(native, import.meta.url), "utf8");
  const ast = ts.createSourceFile("native.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: any;
  function visit(node: any) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "purchaseDisabledReason") expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression);
  const code = ts.transpileModule(`(${expression.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  assert.equal(vm.runInNewContext(code, { requestedServiceTierId: null, eventData: { price: 0, ticketTiers: [later] }, eventSalesClosed: () => false, selectedTier: null, selectedDbTier: undefined }), "No ticket tiers are available yet");
});


test("native sale clock is declared after its event and live-tier inputs", () => {
  const source = fs.readFileSync(new URL(native, import.meta.url), "utf8");
  const ast = ts.createSourceFile("native.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = ast.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === "EventDetailScreenContent");
  assert.ok(screen?.body);
  const positions = new Map<string, number>();
  function bind(name: any, position: number) {
    if (ts.isIdentifier(name)) positions.set(name.text, position);
    else for (const element of name.elements) if (element.name) bind(element.name, position);
  }
  for (const statement of screen.body.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) bind(declaration.name, declaration.pos);
    }
  }
  for (const input of ["eventData", "liveTicketTypes"]) {
    assert.ok(positions.has(input) && positions.has("saleNow"));
    assert.ok(positions.get(input)! < positions.get("saleNow")!, `${input} must exist before the clock hook reads it`);
  }
});
