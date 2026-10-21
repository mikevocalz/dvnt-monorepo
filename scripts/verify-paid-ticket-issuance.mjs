#!/usr/bin/env node
/**
 * Real PostgreSQL regression tests for single-tier paid ticket issuance. No production
 * credentials, network database, Docker service, or live migration is used.
 *
 * Starts a disposable socket-only cluster, replays the production legacy hold
 * RPC and atomic paid issuance migration, and drives independent connections.
 * Concurrency assertions observe pg_locks / pg_blocking_pids before allowing
 * the winning transaction to commit; fixed sleeps are not evidence of a race.
 *
 *   node scripts/verify-paid-ticket-issuance.mjs
 *   PG_BIN=/path/to/postgres/bin node scripts/verify-paid-ticket-issuance.mjs
 *   node scripts/verify-paid-ticket-issuance.mjs --allow-skip
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
const migrationName = "20261021144500_paid_ticket_issuance_atomic.sql";
const functionSignature = "public.paid_ticket_issuance_atomic(uuid,uuid,text,text,bigint,jsonb)";

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
  const message = "verify-paid-ticket-issuance: no complete PostgreSQL server installation found; assertions DID NOT run.";
  if (process.argv.includes("--allow-skip")) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall PostgreSQL or set PG_BIN to its bin directory.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-paid-ticket-data-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-paid-ticket-sock-"));
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
      is_active boolean DEFAULT true, status text DEFAULT 'on_sale',
      tier_visibility text DEFAULT 'public', sale_start timestamptz, sale_end timestamptz
    );
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text, guest_email text,
      type text NOT NULL CHECK (type IN ('event_ticket','promotion','sneaky_access')),
      status text DEFAULT 'created' CHECK (status IN ('created','payment_pending','payment_failed','paid','partially_refunded','refunded','disputed')),
      currency text DEFAULT 'usd', subtotal_cents integer NOT NULL DEFAULT 0,
      platform_fee_cents integer DEFAULT 0, processing_fee_cents integer DEFAULT 0,
      tax_cents integer DEFAULT 0, total_cents integer NOT NULL DEFAULT 0,
      event_id integer REFERENCES events(id), quantity integer, cart_id uuid, sold_by_staff_user_id text,
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
      order_id uuid REFERENCES orders(id), cart_id uuid, cart_line_item_id uuid,
      stripe_payment_intent_id text, stripe_checkout_session_id text,
      order_index integer CHECK (order_index IS NULL OR order_index >= 1),
      order_count integer CHECK (order_count IS NULL OR order_count >= 1),
      created_at timestamptz DEFAULT now(),
      CONSTRAINT tickets_user_or_guest CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
    );
    CREATE UNIQUE INDEX uniq_tickets_session_order_index_v2
      ON public.tickets (stripe_checkout_session_id, order_index);
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
    "INSERT INTO ticket_types(event_id,quantity_total,quantity_sold,price_cents) VALUES($1,$2,$3,500) RETURNING id",
    [eventId, total, sold]))[0].id;
  async function selection(eventId, tierId, opts = {}) {
    const quantity = opts.quantity ?? 1;
    const amount = opts.amount ?? quantity * 500;
    const user = opts.user ?? null;
    const email = opts.email ?? (user ? null : `${randomUUID()}@example.test`);
    const pi = opts.pi ?? `pi_harness_${randomUUID().replaceAll("-", "")}`;
    const session = opts.hosted ? `cs_harness_${randomUUID().replaceAll("-", "")}` : null;
    const [order] = await sql(`INSERT INTO orders(event_id,user_id,guest_email,type,status,quantity,
      subtotal_cents,total_cents,stripe_checkout_session_id,stripe_payment_intent_id,sold_by_staff_user_id)
      VALUES($1,$2,$3,'event_ticket','payment_pending',$4,$5,$5,$6,$7,$8) RETURNING *`,
      [eventId,user,email,quantity,amount,session,opts.bindPi === false ? null : pi,opts.staff ?? null]);
    const request = { orderId: order.id, tierId, pi, session, amount, order,
      rows: Array.from({ length: quantity }, (_, index) => ({ id: randomUUID(),
        event_id: eventId, ticket_type_id: tierId, user_id: user, guest_email: email,
        guest_name: email ? "Guest Buyer" : null, attendee_name: `Attendee ${index + 1}`,
        guest_lookup_token: user ? null : randomUUID(), status: "active", qr_token: randomUUID(),
        qr_payload: `signed-test-payload-${randomUUID()}`, order_id: order.id,
        stripe_payment_intent_id: pi, stripe_checkout_session_id: session,
        purchase_amount_cents: Math.floor(amount / quantity) + (index < amount % quantity ? 1 : 0),
        order_index: index + 1, order_count: quantity })),
    };
    if (opts.hold !== false) await addHold(request, { user: opts.staff ?? user });
    return request;
  }
  async function addHold(request, opts = {}, client = pool) {
    const user = Object.hasOwn(opts, "user") ? opts.user : request.order.user_id;
    const email = Object.hasOwn(opts, "email") ? opts.email
      : request.order.sold_by_staff_user_id && user ? null : request.order.guest_email;
    const [hold] = await sql(`INSERT INTO ticket_holds(ticket_type_id,event_id,quantity,
      payment_intent_id,user_id,guest_email,status,expires_at,hold_kind)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()+$8::interval,'checkout') RETURNING *`,
      [opts.tierId ?? request.tierId, opts.eventId ?? request.order.event_id,
        opts.quantity ?? request.order.quantity, opts.ref ?? request.session ?? request.pi,
        user,email,opts.status ?? "active",opts.ttl ?? "10 min"], client);
    return hold;
  }
  function preparedAgain(request) {
    return { ...request, rows: request.rows.map(row => ({ ...row, id: randomUUID(),
      qr_token: randomUUID(), qr_payload: `retry-payload-${randomUUID()}`,
      guest_lookup_token: row.guest_lookup_token ? randomUUID() : null })) };
  }
  const issue = async (request, client = pool) => (await sql(
    "SELECT public.paid_ticket_issuance_atomic($1::uuid,$2::uuid,$3::text,$4::text,$5::bigint,$6::jsonb) AS result",
    [request.orderId,request.tierId,request.pi,request.session,request.amount,JSON.stringify(request.rows)],client))[0].result;
  const reserve = async (tierId,quantity=1,client=pool,options={}) => (await sql(
    "SELECT public.ticket_hold_create_atomic($1::uuid,$2::integer,$3::text,$4::text,$5::text,$6::integer,$7::text) AS result",
    [tierId,quantity,options.ref ?? `pi_reservation_${randomUUID().replaceAll("-","")}`,
      options.user ?? null,options.email ?? null,options.seconds ?? 600,options.kind ?? null],client))[0].result;
  const snapshot = async (eventId) => (await sql(`SELECT jsonb_build_object(
    'tiers', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM ticket_types t WHERE event_id=$1),
    'orders', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]'::jsonb) FROM orders o WHERE event_id=$1),
    'tickets', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM tickets t WHERE event_id=$1),
    'holds', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]'::jsonb) FROM ticket_holds h WHERE event_id=$1),
    'cart_holds', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id),'[]'::jsonb) FROM cart_holds h
      JOIN ticket_types t ON t.id=h.tier_id WHERE t.event_id=$1)
  ) AS value`, [eventId]))[0].value;
  const inventory = async (tierId) => (await sql(`SELECT quantity_sold,
    (SELECT count(*)::int FROM tickets WHERE ticket_type_id=$1) AS tickets,
    (SELECT count(*)::int FROM ticket_holds WHERE ticket_type_id=$1 AND status='active') AS active_holds,
    (SELECT count(*)::int FROM ticket_holds WHERE ticket_type_id=$1 AND status='converted') AS converted_holds
    FROM ticket_types WHERE id=$1`, [tierId]))[0];
  const successful = (result) => assert.equal(result.ok,true,JSON.stringify(result));
  const rejected = (result) => {
    assert.equal(result.ok,false,JSON.stringify(result));
    assert.equal(result.needs_recovery,true,JSON.stringify(result));
    assert.equal(typeof result.error,"string",JSON.stringify(result));
    assert.ok(result.error.length > 0);
  };
  async function unchangedRejection(request, eventIds = [request.order.event_id]) {
    const before = await Promise.all(eventIds.map(snapshot));
    rejected(await issue(request));
    assert.deepEqual(await Promise.all(eventIds.map(snapshot)),before,"rejected issuance changed database state");
  }
  async function insertLegacy(request, rows = request.rows) {
    for (const row of rows) {
      const columns = Object.keys(row);
      await sql(`INSERT INTO tickets(${columns.join(",")}) VALUES(${columns.map((_,i) => `$${i+1}`).join(",")})`,
        Object.values(row));
    }
  }
  async function unrelatedTickets(eventId,tierId,statuses) {
    for (const status of statuses) await sql(`INSERT INTO tickets(event_id,ticket_type_id,user_id,status,qr_token)
      VALUES($1,$2,'other-holder',$3,$4)`,[eventId,tierId,status,randomUUID()]);
  }

  // Real connection overlap is observed, not inferred from a sleep. The
  // winning SQL statement has finished but its transaction retains the lock.
  async function waitForBlocked(blockerPid,waiterPid,pending) {
    const deadline = performance.now()+10_000;
    while (performance.now()<deadline) {
      const [state] = await sql(`SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked_by_first,
        EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2 AND NOT granted) AS ungranted,
        (SELECT wait_event_type FROM pg_stat_activity WHERE pid=$2) AS wait_event_type`,[blockerPid,waiterPid]);
      if (state.blocked_by_first && state.ungranted && state.wait_event_type === "Lock") return;
      assert.equal(pending.settled,false,"competing request completed before the first transaction committed");
      await nextTurn();
    }
    assert.fail(`backend ${waiterPid} never blocked on transaction ${blockerPid}`);
  }
  async function race(firstCall,secondCall) {
    const first = await pool.connect(); const second = await pool.connect(); let pending;
    try {
      await first.query("BEGIN");
      const firstResult = await firstCall(first); successful(firstResult);
      const firstPid = (await sql("SELECT pg_backend_pid() AS pid",[],first))[0].pid;
      const secondPid = (await sql("SELECT pg_backend_pid() AS pid",[],second))[0].pid;
      pending = { settled: false };
      pending.promise = secondCall(second).then(
        result => { pending.settled=true; return {result}; },
        error => { pending.settled=true; return {error}; });
      await waitForBlocked(firstPid,secondPid,pending);
      await first.query("COMMIT");
      const other = await pending.promise; if (other.error) throw other.error;
      return [firstResult,other.result];
    } finally {
      await first.query("ROLLBACK");
      if (pending) await pending.promise;
      await second.query("ROLLBACK"); first.release(); second.release();
    }
  }

  await test("only service_role may call the SECURITY DEFINER paid issuance RPC",async () => {
    const e = await event(); const t = await tier(e,1); const request = await selection(e,t);
    const before = await snapshot(e);
    for (const role of ["anon","authenticated"]) {
      const client = await pool.connect();
      try {
        await client.query(`SET ROLE ${role}`);
        await assert.rejects(() => issue(request,client),error => error.code === "42501");
      } finally { await client.query("RESET ROLE"); client.release(); }
    }
    assert.deepEqual(await snapshot(e),before);
    const client = await pool.connect();
    try { await client.query("SET ROLE service_role"); successful(await issue(request,client)); }
    finally { await client.query("RESET ROLE"); client.release(); }
    const [permissions] = await sql(`SELECT prosecdef,
      has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') AS service
      FROM pg_proc WHERE oid=$1::regprocedure`,[functionSignature]);
    assert.deepEqual(permissions,{prosecdef:true,anon:false,authenticated:false,service:true});
  });

  await test("shared hold admission rejects stale counters for every kept-ticket status",async () => {
    for (const status of ["active","scanned","transfer_pending",null]) {
      const e = await event(); const t = await tier(e,1,0);
      await unrelatedTickets(e,t,[status]); const before=await snapshot(e);
      const result=await reserve(t); assert.equal(result.ok,false); assert.equal(result.error,"insufficient_inventory");
      assert.equal(result.available,0); assert.deepEqual(await snapshot(e),before);
    }
  });

  await test("shared hold admission excludes refunded and void tickets from its actual-ticket floor",async () => {
    const e = await event(); const t = await tier(e,1,0);
    await unrelatedTickets(e,t,["refunded","void"]);
    const result=await reserve(t); successful(result); assert.equal(result.available,0);
    assert.deepEqual(await inventory(t),{quantity_sold:0,tickets:2,active_holds:1,converted_holds:0});
  });

  await test("shared hold admission sums both hold tables and admits exactly the remaining capacity",async () => {
    const e = await event(); const t = await tier(e,10,1); await unrelatedTickets(e,t,["active","scanned"]);
    await sql(`INSERT INTO cart_holds(tier_id,qty,released,expires_at) VALUES
      ($1,2,false,now()+interval '10 min'),($1,99,true,now()+interval '10 min'),($1,99,false,now()-interval '1 min')`,[t]);
    await sql(`INSERT INTO ticket_holds(ticket_type_id,event_id,quantity,status,expires_at) VALUES
      ($1,$2,3,'active',now()+interval '10 min'),($1,$2,99,'expired',now()+interval '10 min'),
      ($1,$2,99,'converted',now()+interval '10 min'),($1,$2,99,'active',now()-interval '1 min')`,[t,e]);
    // actual kept=2, live cart=2, live legacy=3, requested=3: exactly 10.
    const result=await reserve(t,3); successful(result); assert.equal(result.available,0);
    const after=await snapshot(e); const loser=await reserve(t);
    assert.equal(loser.ok,false); assert.equal(loser.error,"insufficient_inventory"); assert.equal(loser.available,0);
    assert.deepEqual(await snapshot(e),after);
    assert.equal((await inventory(t)).quantity_sold,1,"reservation must not rewrite the sold counter");
  });

  await test("shared hold admission preserves the larger existing sold counter instead of lowering it",async () => {
    const e = await event(); const t = await tier(e,5,4); await unrelatedTickets(e,t,["active"]);
    const result=await reserve(t); successful(result); assert.equal(result.available,0);
    const before=await snapshot(e); const loser=await reserve(t);
    assert.equal(loser.ok,false); assert.equal(loser.error,"insufficient_inventory");
    assert.deepEqual(await snapshot(e),before); assert.equal((await inventory(t)).quantity_sold,4);
  });

  await test("concurrent shared hold requests cannot reserve the stale-counter final seat twice",async () => {
    const e = await event(); const t = await tier(e,3,0); await unrelatedTickets(e,t,["active","scanned"]);
    const [winner,loser]=await race(client => reserve(t,1,client),client => reserve(t,1,client));
    successful(winner); assert.equal(loser.ok,false); assert.equal(loser.error,"insufficient_inventory");
    assert.equal(loser.available,0);
    assert.deepEqual(await inventory(t),{quantity_sold:0,tickets:2,active_holds:1,converted_holds:0});
  });

  await test("shared hold replacement preserves unlimited tiers, TTL bounds, identity, and service-only access",async () => {
    const e = await event(); const t = await tier(e,null,100); await unrelatedTickets(e,t,["active"]);
    for (const [seconds,expected] of [[1,60],[999999,604800]]) {
      const result=await reserve(t,3,pool,{seconds,user:"reserved-buyer",email:"buyer@example.test",kind:"async_settlement"});
      successful(result); assert.equal(result.available,null);
      const [stored]=await sql(`SELECT quantity,user_id,guest_email,hold_kind,
        extract(epoch FROM expires_at-created_at)::int AS seconds FROM ticket_holds WHERE id=$1`,[result.holdId]);
      assert.deepEqual(stored,{quantity:3,user_id:"reserved-buyer",guest_email:"buyer@example.test",hold_kind:"async_settlement",seconds:expected});
    }
    const [permissions]=await sql(`SELECT prosecdef,
      has_function_privilege('anon',oid,'EXECUTE') AS anon,
      has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',oid,'EXECUTE') AS service
      FROM pg_proc WHERE oid='public.ticket_hold_create_atomic(uuid,integer,text,text,text,integer,text)'::regprocedure`);
    assert.deepEqual(permissions,{prosecdef:true,anon:false,authenticated:false,service:true});
    assert.equal((await inventory(t)).quantity_sold,100);
  });

  await test("native authenticated issuance converts its PI hold and keeps buyer ownership",async () => {
    const e = await event(); const t = await tier(e,2); const request = await selection(e,t,{quantity:2,user:"native-buyer"});
    const result = await issue(request); successful(result);
    assert.equal(result.duplicate,false); assert.equal(result.issued_count,2); assert.equal(result.order_id,request.orderId);
    assert.deepEqual(result.tickets.map(row => row.id).sort(),request.rows.map(row => row.id).sort());
    assert.deepEqual(await inventory(t),{quantity_sold:2,tickets:2,active_holds:0,converted_holds:1});
    const state = await snapshot(e);
    assert.ok(state.tickets.every(row => row.user_id === "native-buyer" && row.guest_email === null));
    assert.ok(state.tickets.every(row => row.stripe_payment_intent_id === request.pi && row.order_id === request.orderId));
  });

  await test("hosted guest issuance binds the PI, preserves exact cents, and converts the session hold",async () => {
    const e = await event(); const t = await tier(e,3);
    const request = await selection(e,t,{quantity:3,amount:1001,hosted:true,bindPi:false});
    const result = await issue(request); successful(result); assert.equal(result.issued_count,3);
    const state = await snapshot(e); const tickets = state.tickets.sort((a,b) => a.order_index-b.order_index);
    assert.deepEqual(tickets.map(row => row.purchase_amount_cents),[334,334,333]);
    assert.deepEqual(tickets.map(row => row.order_index),[1,2,3]);
    assert.ok(tickets.every(row => row.order_count === 3 && row.guest_email === request.order.guest_email && row.user_id === null));
    assert.ok(tickets.every(row => row.stripe_checkout_session_id === request.session));
    assert.equal(state.orders[0].stripe_payment_intent_id,request.pi);
    assert.equal(state.holds[0].status,"converted");
  });

  await test("a door sale may consume its staff-owned hold without issuing tickets to staff",async () => {
    const e = await event(); const t = await tier(e,2);
    const request = await selection(e,t,{quantity:2,staff:"door-staff"});
    successful(await issue(request)); const state = await snapshot(e);
    assert.ok(state.tickets.every(row => row.user_id === null && row.guest_email === request.order.guest_email));
    assert.equal(state.holds[0].user_id,"door-staff"); assert.equal(state.holds[0].status,"converted");
  });

  await test("the wrong staff member or a hosted request cannot consume a door staff hold",async () => {
    for (const hosted of [false,true]) {
      const e = await event(); const t = await tier(e,1);
      const request = await selection(e,t,{staff:"correct-staff",hosted});
      if (!hosted) await sql("UPDATE ticket_holds SET user_id='other-staff' WHERE ticket_type_id=$1",[t]);
      await unchangedRejection(request);
    }
  });

  await test("same-order concurrent paid callbacks return original capabilities exactly once",async () => {
    const e = await event(); const t = await tier(e,2); const request = await selection(e,t,{quantity:2});
    const retry = preparedAgain(request);
    const [first,second] = await race(client => issue(request,client),client => issue(retry,client));
    successful(first); successful(second); assert.equal(second.duplicate,true); assert.equal(second.issued_count,0);
    assert.deepEqual(second.tickets,first.tickets); assert.equal(second.order_id,first.order_id);
    assert.deepEqual(await inventory(t),{quantity_sold:2,tickets:2,active_holds:0,converted_holds:1});
    const before = await snapshot(e); successful(await issue(retry)); assert.deepEqual(await snapshot(e),before);
  });

  await test("distinct paid orders serialize and add every seat without a lost sold increment",async () => {
    const e = await event(); const t = await tier(e,5);
    const first = await selection(e,t,{quantity:2}); const second = await selection(e,t,{quantity:3,hosted:true});
    const results = await race(client => issue(first,client),client => issue(second,client)); results.forEach(successful);
    assert.deepEqual(await inventory(t),{quantity_sold:5,tickets:5,active_holds:0,converted_holds:2});
  });

  await test("distinct buyers racing to reserve and issue the final seat admit only one",async () => {
    const e = await event(); const t = await tier(e,1);
    const a = await selection(e,t,{hold:false}); const b = await selection(e,t,{hold:false});
    const reserveAndIssue = async (request,client) => {
      const [row] = await sql(`SELECT public.ticket_hold_create_atomic($1::uuid,1,$2::text,NULL,$3::text) AS result`,
        [request.tierId,request.pi,request.order.guest_email],client);
      return row.result.ok ? issue(request,client) : row.result;
    };
    const [winner,loser] = await race(client => reserveAndIssue(a,client),client => reserveAndIssue(b,client));
    successful(winner); assert.equal(loser.ok,false); assert.equal(loser.error,"insufficient_inventory");
    assert.deepEqual(await inventory(t),{quantity_sold:1,tickets:1,active_holds:0,converted_holds:1});
    assert.equal((await snapshot(e)).tickets[0].order_id,a.orderId);
  });

  await test("hosted and native callbacks for different orders cannot spend the same PI twice",async () => {
    const e = await event(); const aTier = await tier(e,1); const bTier = await tier(e,1);
    const a = await selection(e,aTier,{hosted:true,bindPi:false});
    const b = await selection(e,bTier,{pi:a.pi,hold:false,bindPi:false,user:"native-second-buyer"});
    const [winner,loser] = await race(client => issue(a,client),async client => {
      // Native checkout stores the PI before callback delivery. Introduce
      // that association only after the hosted transaction has issued, then
      // prove its concurrent callback waits on the shared payment lock.
      await sql("UPDATE orders SET stripe_payment_intent_id=$2 WHERE id=$1",[b.orderId,b.pi],client);
      await addHold(b,{},client); return issue(b,client);
    });
    successful(winner); rejected(loser);
    const state = await snapshot(e);
    assert.equal(state.tickets.length,1); assert.equal(state.tickets[0].order_id,a.orderId);
    assert.equal(state.orders.find(order => order.id === b.orderId).stripe_payment_intent_id,b.pi);
    assert.equal(loser.error,"payment_conflict");
    assert.equal((await inventory(bTier)).quantity_sold,0);
  });

  await test("two already-overreserved paid holds fail closed instead of overselling",async () => {
    const e = await event(); const t = await tier(e,1);
    const a = await selection(e,t); const b = await selection(e,t);
    const before = await snapshot(e);
    const results = await Promise.all([issue(a),issue(b)]); results.forEach(rejected);
    assert.deepEqual(await snapshot(e),before);
  });

  await test("mixed cart and legacy hold seat quantities count without double-counting the own hold",async () => {
    const e = await event(); const t = await tier(e,8,1); const request = await selection(e,t,{quantity:2});
    await sql(`INSERT INTO cart_holds(tier_id,qty,released,expires_at) VALUES
      ($1,2,false,now()+interval '10 min'),($1,99,true,now()+interval '10 min'),($1,99,false,now()-interval '1 min')`,[t]);
    await addHold(request,{ref:"pi_unrelated",quantity:3,user:"unrelated",email:null});
    await addHold(request,{ref:"pi_expired",quantity:99,status:"expired"});
    await addHold(request,{ref:"pi_converted",quantity:99,status:"converted"});
    await addHold(request,{ref:"pi_stale",quantity:99,ttl:"-1 min"});
    successful(await issue(request)); assert.equal((await inventory(t)).quantity_sold,3);
    const next = await selection(e,t); await unchangedRejection(next);
  });

  await test("unlimited tiers still account for every paid seat and convert only their own hold",async () => {
    const e = await event(); const t = await tier(e,null,42); const request = await selection(e,t,{quantity:3});
    await addHold(request,{ref:"pi_other",quantity:100,user:"other-buyer",email:null});
    successful(await issue(request));
    assert.deepEqual(await inventory(t),{quantity_sold:45,tickets:3,active_holds:1,converted_holds:1});
  });

  await test("kept tickets block oversell when a legacy sold counter is stale",async () => {
    for (const status of ["active","scanned","transfer_pending",null]) {
      const e = await event(); const t = await tier(e,1,0);
      await unrelatedTickets(e,t,[status]); const request = await selection(e,t); await unchangedRejection(request);
    }
  });

  await test("successful issuance floors stale sold inventory at the actual kept-ticket count",async () => {
    const e = await event(); const t = await tier(e,3,0);
    await unrelatedTickets(e,t,["active",null]); const request = await selection(e,t);
    successful(await issue(request)); assert.equal((await inventory(t)).quantity_sold,3);
  });

  await test("void and refunded tickets do not consume fallback inventory",async () => {
    const e = await event(); const t = await tier(e,1,0);
    await unrelatedTickets(e,t,["void","refunded"]); const request = await selection(e,t);
    successful(await issue(request)); assert.equal((await inventory(t)).quantity_sold,1);
  });

  await test("missing, expired, converted, undersized, or oversized own holds require recovery without writes",async () => {
    for (const change of ["missing","expired","converted","undersized","oversized"]) {
      const e = await event(); const t = await tier(e,10); const request = await selection(e,t,{quantity:2});
      if (change === "missing") await sql("DELETE FROM ticket_holds WHERE ticket_type_id=$1",[t]);
      if (change === "expired") await sql("UPDATE ticket_holds SET expires_at=now()-interval '1 min' WHERE ticket_type_id=$1",[t]);
      if (change === "converted") await sql("UPDATE ticket_holds SET status='converted' WHERE ticket_type_id=$1",[t]);
      if (change === "undersized" || change === "oversized")
        await sql("UPDATE ticket_holds SET quantity=$2 WHERE ticket_type_id=$1",[t,change === "undersized" ? 1 : 3]);
      await unchangedRejection(request);
    }
  });

  await test("a hold that expires while waiting for the tier lock cannot issue after the wait",async () => {
    const e = await event(); const t = await tier(e,1); const request = await selection(e,t);
    const blocker = await pool.connect(); const waiter = await pool.connect(); let pending;
    try {
      await blocker.query("BEGIN");
      await sql("SELECT id FROM ticket_types WHERE id=$1 FOR UPDATE",[t],blocker);
      await waiter.query("BEGIN");
      const started = (await sql("SELECT now()::text AS started",[],waiter))[0].started;
      const blockerPid = (await sql("SELECT pg_backend_pid() AS pid",[],blocker))[0].pid;
      const waiterPid = (await sql("SELECT pg_backend_pid() AS pid",[],waiter))[0].pid;
      pending = {settled:false};
      pending.promise=issue(request,waiter).then(
        result => {pending.settled=true;return {result};},
        error => {pending.settled=true;return {error};});
      await waitForBlocked(blockerPid,waiterPid,pending);
      // Move expiry to wall-clock now only AFTER observing the lock. The
      // waiter's transaction began earlier, so transaction-start now() would
      // incorrectly continue treating this hold as live after lock release.
      await sql("UPDATE ticket_holds SET expires_at=clock_timestamp() WHERE ticket_type_id=$1",[t]);
      const [deadline] = await sql("SELECT expires_at > $2::timestamptz AS after_start FROM ticket_holds WHERE ticket_type_id=$1",[t,started]);
      assert.equal(deadline.after_start,true,"expiry must occur after the waiting transaction began");
      const before = await snapshot(e);
      await blocker.query("COMMIT");
      const outcome=await pending.promise; if(outcome.error)throw outcome.error;
      rejected(outcome.result); assert.equal(outcome.result.error,"allocation_missing");
      await waiter.query("COMMIT");
      assert.deepEqual(await snapshot(e),before);
    } finally {
      await blocker.query("ROLLBACK");
      if(pending)await pending.promise;
      await waiter.query("ROLLBACK");
      blocker.release();waiter.release();
    }
  });

  await test("matching split holds sum to the exact paid allocation and are converted together",async () => {
    const e = await event(); const t = await tier(e,3); const request = await selection(e,t,{quantity:3,hold:false});
    await addHold(request,{quantity:1}); await addHold(request,{quantity:2});
    successful(await issue(request));
    assert.deepEqual(await inventory(t),{quantity_sold:3,tickets:3,active_holds:0,converted_holds:2});
  });

  await test("own hold reference, event, tier, and buyer mismatches cannot be consumed",async () => {
    for (const change of ["reference","event","tier","guest","user"]) {
      const e = await event(); const t = await tier(e,10); const other = await event(); const otherTier = await tier(other,10);
      const request = await selection(e,t);
      const updates = {reference:["payment_intent_id","pi_unrelated"],event:["event_id",other],
        tier:["ticket_type_id",otherTier],guest:["guest_email","someone-else@example.test"],user:["user_id","someone-else"]};
      const [column,value] = updates[change];
      await sql(`UPDATE ticket_holds SET ${column}=$2 WHERE ticket_type_id=$1`,[t,value]);
      await unchangedRejection(request,[e,other]);
    }
  });

  await test("empty PI, wrong order amount, zero amount, and rounded-away cents require recovery",async () => {
    const e = await event(); const t = await tier(e,3); const request = await selection(e,t,{quantity:3,amount:1001});
    for (const pi of [null,""]) await unchangedRejection({...request,pi});
    for (const amount of [0,1000,1002]) await unchangedRejection({...request,amount});
    const bad = preparedAgain(request); bad.rows.forEach(row => { row.purchase_amount_cents=334; });
    await unchangedRejection(bad);
    successful(await issue(request));
  });

  await test("ticket row event, tier, ownership, amount, and quantity must match the paid order",async () => {
    for (const change of ["event","tier","guest","user","negative_amount","quantity"]) {
      const e = await event(); const t = await tier(e,10); const other = await event(); const otherTier = await tier(other,10);
      const request = await selection(e,t,{quantity:2});
      const updates = {event:["event_id",other],tier:["ticket_type_id",otherTier],
        guest:["guest_email","someone-else@example.test"],user:["user_id","someone-else"],negative_amount:["purchase_amount_cents",-500]};
      if (change === "quantity") request.rows.pop();
      else { const [column,value] = updates[change]; request.rows[0][column]=value; }
      await unchangedRejection(request,[e,other]);
    }
  });

  await test("wrong order type, cart orders, and conflicting stored Stripe references are excluded",async () => {
    for (const change of ["type","cart","pi","session"]) {
      const e = await event(); const t = await tier(e,2); const request = await selection(e,t,{hosted:true});
      const updates = {type:["type","promotion"],cart:["cart_id",randomUUID()],
        pi:["stripe_payment_intent_id","pi_different"],session:["stripe_checkout_session_id","cs_different"]};
      const [column,value] = updates[change]; await sql(`UPDATE orders SET ${column}=$2 WHERE id=$1`,[request.orderId,value]);
      await unchangedRejection(request);
    }
  });

  await test("a complete active legacy issuance replays original tickets even after its hold expires",async () => {
    const e = await event(); const t = await tier(e,2,0); const request = await selection(e,t,{quantity:2,hosted:true,bindPi:false});
    await insertLegacy(request);
    await sql("UPDATE ticket_holds SET expires_at=now()-interval '1 min' WHERE ticket_type_id=$1",[t]);
    const before = await snapshot(e); const result = await issue(preparedAgain(request)); successful(result);
    assert.equal(result.duplicate,true); assert.equal(result.issued_count,0);
    assert.deepEqual(result.tickets.map(row => row.id).sort(),request.rows.map(row => row.id).sort());
    const repaired = await snapshot(e);
    assert.deepEqual(repaired.tickets,before.tickets);
    assert.equal(repaired.orders[0].stripe_payment_intent_id,request.pi);
    assert.deepEqual(await inventory(t),{quantity_sold:2,tickets:2,active_holds:0,converted_holds:1});
    successful(await issue(preparedAgain(request)));
    assert.deepEqual(await snapshot(e),repaired,"already repaired replay changed database state");
  });

  await test("complete pre-group native tickets with null order links replay without new capabilities",async () => {
    const e = await event(); const t = await tier(e,2,2); const request = await selection(e,t,{quantity:2,user:"legacy-native",hold:false});
    const rows = request.rows.map(row => ({...row,order_id:null,order_index:null,order_count:null}));
    await insertLegacy(request,rows);
    await sql("UPDATE ticket_holds SET status='expired',expires_at=now()-interval '1 min' WHERE ticket_type_id=$1",[t]);
    const before = await snapshot(e); const result = await issue(preparedAgain(request)); successful(result);
    assert.equal(result.duplicate,true); assert.equal(result.issued_count,0);
    assert.deepEqual(result.tickets.map(row => row.id).sort(),rows.map(row => row.id).sort());
    assert.deepEqual(await snapshot(e),before);
  });

  await test("complete legacy replay rejects foreign buyers and mismatched active hold quantities",async () => {
    for (const change of ["buyer","undersized","oversized"]) {
      const e = await event(); const t = await tier(e,2,0); const request = await selection(e,t,{quantity:2,hosted:true,bindPi:false});
      await insertLegacy(request);
      if(change === "buyer") await sql("UPDATE ticket_holds SET guest_email='someone-else@example.test' WHERE ticket_type_id=$1",[t]);
      else await sql("UPDATE ticket_holds SET quantity=$2 WHERE ticket_type_id=$1",[t,change === "undersized" ? 1 : 3]);
      await unchangedRejection(preparedAgain(request));
    }
  });

  await test("partial or mismatched legacy ticket sets require recovery and are never topped up",async () => {
    for (const change of ["partial","tier","buyer","pi","order","count","position","duplicate_position"]) {
      const e = await event(); const t = await tier(e,5); const otherTier = await tier(e,5);
      const request = await selection(e,t,{quantity:2,hosted:true}); const rows = structuredClone(request.rows);
      if (change === "partial") rows.pop();
      if (change === "tier") rows[0].ticket_type_id=otherTier;
      if (change === "buyer") rows[0].guest_email="someone-else@example.test";
      if (change === "pi") rows[0].stripe_payment_intent_id="pi_other";
      if (change === "count") rows[0].order_count=3;
      if (change === "position") rows[0].order_index=3;
      if (change === "duplicate_position") {
        // Native legacy rows have no session uniqueness guard.
        request.session=null; request.order.stripe_checkout_session_id=null;
        await sql("UPDATE orders SET stripe_checkout_session_id=NULL WHERE id=$1",[request.orderId]);
        rows.forEach(row => { row.stripe_checkout_session_id=null; row.order_index=1; });
      }
      if (change === "order") {
        const other = await selection(e,t,{hold:false}); rows[0].order_id=other.orderId;
      }
      await insertLegacy(request,rows); await unchangedRejection(preparedAgain(request));
    }
  });

  await test("nonterminal legacy bundles reject blank QR tokens and null ticket status without repair",async () => {
    for (const change of ["blank_qr","whitespace_qr","null_status"]) {
      const e = await event(); const t = await tier(e,2,0); const request = await selection(e,t,{quantity:2,hosted:true,bindPi:false});
      const rows = structuredClone(request.rows);
      if(change === "null_status") rows[0].status=null;
      else rows[0].qr_token=change === "blank_qr" ? "" : "   ";
      await insertLegacy(request,rows);
      const before=await snapshot(e); const result=await issue(preparedAgain(request));
      rejected(result); assert.equal(result.error,"existing_tickets_invalid");
      assert.deepEqual(await snapshot(e),before,"invalid legacy capabilities changed bookkeeping");
    }
  });

  await test("complete scanned and transfer-pending legacy bundles replay their existing capabilities",async () => {
    for (const status of ["scanned","transfer_pending"]) {
      const e = await event(); const t = await tier(e,2,0); const request = await selection(e,t,{quantity:2,hold:false});
      const rows = request.rows.map(row => ({...row,status}));
      await insertLegacy(request,rows);
      const before=await snapshot(e); const result=await issue(preparedAgain(request)); successful(result);
      assert.equal(result.duplicate,true); assert.equal(result.issued_count,0);
      assert.deepEqual(result.tickets.map(row => row.id).sort(),rows.map(row => row.id).sort());
      assert.deepEqual((await snapshot(e)).tickets,before.tickets);
      assert.deepEqual(await inventory(t),{quantity_sold:2,tickets:2,active_holds:0,converted_holds:0});
    }
  });

  await test("refunded, partially refunded, or disputed orders replay as terminal without ticket capabilities",async () => {
    for (const status of ["refunded","partially_refunded","disputed"]) {
      const e = await event(); const t = await tier(e,1); const request = await selection(e,t);
      successful(await issue(request)); await sql("UPDATE orders SET status=$2 WHERE id=$1",[request.orderId,status]);
      const before = await snapshot(e); const result = await issue(preparedAgain(request)); successful(result);
      assert.equal(result.duplicate,true); assert.equal(result.terminal,true); assert.equal(result.issued_count,0);
      assert.deepEqual(result.tickets,[]); assert.deepEqual(await snapshot(e),before);
    }
  });

  await test("refunded or void tickets never reissue or return delivery capabilities",async () => {
    for (const status of ["refunded","void"]) {
      const e = await event(); const t = await tier(e,2); const request = await selection(e,t,{quantity:2});
      successful(await issue(request)); await sql("UPDATE tickets SET status=$2 WHERE order_id=$1",[request.orderId,status]);
      // Terminal tickets never return capabilities, even if a legacy QR is malformed.
      await sql("UPDATE tickets SET qr_token=$2 WHERE id=$1",[request.rows[0].id,status === "refunded" ? "     " : "       "]);
      const before = await snapshot(e); const result = await issue(preparedAgain(request)); successful(result);
      assert.equal(result.terminal,true); assert.equal(result.duplicate,true); assert.equal(result.issued_count,0);
      assert.deepEqual(result.tickets,[]); assert.deepEqual(await snapshot(e),before);
    }
  });

  await test("a duplicate QR constraint failure rolls back the complete multi-ticket insert",async () => {
    const e = await event(); const t = await tier(e,2); const request = await selection(e,t,{quantity:2});
    request.rows[1].qr_token=request.rows[0].qr_token;
    const before=await snapshot(e);
    await assert.rejects(() => issue(request),error => error.code === "23505");
    assert.deepEqual(await snapshot(e),before);
    successful(await issue(preparedAgain(request)));
  });

  // AFTER triggers prove that even a failure after a write reverses every
  // earlier ticket, sold-counter, hold-conversion, and PI-binding mutation.
  await sql(`CREATE FUNCTION public.harness_fail_paid_issuance() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('harness.fail_stage',true) = TG_ARGV[0] THEN
        RAISE EXCEPTION 'harness forced failure at %',TG_ARGV[0];
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER harness_fail_ticket AFTER INSERT ON tickets FOR EACH ROW
      EXECUTE FUNCTION harness_fail_paid_issuance('ticket');
    CREATE TRIGGER harness_fail_counter AFTER UPDATE ON ticket_types FOR EACH ROW
      EXECUTE FUNCTION harness_fail_paid_issuance('counter');
    CREATE TRIGGER harness_fail_conversion AFTER UPDATE OF status ON ticket_holds FOR EACH ROW
      WHEN (NEW.status='converted') EXECUTE FUNCTION harness_fail_paid_issuance('conversion');
    CREATE TRIGGER harness_fail_order AFTER UPDATE ON orders FOR EACH ROW
      EXECUTE FUNCTION harness_fail_paid_issuance('order');`);
  for (const stage of ["ticket","counter","conversion","order"]) {
    await test(`a SQL failure after ${stage} reverses all issuance writes and permits a clean retry`,async () => {
      const e = await event(); const t = await tier(e,2); const request = await selection(e,t,{quantity:2,hosted:true,bindPi:false});
      const before = await snapshot(e); const client = await pool.connect();
      try {
        await client.query("SELECT set_config('harness.fail_stage',$1,false)",[stage]);
        await assert.rejects(() => issue(request,client),/harness forced failure/);
      } finally { await client.query("RESET harness.fail_stage"); client.release(); }
      assert.deepEqual(await snapshot(e),before);
      successful(await issue(request));
      assert.deepEqual(await inventory(t),{quantity_sold:2,tickets:2,active_holds:0,converted_holds:1});
    });
  }

  for (const stage of ["counter","conversion","order"]) {
    await test(`a SQL failure during legacy replay ${stage} repair rolls back every repair without reissue`,async () => {
      const e = await event(); const t = await tier(e,2,0); const request = await selection(e,t,{quantity:2,hosted:true,bindPi:false});
      await insertLegacy(request);
      await sql("UPDATE ticket_holds SET expires_at=now()-interval '1 min' WHERE ticket_type_id=$1",[t]);
      const before = await snapshot(e); const client = await pool.connect();
      try {
        await client.query("SELECT set_config('harness.fail_stage',$1,false)",[stage]);
        await assert.rejects(() => issue(preparedAgain(request),client),/harness forced failure/);
      } finally { await client.query("RESET harness.fail_stage"); client.release(); }
      assert.deepEqual(await snapshot(e),before);
      const result=await issue(preparedAgain(request)); successful(result);
      assert.equal(result.duplicate,true); assert.equal(result.issued_count,0);
      assert.deepEqual(result.tickets.map(row => row.id).sort(),request.rows.map(row => row.id).sort());
      assert.deepEqual(await inventory(t),{quantity_sold:2,tickets:2,active_holds:0,converted_holds:1});
      assert.equal((await snapshot(e)).orders[0].stripe_payment_intent_id,request.pi);
    });
  }

  console.log(`\nPASS: ${passed} real PostgreSQL paid-ticket issuance regressions; multi-connection lock barriers verified.`);
} finally {
  await pool.end();
  teardown();
}
