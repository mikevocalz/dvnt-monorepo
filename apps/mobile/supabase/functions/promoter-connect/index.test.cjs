const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function harness({ existingAccount = null, cardPayments = "unrequested" } = {}) {
  let handler;
  const calls = [];
  const promoter = {
    id: "prom-1",
    event_id: 42,
    user_id: "user-1",
    status: "active",
    stripe_account_id: existingAccount,
  };
  const tables = {
    event_promoters: [promoter],
    organizer_accounts: [],
  };
  const supabase = {
    from(name) {
      const filters = [];
      let patch;
      const query = {
        select() { return query; },
        eq(k, v) { filters.push((r) => r[k] === v); return query; },
        neq(k, v) { filters.push((r) => r[k] !== v); return query; },
        update(value) { patch = value; return query; },
        async maybeSingle() {
          return { data: tables[name].find((r) => filters.every((f) => f(r))) || null, error: null };
        },
        then(resolve, reject) {
          try {
            if (patch) {
              for (const row of tables[name].filter((r) => filters.every((f) => f(r)))) Object.assign(row, patch);
            }
            resolve({ error: null });
          } catch (error) { reject(error); }
        },
      };
      return query;
    },
  };

  async function mockFetch(url, opts = {}) {
    const endpoint = new URL(url).pathname;
    const body = new URLSearchParams(opts.body || "");
    calls.push({ method: opts.method || "GET", endpoint, body });
    let response;
    if (endpoint === "/v1/accounts" && opts.method === "POST") {
      response = { id: "acct_new" };
    } else if (endpoint.startsWith("/v1/accounts/") && opts.method !== "POST") {
      response = { id: existingAccount, capabilities: { transfers: "active", card_payments: cardPayments } };
    } else if (endpoint.endsWith("/capabilities/card_payments")) {
      response = { id: "card_payments", requested: true, status: "pending" };
    } else if (endpoint === "/v1/account_links") {
      response = { url: "https://connect.stripe.com/setup/test" };
    } else throw new Error(`Unexpected Stripe request ${opts.method} ${url}`);
    return { json: async () => response };
  }

  const source = fs.readFileSync(path.join(__dirname, "index.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireMock = (name) => {
    if (name.startsWith("https://esm.sh/")) return { createClient: () => supabase };
    if (name.endsWith("/verify-session.ts")) return { verifySession: async () => "user-1" };
    if (name.endsWith("/sentry.ts")) return { withSentry: (_name, fn) => fn };
    throw new Error(`Unexpected import ${name}`);
  };
  const deno = {
    env: { get: (key) => ({
      STRIPE_SECRET_KEY: "sk_test_fixture",
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture",
    })[key] },
    serve: (fn) => { handler = fn; },
  };
  // Shadow fetch for the handler; no actual Stripe or Supabase network calls.
  new Function("exports", "require", "Deno", "fetch", compiled)({}, requireMock, deno, mockFetch);

  async function start() {
    const response = await handler(new Request("https://test.supabase.co/functions/v1/promoter-connect", {
      method: "POST",
      body: JSON.stringify({ action: "start", event_id: 42 }),
    }));
    return { status: response.status, body: await response.json() };
  }
  return { calls, promoter, start };
}

test("new Stripe Express accounts request both card_payments and transfers", async () => {
  const h = harness();
  const r = await h.start();
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^https:\/\//);
  assert.equal(h.promoter.stripe_account_id, "acct_new");
  const created = h.calls.find((x) => x.endpoint === "/v1/accounts");
  assert.ok(created);
  assert.equal(created.body.get("capabilities[card_payments][requested]"), "true");
  assert.equal(created.body.get("capabilities[transfers][requested]"), "true");
});

test("existing transfer-only account requests card_payments without duplicate account", async () => {
  const h = harness({ existingAccount: "acct_prior", cardPayments: "unrequested" });
  const r = await h.start();
  assert.equal(r.status, 200);
  assert.equal(h.promoter.stripe_account_id, "acct_prior");
  assert.equal(h.calls.some((x) => x.endpoint === "/v1/accounts"), false);
  const upgraded = h.calls.find((x) => x.endpoint === "/v1/accounts/acct_prior/capabilities/card_payments");
  assert.ok(upgraded);
  assert.equal(upgraded.body.get("requested"), "true");
});

test("existing account with card payments capability does not rerequest it", async () => {
  const h = harness({ existingAccount: "acct_ok", cardPayments: "active" });
  assert.equal((await h.start()).status, 200);
  assert.equal(h.calls.some((x) => x.endpoint.includes("/capabilities/card_payments")), false);
});
