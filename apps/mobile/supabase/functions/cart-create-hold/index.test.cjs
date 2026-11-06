const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const CART = "11111111-1111-4111-8111-111111111111";
const body = {
  cartId: CART,
  eventId: 1,
  idempotencyKey: "new-key-must-not-unfreeze-payment",
  lineItems: [
    {
      lineItemId: "22222222-2222-4222-8222-222222222222",
      category: "admission",
      tierId: "33333333-3333-4333-8333-333333333333",
      quantity: 1,
      unitPriceCents: 3000,
    },
  ],
};
function fixture(existingCart, rpcResult = { ok: true, holdExpiresAt: "2099-01-01T00:00:00Z" }) {
  let handler;
  const writes = [],
    rpcs = [];
  const client = {
    from(table) {
      let fields = "*";
      const query = {
        select(value) {
          fields = value;
          return query;
        },
        eq() {
          return query;
        },
        maybeSingle: async () => ({
          data: existingCart
            ? Object.fromEntries(
                fields
                  .split(",")
                  .map((field) => [field.trim(), existingCart[field.trim()]]),
              )
            : null,
          error: null,
        }),
        then: (resolve) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      for (const action of ["upsert", "update", "delete", "insert"])
        query[action] = (payload) => {
          writes.push({ table, action, payload });
          return query;
        };
      return query;
    },
    async rpc(name, args) {
      rpcs.push({ name, args });
      return {
        data: rpcResult,
        error: null,
      };
    },
  };
  const source = process.env.CHECKOUT_BASELINE_REF
    ? execFileSync(
        "git",
        [
          "show",
          `${process.env.CHECKOUT_BASELINE_REF}:apps/mobile/supabase/functions/cart-create-hold/index.ts`,
        ],
        { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8" },
      )
    : fs.readFileSync(path.join(__dirname, "index.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  vm.runInNewContext(compiled, {
    exports: {},
    Response,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: () => "" }, serve: (fn) => (handler = fn) },
    require(name) {
      if (name.includes("supabase-js")) return { createClient: () => client };
      if (name.includes("event-access"))
        return { canAccessEvent: async () => true };
      if (name.includes("verify-session"))
        return {
          verifySession: async () => "fixture-buyer",
          jsonResponse: json,
          errorResponse: (error, status) => json({ error }, status),
          optionsResponse: () => new Response(null, { status: 204 }),
        };
      throw new Error(`Unexpected dependency ${name}`);
    },
    fetch: () => {
      throw new Error("No network/Stripe access allowed in this fixture");
    },
  });
  return {
    writes,
    rpcs,
    call: async () => {
      const response = await handler(
        new Request("https://fixture.invalid/cart-create-hold", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      return { status: response.status, data: await response.json() };
    },
  };
}
for (const state of [
  { status: "paying", stripe_pi_id: null },
  { status: "paying", stripe_pi_id: "pi_fixture" },
  { status: "holding", stripe_pi_id: "pi_fixture" },
  { status: "draft", stripe_pi_id: "pi_fixture" },
  { status: "abandoned", stripe_pi_id: "pi_fixture" },
]) {
  test(`frozen ${state.status} cart with PI=${!!state.stripe_pi_id} refuses edits before any writes or hold RPC`, async () => {
    const f = fixture({ id: CART, user_id: "fixture-buyer", ...state });
    const response = await f.call();
    assert.equal(response.status, 409);
    assert.match(response.data.error, /Payment already started/);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.rpcs, []);
  });
}
for (const status of ["draft", "holding"]) {
  test(`unpaid ${status} cart still accepts line edits and creates a hold`, async () => {
    const f = fixture({
      id: CART,
      user_id: "fixture-buyer",
      status,
      stripe_pi_id: null,
    });
    const response = await f.call();
    assert.equal(response.status, 200);
    assert.equal(response.data.ok, true);
    assert.deepEqual(
      f.writes.map((w) => [w.table, w.action]),
      [
        ["carts", "upsert"],
        ["cart_holds", "update"],
        ["cart_line_items", "delete"],
        ["cart_line_items", "insert"],
      ],
    );
    assert.equal(f.rpcs.length, 1);
    assert.equal(f.rpcs[0].name, "cart_create_hold");
  });
}
test("new cart still creates a draft and hold", async () => {
  const f = fixture(null);
  assert.equal((await f.call()).status, 200);
  assert.equal(f.rpcs.length, 1);
});
test("completed cart remains closed before mutation", async () => {
  const f = fixture({
    id: CART,
    user_id: "fixture-buyer",
    status: "completed",
    stripe_pi_id: "pi_fixture",
  });
  const response = await f.call();
  assert.equal(response.status, 409);
  assert.match(response.data.error, /already completed/);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.rpcs, []);
});
test("another buyer cannot use the frozen-cart error to inspect ownership", async () => {
  const f = fixture({
    id: CART,
    user_id: "other-buyer",
    status: "paying",
    stripe_pi_id: "pi_fixture",
  });
  assert.equal((await f.call()).status, 404);
  assert.deepEqual(f.writes, []);
});

for (const error of ["sale_not_started", "sale_ended", "invalid_sale_window"]) {
  test(`sale-window RPC refusal reaches the buyer without a successful hold: ${error}`, async () => {
    const f = fixture(null, { ok: false, error, tierId: body.lineItems[0].tierId });
    const r = await f.call();
    assert.equal(r.status, 400);
    assert.equal(r.data.error, error);
    assert.equal(r.data.tierId, body.lineItems[0].tierId);
    assert.equal(r.data.ok, undefined);
    assert.equal(r.data.holdExpiresAt, undefined);
    assert.equal(f.rpcs.length, 1);
  });
}

test("sale preflight locks cart lines and tiers before date checks or hold mutations; existing allocator preserved", () => {
  const dir = path.resolve(__dirname, "../../migrations");
  const migration = fs.readFileSync(path.join(dir, "20261106120000_cart_hold_sale_windows.sql"), "utf8");
  const previous = fs.readFileSync(path.join(dir, "20261031142216_repeat_purchase_tier_limits.sql"), "utf8");
  const cartLock = migration.indexOf("WHERE id = p_cart_id FOR UPDATE");
  const lineLock = migration.indexOf("ORDER BY cli.id FOR UPDATE;");
  const tierLock = migration.indexOf("ORDER BY t.id FOR UPDATE;");
  const start = migration.indexOf("  -- Use wall time AFTER");
  const end = migration.indexOf("  FOR v_line IN\n    SELECT t.id AS tier_id, t.max_per_user", start);
  assert.ok(cartLock < lineLock && lineLock < tierLock && tierLock < start);
  assert.ok(end < migration.indexOf("UPDATE public.cart_holds SET released"));
  assert.match(migration.slice(start,end), /v_sale_now := clock_timestamp\(\)/);
  assert.match(migration.slice(start,end), /sale_start > v_sale_now/);
  assert.match(migration.slice(start,end), /sale_end <= v_sale_now/);
  assert.match(migration.slice(start,end), /NOT isfinite/);
  const functionStart = "CREATE OR REPLACE FUNCTION public.cart_create_hold(";
  const original = previous.slice(previous.indexOf(functionStart), previous.indexOf("-- Preserve the existing paid recovery allocator"));
  const withoutPreflight = (migration.slice(migration.indexOf(functionStart), start) + migration.slice(end))
    .replace("  v_sale_now timestamptz;\n", "")
    .replace(/  -- Freeze the selection before locking its tier set\.[\s\S]*?ORDER BY cli.id FOR UPDATE;\n\n/, "")
    .replace("ORDER BY t.id FOR UPDATE;\n\n", "ORDER BY t.id FOR UPDATE;\n");
  assert.equal(withoutPreflight, original, "caps, unlock chains, allocator, add-ons, and grants otherwise unchanged");
  const schema = fs.readFileSync(path.join(dir, "20260516150000_mixed_cart_checkout.sql"), "utf8");
  assert.match(schema, /create table if not exists public\.cart_line_items \([\s\S]*?cart_id uuid not null references public\.carts\(id\)/);
});
