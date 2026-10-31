import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

function api() {
  const exports: any = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./tickets.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, console: { error() {}, warn() {} }, require: () => ({}) });
  return exports.ticketsApi;
}

for (const [kind, admits_entry, expected] of [
  ["ticket", true, true], ["service", false, false], ["product", false, false],
  ["coat_check", false, false], ["addon", false, false], [undefined, undefined, false],
  ["service", true, false], ["ticket", false, false],
] as const) test(`legacy manual check-in accepts only confirmed admission: ${kind}/${admits_entry}`, async () => {
  const tickets = api();
  tickets.scanTicket = async () => ({ valid: true, kind, admits_entry });
  assert.equal((await tickets.checkIn({ qrToken: "synthetic-token" })).success, expected);
});

test("service duplicate is not reported as an existing admission; failures remain nonthrowing", async () => {
  const tickets = api();
  tickets.scanTicket = async () => ({ valid: false, reason: "already_scanned", kind: "service", admits_entry: false });
  assert.equal((await tickets.checkIn({ qrToken: "synthetic-token" })).alreadyCheckedIn, false);
  tickets.scanTicket = async () => { throw new Error("offline"); };
  assert.equal((await tickets.checkIn({ qrToken: "synthetic-token" })).success, false);
});


test("confirmed duplicate admission retains already-checked-in compatibility", async () => {
  const tickets = api();
  tickets.scanTicket = async () => ({ valid: false, reason: "already_scanned", kind: "ticket", admits_entry: true });
  const result = await tickets.checkIn({ qrToken: "synthetic-token" });
  assert.equal(result.success, false);
  assert.equal(result.alreadyCheckedIn, true);
});
