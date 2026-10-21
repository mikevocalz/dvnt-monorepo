const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function harness({ racedStatus, racedOwner, racedScan, error } = {}) {
  let handler, walletVoids = 0, transferInserts = 0;
  const ticket = { id: "ticket", event_id: 7, user_id: "sender", status: "active", checked_in_at: null };
  const claims = [];
  const db = { from(table) {
    let patch, insert;
    const filters = [];
    const record = { table, eq: {}, is: {} };
    const q = {
      select() { return q; }, eq(k,v) { filters.push(row => row[k] === v); record.eq[k] = v; return q; },
      is(k,v) { filters.push(row => row[k] === v); record.is[k] = v; return q; },
      in() { return q; }, limit() { return q; },
      update(p) { patch=p; return q; }, insert(p) { insert=p; return q; },
      async single() {
        if (table === "tickets") return { data: record.eq.id ? { ...ticket } : null, error: null };
        if (table === "user") {
          if (racedStatus) ticket.status = racedStatus;
          if (racedOwner) ticket.user_id = racedOwner;
          if (racedScan) ticket.checked_in_at = "2026-10-21T12:00:00Z";
          return { data: { id: "recipient" }, error: null };
        }
        if (table === "ticket_transfers" && insert) { transferInserts++; return { data: { id: "transfer" }, error: null }; }
        return { data: null, error: null };
      },
      async maybeSingle() {
        if (table === "tickets" && patch) {
          claims.push(record);
          if (error) return { data: null, error: { message: "write failed" } };
          if (!filters.every(fn => fn(ticket))) return { data: null, error: null };
          Object.assign(ticket, patch); return { data: { id: ticket.id }, error: null };
        }
        if (table === "events") return { data: { start_date: new Date(Date.now()+7*864e5).toISOString() }, error: null };
        return { data: null, error: null };
      },
      then(resolve,reject) { return Promise.resolve({data:null,error:null}).then(resolve,reject); },
    }; return q;
  }};
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname,"index.ts"),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(code, { exports:{}, Response, Request, crypto, console:{log(){},error(){},warn(){}},
    Deno:{env:{get:()=>"test"},serve:fn=>{handler=fn}}, fetch:async()=>Response.json({}),
    require:name=> name.includes("supabase-js")?{createClient:()=>db}:name.endsWith("verify-session.ts")?{verifySession:async()=>"sender"}:name.endsWith("wallet-push.ts")?{voidWalletPass:async()=>{walletVoids++}}:{},
  });
  return { ticket, claims, get walletVoids(){return walletVoids}, get transferInserts(){return transferInserts},
    invoke:()=>handler(new Request("http://offline.test",{method:"POST",body:JSON.stringify({action:"initiate",ticket_id:"ticket",to_username:"recipient"})})),
  };
}

for (const racedStatus of ["void", "refunded", "scanned", "transfer_pending"]) {
  test(`transfer initiation cannot resurrect ${racedStatus} after its initial read`, async()=>{
    const f=harness({racedStatus}); const res=await f.invoke();
    assert.equal(res.status,409,await res.clone().text());
    assert.equal(f.ticket.status,racedStatus); assert.equal(f.walletVoids,0); assert.equal(f.transferInserts,0);
    assert.equal(f.claims[0].eq.status,"active"); assert.equal(f.claims[0].eq.user_id,"sender");
    assert.equal(f.claims[0].is.checked_in_at,null);
  });
}
test("ownership/check-in changes and uncertain claim errors stop before transfer side effects",async()=>{
  for(const opts of [{racedOwner:"other"},{racedScan:true},{error:true}]){
    const f=harness(opts);const res=await f.invoke();assert.equal(res.status,opts.error?503:409);
    assert.equal(f.walletVoids,0);assert.equal(f.transferInserts,0);
  }
});
