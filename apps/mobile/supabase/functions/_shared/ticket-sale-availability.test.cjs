const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Execute the production handlers and their real pure policy helpers. Only
// authentication, persistence, crypto, and external side effects are faked.
// No Stripe, Supabase, email, network credentials, or live tickets are used.
const NOW = Date.parse("2026-10-21T12:00:00Z");
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
const compiled = new Map();
function source(file) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  return compiled.get(file);
}

function checkout(rail, patch = {}, options = {}) {
  const tier = {
    id: "tier-1", event_id: 42, name: "General admission", price_cents: 2000,
    currency: "usd", is_active: true, is_sold_out: false, status: "on_sale",
    sale_start: null, sale_end: null, tier_visibility: "public",
    quantity_total: 20, quantity_sold: 0, max_per_user: 4, ...patch,
  };
  const ops = [], stripe = [], issued = [], qr = [], promoCalls = [], deliveries = [];
  const db = {
    from(table) {
      const op = { table, action: "select", payload: null, eq: {} };
      function result() {
        ops.push(op);
        if (op.action === "insert" && table === "tickets") {
          issued.push(...op.payload);
          return { data: op.payload, error: null };
        }
        if (op.action === "insert" && table === "orders") return { data: { id: "order-1" }, error: null };
        if (op.action !== "select") return { data: null, error: null };
        if (table === "ticket_types") return { data: op.eq.id === "gate-1" ? options.gate : tier, error: null };
        if (table === "events") return { data: {
          host_id: "host-1", title: "Test event", fee_mode: "pass",
          start_date: "2026-10-22T18:00:00Z", end_date: "2026-10-23T01:00:00Z",
          ...options.event,
        }, error: null };
        if (table === "organizer_accounts") return { data: { stripe_account_id: "acct_fixture", charges_enabled: true }, error: null };
        if (table === "stripe_customers") return { data: { stripe_customer_id: "cus_fixture" }, error: null };
        if (table === "tickets" || table === "ticket_holds") return { data: [], count: 0, error: null };
        if (table === "orders") return { data: null, error: null };
        throw new Error(`Unexpected table read: ${table}`);
      }
      const q = {
        select: () => q, eq: (key, value) => { op.eq[key] = value; return q; },
        in: () => q, gt: () => q,
        insert: (payload) => { op.action = "insert"; op.payload = payload; return q; },
        update: (payload) => { op.action = "update"; op.payload = payload; return q; },
        upsert: (payload) => { op.action = "upsert"; op.payload = payload; return q; },
        delete: () => { op.action = "delete"; return q; },
        single: async () => result(), maybeSingle: async () => result(),
        then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      };
      return q;
    },
    rpc: async (name, args) => {
      ops.push({ action: "rpc", name, args });
      assert.equal(name, "ticket_hold_create_atomic");
      return { data: { ok: true, hold_id: "hold-1" }, error: null };
    },
  };
  const stubs = {
    "event-access.ts": { canAccessEvent: async () => true },
    "verify-session.ts": { verifySession: async () => options.guest ? null : "buyer-1" },
    "member-phone.ts": { requireMemberPhone: async () => ({ ok: true }) },
    "hmac-qr.ts": { createSignedQrPayload: async (id) => {
      qr.push(id); return { qrToken: `qr-${id}`, qrPayload: `signed-${id}` };
    } },
    "apply-promo-code.ts": {
      validateAndApplyPromo: async (...args) => {
        promoCalls.push(args);
        return { result: { promo_code_id: "promo-1", code: "FREE", discount_cents: args[4] }, error: null };
      },
      incrementPromoUsage: async () => {},
    },
    "apply-promoter-code.ts": {
      resolveAccountPromoterCode: async () => null,
      validateAndApplyPromoterCode: async () => { throw new Error("Unexpected promoter code"); },
    },
    "sentry.ts": { withSentry: (_name, handler) => handler },
    "capacity-alerts.ts": { maybeFireCapacityAlerts: async () => {} },
    "ticket-email-delivery.ts": { deliverTicketBundleEmail: async (...args) => { deliveries.push(args); } },
    "checkout-profile-fields.ts": { parseCheckoutProfileFields: () => ({ ok: true, fields: null }) },
    "checkout-profile.ts": {
      provisionCheckoutProfile: async () => { throw new Error("Unexpected profile provisioning"); },
      recordCheckoutProfileIntake: async () => { throw new Error("Unexpected profile intake"); },
    },
    "rate-limit.ts": { checkRateLimit: () => ({ allowed: true }) },
  };
  const realHelpers = new Set([
    "tier-sale-availability.ts", "tier-visibility.ts", "sales-cutoff.ts",
    "fee-calculator.ts", "async-settlement.ts", "checkout-line-items.ts",
  ]);
  let handler;
  const context = {
    Request, Response, URLSearchParams, crypto, Date: FixedDate,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: () => "test-fixture" }, serve: (fn) => { handler = fn; } },
    fetch: async (url, init) => {
      stripe.push({ url, init });
      const endpoint = new URL(url).pathname;
      if (endpoint === "/v1/customers/cus_fixture") return Response.json({ id: "cus_fixture" });
      if (endpoint === "/v1/payment_intents") return Response.json({ id: "pi_fixture", client_secret: "pi_fixture_secret" });
      if (endpoint === "/v1/ephemeral_keys") return Response.json({ secret: "ek_fixture" });
      if (endpoint === "/v1/checkout/sessions") return Response.json({ id: "cs_fixture", url: "https://checkout.example.test/session" });
      throw new Error(`Unexpected external request: ${url}`);
    },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    vm.runInNewContext(source(file), { ...context, exports, require: (specifier) => {
      if (specifier.includes("supabase-js")) return { createClient: () => db };
      const name = path.basename(specifier);
      if (stubs[name]) return stubs[name];
      if (realHelpers.has(name)) return load(path.resolve(path.dirname(file), specifier));
      throw new Error(`Unmocked dependency: ${specifier}`);
    } }, { filename: file });
    return exports;
  }
  load(path.resolve(__dirname, "..", rail, "index.ts"));
  return {
    ops, stripe, issued, qr, promoCalls, deliveries,
    run: (body = {}) => handler(new Request("https://checkout.example.test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: 42, ticket_type_id: "tier-1", quantity: 2,
        ...(options.guest ? { guest_email: "buyer@example.test" } : {}), ...body }),
    })),
  };
}

const blocked = [
  ["inactive", { is_active: false }, "tier_unavailable"],
  ["paused", { status: "paused" }, "tier_unavailable"],
  ["ended", { status: "ended" }, "tier_unavailable"],
  ["draft", { status: "draft" }, "tier_unavailable"],
  ["scheduled", { status: "scheduled" }, "tier_unavailable"],
  ["unknown status", { status: "unknown" }, "tier_unavailable"],
  ["sold-out status", { status: "sold_out" }, "sold_out"],
  ["sold-out legacy flag", { is_sold_out: true }, "sold_out"],
  ["before opening", { sale_start: new Date(NOW + 1).toISOString() }, "sale_not_started"],
  ["at closing", { sale_end: new Date(NOW).toISOString() }, "sale_ended"],
  ["after closing", { sale_end: new Date(NOW - 1).toISOString() }, "sale_ended"],
  ["invalid opening", { sale_start: "not-a-date" }, "invalid_sale_window"],
  ["invalid closing", { sale_end: "not-a-date" }, "invalid_sale_window"],
  ["reversed window", { sale_start: new Date(NOW + 1).toISOString(), sale_end: new Date(NOW - 1).toISOString() }, "invalid_sale_window"],
  ["empty window", { sale_start: new Date(NOW).toISOString(), sale_end: new Date(NOW).toISOString() }, "invalid_sale_window"],
];
const rails = [
  ["native", "create-payment-intent", {}],
  ["hosted member", "ticket-checkout", {}],
  ["hosted guest", "ticket-checkout", { guest: true }],
];
const purchases = [
  ["paid", {}, {}],
  ["free", { price_cents: 0 }, {}],
  ["100% promo", {}, { promo_code: "FREE" }],
];

for (const [label, rail, options] of rails) {
  for (const [purchase, price, body] of purchases) {
    for (const [state, patch, code] of blocked) {
      test(`${label}: ${state} rejects ${purchase} before checkout side effects`, async () => {
        const fn = checkout(rail, { ...price, ...patch }, options);
        const response = await fn.run(body);
        assert.equal(response.status, 400, await response.clone().text());
        assert.equal((await response.json()).code, code);
        assert.equal(fn.stripe.length, 0, "No Stripe customer, payment intent or hosted session");
        assert.equal(fn.qr.length, 0, "No QR minting");
        assert.equal(fn.issued.length, 0, "No tickets");
        assert.equal(fn.promoCalls.length, 0, "Discounts cannot bypass a sale restriction");
        assert.equal(fn.deliveries.length, 0, "No ticket email");
        assert.deepEqual(fn.ops.filter((op) => op.action !== "select"), [], "No orders, inventory holds, or inventory writes");
      });
    }
    for (const [state, patch] of [
      ["open window", { sale_start: new Date(NOW - 1).toISOString(), sale_end: new Date(NOW + 1).toISOString() }],
      ["exact opening", { sale_start: new Date(NOW).toISOString() }],
      ["no sale window", {}],
      ["legacy nullable flags", { status: null, is_active: null, is_sold_out: null }],
    ]) {
      test(`${label}: ${state} preserves ${purchase} checkout`, async () => {
        const fn = checkout(rail, { ...price, ...patch }, options);
        const response = await fn.run(body);
        assert.equal(response.status, 200, await response.clone().text());
        const result = await response.json();
        if (purchase === "paid") {
          assert.equal(fn.issued.length, 0, "Paid tickets wait for webhook fulfillment");
          assert.equal(fn.ops.filter((op) => op.name === "ticket_hold_create_atomic").length, 1);
          assert.equal(fn.ops.find((op) => op.table === "orders" && op.action === "insert").payload.status, "payment_pending");
          assert.ok(rail === "create-payment-intent" ? result.paymentIntent : result.url);
        } else {
          assert.equal(result.free, true);
          assert.equal(result.tickets.length, 2);
          assert.equal(fn.issued.length, 2);
          assert.equal(fn.stripe.length, 0);
          assert.equal(fn.promoCalls.length, purchase === "100% promo" ? 1 : 0);
          assert.equal(fn.deliveries.length, options.guest ? 1 : 0);
        }
      });
    }
  }
  for (const [visibility, body, status] of [
    ["hidden", {}, 404], ["locked", {}, 403],
    ["locked", { unlock_code: "wrong" }, 403],
    ["locked", { unlock_code: " OPEN " }, 200],
  ]) {
    test(`${label}: retains ${visibility} visibility guard (${status})`, async () => {
      const fn = checkout(rail, { tier_visibility: visibility, unlock_code: "open" }, options);
      assert.equal((await fn.run(body)).status, status);
      if (status !== 200) assert.equal(fn.stripe.length, 0);
    });
  }
  test(`${label}: retains automatic unlock after a preceding tier sells out`, async () => {
    const fn = checkout(rail, { tier_visibility: "locked", unlocks_after_tier_id: "gate-1" }, {
      ...options, gate: { status: "sold_out", quantity_total: 10, quantity_sold: 10 },
    });
    assert.equal((await fn.run()).status, 200);
    assert.ok(fn.stripe.length > 0);
  });
  test(`${label}: unlocking a tier does not bypass a paused sale`, async () => {
    const fn = checkout(rail, { status: "paused", tier_visibility: "locked", unlock_code: "open" }, options);
    const response = await fn.run({ unlock_code: "open" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "tier_unavailable");
    assert.equal(fn.stripe.length, 0);
  });
  test(`${label}: retains event-wide online-sales cutoff`, async () => {
    const fn = checkout(rail, {}, { ...options, event: { end_date: new Date(NOW + 30 * 60_000).toISOString() } });
    assert.equal((await fn.run()).status, 400);
    assert.equal(fn.stripe.length, 0);
  });
}
