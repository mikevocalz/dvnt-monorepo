#!/usr/bin/env node
/**
 * Runs recompute_event_financials against a real Postgres to prove add-on
 * revenue (public.order_addons) reaches event_financials. Before
 * 20261009020000 the function summed tickets.purchase_amount_cents only, so a
 * cart that sold a $25 ticket and a $10 coat check reported $25 gross while
 * orders.stripe_fee_cents covered the full $35 charge.
 *
 * Boots a throwaway socket-only cluster (same approach as
 * verify-event-consolidation.mjs), builds only the tables the function reads,
 * replays the real tickets trigger section of 20260922100000, the real
 * 20261006223500 ledger migration and the add-on migration, then asserts:
 *
 *   1. one $25 ticket + one $10 add-on row: gross 3500, fee counts 2 units.
 *   2. a partial add-on refund (refunded_amount_cents) leaves the rest.
 *   3. status 'refunded' drops the add-on: gross back to 2500.
 *   4. multi-unit add-on rows count unit_price_cents * quantity.
 *   5. moving an add-on row between events recomputes both; delete recomputes.
 *   6. the order_addons trigger functions are not executable by anon.
 *
 *   node scripts/verify-event-financials-addons.mjs
 *   node scripts/verify-event-financials-addons.mjs --baseline   # skip the fix (expect failure)
 *   node scripts/verify-event-financials-addons.mjs --allow-skip # no Postgres
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
const FIX = "20261009020000_event_financials_addon_revenue.sql";

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
    "verify-event-financials-addons: no complete Postgres server install found. " +
    "The financials assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-financials-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-financials-sock-"));
const run = (bin, args) =>
  execFileSync(`${prefix}${bin}`, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let pool;
function teardown() {
  try {
    run("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]);
  } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
process.on("exit", teardown);

run("initdb", ["-D", dataDir, "-U", "harness", "--auth=trust", "--no-sync"]);
run("pg_ctl", [
  "-D", dataDir,
  "-o", `-k ${socketDir} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,
  "-w", "-l", join(dataDir, "server.log"),
  "start",
]);

pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 4 });
const sql = async (text, values) => (await pool.query(text, values)).rows;

// Production column names for what recompute_event_financials and the
// migrations under test read. order_addons matches 20260613000100.
await sql(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.events (id SERIAL PRIMARY KEY);
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER REFERENCES public.events(id),
  status TEXT NOT NULL DEFAULT 'active',
  purchase_amount_cents INTEGER
);
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER REFERENCES public.events(id),
  type TEXT,
  status TEXT,
  paid_at TIMESTAMPTZ
);
CREATE TABLE public.event_financials (
  event_id integer PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  gross_cents integer DEFAULT 0,
  refunds_cents integer DEFAULT 0,
  dvnt_fee_cents integer DEFAULT 0,
  stripe_fee_cents integer DEFAULT 0,
  net_cents integer DEFAULT 0,
  calculated_at timestamptz
);
CREATE TABLE public.order_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  addon_id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id TEXT DEFAULT 'buyer',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unfulfilled'
    CHECK (status IN ('unfulfilled','fulfilled','redeemed','refunded'))
);
`);

const read = (file) => readFileSync(join(MIGRATIONS, file), "utf8");
// Only section 7 of 20260922100000 (the financials function and the tickets
// triggers); sections 1-6 rewrite issuance RPCs and backfill tables this
// fixture does not model.
const section7 = read("20260922100000_free_ticket_orders_and_event_financials.sql").match(
  /\n-- ── 7\. Live event_financials[\s\S]*$/,
)?.[0];
assert.ok(section7, "20260922100000 no longer has its section 7 marker");
await sql(section7);
await sql(read("20261006223500_stripe_processing_fee_ledger.sql"));
if (!baseline) await sql(read(FIX));
console.log(`0. OK: fixture, 20260922100000 section 7, 20261006223500${baseline ? "" : ` and ${FIX}`} applied`);

// ── helpers ──────────────────────────────────────────────────────────────────
const event = async () => (await sql(`INSERT INTO events DEFAULT VALUES RETURNING id`))[0].id;
const ticket = (eventId, cents, status = "active") =>
  sql(`INSERT INTO tickets (event_id, purchase_amount_cents, status) VALUES ($1,$2,$3)`, [eventId, cents, status]);
const addon = async (eventId, unit, qty = 1) =>
  (
    await sql(
      `INSERT INTO order_addons (event_id, unit_price_cents, quantity) VALUES ($1,$2,$3) RETURNING id`,
      [eventId, unit, qty],
    )
  )[0].id;
const fin = async (eventId) =>
  (await sql(`SELECT gross_cents, refunds_cents, dvnt_fee_cents, net_cents FROM event_financials WHERE event_id = $1`, [eventId]))[0];
// Organizer fee policy: 2.5% of gross + $1 per kept unit (tickets and add-on
// units, matching cart-checkout's computeFeesWithMode quantity).
const expectFin = async (eventId, gross, refunds, units, label) => {
  const row = await fin(eventId);
  const fee = Math.round(gross * 0.025) + 100 * units;
  assert.deepStrictEqual(
    row,
    { gross_cents: gross, refunds_cents: refunds, dvnt_fee_cents: fee, net_cents: Math.max(0, gross - fee) },
    label,
  );
};

let failed = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`OK: ${label}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${label}\n  ${err.message.split("\n").join("\n  ")}`);
  }
};

// 1-3. The brief's case, driven only by row writes (no manual recompute).
const e1 = await event();
await ticket(e1, 2500);
const coat = await addon(e1, 1000);
await check("1. $25 ticket + $10 coat check: gross 3500, fee counts 2 units", () =>
  expectFin(e1, 3500, 0, 2, "ticket + add-on"),
);

await sql(`UPDATE order_addons SET refunded_amount_cents = 400 WHERE id = $1`, [coat]);
await check("2. partial add-on refund of $4 leaves $6 in gross and $4 in refunds", () =>
  expectFin(e1, 3100, 400, 2, "partial refund"),
);

await sql(`UPDATE order_addons SET status = 'refunded', refunded_amount_cents = 1000 WHERE id = $1`, [coat]);
await check("3. refunding the add-on row brings gross back to 2500", () =>
  expectFin(e1, 2500, 1000, 1, "full refund"),
);

// 3b. A refunded row whose amount was never stamped still refunds the line.
const e1b = await event();
await ticket(e1b, 2500);
const bare = await addon(e1b, 1000);
await sql(`UPDATE order_addons SET status = 'refunded' WHERE id = $1`, [bare]);
await check("3b. status 'refunded' with refunded_amount_cents 0 counts the full line as refunded", () =>
  expectFin(e1b, 2500, 1000, 1, "status-only refund"),
);

// 4. Multi-unit rows.
const e2 = await event();
await ticket(e2, 2500);
await ticket(e2, 2500, "refunded");
await addon(e2, 500, 3);
await check("4. 3 x $5 add-on row counts 1500 and 3 units; refunded ticket stays out", () =>
  expectFin(e2, 4000, 2500, 4, "multi-unit"),
);

// 5. Move and delete.
const e3 = await event();
const e4 = await event();
await ticket(e3, 2000);
await ticket(e4, 2000);
const moving = await addon(e3, 1000);
await sql(`UPDATE order_addons SET event_id = $1 WHERE id = $2`, [e4, moving]);
await check("5a. moving an add-on row recomputes the source event", () =>
  expectFin(e3, 2000, 0, 1, "source after move"),
);
await check("5b. moving an add-on row recomputes the destination event", () =>
  expectFin(e4, 3000, 0, 2, "destination after move"),
);
await sql(`DELETE FROM order_addons WHERE id = $1`, [moving]);
await check("5c. deleting an add-on row recomputes its event", () =>
  expectFin(e4, 2000, 0, 1, "after delete"),
);

// 6. Grants.
await check("6. order_addons refresh functions and recompute are not executable by anon/authenticated", async () => {
  const rows = await sql(`
    SELECT p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('recompute_event_financials',
                        'order_addons_financials_refresh_ins',
                        'order_addons_financials_refresh_upd',
                        'order_addons_financials_refresh_del')
    ORDER BY 1`);
  assert.equal(rows.length, 4, `expected 4 functions, found ${rows.map((r) => r.proname).join(", ")}`);
  for (const r of rows) {
    assert.deepStrictEqual({ anon: r.anon, authed: r.authed, service: r.service },
      { anon: false, authed: false, service: true }, r.proname);
  }
});

await pool.end();
pool = null;
if (failed > 0) {
  console.error(`verify-event-financials-addons: ${failed} assertion group(s) failed`);
  process.exit(1);
}
console.log("verify-event-financials-addons: all assertions passed");
