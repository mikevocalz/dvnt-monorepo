const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, stubs) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, console, Response, Request, ...stubs });
  return exports;
}

function fixture(overrides = {}, failedTable) {
  const event = { start_date: new Date(Date.now() + 7 * 864e5).toISOString(), refund_policy: "before_event", title: "A free RSVP" };
  const ticket = { id: "t1", user_id: "buyer", event_id: 1, status: "active", purchase_amount_cents: 0, checked_in_at: null, transferred_from: null, events: event, ticket_types: { name: "RSVP" } };
  const tables = { users: [{ id: 1, auth_id: "buyer" }], tickets: [ticket], orders: [], carts: [], cart_line_items: [], ...overrides };
  let handler;
  const reads = [];
  const db = { from(table) {
    const filters = [];
    const rows = () => (tables[table] || []).filter(row => filters.every(fn => fn(row)));
    const result = () => ({ data: failedTable === table ? null : rows(), error: failedTable === table ? { message: "unavailable" } : null });
    const q = {
      select(fields) { reads.push({ table, fields }); return q; },
      eq(k,v) { filters.push(row => row[k] === v); return q; },
      in(k,vs) { filters.push(row => vs.includes(row[k])); return q; },
      order() { return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then(resolve, reject) { return Promise.resolve(result()).then(resolve,reject); },
    }; return q;
  } };
  const helper = load(path.resolve(__dirname, "../_shared/ticket-self-service.ts"));
  load(path.resolve(__dirname, "index.ts"), {
    Deno: { env: { get: () => "test" }, serve: fn => { handler = fn; } },
    require: name => name.includes("supabase-js") ? { createClient: () => db }
      : name.endsWith("ticket-self-service.ts") ? helper
      : { verifySession: async () => "buyer", jsonResponse: (data, status = 200) => Response.json(data, { status }), errorResponse: (error, status) => Response.json({ error }, { status }), optionsResponse: () => new Response(null) },
  });
  return { ticket, tables, reads, async run() { const res = await handler(new Request("http://offline.test", { method: "POST", body: "{}" })); assert.equal(res.status, 200); return res.json(); } };
}

test("real get-my-tickets projects free cancellation without inventing payment", async () => {
  const f = fixture(); const out = await f.run();
  assert.equal(out.tickets[0].self_service_action, "cancel_free");
  assert.equal(out.tickets[0].purchase_amount_cents, 0);
  assert.ok(f.reads.some(r => r.table === "tickets" && r.fields.includes("refund_policy")));
});

test("no action for wrong order buyer, paid add-on order, failed context or policy refusal", async () => {
  for (const kind of ["wrong-buyer", "paid-addon", "failed-context", "none", "transferred", "unknown-price", "used"]) {
    const f = fixture({}, kind === "failed-context" ? "orders" : undefined);
    f.ticket.order_id = "o1";
    f.tables.orders.push({ id: "o1", user_id: kind === "wrong-buyer" ? "other" : "buyer", event_id: 1, status: "paid", total_cents: kind === "paid-addon" ? 1000 : 0 });
    if (kind === "none") f.ticket.events.refund_policy = "none";
    if (kind === "transferred") f.ticket.transferred_from = "original";
    if (kind === "unknown-price") f.ticket.purchase_amount_cents = null;
    if (kind === "used") f.ticket.checked_in_at = new Date().toISOString();
    const out = await f.run();
    assert.equal(out.tickets.length, 1, "a context failure must not hide the credential");
    assert.equal(out.tickets[0].self_service_action, null, kind);
    assert.equal(out.orders, undefined, "buyer context stays server-side");
  }
});

test("synthetic free groups work; zero-priced cart lines do not masquerade as refunds", async () => {
  const f = fixture(); Object.assign(f.ticket, { order_id: "o1", cart_id: "synthetic" });
  f.tables.orders.push({ id: "o1", user_id: "buyer", event_id: 1, status: "paid", total_cents: 0 });
  assert.equal((await f.run()).tickets[0].self_service_action, "cancel_free");
  f.ticket.cart_line_item_id = "line";
  assert.equal((await f.run()).tickets[0].self_service_action, null);
});

test("positive actual paid ticket and verified paid cart line retain refund routing", async () => {
  const f = fixture(); Object.assign(f.ticket, { purchase_amount_cents: 1200, stripe_payment_intent_id: "pi_paid" });
  assert.equal((await f.run()).tickets[0].self_service_action, "refund");
  Object.assign(f.ticket, { cart_id: "cart", cart_line_item_id: "line" });
  f.tables.carts.push({ id: "cart", user_id: "buyer", event_id: 1, status: "completed", stripe_pi_id: "pi_paid" });
  f.tables.cart_line_items.push({ id: "line", cart_id: "cart", tier_id: "tier", addon_id: null, quantity: 1, unit_price_cents: 1200, refunded_amount_cents: 0 });
  assert.equal((await f.run()).tickets[0].self_service_action, "refund_line");
  f.tables.carts[0].user_id = "other";
  assert.equal((await f.run()).tickets[0].self_service_action, null);
});
