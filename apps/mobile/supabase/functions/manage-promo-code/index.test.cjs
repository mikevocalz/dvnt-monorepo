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
} = {}) {
  let handler;
  const promo = { id: PROMO_ID, event_id: 42, deleted_at: deletedAt, valid_until: null };
  const tables = {
    promo_codes: [promo],
    events: [{ id: 42, host_id: host }],
    event_co_organizers: coOrganizers,
  };
  const updates = [];
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
        is(key, value) {
          filters.push((row) => row[key] === value);
          return query;
        },
        update(value) { patch = value; return query; },
        async maybeSingle() {
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

  const send = async (id = PROMO_ID, action = "delete") => {
    const response = await handler(new Request("https://test.supabase.co/functions/v1/manage-promo-code", {
      method: "POST",
      body: JSON.stringify({ action, promo_id: id }),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { send, promo, updates };
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
