const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const PROMO_ID = "123e4567-e89b-12d3-a456-426614174000";

function harness({
  caller = "host-1",
  host = "host-1",
  coOrganizers = [],
  deletedAt = null,
  roleError = false,
  createError = null,
} = {}) {
  let handler;
  const promo = { id: PROMO_ID, event_id: 42, deleted_at: deletedAt, valid_until: null };
  const tables = {
    promo_codes: [promo],
    events: [{ id: 42, host_id: host }],
    event_co_organizers: coOrganizers,
  };
  const updates = [];
  const inserts = [];
  const supabase = {
    from(tableName) {
      const filters = [];
      let patch = null;
      const query = {
        select() { return query; },
        eq(key, value) {
          filters.push((row) => row[key] === value);
          return query;
        },
        in(key, values) {
          filters.push(row => values.includes(row[key]));
          return query;
        },
        insert(value) { inserts.push(value); return query; },
        async single() {
          return createError ? {data:null,error:createError} : {data:{id:PROMO_ID,code:inserts.at(-1).code},error:null};
        },
        is(key, value) {
          filters.push((row) => row[key] === value);
          return query;
        },
        update(value) { patch = value; return query; },
        async maybeSingle() {
          if (roleError && tableName === "event_co_organizers") return {data:null,error:{message:"offline"}};
          return { data: tables[tableName].find((row) => filters.every((f) => f(row))) ?? null, error: null };
        },
        then(resolve, reject) {
          try {
            const rows = tables[tableName].filter((row) => filters.every((f) => f(row)));
            if (patch) {
              for (const row of rows) Object.assign(row, patch);
              updates.push(...rows);
            }
            resolve({ data: rows, error: null });
          } catch (error) { reject(error); }
        },
      };
      return query;
    },
  };

  const source = fs.readFileSync(path.join(__dirname, "index.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imports = (name) => {
    if (name.startsWith("https://esm.sh/")) return { createClient: () => supabase };
    if (name.endsWith("/verify-session.ts")) {
      return {
        verifySession: async () => caller,
        corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
        optionsResponse: () => new Response(null, { status: 204 }),
      };
    }
    if (name.endsWith("/sentry.ts")) return { withSentry: (_name, fn) => fn };
    throw new Error(`Unexpected import: ${name}`);
  };
  const deno = { env: { get: (key) => key === "SUPABASE_URL" ? "https://test.supabase.co" : "fixture-secret" },
    serve: (fn) => { handler = fn; } };
  new Function("exports", "require", "Deno", compiled)({}, imports, deno);

  const request = async body => {
    const response = await handler(new Request("https://test.supabase.co/functions/v1/manage-promo-code", {
      method: "POST",
      body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  const send = (id = PROMO_ID, action = "delete") => request({action,promo_id:id});
  const create = (patch = {}) => request({action:"create",event_id:42,code:" cohost15 ",discount_type:"percent",discount_value:15,max_uses:null,...patch});
  return { send, create, request, promo, updates, inserts };
}

test("organizer removal revokes the code but preserves the row for orders", async () => {
  const h = harness();
  const response = await h.send();
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(h.updates.length, 1);
  assert.ok(h.promo.deleted_at);
  // Existing deployed checkout versions use valid_until; deletion must
  // immediately revoke discounts even before those functions are redeployed.
  assert.ok(new Date(h.promo.valid_until) < new Date());

  const duplicate = await h.send();
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.alreadyDeleted, true);
  assert.equal(h.updates.length, 1);
});

test("unrelated event member cannot delete another organizer's code", async () => {
  const h = harness({ caller: "stranger" });
  const response = await h.send();
  assert.equal(response.status, 403);
  assert.equal(h.promo.deleted_at, null);
  assert.equal(h.updates.length, 0);
});

test("accepted admin co-organizer may revoke, but non-admin cannot", async () => {
  const admin = harness({
    caller: "admin-1",
    coOrganizers: [{ id: "co-1", event_id: 42, user_id: "admin-1", accepted: true, role: "admin" }],
  });
  assert.equal((await admin.send()).status, 200);
  assert.ok(admin.promo.deleted_at);

  const notAdmin = harness({
    caller: "viewer",
    coOrganizers: [{ id: "co-2", event_id: 42, user_id: "viewer", accepted: true, role: "viewer" }],
  });
  assert.equal((await notAdmin.send()).status, 403);
  assert.equal(notAdmin.promo.deleted_at, null);
});

test("invalid or unknown promo IDs cannot delete anything", async () => {
  const h = harness();
  assert.equal((await h.send("wrong")).status, 400);
  assert.equal((await h.send("00000000-0000-0000-0000-000000000000")).status, 404);
  assert.equal(h.updates.length, 0);
});

test("all checkout entry points exclude revoked promo codes", () => {
  for (const file of [
    "../validate-promo-code/index.ts",
    "../_shared/apply-promo-code.ts",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(source, /\.from\("promo_codes"\)[\s\S]*?\.is\("deleted_at", null\)/);
  }
});


for (const role of ["owner", "admin", "editor"]) {
  test(`${role} creates a 15-percent code with server-owned attribution`, async () => {
    const caller = role === "owner" ? "host-1" : "cohost";
    const h = harness({caller,coOrganizers:[{id:"co",event_id:42,user_id:caller,accepted:true,role}]});
    const result = await h.create({created_by:"another-user",uses_count:999,ticket_type_id:"other-event-tier",deleted_at:"2020-01-01"});
    assert.equal(result.status,200);
    assert.equal(result.body.ok,true);
    assert.deepEqual(h.inserts,[{event_id:42,code:"COHOST15",discount_type:"percent",discount_value:15,max_uses:null,created_by:caller,uses_count:0}]);
    assert.equal(h.updates.length,0);
  });
}

for (const [label,staff] of [
  ["pending",{accepted:false,role:"admin",event_id:42}],
  ["scanner",{accepted:true,role:"scanner",event_id:42}],
  ["another event",{accepted:true,role:"editor",event_id:99}],
  ["removed",null],
]) {
  test(`${label} cannot create codes`,async()=>{
    const h=harness({caller:"cohost",coOrganizers:staff?[{id:"co",user_id:"cohost",...staff}]:[]});
    assert.equal((await h.create()).status,403);assert.equal(h.inserts.length,0);
  });
}

test("signed-out and unavailable role lookup fail closed",async()=>{
  const loggedOut=harness({caller:null});assert.equal((await loggedOut.create()).status,401);assert.equal(loggedOut.inserts.length,0);
  const broken=harness({caller:"cohost",roleError:true});assert.equal((await broken.create()).status,500);assert.equal(broken.inserts.length,0);
});

test("promo creation validates numeric values and scope before writing",async()=>{
  for(const patch of [
    {event_id:"42"},{event_id:0},{event_id:-1},{code:""},{code:"HAS SPACE"},
    {discount_type:"unknown"},{discount_value:0},{discount_value:101},{discount_value:15.5},
    {discount_value:"15"},{discount_value:Infinity},{max_uses:0},{max_uses:-1},{max_uses:1.5},
    {discount_type:"fixed_cents",discount_value:2147483648},
  ]){
    const h=harness();assert.equal((await h.create(patch)).status,400,JSON.stringify(patch));assert.equal(h.inserts.length,0);
  }
  const fixed=harness();assert.equal((await fixed.create({discount_type:"fixed_cents",discount_value:250,max_uses:10})).status,200);
  assert.equal(fixed.inserts[0].discount_value,250);
});

test("duplicates and insert errors return failures, never pretend creation succeeded",async()=>{
  const dup=harness({createError:{code:"23505"}});const d=await dup.create();assert.equal(d.status,409);assert.equal(d.body.code,"promo_code_exists");
  const failed=harness({createError:{code:"offline"}});assert.equal((await failed.create()).status,500);
});

test("creating an editor code does not grant admin revocation permission",async()=>{
  const h=harness({caller:"editor",coOrganizers:[{id:"co",event_id:42,user_id:"editor",accepted:true,role:"editor"}]});
  assert.equal((await h.create()).status,200);
  assert.equal((await h.send()).status,403);
  assert.equal(h.promo.deleted_at,null);
});
