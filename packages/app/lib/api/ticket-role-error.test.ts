import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

for (const status of [401, 403, 429, 503, undefined]) test(`roster role lookup preserves failure status ${status ?? 'transport'}`, async () => {
  const exports: any = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./tickets.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, console: { error() {}, warn() {} },
    require: (name: string) => name.endsWith("invoke-edge")
      ? { invokeEdge: async () => ({ error: { message: "request failed", status } }) } : {},
  });
  await assert.rejects(() => exports.ticketsApi.getEventTicketsPaginated("7", { pageSize: 1 }), (e: any) => {
    assert.equal(e.status, status); return true;
  });
});
