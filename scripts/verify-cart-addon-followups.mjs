#!/usr/bin/env node
/**
 * Replays the cart add-on SQL on a throwaway Postgres and asserts the
 * 2026-10-09 follow-ups to the add-on audit (PR #61):
 *
 *   1. cart_create_hold checks a variant line against the parent add-on's cap
 *      as well as the variant's, and a plain line counts variant sales and
 *      variant holds against the parent.
 *   2. addon_available / addon_variant_available subtract live cart holds.
 *   3. cart_complete_issuance binds each add-on purchase to an admission
 *      ticket issued on the same cart (order_addons.ticket_id).
 *   4. a redeemable add-on line with quantity > 1 issues one row and one QR
 *      per unit, because redeem_addon spends a whole row on one scan; a caller
 *      that sends one QR keeps the old single row.
 *   5. cart_release_expired_holds abandons a 'holding' cart once it has no
 *      live hold, and leaves 'paying' carts and carts with a live hold alone.
 *
 *   node scripts/verify-cart-addon-followups.mjs
 *   node scripts/verify-cart-addon-followups.mjs --baseline   # pre-fix SQL, must fail
 *   node scripts/verify-cart-addon-followups.mjs --allow-skip # no Postgres
 *
 * Without --allow-skip, a missing Postgres server is a failure, not a pass.
 */
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowSkip = process.argv.includes("--allow-skip");
const baseline = process.argv.includes("--baseline");
const MIGRATIONS = join(root, "apps/mobile/supabase/migrations");

function serverBin() {
  const candidates = [
    "",
    ...[18, 17, 16, 15, 14].flatMap((v) => [
      `/opt/homebrew/opt/postgresql@${v}/bin/`,
      `/usr/lib/postgresql/${v}/bin/`,
      `/usr/local/opt/postgresql@${v}/bin/`,
    ]),
  ];
  for (const prefix of candidates) {
    const versions = ["initdb", "postgres", "pg_ctl"].map((bin) => {
      const probe = spawnSync(`${prefix}${bin}`, ["--version"], { encoding: "utf8" });
      return probe.status === 0 ? (probe.stdout.match(/\s(\d+)\./)?.[1] ?? null) : null;
    });
    if (versions.every((v) => v !== null && v === versions[0])) return prefix;
  }
  return null;
}

const prefix = serverBin();
if (prefix === null) {
  const message =
    "verify-cart-addon-followups: no complete Postgres server install found. " +
    "The cart add-on assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-cart-addons-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-cart-addons-sock-"));
const run = (bin, args) =>
  execFileSync(`${prefix}${bin}`, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
process.on("exit", () => {
  try {
    run("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]);
  } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
});

run("initdb", ["-D", dataDir, "-U", "harness", "--auth=trust", "--no-sync"]);
run("pg_ctl", [
  "-D", dataDir,
  "-o", `-k ${socketDir} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,
  "-w", "-l", join(dataDir, "server.log"),
  "start",
]);

const pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 4 });
const sql = async (text, values) => (await pool.query(text, values)).rows;

// Only the columns the replayed functions read or write, with production
// names, defaults and the order_addons CHECKs.
await sql(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.ticket_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  quantity_total INTEGER,
  quantity_sold INTEGER DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'admission',
  status TEXT DEFAULT 'on_sale',
  tier_visibility TEXT DEFAULT 'public',
  unlock_code TEXT,
  unlocks_after_tier_id UUID,
  is_sold_out BOOLEAN DEFAULT false,
  price_cents INTEGER NOT NULL DEFAULT 2500
);
CREATE TABLE public.carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  event_id INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'usd',
  stripe_pi_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.ticket_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'on_sale',
  requires_tier_id UUID,
  price_cents INTEGER NOT NULL DEFAULT 500,
  currency TEXT DEFAULT 'usd',
  is_redeemable BOOLEAN NOT NULL DEFAULT true,
  quantity_total INTEGER,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  quantity_held INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE public.ticket_addon_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID NOT NULL REFERENCES public.ticket_addons(id),
  price_cents INTEGER,
  quantity_total INTEGER,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  quantity_held INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE public.cart_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES public.carts(id),
  category TEXT NOT NULL DEFAULT 'admission',
  tier_id UUID REFERENCES public.ticket_types(id),
  addon_id UUID REFERENCES public.ticket_addons(id),
  variant_id UUID REFERENCES public.ticket_addon_variants(id),
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE public.cart_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID,
  line_item_id UUID,
  tier_id UUID,
  addon_id UUID,
  variant_id UUID,
  qty INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  released BOOLEAN NOT NULL DEFAULT false,
  released_at TIMESTAMPTZ
);
CREATE TABLE public.ticket_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id UUID NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID,
  user_id TEXT,
  guest_email TEXT,
  status TEXT,
  stripe_payment_intent_id TEXT,
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL,
  ticket_type_id UUID,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  qr_token TEXT,
  qr_payload TEXT,
  stripe_payment_intent_id TEXT,
  purchase_amount_cents INTEGER,
  category TEXT,
  cart_id UUID,
  cart_line_item_id UUID,
  order_index INTEGER,
  order_count INTEGER,
  attendee_name TEXT,
  order_id UUID
);
CREATE TABLE public.order_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID,
  event_id INTEGER NOT NULL,
  addon_id UUID NOT NULL REFERENCES public.ticket_addons(id),
  variant_id UUID,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  cart_id UUID,
  cart_line_item_id UUID,
  user_id TEXT,
  guest_email TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER,
  refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unfulfilled'
    CHECK (status IN ('unfulfilled','fulfilled','redeemed','refunded')),
  qr_token TEXT,
  qr_payload TEXT,
  CONSTRAINT order_addons_owner CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
);
-- Stand-ins for the tier pricing helpers cart_create_hold calls.
CREATE FUNCTION public.ticket_type_current_price_cents(p_tier_id uuid) RETURNS integer
  LANGUAGE sql STABLE AS $$ SELECT price_cents FROM public.ticket_types WHERE id = p_tier_id $$;
CREATE FUNCTION public.ticket_type_available(p_tier_id uuid) RETURNS integer
  LANGUAGE sql STABLE AS $$ SELECT 1 $$;
`);

const read = (file) => readFileSync(join(MIGRATIONS, file), "utf8");
const fn = (file, name) => {
  const m = read(file).match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\([\\s\\S]*?(\\$[a-z_]*\\$)[\\s\\S]*?\\1;`, "i"),
  );
  assert.ok(m, `${file} no longer defines ${name}`);
  return m[0];
};

// Production lineage before the follow-ups.
await sql(fn("20260613145014_ticket_addons.sql", "addon_available"));
await sql(fn("20260613145014_ticket_addons.sql", "addon_variant_available"));
await sql(fn("20260806400100_cart_hold_addon_owned_ticket_gate.sql", "cart_create_hold"));
await sql(fn("20260922100000_free_ticket_orders_and_event_financials.sql", "cart_complete_issuance"));
await sql(fn("20260516150000_mixed_cart_checkout.sql", "cart_release_expired_holds"));
if (!baseline) {
  await sql(read("20261009100000_addon_capacity_counts_variants_and_holds.sql"));
  await sql(read("20261009100200_cart_issuance_addon_ticket_and_units.sql"));
  await sql(read("20261009100300_cart_cleanup_abandons_holdless_carts.sql"));
}

const failures = [];
// Each section reports on its own so --baseline shows every defect red, not
// only the first one.
async function section(name, body) {
  try {
    await body();
  } catch (error) {
    failures.push(name);
    console.log(`FAIL: ${name}: ${String(error.message).split("\n")[0]}`);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
const one = async (text, values) => (await sql(text, values))[0];
const addon = (total = null, extra = {}) =>
  one(
    `INSERT INTO ticket_addons (quantity_total, quantity_sold, is_redeemable, requires_tier_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [total, extra.sold ?? 0, extra.redeemable ?? true, extra.requiresTier ?? null],
  ).then((r) => r.id);
const variant = (addonId, total = null, sold = 0) =>
  one(
    `INSERT INTO ticket_addon_variants (addon_id, quantity_total, quantity_sold) VALUES ($1,$2,$3) RETURNING id`,
    [addonId, total, sold],
  ).then((r) => r.id);
const tier = () => one(`INSERT INTO ticket_types (event_id) VALUES (1) RETURNING id`).then((r) => r.id);
const cart = (user = "buyer", status = "draft") =>
  one(`INSERT INTO carts (user_id, status) VALUES ($1, $2) RETURNING id`, [user, status]).then((r) => r.id);
const line = (cartId, { tierId = null, addonId = null, variantId = null, quantity = 1 }) =>
  one(
    `INSERT INTO cart_line_items (cart_id, category, tier_id, addon_id, variant_id, quantity, unit_price_cents)
     VALUES ($1, $2, $3, $4, $5, $6, 500) RETURNING id`,
    [cartId, tierId ? "admission" : "addon", tierId, addonId, variantId, quantity],
  ).then((r) => r.id);
const hold = (cartId) => one(`SELECT cart_create_hold($1, 600, '[]'::jsonb) AS r`, [cartId]).then((r) => r.r);
const liveHold = (fields) =>
  sql(
    `INSERT INTO cart_holds (addon_id, variant_id, qty, expires_at) VALUES ($1, $2, $3, now() + interval '10 min')`,
    [fields.addonId, fields.variantId ?? null, fields.qty],
  );

// ── 1. parent cap binds variant lines; variant sales and holds bind the parent
await section('1. parent cap binds variant lines; variant sales and holds bind the parent', async () => {
  // Parent capped at 5, variant uncapped: 6 of the variant oversold the parent.
  const shirt = await addon(5);
  const medium = await variant(shirt, null);
  const c = await cart();
  await line(c, { addonId: shirt, variantId: medium, quantity: 6 });
  const r = await hold(c);
  assert.equal(r.ok, false, `variant line ignored the parent cap: ${JSON.stringify(r)}`);
  assert.equal(r.error, "addon_insufficient_capacity");
  assert.equal(r.available, 5);

  // Two variant lines of one parent in one cart: 3 + 3 > 5.
  const small = await variant(shirt, null);
  const c2 = await cart();
  await line(c2, { addonId: shirt, variantId: medium, quantity: 3 });
  await line(c2, { addonId: shirt, variantId: small, quantity: 3 });
  assert.equal((await hold(c2)).ok, false, "two variant lines together oversold the parent");
  console.log("-. OK: a variant line is checked against the parent add-on's cap");

  // Parent capped at 5: a variant sold 2, another cart holds 2 of a variant.
  // A plain line of 2 fits (1 left over), a plain line of 2 more does not.
  const coat = await addon(5);
  const v = await variant(coat, null, 2);
  await liveHold({ addonId: coat, variantId: v, qty: 2 });
  const c3 = await cart();
  await line(c3, { addonId: coat, quantity: 2 });
  const over = await hold(c3);
  assert.equal(over.ok, false, `variant sales and holds were not counted: ${JSON.stringify(over)}`);
  assert.equal(over.available, 1);
  console.log("-. OK: a plain line counts variant sales and variant holds against the parent");

  // A fitting cart still holds, and the variant's own cap still applies.
  const capped = await addon(null);
  const tiny = await variant(capped, 1);
  const c4 = await cart();
  await line(c4, { addonId: capped, variantId: tiny, quantity: 1 });
  assert.equal((await hold(c4)).ok, true);
  const c5 = await cart();
  await line(c5, { addonId: capped, variantId: tiny, quantity: 1 });
  assert.equal((await hold(c5)).ok, false, "the variant's own cap stopped binding");
  console.log("-. OK: the variant's own cap and live holds still bind");
});

// ── 2. addon_available counts live holds; dead holds do not count ───────────
await section('2. addon_available counts live holds; dead holds do not count', async () => {
  const drink = await addon(10, { sold: 1 });
  await liveHold({ addonId: drink, qty: 2 });
  await sql(
    `INSERT INTO cart_holds (addon_id, qty, expires_at, released) VALUES ($1, 9, now() + interval '10 min', true)`,
    [drink],
  );
  await sql(`INSERT INTO cart_holds (addon_id, qty, expires_at) VALUES ($1, 9, now() - interval '1 min')`, [drink]);
  const v = await variant(drink, 3);
  await liveHold({ addonId: drink, variantId: v, qty: 1 });
  const { a } = await one(`SELECT addon_available($1) AS a`, [drink]);
  assert.equal(a, 6, "10 - 1 sold - 2 held - 1 variant hold");
  const { b } = await one(`SELECT addon_variant_available($1) AS b`, [v]);
  assert.equal(b, 2, "variant: 3 - 1 own hold");
  const unlimited = await addon(null);
  assert.equal((await one(`SELECT addon_available($1) AS a`, [unlimited])).a, 2147483647);
  console.log("-. OK: addon_available / addon_variant_available subtract live cart holds only");
});

// ── 3 + 4. issuance binds add-ons to a ticket and splits redeemable units ────
const issue = async (cartId, ticketRows, addonRows) =>
  (await one(`SELECT cart_complete_issuance($1, 'pi_1', $2::jsonb, $3::jsonb) AS r`,
    [cartId, JSON.stringify(ticketRows), JSON.stringify(addonRows)])).r;
const ticketRows = (lineId, n) =>
  Array.from({ length: n }, (_, i) => ({
    ticket_id: crypto.randomUUID(), line_item_id: lineId, qr_token: `t${i}-${lineId}`, qr_payload: `p${i}`,
  }));
const qrRows = (lineId, n) =>
  Array.from({ length: n }, (_, i) => ({ line_item_id: lineId, qr_token: `a${i}-${lineId}`, qr_payload: `ap${i}` }));
const purchases = (cartId) =>
  sql(`SELECT ticket_id, quantity, qr_token FROM order_addons WHERE cart_id = $1 ORDER BY qr_token`, [cartId]);

let issued = null;
await section('3. issuance binds each add-on purchase to a ticket on the same cart', async () => {
  const vip = await tier();
  const ga = await tier();
  const drink = await addon(null, { requiresTier: vip });
  const c = await cart();
  const gaLine = await line(c, { tierId: ga, quantity: 1 });
  const vipLine = await line(c, { tierId: vip, quantity: 1 });
  const drinkLine = await line(c, { addonId: drink, quantity: 3 });
  assert.equal((await hold(c)).ok, true);
  const r = await issue(c, [...ticketRows(gaLine, 1), ...ticketRows(vipLine, 1)], qrRows(drinkLine, 3));
  assert.equal(r.ok, true, JSON.stringify(r));

  issued = { c, drink, vipLine };
  const rows = await purchases(c);
  const vipTicket = (await one(`SELECT id FROM tickets WHERE cart_line_item_id = $1`, [vipLine])).id;
  assert.ok(rows.every((row) => row.ticket_id === vipTicket),
    `add-on not bound to the required-tier ticket: ${JSON.stringify(rows)}`);
  console.log("-. OK: an add-on purchase is bound to the cart's ticket of the tier it requires");
});
await section('4. a redeemable line issues one row and one QR per unit', async () => {
  assert.ok(issued, "section 3 did not issue the cart");
  const { c, drink } = issued;
  const rows = await purchases(c);
  assert.equal(rows.length, 3, `one row per redeemable unit expected, got ${JSON.stringify(rows)}`);
  assert.ok(rows.every((row) => row.quantity === 1));
  assert.equal(new Set(rows.map((row) => row.qr_token)).size, 3, "each unit needs its own QR");
  const { sold } = await one(`SELECT quantity_sold AS sold FROM ticket_addons WHERE id = $1`, [drink]);
  assert.equal(sold, 3, "stock moves by the line quantity once");
  console.log("-. OK: a redeemable line of 3 issues 3 rows with 3 QRs");
});
await section('4b. single-QR fallback, non-redeemable and add-on-only carts', async () => {
  // An older edge deploy sends one QR for the line: keep the single row.
  const ga = await tier();
  const drink = await addon(null);
  const c = await cart();
  const gaLine = await line(c, { tierId: ga, quantity: 1 });
  const drinkLine = await line(c, { addonId: drink, quantity: 2 });
  assert.equal((await hold(c)).ok, true);
  assert.equal((await issue(c, ticketRows(gaLine, 1), qrRows(drinkLine, 1))).ok, true);
  const rows = await purchases(c);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
  console.log("-. OK: one prepared QR for a multi-unit line still issues the old single row");

  // Non-redeemable and add-on-only carts: one row, no ticket on the cart.
  const merch = await addon(null, { redeemable: false });
  const c2 = await cart();
  const merchLine = await line(c2, { addonId: merch, quantity: 2 });
  assert.equal((await hold(c2)).ok, true);
  assert.equal((await issue(c2, [], [])).ok, true);
  const solo = await purchases(c2);
  assert.equal(solo.length, 1);
  assert.equal(solo[0].ticket_id, null, "an add-on-only cart has no ticket to bind to");
  assert.equal(solo[0].qr_token, null);
  void merchLine;
  console.log("-. OK: non-redeemable lines stay one row; add-on-only carts stay unbound");
});

// ── 5. cleanup abandons holding carts with no live hold ──────────────────────
await section('5. cleanup abandons holding carts with no live hold', async () => {
  const stale = await cart("s", "holding");
  await sql(`INSERT INTO cart_holds (cart_id, addon_id, qty, expires_at, released) VALUES ($1, $2, 1, now() - interval '1 min', true)`,
    [stale, await addon()]);
  const expiring = await cart("e", "holding");
  await sql(`INSERT INTO cart_holds (cart_id, addon_id, qty, expires_at) VALUES ($1, $2, 1, now() - interval '1 min')`,
    [expiring, await addon()]);
  const live = await cart("l", "holding");
  await sql(`INSERT INTO cart_holds (cart_id, addon_id, qty, expires_at) VALUES ($1, $2, 1, now() + interval '5 min')`,
    [live, await addon()]);
  const paying = await cart("p", "paying");
  const draft = await cart("d", "draft");

  const result = (await one(`SELECT cart_release_expired_holds() AS r`)).r;
  const status = async (id) => (await one(`SELECT status FROM carts WHERE id = $1`, [id])).status;
  assert.equal(await status(stale), "abandoned", `holding cart with only released holds kept: ${JSON.stringify(result)}`);
  assert.equal(await status(expiring), "abandoned", "holding cart whose last hold expired this tick kept");
  assert.equal(await status(live), "holding");
  assert.equal(await status(paying), "paying");
  assert.equal(await status(draft), "draft");
  console.log("-. OK: cleanup abandons holding carts with no live hold, keeps live, paying and draft carts");

  // A cart being re-held is locked by cart_create_hold. The sweep must skip
  // it, not wait and then abandon it on a stale view of its holds.
  const rehold = await cart("r", "holding");
  await sql(`INSERT INTO cart_holds (cart_id, addon_id, qty, expires_at, released) VALUES ($1, $2, 1, now() - interval '1 min', true)`,
    [rehold, await addon()]);
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(`SELECT 1 FROM carts WHERE id = $1 FOR UPDATE`, [rehold]);
    await holder.query(`INSERT INTO cart_holds (cart_id, addon_id, qty, expires_at) VALUES ($1, $2, 1, now() + interval '10 min')`,
      [rehold, await addon()]);
    const sweep = await Promise.race([
      one(`SELECT cart_release_expired_holds() AS r`).then(() => "done"),
      new Promise((r) => setTimeout(() => r("blocked"), 2000)),
    ]);
    assert.equal(sweep, "done", "the sweep waited on a cart lock instead of skipping it");
    await holder.query("COMMIT");
  } finally {
    holder.release();
  }
  assert.equal(await status(rehold), "holding", "a cart re-held during the sweep was abandoned");
  console.log("-. OK: the sweep skips a cart locked by a re-hold");
});

await pool.end();
if (failures.length) {
  console.error(`verify-cart-addon-followups: ${failures.length} section(s) failed`);
  process.exit(1);
}
console.log("verify-cart-addon-followups: all assertions passed");
