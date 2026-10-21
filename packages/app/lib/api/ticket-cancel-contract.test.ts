import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

function apiFixture(result: any = { data: { ok: true }, error: null }) {
  const calls: any[] = [];
  const exports: any = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./tickets.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    console: { error() {} },
    require: (name: string) => name.endsWith("supabase/client")
      ? { supabase: { functions: { invoke: async (...args: any[]) => { calls.push(args); return result; } } } }
      : name.endsWith("auth/identity") ? { requireBetterAuthToken: async () => "fixture-token" }
      : name.endsWith("contracts/dto") ? { parseDTO: (_: unknown, data: any) => data } : {},
  });
  return { api: exports.ticketsApi, calls };
}

test("cancelFreeTicket explicitly requests cancellation for exactly one credential", async () => {
  const { api, calls } = apiFixture();
  assert.equal((await api.cancelFreeTicket("free-id")).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "ticket-refund");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].body)), { ticket_id: "free-id", action: "cancel_free" });
  assert.equal(calls[0][1].headers.Authorization, "Bearer fixture-token");
});

test("free cancellation errors propagate without pretending it refunded or succeeded", async () => {
  const { api } = apiFixture({ data: null, error: { message: "Cannot cancel this ticket" } });
  const result = await api.cancelFreeTicket("free-id");
  assert.equal(result.error, "Cannot cancel this ticket");
  assert.equal(result.ok, undefined);
});

test("existing positive-payment refund adapters retain their distinct payloads", async () => {
  const { api, calls } = apiFixture();
  await api.requestRefund("paid-id");
  await api.requestLineRefund({ cartId: "cart", lineItemId: "line" });
  assert.equal(calls[0][0], "ticket-refund");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].body)), { ticket_id: "paid-id" });
  assert.equal(calls[1][0], "cart-line-refund");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1].body)), { cartId: "cart", lineItemId: "line" });
});
