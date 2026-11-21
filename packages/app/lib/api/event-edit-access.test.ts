import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { URL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

function fixture(staff: { role: string; accepted: boolean } | null, options: { owner?: boolean; error?: boolean } = {}) {
  const calls: any[] = [];
  const supabase = {
    from(table: string) {
      const filters: Record<string, any> = {};
      const query: any = {
        select() { return query; },
        eq(key: string, value: any) { filters[key] = value; return query; },
        in(key: string, value: any) { filters[key] = value; return query; },
        async maybeSingle() {
          calls.push({ table, filters });
          if (options.error) return { data: null, error: new Error("offline") };
          if (table === "events") return { data: { host_id: options.owner ? "viewer" : "host" } };
          const matches = staff && (!filters.role || filters.role.includes(staff.role)) &&
            (filters.accepted === undefined || staff.accepted === filters.accepted);
          return { data: matches ? staff : null };
        },
      };
      return query;
    },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("./events.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require: (name: string) => name.endsWith("supabase/client") ? { supabase }
      : name.endsWith("supabase/db-map") ? { DB: { events: { table: "events", id: "id", hostId: "host_id" } } } : {},
  });
  return { api: exports.eventsApi, calls };
}

for (const role of ["admin", "editor", "scanner"]) {
  for (const accepted of [true, false]) {
    test(`event editing requires an accepted editor/admin: ${role}, accepted=${accepted}`, async () => {
      const f = fixture({ role, accepted });
      assert.equal(await f.api.canEditEvent("7", "viewer"), accepted && role !== "scanner");
      assert.equal(f.calls[1].filters.accepted, true);
      assert.equal(f.calls[1].filters.event_id, 7);
      assert.equal(f.calls[1].filters.user_id, "viewer");
    });
  }
}

test("owner can edit without a staff row; removed and unrelated users cannot", async () => {
  assert.equal(await fixture(null, { owner: true }).api.canEditEvent("7", "viewer"), true);
  assert.equal(await fixture(null).api.canEditEvent("7", "viewer"), false);
  assert.equal(await fixture({role:"admin",accepted:true},{error:true}).api.canEditEvent("7", "viewer"), false);
});

test("missing account and malformed event fail closed before querying", async () => {
  const f=fixture({role:"admin",accepted:true});
  for(const [id,user] of [["7",""],["7junk","viewer"],["0","viewer"],["-1","viewer"]])
    assert.equal(await f.api.canEditEvent(id,user),false);
  assert.equal(f.calls.length,0);
});

function tierFixture(data: unknown, error: Error | null = null) {
  const calls: unknown[][] = [];
  const query: any = {};
  for (const method of ["from", "insert", "update", "eq", "select", "abortSignal"])
    query[method] = (...args: unknown[]) => { calls.push([method, ...args]); return query; };
  query.single = async () => { calls.push(["single"]); return { data, error }; };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("./ticket-types.ts", import.meta.url),"utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText, {exports,AbortSignal,setTimeout:()=>0,console:{error(){}},require:(name:string)=>name.endsWith("supabase/client")?{supabase:query}:{ensureSupabaseJwt:async()=>true}});
  return {api:exports.ticketTypesApi,calls};
}

test("ticket updates require confirmation of the intended row and event", async () => {
  const ok = tierFixture({ id: "tier", event_id: 7, is_active: true });
  assert.equal(await ok.api.update("7", "tier", { price_cents: 2500 }), true);
  assert.deepEqual(ok.calls.filter(([method]) => method === "eq"), [["eq", "event_id", 7], ["eq", "id", "tier"]]);
  assert.ok(ok.calls.some(([method, args]) => method === "select" && args === "id,event_id,is_active"));
  assert.ok(ok.calls.some(([method]) => method === "single"));
  for (const data of [null, { id: "other", event_id: 7 }, { id: "tier", event_id: 8 }]) {
    await assert.rejects(tierFixture(data).api.update("7", "tier", { price_cents: 2500 }), /not confirmed/);
  }
  await assert.rejects(tierFixture(null, new Error("No row updated")).api.update("7", "tier", { price_cents: 2500 }), /No row updated/);
});

test("removing a tier succeeds only when that exact row is returned inactive", async () => {
  const ok = tierFixture({ id: "tier", event_id: 7, is_active: false });
  assert.equal(await ok.api.deactivate("7", "tier"), true);
  const update = ok.calls.find(([method]) => method === "update")?.[1] as { is_active: boolean };
  assert.equal(update.is_active, false);
  for (const data of [null, { id: "tier", event_id: 7, is_active: true }, { id: "tier", event_id: 8, is_active: false }]) {
    await assert.rejects(tierFixture(data).api.deactivate("7", "tier"), /not confirmed/);
  }
});

test("an unconfirmed create response requires reloading before retry", async () => {
  const params = { eventId: "7", name: "GA", priceCents: 2500, quantityTotal: 20 };
  assert.equal((await tierFixture({ id: "new", event_id: 7 }).api.create(params)).id, "new");
  for (const data of [null, { id: "new", event_id: 8 }]) {
    await assert.rejects(tierFixture(data).api.create(params), /Reload before retrying/);
  }
});
