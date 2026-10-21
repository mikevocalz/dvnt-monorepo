#!/usr/bin/env node
/**
 * Real PostgreSQL regression tests for free guest checkout. No production
 * credentials, network database, Docker service, or live migration is used.
 *
 * Starts a disposable socket-only cluster, replays the production legacy hold
 * RPC and atomic guest issuance migration, and drives independent connections.
 * Concurrency assertions observe pg_locks / pg_blocking_pids before allowing
 * the winning transaction to commit; fixed sleeps are not evidence of a race.
 *
 *   node scripts/verify-guest-free-issuance.mjs
 *   PG_BIN=/path/to/postgres/bin node scripts/verify-guest-free-issuance.mjs
 *   node scripts/verify-guest-free-issuance.mjs --allow-skip
 *
 * Missing PostgreSQL is an error unless --allow-skip explicitly records an
 * unverified run. Startup, SQL, permissions, and concurrency failures never skip.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = join(root, "apps/mobile/supabase/migrations");
const migrationName = "20261021142135_guest_free_checkout_atomic.sql";
const functionSignature = "public.guest_free_checkout_atomic(uuid,jsonb,jsonb)";

function serverBin() {
  const candidates = [
    ...(process.env.PG_BIN ? [process.env.PG_BIN] : []),
    "",
    ...[18, 17, 16, 15, 14].flatMap((version) => [
      `/usr/lib/postgresql/${version}/bin`,
      `/opt/homebrew/opt/postgresql@${version}/bin`,
      `/usr/local/opt/postgresql@${version}/bin`,
    ]),
  ];
  for (const prefix of candidates) {
    const versions = ["initdb", "postgres", "pg_ctl"].map((bin) => {
      const result = spawnSync(prefix ? join(prefix, bin) : bin, ["--version"], { encoding: "utf8" });
      return result.status === 0 ? result.stdout.match(/\s(\d+)\./)?.[1] : null;
    });
    if (versions.every((version) => version && version === versions[0])) return prefix;
  }
  return null;
}

const prefix = serverBin();
if (prefix === null) {
  const message = "verify-guest-free-issuance: no complete PostgreSQL server installation found; assertions DID NOT run.";
  if (process.argv.includes("--allow-skip")) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall PostgreSQL or set PG_BIN to its bin directory.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-guest-free-data-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-guest-free-sock-"));
const run = (bin, args) => execFileSync(prefix ? join(prefix, bin) : bin, args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
let stopped = false;
function teardown() {
  if (stopped) return;
  stopped = true;
  try { run("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
process.once("exit", teardown);
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => process.exit(1));
try {
  run("initdb", ["-D", dataDir, "-U", "harness", "--auth=trust", "--no-sync", "--locale=C", "-E", "UTF8"]);
  run("pg_ctl", ["-D", dataDir,
    "-o", `-k ${socketDir} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,
    "-w", "-l", join(dataDir, "server.log"), "start"]);
} catch (error) {
  const log = join(dataDir, "server.log");
  console.error("Disposable PostgreSQL startup failed. Assertions DID NOT run.");
  if (existsSync(log)) console.error(readFileSync(log, "utf8"));
  throw error;
}

const pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 8,
  options: "-c statement_timeout=15000 -c lock_timeout=12000" });
const sql = async (text, values, client = pool) => (await client.query(text, values)).rows;
const read = (name) => readFileSync(join(migrations, name), "utf8");
let passed = 0;
async function test(name, body) {
  await body();
  passed++;
  console.log(`OK ${passed}: ${name}`);
}

try {
  // Minimal production-shaped fixture. In particular, ticket_holds deliberately
  // has the deployed CHECK: 'released' is NOT a valid legacy-hold state.
  await sql(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE TABLE public.events (
      id SERIAL PRIMARY KEY, host_id text, total_attendees integer DEFAULT 0,
      max_attendees numeric, title text DEFAULT 'Harness event'
    );
    CREATE TABLE public.ticket_types (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id integer NOT NULL REFERENCES events(id),
      quantity_total integer, quantity_sold integer DEFAULT 0,
      price_cents integer NOT NULL DEFAULT 0, max_per_user integer,
      is_active boolean DEFAULT true, is_sold_out boolean DEFAULT false, status text DEFAULT 'on_sale',
      tier_visibility text DEFAULT 'public', sale_start timestamptz, sale_end timestamptz
    );
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text, guest_email text,
      type text NOT NULL CHECK (type IN ('event_ticket','promotion','sneaky_access')),
      status text DEFAULT 'created' CHECK (status IN ('created','payment_pending','payment_failed','paid','partially_refunded','refunded','disputed')),
      currency text DEFAULT 'usd', subtotal_cents integer NOT NULL DEFAULT 0,
      platform_fee_cents integer DEFAULT 0, processing_fee_cents integer DEFAULT 0,
      tax_cents integer DEFAULT 0, total_cents integer NOT NULL DEFAULT 0,
      event_id integer REFERENCES events(id), quantity integer,
      paid_at timestamptz, created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(), idempotency_key text UNIQUE,
      stripe_payment_intent_id text, stripe_checkout_session_id text,
      promo_code_id uuid, discount_cents integer,
      promoter_policy_version text, promoter_original_amount_cents integer,
      promoter_customer_discount_bps integer, promoter_discount_amount_cents integer,
      promoter_discounted_amount_cents integer, promoter_id uuid, promoter_code text,
      promoter_commission_bps integer, promoter_commission_amount_cents integer,
      CONSTRAINT orders_user_or_guest CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
    );
    CREATE TABLE public.tickets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id integer NOT NULL REFERENCES events(id),
      ticket_type_id uuid REFERENCES ticket_types(id), user_id text,
      guest_email text, guest_name text, attendee_name text,
      guest_lookup_token text UNIQUE,
      status text DEFAULT 'active' CHECK (status IN ('active','scanned','refunded','void','transfer_pending')),
      qr_token text UNIQUE NOT NULL, qr_payload text, purchase_amount_cents integer,
      order_id uuid REFERENCES orders(id),
      order_index integer CHECK (order_index IS NULL OR order_index >= 1),
      order_count integer CHECK (order_count IS NULL OR order_count >= 1),
      created_at timestamptz DEFAULT now(),
      CONSTRAINT tickets_user_or_guest CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
    );
    CREATE TABLE public.cart_holds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tier_id uuid, addon_id uuid,
      variant_id uuid, qty integer NOT NULL, released boolean NOT NULL DEFAULT false,
      expires_at timestamptz NOT NULL
    );
    CREATE TABLE public.ticket_holds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text,
      ticket_type_id uuid NOT NULL, event_id integer NOT NULL,
      quantity integer NOT NULL DEFAULT 1, payment_intent_id text,
      status text NOT NULL DEFAULT 'active'
        CONSTRAINT ticket_holds_status_check CHECK (status IN ('active','converted','expired')),
      expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT now(),
      guest_email text, hold_kind text
    );
    CREATE TABLE public.order_timeline (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      type text NOT NULL, label text NOT NULL, created_at timestamptz DEFAULT now()
    );
  `);
  await sql(read("20260915172318_atomic_legacy_ticket_hold.sql"));
  await sql(read(migrationName));

  const event = async () => (await sql("INSERT INTO events DEFAULT VALUES RETURNING id"))[0].id;
  const tier = async (eventId, total = null, sold = 0) => (await sql(
    "INSERT INTO ticket_types(event_id,quantity_total,quantity_sold) VALUES($1,$2,$3) RETURNING id",
    [eventId, total, sold]))[0].id;
  function selection(eventId, tierId, quantity = 1, email = `${randomUUID()}@example.test`, key = randomUUID()) {
    return {
      tierId,
      order: { event_id: eventId, guest_email: email, user_id: null, type: "event_ticket",
        status: "paid", quantity, subtotal_cents: 0, total_cents: 0, currency: "usd",
        expected_unit_price_cents: 0,
        paid_at: new Date().toISOString(), ...(key ? { idempotency_key: key } : {}) },
      rows: Array.from({ length: quantity }, (_, index) => ({ id: randomUUID(),
        event_id: eventId, ticket_type_id: tierId, user_id: null, guest_email: email,
        guest_name: "Guest Buyer", attendee_name: `Guest ${index + 1}`,
        guest_lookup_token: randomUUID(), status: "active", qr_token: randomUUID(),
        qr_payload: `signed-test-payload-${randomUUID()}`, purchase_amount_cents: 0,
        order_index: index + 1, order_count: quantity })),
    };
  }
  const issue = async (request, client = pool) => (await sql(
    "SELECT public.guest_free_checkout_atomic($1::uuid,$2::jsonb,$3::jsonb) AS result",
    [request.tierId, JSON.stringify(request.rows), JSON.stringify(request.order)], client))[0].result;
  const hold = async (tierId, client = pool) => (await sql(
    "SELECT public.ticket_hold_create_atomic($1::uuid,1) AS result", [tierId], client))[0].result;
  const snapshot = async (eventId) => (await sql(`SELECT jsonb_build_object(
    'tiers', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM ticket_types t WHERE event_id=$1),
    'orders', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]'::jsonb) FROM orders o WHERE event_id=$1),
    'tickets', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM tickets t WHERE event_id=$1),
    'holds', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]'::jsonb) FROM ticket_holds h WHERE event_id=$1),
    'timeline', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM order_timeline t JOIN orders o ON o.id=t.order_id WHERE o.event_id=$1)
  ) AS value`, [eventId]))[0].value;
  const inventory = async (tierId) => (await sql(`SELECT quantity_sold,
    (SELECT count(*)::int FROM tickets WHERE ticket_type_id=$1) AS tickets,
    (SELECT count(*)::int FROM ticket_holds WHERE ticket_type_id=$1 AND status='active') AS active_holds,
    (SELECT count(*)::int FROM ticket_holds WHERE ticket_type_id=$1 AND status='converted') AS converted_holds
    FROM ticket_types WHERE id=$1`, [tierId]))[0];
  const successful = (result) => assert.equal(result.ok, true, JSON.stringify(result));
  const rejected = (result, error) => {
    assert.equal(result.ok, false, JSON.stringify(result));
    if (error) assert.equal(result.error, error, JSON.stringify(result));
  };

  // A deterministic barrier: the second backend must actually have an
  // ungranted lock and name the first backend in pg_blocking_pids. It cannot
  // pass because the scheduler simply had not started the second query yet.
  async function waitForBlocked(blockerPid, waiterPid, pending) {
    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      const [state] = await sql(`SELECT
        $1::int = ANY(pg_blocking_pids($2::int)) AS blocked_by_first,
        EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2 AND NOT granted) AS ungranted,
        (SELECT wait_event_type FROM pg_stat_activity WHERE pid=$2) AS wait_event_type`,
      [blockerPid, waiterPid]);
      if (state.blocked_by_first && state.ungranted && state.wait_event_type === "Lock") return;
      assert.equal(pending.settled, false, "competing request completed before the first transaction committed");
      await nextTurn();
    }
    assert.fail(`backend ${waiterPid} never blocked on transaction ${blockerPid}`);
  }
  async function race(firstCall, secondCall) {
    const first = await pool.connect();
    const second = await pool.connect();
    let pending;
    try {
      await first.query("BEGIN");
      const firstResult = await firstCall(first);
      successful(firstResult);
      const firstPid = (await sql("SELECT pg_backend_pid() AS pid", [], first))[0].pid;
      const secondPid = (await sql("SELECT pg_backend_pid() AS pid", [], second))[0].pid;
      pending = { settled: false };
      pending.promise = secondCall(second).then(
        (result) => { pending.settled = true; return { result }; },
        (error) => { pending.settled = true; return { error }; },
      );
      await waitForBlocked(firstPid, secondPid, pending);
      await first.query("COMMIT");
      const other = await pending.promise;
      if (other.error) throw other.error;
      return [firstResult, other.result];
    } finally {
      await first.query("ROLLBACK");
      if (pending) await pending.promise;
      await second.query("ROLLBACK");
      first.release();
      second.release();
    }
  }

  // Eligibility is rechecked by the actual transaction, not just the edge.
  for (const [label, patch] of [
    ["inactive", "is_active=false"], ["draft", "status='draft'"],
    ["scheduled", "status='scheduled'"], ["paused", "status='paused'"],
    ["ended", "status='ended'"], ["sold-out status", "status='sold_out'"],
    ["unknown status", "status='unknown'"], ["empty status", "status=''"],
    ["legacy sold-out flag", "is_sold_out=true"], ["hidden", "tier_visibility='hidden'"],
    ["before opening", "sale_start=clock_timestamp()+interval '1 day'"],
    ["closed sale", "sale_end=clock_timestamp()"],
    ["past closing", "sale_end=clock_timestamp()-interval '1 day'"],
    ["empty window", "sale_start=now(),sale_end=now()"],
    ["reversed window", "sale_start=now()+interval '1 day',sale_end=now()-interval '1 day'"],
    ["infinite opening", "sale_start='-infinity'"],
    ["infinite closing", "sale_end='infinity'"],
  ]) {
    await test(`sale eligibility: ${label} rejects without any bookkeeping writes`, async () => {
      const e = await event(); const t = await tier(e, 10);
      await sql(`UPDATE ticket_types SET ${patch} WHERE id=$1`, [t]);
      const before = await snapshot(e);
      rejected(await issue(selection(e,t)), "tier_unavailable");
      assert.deepEqual(await snapshot(e), before);
    });
  }
  for (const [label, patch] of [
    ["open window", "sale_start=now()-interval '1 day',sale_end=now()+interval '1 day'"],
    ["opening boundary", "sale_start=clock_timestamp()"],
    ["null legacy flags", "is_active=NULL,is_sold_out=NULL,status=NULL,sale_start=NULL,sale_end=NULL"],
  ]) {
    await test(`sale eligibility: ${label} preserves free issuance`, async () => {
      const e = await event(); const t = await tier(e, 10);
      await sql(`UPDATE ticket_types SET ${patch} WHERE id=$1`, [t]);
      successful(await issue(selection(e,t)));
      assert.deepEqual(await inventory(t), { quantity_sold: 1, tickets: 1, active_holds: 0, converted_holds: 1 });
    });
  }
  for (const patch of ["status='paused'", "is_sold_out=true"]) {
    await test(`sale eligibility rechecks ${patch} committed while waiting for the tier lock`, async () => {
      const e = await event(); const t = await tier(e, 10);
      const [, result] = await race(async (client) => {
        await sql(`UPDATE ticket_types SET ${patch} WHERE id=$1`, [t], client);
        return { ok: true };
      }, (client) => issue(selection(e,t), client));
      rejected(result, "tier_unavailable");
      assert.deepEqual(await inventory(t), { quantity_sold: 0, tickets: 0, active_holds: 0, converted_holds: 0 });
      assert.equal((await snapshot(e)).orders.length, 0);
    });
  }
  await test("a sale closing during the tier-lock wait rejects using wall time, not transaction-start time", async () => {
    const e = await event(); const t = await tier(e, 10);
    const control = await pool.connect(); const guest = await pool.connect();
    let pending;
    try {
      await control.query("BEGIN");
      await sql("SELECT id FROM ticket_types WHERE id=$1 FOR UPDATE", [t], control);
      await guest.query("BEGIN");
      const controlPid = (await sql("SELECT pg_backend_pid() AS pid", [], control))[0].pid;
      const guestPid = (await sql("SELECT pg_backend_pid() AS pid", [], guest))[0].pid;
      pending = { settled: false };
      pending.promise = issue(selection(e,t),guest).then(
        result => { pending.settled=true; return {result}; },
        error => { pending.settled=true; return {error}; });
      await waitForBlocked(controlPid,guestPid,pending);
      // End the sale only AFTER the lock barrier proves this transaction is
      // waiting. The observed timestamps prove stale now() would admit it,
      // without depending on a fixed delay or runner speed.
      await sql("UPDATE ticket_types SET sale_end=clock_timestamp() WHERE id=$1", [t], control);
      const [timing] = await sql(`SELECT clock_timestamp() >= sale_end AS ended,
        (SELECT xact_start FROM pg_stat_activity WHERE pid=$2) < sale_end AS began_before_end
        FROM ticket_types WHERE id=$1`, [t,guestPid], control);
      assert.equal(timing.ended, true);
      assert.equal(timing.began_before_end, true);
      await control.query("COMMIT");
      const result = await pending.promise;
      if (result.error) throw result.error;
      rejected(result.result, "tier_unavailable");
      assert.deepEqual(await inventory(t), { quantity_sold: 0, tickets: 0, active_holds: 0, converted_holds: 0 });
    } finally {
      await control.query("ROLLBACK");
      if (pending) await pending.promise;
      await guest.query("ROLLBACK");
      control.release(); guest.release();
    }
  });
  await test("a completed same-key free order remains a no-write replay after its sale is closed", async () => {
    const e = await event(); const t = await tier(e, 10); const request = selection(e,t);
    const first = await issue(request); successful(first);
    await sql("UPDATE ticket_types SET status='ended',is_sold_out=true,sale_end=clock_timestamp() WHERE id=$1", [t]);
    const before = await snapshot(e);
    const replay = await issue(request); successful(replay);
    assert.equal(replay.idempotent, true); assert.equal(replay.order_id, first.order_id);
    assert.deepEqual(await snapshot(e), before);
  });

  await test("the pre-fix split-write schedule reproduces oversell and a lost sold increment", async () => {
    // Mirror the old edge flow using separate committed statements: reserve,
    // insert order/tickets, convert hold, then write a stale absolute counter.
    // Stop buyer A after conversion. Buyer B can reserve that same final seat
    // before A publishes sold inventory. The patched RPC tests below must not
    // admit this schedule because its tier lock spans all of those writes.
    const e = await event(); const t = await tier(e, 1);
    const a = await pool.connect(); const b = await pool.connect();
    try {
      const aSold = (await sql("SELECT quantity_sold FROM ticket_types WHERE id=$1", [t], a))[0].quantity_sold;
      const bSold = (await sql("SELECT quantity_sold FROM ticket_types WHERE id=$1", [t], b))[0].quantity_sold;
      const oldWrite = async (client, label, held) => {
        const [order] = await sql(`INSERT INTO orders(event_id,guest_email,type,status,quantity,total_cents)
          VALUES($1,$2,'event_ticket','paid',1,0) RETURNING id`, [e,`${label}@example.test`],client);
        await sql(`INSERT INTO tickets(event_id,ticket_type_id,guest_email,order_id,qr_token)
          VALUES($1,$2,$3,$4,$5)`, [e,t,`${label}@example.test`,order.id,randomUUID()],client);
        await sql("UPDATE ticket_holds SET status='converted' WHERE id=$1", [held.holdId],client);
      };
      const aHold = await hold(t,a); successful(aHold);
      await oldWrite(a,"baseline-a",aHold);
      const bHold = await hold(t,b); successful(bHold);
      await oldWrite(b,"baseline-b",bHold);
      await sql("UPDATE ticket_types SET quantity_sold=$2 WHERE id=$1", [t,bSold+1],b);
      await sql("UPDATE ticket_types SET quantity_sold=$2 WHERE id=$1", [t,aSold+1],a);
      assert.deepEqual(await inventory(t), { quantity_sold: 1, tickets: 2, active_holds: 0, converted_holds: 2 });
    } finally { a.release(); b.release(); }
  });

  await test("only service_role may call the SECURITY DEFINER issuance RPC", async () => {
    const e = await event(); const t = await tier(e, 2);
    const request = selection(e, t);
    for (const role of ["anon", "authenticated"]) {
      const client = await pool.connect();
      try {
        await client.query(`SET ROLE ${role}`);
        await assert.rejects(() => issue(request, client), (error) => error.code === "42501");
      } finally { await client.query("RESET ROLE"); client.release(); }
    }
    assert.deepEqual(await inventory(t), { quantity_sold: 0, tickets: 0, active_holds: 0, converted_holds: 0 });
    const client = await pool.connect();
    try { await client.query("SET ROLE service_role"); successful(await issue(request, client)); }
    finally { await client.query("RESET ROLE"); client.release(); }
    const [permissions] = await sql(`SELECT prosecdef,
      has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') AS service
      FROM pg_proc WHERE oid=$1::regprocedure`, [functionSignature]);
    assert.deepEqual(permissions, { prosecdef: true, anon: false, authenticated: false, service: true });
  });

  await test("two distinct requests for the final seat serialize and only one succeeds", async () => {
    const e = await event(); const t = await tier(e, 1);
    const [winner, loser] = await race((client) => issue(selection(e, t), client),
      (client) => issue(selection(e, t), client));
    successful(winner); rejected(loser, "insufficient_inventory");
    assert.deepEqual(await inventory(t), { quantity_sold: 1, tickets: 1, active_holds: 0, converted_holds: 1 });
    assert.equal((await snapshot(e)).orders.length, 1);
  });

  await test("concurrent multi-seat orders increment inventory without lost updates", async () => {
    const e = await event(); const t = await tier(e, 7);
    const results = await race((client) => issue(selection(e, t, 3), client),
      (client) => issue(selection(e, t, 4), client));
    results.forEach(successful);
    assert.deepEqual(await inventory(t), { quantity_sold: 7, tickets: 7, active_holds: 0, converted_holds: 2 });
    assert.equal((await snapshot(e)).orders.length, 2);
  });

  await test("a legacy paid hold waits until free issuance commits then rejects the full tier", async () => {
    const e = await event(); const t = await tier(e, 1);
    const [winner, loser] = await race((client) => issue(selection(e, t), client),
      (client) => hold(t, client));
    successful(winner); rejected(loser, "insufficient_inventory");
    assert.deepEqual(await inventory(t), { quantity_sold: 1, tickets: 1, active_holds: 0, converted_holds: 1 });
  });

  await test("free issuance waits for a prior paid hold and respects its committed reservation", async () => {
    const e = await event(); const t = await tier(e, 1);
    const [winner, loser] = await race((client) => hold(t, client),
      (client) => issue(selection(e, t), client));
    successful(winner); rejected(loser, "insufficient_inventory");
    assert.deepEqual(await inventory(t), { quantity_sold: 0, tickets: 0, active_holds: 1, converted_holds: 0 });
    assert.equal((await snapshot(e)).orders.length, 0);
  });

  await test("availability sums cart and legacy hold quantities and ignores expired or inactive holds", async () => {
    const e = await event(); const t = await tier(e, 8, 1);
    await sql(`INSERT INTO cart_holds(tier_id,qty,released,expires_at) VALUES
      ($1,2,false,now()+interval '10 min'),($1,99,true,now()+interval '10 min'),
      ($1,99,false,now()-interval '1 min')`, [t]);
    await sql(`INSERT INTO ticket_holds(ticket_type_id,event_id,quantity,status,expires_at) VALUES
      ($1,$2,3,'active',now()+interval '10 min'),($1,$2,99,'expired',now()+interval '10 min'),
      ($1,$2,99,'converted',now()+interval '10 min'),($1,$2,99,'active',now()-interval '1 min')`, [t,e]);
    const before = await snapshot(e);
    rejected(await issue(selection(e, t, 3)), "insufficient_inventory");
    assert.deepEqual(await snapshot(e), before, "rejected issuance changed bookkeeping");
    successful(await issue(selection(e, t, 2)));
    assert.equal((await inventory(t)).quantity_sold, 3);
    rejected(await issue(selection(e, t)), "insufficient_inventory");
  });

  await test("an unlimited tier still accounts for every issued seat", async () => {
    const e = await event(); const t = await tier(e, null, 42);
    const result = await issue(selection(e, t, 3)); successful(result);
    assert.deepEqual(await inventory(t), { quantity_sold: 45, tickets: 3, active_holds: 0, converted_holds: 1 });
  });

  await test("same-key concurrent requests return the identical order exactly once, even at capacity", async () => {
    const e = await event(); const t = await tier(e, 2);
    const a = selection(e, t, 2); const b = selection(e, t, 2, a.order.guest_email, a.order.idempotency_key);
    const [first, replay] = await race((client) => issue(a, client), (client) => issue(b, client));
    successful(first); successful(replay);
    assert.equal(replay.order_id, first.order_id);
    assert.equal(replay.idempotent, true);
    const before = await snapshot(e);
    const third = await issue(b); successful(third);
    assert.equal(third.order_id, first.order_id); assert.equal(third.idempotent, true);
    assert.deepEqual(await snapshot(e), before, "idempotent retry changed tickets, holds, orders, or counter");
    assert.deepEqual(await inventory(t), { quantity_sold: 2, tickets: 2, active_holds: 0, converted_holds: 1 });
    const stored = before.tickets.map((ticket) => ticket.id).sort();
    assert.deepEqual(stored, a.rows.map((ticket) => ticket.id).sort(), "retry replaced the original ticket capabilities");
  });

  await test("reusing a key for another buyer, tier, event, or quantity never replays the original order", async () => {
    const e = await event(); const t = await tier(e, 20); const otherTier = await tier(e, 20);
    const otherEvent = await event(); const otherEventTier = await tier(otherEvent, 20);
    const original = selection(e, t, 2); successful(await issue(original));
    const key = original.order.idempotency_key; const email = original.order.guest_email;
    const attempts = [selection(e,t,2,"different@example.test",key), selection(e,otherTier,2,email,key),
      selection(otherEvent,otherEventTier,2,email,key), selection(e,t,1,email,key)];
    const before = [await snapshot(e), await snapshot(otherEvent)];
    for (const attempt of attempts) rejected(await issue(attempt), "idempotency_conflict");
    assert.deepEqual([await snapshot(e), await snapshot(otherEvent)], before);
  });

  await test("same-key requests on different tiers serialize before rejecting the conflicting tier", async () => {
    const e = await event(); const aTier = await tier(e, 2); const bTier = await tier(e, 2);
    const a = selection(e,aTier); const b = selection(e,bTier,1,a.order.guest_email,a.order.idempotency_key);
    const [first, second] = await race((client) => issue(a,client), (client) => issue(b,client));
    successful(first); rejected(second,"idempotency_conflict");
    assert.equal((await snapshot(e)).orders.length, 1);
    assert.equal((await inventory(bTier)).quantity_sold, 0);
  });

  await test("concurrent distinct requests cannot exceed the per-email ticket cap", async () => {
    const e = await event(); const t = await tier(e, 10);
    await sql("UPDATE ticket_types SET max_per_user=1 WHERE id=$1", [t]);
    const email = "same-buyer@example.test";
    const [first, second] = await race((client) => issue(selection(e,t,1,email),client),
      (client) => issue(selection(e,t,1,email),client));
    successful(first); rejected(second,"limit");
    assert.deepEqual(await inventory(t), { quantity_sold: 1, tickets: 1, active_holds: 0, converted_holds: 1 });
  });

  await test("incomplete and paid-money prior orders are never replayed as free success", async () => {
    for (const [status,total] of [["created",0],["paid",1],["paid",0]]) {
      const e = await event(); const t = await tier(e, 2); const request = selection(e,t,2);
      await sql(`INSERT INTO orders(guest_email,event_id,quantity,type,status,total_cents,idempotency_key)
        VALUES($1,$2,2,'event_ticket',$3,$4,$5)`,
        [request.order.guest_email,e,status,total,request.order.idempotency_key]);
      const before = await snapshot(e);
      rejected(await issue(request),"checkout_processing");
      assert.deepEqual(await snapshot(e),before);
    }
  });

  await test("zero-price and fully-discounted tiers validate their exact server quote", async () => {
    const e = await event(); const t = await tier(e, 3);
    await sql("UPDATE ticket_types SET price_cents=500 WHERE id=$1", [t]);
    const request = selection(e,t,2); const before = await snapshot(e);
    rejected(await issue(request),"quote_changed");
    request.order.expected_unit_price_cents = 500;
    rejected(await issue(request),"quote_changed");
    assert.deepEqual(await snapshot(e),before);
    Object.assign(request.order, { discount_cents: 1000, promoter_id: randomUUID(),
      promoter_policy_version: "v2_eligible_subtotal_after_discount", promoter_code: "FREE",
      promoter_original_amount_cents: 1000, promoter_customer_discount_bps: 10000,
      promoter_discount_amount_cents: 1000, promoter_discounted_amount_cents: 0,
      promoter_commission_bps: 500, promoter_commission_amount_cents: 100 });
    const result = await issue(request); successful(result);
    assert.equal(result.order.discount_cents,1000);
    assert.equal(result.order.promoter_id,request.order.promoter_id);
    assert.equal(result.order.promoter_commission_amount_cents,0);
    assert.equal((await inventory(t)).quantity_sold,2);
  });

  await test("ownership and grouping are authoritative, not caller-prepared ticket fields", async () => {
    const e = await event(); const t = await tier(e, 2); const otherEvent = await event();
    const otherTier = await tier(otherEvent, 2); const request = selection(e,t,2);
    for (const row of request.rows) Object.assign(row, { event_id: otherEvent,
      ticket_type_id: otherTier, user_id: "unexpected-user", guest_email: "other@example.test",
      order_id: randomUUID(), order_index: 99, order_count: 99,
      purchase_amount_cents: 999, status: "refunded" });
    const result = await issue(request); successful(result);
    const tickets = (await snapshot(e)).tickets.sort((a,b) => a.order_index-b.order_index);
    assert.equal(tickets.length,2);
    tickets.forEach((ticket,index) => {
      assert.equal(ticket.event_id,e); assert.equal(ticket.ticket_type_id,t);
      assert.equal(ticket.user_id,null); assert.equal(ticket.guest_email,request.order.guest_email);
      assert.equal(ticket.order_id,result.order_id); assert.equal(ticket.order_index,index+1);
      assert.equal(ticket.order_count,2); assert.equal(ticket.purchase_amount_cents,0);
      assert.equal(ticket.status,"active");
      assert.equal(ticket.guest_lookup_token,request.rows[index].guest_lookup_token);
      assert.equal(ticket.qr_token,request.rows[index].qr_token);
    });
    assert.equal((await snapshot(otherEvent)).tickets.length,0);
  });

  await test("invalid prepared rows and invalid quantities produce no partial writes", async () => {
    const e = await event(); const t = await tier(e, 20); const before = await snapshot(e);
    const badRow = selection(e,t); delete badRow.rows[0].qr_payload;
    rejected(await issue(badRow),"invalid_ticket_rows");
    const mismatch = selection(e,t,2); mismatch.order.quantity = 1;
    rejected(await issue(mismatch),"invalid_request");
    const empty = selection(e,t,0); rejected(await issue(empty),"invalid_request");
    const tooMany = selection(e,t,11); rejected(await issue(tooMany),"invalid_request");
    assert.deepEqual(await snapshot(e),before);
  });

  await test("legacy hold status CHECK rejects released while successful issuance uses converted", async () => {
    const e = await event(); const t = await tier(e, 1);
    await assert.rejects(() => sql(`INSERT INTO ticket_holds(ticket_type_id,event_id,quantity,status,expires_at)
      VALUES($1,$2,1,'released',now()+interval '1 min')`, [t,e]), (error) => error.code === "23514");
    successful(await issue(selection(e,t)));
    const state = await snapshot(e); assert.equal(state.holds.length, 1); assert.equal(state.holds[0].status, "converted");
  });

  // Force failures AFTER writes in each table, not before the transaction does
  // any work. Each failed SQL statement must unwind all earlier side effects.
  await sql(`
    CREATE FUNCTION public.harness_fail_guest_issuance() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('harness.fail_stage',true) = TG_ARGV[0] THEN
        RAISE EXCEPTION 'harness forced failure at %', TG_ARGV[0];
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER harness_fail_order AFTER INSERT ON orders
      FOR EACH ROW EXECUTE FUNCTION harness_fail_guest_issuance('order');
    CREATE TRIGGER harness_fail_ticket AFTER INSERT ON tickets
      FOR EACH ROW EXECUTE FUNCTION harness_fail_guest_issuance('ticket');
    CREATE TRIGGER harness_fail_counter AFTER UPDATE ON ticket_types
      FOR EACH ROW EXECUTE FUNCTION harness_fail_guest_issuance('counter');
    CREATE TRIGGER harness_fail_conversion AFTER UPDATE OF status ON ticket_holds
      FOR EACH ROW WHEN (NEW.status='converted') EXECUTE FUNCTION harness_fail_guest_issuance('conversion');
    CREATE TRIGGER harness_fail_timeline AFTER INSERT ON order_timeline
      FOR EACH ROW EXECUTE FUNCTION harness_fail_guest_issuance('timeline');
  `);
  for (const stage of ["order", "ticket", "counter", "conversion", "timeline"]) {
    await test(`a SQL failure at ${stage} rolls back order, tickets, sold count, and hold together`, async () => {
      const e = await event(); const t = await tier(e, 2); const request = selection(e,t,2);
      const before = await snapshot(e); const client = await pool.connect();
      try {
        await client.query("SELECT set_config('harness.fail_stage',$1,false)", [stage]);
        await assert.rejects(() => issue(request,client), /harness forced failure/);
      } finally { await client.query("RESET harness.fail_stage"); client.release(); }
      assert.deepEqual(await snapshot(e), before);
      successful(await issue(request));
      assert.deepEqual(await inventory(t), { quantity_sold: 2, tickets: 2, active_holds: 0, converted_holds: 1 });
    });
  }

  await test("actual kept tickets prevent oversell when a legacy counter is stale", async () => {
    const e = await event(); const t = await tier(e, 2, 0);
    await sql(`INSERT INTO tickets(event_id,ticket_type_id,user_id,status,qr_token) VALUES
      ($1,$2,'active-holder','active',$3),($1,$2,'scanned-holder','scanned',$4)`, [e,t,randomUUID(),randomUUID()]);
    const before = await snapshot(e);
    rejected(await issue(selection(e,t)), "insufficient_inventory");
    assert.deepEqual(await snapshot(e), before);
  });

  await test("void and refunded tickets do not consume the kept-ticket fallback", async () => {
    const e = await event(); const t = await tier(e, 1, 0);
    await sql(`INSERT INTO tickets(event_id,ticket_type_id,user_id,status,qr_token) VALUES
      ($1,$2,'void-holder','void',$3),($1,$2,'refunded-holder','refunded',$4)`, [e,t,randomUUID(),randomUUID()]);
    successful(await issue(selection(e,t)));
    assert.equal((await inventory(t)).quantity_sold, 1);
  });

  await test("transfer-pending tickets remain inventory even when the sold counter is stale", async () => {
    const e = await event(); const t = await tier(e, 1, 0);
    await sql(`INSERT INTO tickets(event_id,ticket_type_id,user_id,status,qr_token)
      VALUES($1,$2,'transfer-owner','transfer_pending',$3)`, [e,t,randomUUID()]);
    const before = await snapshot(e);
    rejected(await issue(selection(e,t)),"insufficient_inventory");
    assert.deepEqual(await snapshot(e),before);
  });

  await test("a stale sold counter is safely floored by actual kept tickets during a successful issue", async () => {
    const e = await event(); const t = await tier(e, 3, 0);
    await sql(`INSERT INTO tickets(event_id,ticket_type_id,user_id,status,qr_token) VALUES
      ($1,$2,'active-holder','active',$3),($1,$2,'null-status-holder',NULL,$4)`,
      [e,t,randomUUID(),randomUUID()]);
    successful(await issue(selection(e,t)));
    assert.deepEqual(await inventory(t), { quantity_sold: 3, tickets: 3, active_holds: 0, converted_holds: 1 });
  });

  await test("a concurrent hosted paid hold conversion never reopens its already-issued seat", async () => {
    const e = await event(); const t = await tier(e, 1, 0);
    const paidHold = await hold(t); successful(paidHold);
    // Current hosted fulfillment commits tickets, converts its hold, and only
    // then updates the sold counter. Model that real intermediate state.
    await sql(`INSERT INTO tickets(event_id,ticket_type_id,user_id,status,qr_token)
      VALUES($1,$2,'paid-buyer','active',$3)`, [e,t,randomUUID()]);

    // A test-only pause after the actual-ticket subquery lets the paid writer
    // convert its hold while the guest admission SELECT is still executing.
    // The original migration is restored in finally; no production hook exists.
    await sql(`CREATE FUNCTION public.harness_pause_guest_count(p_count bigint)
      RETURNS bigint LANGUAGE plpgsql VOLATILE AS $$ BEGIN
        PERFORM pg_advisory_xact_lock(620017, 1); RETURN p_count;
      END; $$;`);
    const source = read(migrationName);
    const needle = "(SELECT count(*) FROM public.tickets\n      WHERE ticket_type_id = p_ticket_type_id";
    assert.equal(source.split(needle).length, 2, "capacity count must have one identifiable statement snapshot");
    await sql(source.replace(needle,
      "(SELECT public.harness_pause_guest_count(count(*)) FROM public.tickets\n      WHERE ticket_type_id = p_ticket_type_id"));
    const control = await pool.connect(); const guest = await pool.connect(); const paid = await pool.connect();
    let guestPending, paidPending;
    try {
      await control.query("BEGIN");
      await control.query("SELECT pg_advisory_xact_lock(620017, 1)");
      const controlPid = (await sql("SELECT pg_backend_pid() AS pid", [], control))[0].pid;
      const guestPid = (await sql("SELECT pg_backend_pid() AS pid", [], guest))[0].pid;
      const paidPid = (await sql("SELECT pg_backend_pid() AS pid", [], paid))[0].pid;
      guestPending = { settled: false };
      guestPending.promise = issue(selection(e,t),guest).then(
        result => { guestPending.settled=true; return {result}; },
        error => { guestPending.settled=true; return {error}; });
      await waitForBlocked(controlPid,guestPid,guestPending);
      await paid.query("UPDATE ticket_holds SET status='converted' WHERE id=$1", [paidHold.holdId]);
      paidPending = { settled: false };
      paidPending.promise = paid.query("UPDATE ticket_types SET quantity_sold=1 WHERE id=$1", [t]).then(
        result => { paidPending.settled=true; return {result}; },
        error => { paidPending.settled=true; return {error}; });
      await waitForBlocked(guestPid,paidPid,paidPending);
      await control.query("COMMIT");
      const guestResult = await guestPending.promise;
      if (guestResult.error) throw guestResult.error;
      rejected(guestResult.result,"insufficient_inventory");
      const paidResult = await paidPending.promise;
      if (paidResult.error) throw paidResult.error;
      assert.deepEqual(await inventory(t), {quantity_sold:1,tickets:1,active_holds:0,converted_holds:1});
      assert.equal((await snapshot(e)).orders.length,0,"free guest was issued against the paid seat");
    } finally {
      await control.query("ROLLBACK");
      if (guestPending) await guestPending.promise;
      if (paidPending) await paidPending.promise;
      control.release();guest.release();paid.release();
      await sql(source);
      await sql("DROP FUNCTION public.harness_pause_guest_count(bigint)");
    }
  });

  console.log(`\nPASS: ${passed} real PostgreSQL free-guest issuance regressions; multi-connection lock barriers verified.`);
} finally {
  await pool.end();
  teardown();
}
