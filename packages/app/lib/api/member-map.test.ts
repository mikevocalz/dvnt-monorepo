import { URL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function fixture(result: unknown) {
  const exports: any = {};
  const calls: any[] = [];
  const code = ts.transpileModule(fs.readFileSync(new URL("./member-map.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ invokeEdge: async (...args: unknown[]) => { calls.push(args); return result; } }) });
  return { api: exports.memberMapApi, calls };
}
test("member map API preserves machine-readable server refusal", async () => {
  const { api } = fixture({ error: { message: "Settings changed", code: "settings_changed", status: 409 } });
  await assert.rejects(api.updateSettings("synthetic-owner", { expectedRevision: 1, locationEnabled: true, eventsMapEnabled: true }), (error: any) => error.name === "MemberMapError" && error.status === 409 && error.code === "settings_changed");
});
test("member map transport uncertainty is not assigned a refusal status", async () => {
  const { api } = fixture({ error: { message: "Connection interrupted" } });
  await assert.rejects(api.settings("synthetic-owner"), (error: any) => error.status === undefined && error.code === undefined && error.message === "Connection interrupted");
});
test("conditional withdrawal preserves owned revision without renewing consent", async () => {
  const { api, calls } = fixture({ data: { ok: true, data: { locationEnabled: true, eventsMapEnabled: false, revision: 8, shareUntil: null } } });
  await api.updateSettings("synthetic-owner", { expectedRevision: 7, locationEnabled: true, eventsMapEnabled: false });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [["member-map", { action: "updateSettings", expectedAuthId: "synthetic-owner", expectedRevision: 7, locationEnabled: true, eventsMapEnabled: false }]]);
});
