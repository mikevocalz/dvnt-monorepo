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
  let insertLost = false;
  const db = {
    from(table) {
      const op = { table, action: "select", payload: null, eq: {} };
      function result() {
        ops.push(op);
        if (op.action === "insert" && table === "tickets") {
          issued.push(...op.payload);
          return { data: op.payload, error: null };
        }
        if (op.action === "insert" && table === "orders") {
          if (options.raceOrder) { insertLost = true; return { data: null, error: { code: "23505" } }; }
          return { data: { id: "order-1" }, error: null };
        }
        if (op.action !== "select") return { data: null, error: null };
        if (table === "ticket_types") return { data: op.eq.id === "gate-1" ? options.gate : tier, error: null };
        if (table === "events") return { data: {
          host_id: "host-1", title: "Test event", fee_mode: "pass",
          start_date: "2026-10-22T18:00:00Z", end_date: "2026-10-23T01:00:00Z",
          ...options.event,
        }, error: null };
        if (table === "organizer_accounts") return { data: { stripe_account_id: "acct_fixture", charges_enabled: true }, error: null };
        if (table === "stripe_customers") return { data: { stripe_customer_id: "cus_fixture" }, error: null };
        if (table === "tickets" && op.eq.order_id) return { data: options.tickets || [], error: options.ticketReadError || null };
        if (table === "tickets" || table === "ticket_holds") return { data: [], count: 0, error: null };
        if (table === "orders") return { data: insertLost ? options.raceOrder : options.order || null, error: options.orderReadError || null };
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
      if (name === "free_ticket_checkout_atomic") {
        if (options.raceOrder) { insertLost = true; return { data: { ok: true, idempotent: true, order: options.raceOrder, tickets: options.tickets }, error: null }; }
        issued.push(...args.p_ticket_rows);
        return { data: { ok: true, idempotent: false, order: { id: "order-1", ...args.p_order }, tickets: args.p_ticket_rows }, error: null };
      }
      assert.equal(name, "ticket_purchase_hold_atomic");
      return { data: { ok: true, hold_id: "hold-1" }, error: null };
    },
  };
  const stubs = {
    "event-access.ts": { canAccessEvent: async () => true },
    "verify-session.ts": { verifySession: async () => options.guest || options.anonymous ? null : "buyer-1" },
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
    "checkout-replay.ts", "tier-sale-availability.ts", "tier-visibility.ts", "sales-cutoff.ts",
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
      body: JSON.stringify({ event_id: 42, ticket_type_id: "tier-1", quantity: 2, idempotency_key: "attempt-fixture",
        ...(options.guest ? { guest_email: "buyer@example.test" } : {}), ...body }),
    })),
  };
}

const ORDER = {
  id: "existing-order", user_id: "buyer-1", guest_email: null,
  type: "event_ticket", event_id: 42, quantity: 2, total_cents: 0, status: "paid",
  stripe_payment_intent_id: null, stripe_checkout_session_id: null,
};
function tickets(order = ORDER, patch = {}) {
  return [1, 2].map((i) => ({ id: `ticket-${i}`, qr_token: `private-qr-${i}`,
    event_id: order.event_id, ticket_type_id: "tier-1", user_id: order.user_id,
    guest_email: order.guest_email, status: "active", ...patch }));
}
const rails = [
  ["native", "create-payment-intent", {}],
  ["hosted member", "ticket-checkout", {}],
  ["hosted guest", "ticket-checkout", { guest: true }],
];
for (const [label, rail, identity] of rails) {
  const ownOrder = { ...ORDER, ...(identity.guest ? { user_id: null, guest_email: "buyer@example.test" } : {}) };
  const cases = [
    ["other member", { ...ownOrder, user_id: "another-buyer" }],
    ["other guest", { ...ownOrder, user_id: null, guest_email: "someone-else@example.test" }],
    ["other event", { ...ownOrder, event_id: 43 }],
    ["different quantity", { ...ownOrder, quantity: 1 }],
    ["non-ticket order", { ...ownOrder, type: "subscription" }],
    ["pending payment", { ...ownOrder, status: "payment_pending", total_cents: 4000 }],
    ["paid amount", { ...ownOrder, total_cents: 4000 }],
    ["refunded order", { ...ownOrder, status: "refunded" }],
    ["cancelled order", { ...ownOrder, status: "cancelled" }],
    ["zero-value Stripe intent", { ...ownOrder, stripe_payment_intent_id: "pi_existing" }],
    ["zero-value Stripe session", { ...ownOrder, stripe_checkout_session_id: "cs_existing" }],
  ];
  for (const race of [false, true]) {
    for (const [state, order] of cases) {
      test(`${label}: ${race ? "race loser" : "initial replay"} refuses ${state}`, async () => {
        const fn = checkout(rail, { price_cents: 0 }, { ...identity,
          [race ? "raceOrder" : "order"]: order, tickets: tickets(order),
        });
        const response = await fn.run();
        assert.equal(response.status, 409, await response.clone().text());
        const body = await response.json();
        assert.equal(body.code, "checkout_replay_unavailable");
        assert.equal(body.free, undefined);
        assert.equal(body.order_id, undefined);
        assert.equal(body.tickets, undefined);
        assert.equal(fn.issued.length, 0);
        assert.equal(fn.qr.length, race ? 2 : 0, "A race may prepare unused QRs before the atomic allocator; it never persists them");
        assert.equal(fn.stripe.length, 0);
        assert.equal(fn.deliveries.length, 0);
        if (!race) assert.deepEqual(fn.ops.filter((op) => op.action !== "select"), []);
      });
    }
    test(`${label}: ${race ? "race loser" : "initial replay"} returns free tickets only to a verified matching member`, async () => {
      const fn = checkout(rail, { price_cents: 0 }, { ...identity,
        [race ? "raceOrder" : "order"]: ownOrder, tickets: tickets(ownOrder),
      });
      const response = await fn.run();
      if (identity.guest) {
        assert.equal(response.status, 409, await response.clone().text());
        const body = await response.json();
        assert.equal(body.tickets, undefined, "Matching unverified email/key is not authorization");
        assert.equal(body.order_id, undefined);
        assert.equal(fn.ops.some((op) => op.table === "tickets" && op.eq.order_id), false);
      } else {
        assert.equal(response.status, 200, await response.clone().text());
        assert.deepEqual(await response.json(), {
          tickets: tickets(ownOrder).map(({ id, qr_token }) => ({ id, qr_token })),
          free: true, order_id: "existing-order", idempotent: true,
        });
      }
      assert.equal(fn.issued.length, 0);
      assert.equal(fn.qr.length, race ? 2 : 0, "A race may prepare unused QRs before the atomic allocator; it never persists them");
      assert.equal(fn.stripe.length, 0);
    });
    for (const [state, rows] of [
      ["incomplete issuance", tickets(ownOrder).slice(0, 1)],
      ["empty issuance", []],
      ["different tier", tickets(ownOrder, { ticket_type_id: "another-tier" })],
      ["different ticket event", tickets(ownOrder, { event_id: 43 })],
      ["transferred ownership", tickets(ownOrder, { user_id: "recipient" })],
      ["voided tickets", tickets(ownOrder, { status: "void" })],
      ["cancelled tickets", tickets(ownOrder, { status: "cancelled" })],
      ["refunded tickets", tickets(ownOrder, { status: "refunded" })],
      ["missing QR", tickets(ownOrder, { qr_token: null })],
    ]) {
      test(`${label}: ${race ? "race loser" : "initial replay"} rejects ${state} rather than false success`, async () => {
        const fn = checkout(rail, { price_cents: 0 }, { ...identity,
          [race ? "raceOrder" : "order"]: ownOrder, tickets: rows,
        });
        const response = await fn.run();
        assert.equal(response.status, 409, await response.clone().text());
        assert.equal((await response.json()).tickets, undefined);
        assert.equal(fn.issued.length, 0);
        assert.equal(fn.stripe.length, 0);
      });
    }
  }
  for (const [name, body] of [
    ["missing event", { event_id: null }], ["missing tier", { ticket_type_id: null }],
    ["zero quantity", { quantity: 0 }], ["fractional quantity", { quantity: 1.5 }],
  ]) {
    test(`${label}: ${name} cannot retrieve a previous checkout`, async () => {
      const fn = checkout(rail, {}, { ...identity, order: ownOrder, tickets: tickets(ownOrder) });
      assert.equal((await fn.run(body)).status, 400);
      assert.equal(fn.ops.some((op) => op.table === "orders"), false);
      assert.equal(fn.stripe.length, 0);
    });
  }
  test(`${label}: a new key still creates a free checkout`, async () => {
    const fn = checkout(rail, { price_cents: 0 }, identity);
    const response = await fn.run();
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).free, true);
    assert.equal(fn.issued.length, 2);
  });
  test(`${label}: a new key still starts paid checkout without issuing tickets`, async () => {
    const fn = checkout(rail, {}, identity);
    const response = await fn.run();
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).free, undefined);
    assert.equal(fn.issued.length, 0);
    assert.ok(fn.stripe.length > 0);
  });
  for (const [name, error] of [["order", { orderReadError: { message: "db unavailable" } }], ["tickets", { ticketReadError: { message: "db unavailable" } }]]) {
    test(`${label}: failed ${name} lookup never mints duplicates or returns empty success`, async () => {
      const fn = checkout(rail, { price_cents: 0 }, { ...identity, order: ownOrder, tickets: tickets(ownOrder), ...error });
      assert.equal((await fn.run()).status, identity.guest && name === "tickets" ? 409 : 500);
      assert.equal(fn.issued.length, 0);
      assert.equal(fn.stripe.length, 0);
    });
  }
}
test("hosted: anonymous request cannot replay an existing order before authentication", async () => {
  const fn = checkout("ticket-checkout", {}, { anonymous: true, order: ORDER, tickets: tickets() });
  const response = await fn.run();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).tickets, undefined);
  assert.equal(fn.ops.some((op) => op.table === "orders"), false);
});
