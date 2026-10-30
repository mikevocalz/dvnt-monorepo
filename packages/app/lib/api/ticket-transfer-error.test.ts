import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { URL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

function load(relative: string, deps: Record<string, unknown>) {
  const exports: any = {};
  const code = ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, console: { error() {} }, require: (name: string) => deps[name] ?? {} });
  return exports;
}
function fixture(result: any, authError?: Error) {
  const calls: any[] = [];
  const api = load("./tickets.ts", {
    "../supabase/client": { supabase: { functions: { invoke: async (...args: any[]) => { calls.push(args); return result; } } } },
    "../auth/identity": { requireBetterAuthToken: async () => { if (authError) throw authError; return "fixture-token"; } },
    "./ticket-transfer-error": load("./ticket-transfer-error.ts", {}),
  }).ticketsApi;
  return { api, calls };
}
const methods = [
  ["initiateTransfer", ["ticket", "recipient"], { action: "initiate", ticket_id: "ticket", to_username: "recipient" }],
  ["acceptTransfer", ["transfer"], { action: "accept", transfer_id: "transfer" }],
  ["declineTransfer", ["transfer"], { action: "decline", transfer_id: "transfer" }],
  ["cancelTransfer", ["transfer"], { action: "cancel", transfer_id: "transfer" }],
] as const;
for (const [method, args, body] of methods) {
  test(`${method}: exposes structured refusal, preserves session/payload and response body`, async () => {
    const response = new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
    const { api, calls } = fixture({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: response } });
    assert.equal((await api[method](...args)).error, "User not found");
    assert.equal(calls[0][0], "transfer-ticket");
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].body)), body);
    assert.equal(calls[0][1].headers.Authorization, "Bearer fixture-token");
    assert.equal(response.bodyUsed, false);
  });
  test(`${method}: successful object/string responses stay intact`, async () => {
    for (const data of [{ success: true, transfer_id: "new" }, JSON.stringify({ success: true, transfer_id: "new" })]) {
      const { api } = fixture({ data, error: null });
      const result = await api[method](...args);
      assert.equal(result.success, true);
      assert.equal(result.transfer_id, "new");
    }
  });
}
test("transfer failures never expose internal, malformed, HTML or transport details", async () => {
  for (const error of [
    { context: new Response(JSON.stringify({ error: "SQL secret detail" }), { status: 500 }) },
    { context: new Response("<html>proxy secret</html>", { status: 502 }) },
    { context: new Response("not json", { status: 400 }) },
    { context: new Response(JSON.stringify({ error: "<html>proxy detail</html>" }), { status: 400 }) },
    { message: "fetch failed secret-url" },
  ]) {
    const { api } = fixture({ data: null, error });
    assert.equal((await api.initiateTransfer("ticket", "recipient")).error,
      "Could not complete the transfer. Check My Tickets before trying again.");
  }
});
test("expired/missing authentication is actionable and missing auth never invokes", async () => {
  const missing = fixture({}, new Error("Not authenticated - no Better Auth token available"));
  assert.match((await missing.api.acceptTransfer("transfer")).error, /sign in again/);
  assert.equal(missing.calls.length, 0);
  const denied = fixture({ error: { context: new Response("{}", { status: 401 }) } });
  assert.match((await denied.api.acceptTransfer("transfer")).error, /sign in again/);
});
test("nested structured refusal and already-consumed responses are handled safely", async () => {
  const response = new Response(JSON.stringify({ error: { message: "Transfer has expired" } }), { status: 400 });
  const { api } = fixture({ error: { context: response } });
  assert.equal((await api.acceptTransfer("transfer")).error, "Transfer has expired");
  await response.text();
  assert.match((await api.acceptTransfer("transfer")).error, /Check My Tickets/);
});
test("only explicitly safe service-unavailable messages are displayed", async () => {
  for (const message of ["Could not verify the recipient. Please try again.", "Could not accept transfer. Check My Tickets and try again."]) {
    const { api } = fixture({ error: { context: new Response(JSON.stringify({ error: message }), { status: 503 }) } });
    assert.equal((await api.acceptTransfer("transfer")).error, message);
  }
  const { api } = fixture({ error: { context: new Response(JSON.stringify({ error: "database password detail" }), { status: 503 }) } });
  assert.match((await api.acceptTransfer("transfer")).error, /Check My Tickets/);
});
