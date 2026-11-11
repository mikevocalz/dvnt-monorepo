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

function tierFixture(error: Error | null) {
  const calls: string[] = [];
  const query: any = {};
  for(const method of ["from","update","eq","select","abortSignal"])
    query[method] = () => { calls.push(method); return query; };
  query.single = async () => { calls.push("single"); return {data:error?null:{id:"tier"},error}; };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("./ticket-types.ts",import.meta.url),"utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText, {exports,AbortSignal,setTimeout:()=>0,console:{error(){}},require:(name:string)=>name.endsWith("supabase/client")?{supabase:query}:{ensureSupabaseJwt:async()=>true}});
  return {api:exports.ticketTypesApi,calls};
}

test("ticket-price saves require an actually updated row instead of silent RLS success", async()=>{
  const ok=tierFixture(null);
  assert.equal(await ok.api.update("tier",{price_cents:2500}),true);
  assert.ok(ok.calls.includes("select"));assert.ok(ok.calls.includes("single"));
  const blocked=tierFixture(new Error("No row updated"));
  await assert.rejects(blocked.api.update("tier",{price_cents:2500}),/No row updated/);
  await assert.rejects(blocked.api.deactivate("tier"),/No row updated/);
});
