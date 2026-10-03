#!/usr/bin/env node
/**
 * Runs execute_event_consolidation against a real Postgres, because every
 * defect it had lives in SQL semantics a unit test of the edge handler cannot
 * reach: `jsonb ? NULL` returning NULL, a trigger column list, and a capacity
 * check that is only correct if it holds a row lock.
 *
 * Boots a throwaway socket-only cluster (same approach as
 * verify-call-capacity.mjs), builds a fixture of only the tables and columns
 * the consolidation touches, replays the real attendee-trigger lineage, the
 * real atomic hold RPC and the consolidation migration, then asserts:
 *
 *   1. destination auth: a host of the source cannot push into an event they
 *      do not administer; an accepted admin co-organizer of both can.
 *   2. capacity: incoming tickets are refused past quantity_total minus sold
 *      minus live cart and legacy holds, and a hold racing the move for the
 *      last seat waits on the tier lock and is then refused.
 *   3. NULL tier: a tier-less RSVP ticket blocks the move instead of slipping
 *      past the map guard.
 *   4. total_attendees: moving a ticket between events recounts both.
 *
 *   node scripts/verify-event-consolidation.mjs
 *   node scripts/verify-event-consolidation.mjs --allow-skip   # no Postgres
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
    "verify-event-consolidation: no complete Postgres server install found. " +
    "The consolidation assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-consolidation-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-consolidation-sock-"));
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

pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 6 });
const sql = async (text, values) => (await pool.query(text, values)).rows;

// Production column names and nullability for what the consolidation reads.
// tickets.ticket_type_id is nullable, as in production
// (20260334_tickets_nullable_ticket_type.sql): that is defect 3.
await sql(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.events (
  id SERIAL PRIMARY KEY,
  host_id TEXT,
  total_attendees INTEGER DEFAULT 0
);
CREATE TABLE public.event_co_organizers (
  event_id INTEGER NOT NULL REFERENCES public.events(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  accepted BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE public.ticket_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES public.events(id),
  quantity_total INTEGER,
  quantity_sold INTEGER DEFAULT 0
);
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES public.events(id),
  ticket_type_id UUID REFERENCES public.ticket_types(id),
  status TEXT NOT NULL DEFAULT 'active',
  user_id TEXT,
  guest_email TEXT,
  guest_lookup_token TEXT,
  purchase_amount_cents INTEGER,
  qr_token TEXT
);
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER REFERENCES public.events(id),
  status TEXT,
  total_cents INTEGER,
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT
);
CREATE TABLE public.event_rsvps (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES public.events(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'going'
);
CREATE TABLE public.cart_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id UUID NOT NULL,
  qty INTEGER NOT NULL,
  released BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE public.ticket_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  ticket_type_id UUID NOT NULL,
  event_id INTEGER,
  quantity INTEGER NOT NULL,
  payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  guest_email TEXT,
  hold_kind TEXT
);
`);

const read = (file) => readFileSync(join(MIGRATIONS, file), "utf8");
// Attendee-trigger lineage as production runs it: the distinct-user recompute
// and its triggers, then the ('active','scanned') widening. Only the recompute
// function is lifted from the later file; its other bodies need tables
// (users, media) this fixture does not model.
await sql(read("20260521000137_v2_db_06_fix_total_attendees_distinct_users.sql"));
const going = read("20260918000000_going_survives_check_in.sql").match(
  /CREATE OR REPLACE FUNCTION public\.recompute_event_total_attendees[\s\S]*?\$\$;/,
);
assert.ok(going, "20260918000000 no longer defines recompute_event_total_attendees");
await sql(going[0]);
await sql(read("20260915172318_atomic_legacy_ticket_hold.sql"));
await sql(read("20261002200000_event_consolidation_tooling.sql"));

// ── helpers ──────────────────────────────────────────────────────────────────
const event = async (host) =>
  (await sql(`INSERT INTO events (host_id) VALUES ($1) RETURNING id`, [host]))[0].id;
const tier = async (eventId, total = null, sold = 0) =>
  (
    await sql(
      `INSERT INTO ticket_types (event_id, quantity_total, quantity_sold) VALUES ($1,$2,$3) RETURNING id`,
      [eventId, total, sold],
    )
  )[0].id;
const ticket = async (eventId, tierId, user) =>
  (
    await sql(
      `INSERT INTO tickets (event_id, ticket_type_id, user_id) VALUES ($1,$2,$3) RETURNING id`,
      [eventId, tierId, user],
    )
  )[0].id;
const hash = async (src, dst) =>
  (await sql(`SELECT event_consolidation_snapshot($1,$2)->>'fingerprint' AS f`, [src, dst]))[0].f;
const consolidate = async (src, dst, actor, map, client = pool) =>
  (
    await client.query(
      `SELECT execute_event_consolidation($1,$2,$3,gen_random_uuid(),$4,$5::jsonb) AS r`,
      [src, dst, actor, await hash(src, dst), JSON.stringify(map)],
    )
  ).rows[0].r;
const countOn = async (eventId) =>
  Number((await sql(`SELECT count(*) AS n FROM tickets WHERE event_id = $1`, [eventId]))[0].n);
const attendees = async (eventId) =>
  (await sql(`SELECT total_attendees AS n FROM events WHERE id = $1`, [eventId]))[0].n;

// ── 1. destination authorization ─────────────────────────────────────────────
{
  const src = await event("attacker");
  const victim = await event("victim");
  const srcTier = await tier(src);
  const victimTier = await tier(victim);
  await ticket(src, srcTier, "comp-1");

  const denied = await consolidate(src, victim, "attacker", { [srcTier]: victimTier });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "Actor cannot consolidate into destination event");
  assert.equal(await countOn(victim), 0, "a refused move still moved tickets");

  // A pending (not accepted) invite is not authority.
  await sql(
    `INSERT INTO event_co_organizers (event_id, user_id, role, accepted) VALUES ($1,'attacker','admin',false)`,
    [victim],
  );
  assert.equal((await consolidate(src, victim, "attacker", { [srcTier]: victimTier })).ok, false);

  await sql(`UPDATE event_co_organizers SET accepted = true WHERE event_id = $1`, [victim]);
  const allowed = await consolidate(src, victim, "attacker", { [srcTier]: victimTier });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  assert.equal(allowed.moved_count, 1);
  console.log("-. OK: destination must be administered by the actor (host or accepted admin)");
}

// ── 2. capacity ──────────────────────────────────────────────────────────────
{
  const src = await event("host");
  const dst = await event("host");
  const srcTier = await tier(src);
  // 4 seats, 1 sold, 1 in a live cart hold, 1 in a live legacy hold: 1 left.
  const dstTier = await tier(dst, 4, 1);
  await sql(`INSERT INTO cart_holds (tier_id, qty, expires_at) VALUES ($1, 1, now() + interval '10 min')`, [dstTier]);
  await sql(
    `INSERT INTO ticket_holds (ticket_type_id, event_id, quantity, expires_at) VALUES ($1,$2,1, now() + interval '10 min')`,
    [dstTier, dst],
  );
  // Expired and released holds must not count.
  await sql(`INSERT INTO cart_holds (tier_id, qty, released, expires_at) VALUES ($1, 9, true, now() + interval '10 min')`, [dstTier]);
  await sql(`INSERT INTO ticket_holds (ticket_type_id, quantity, expires_at) VALUES ($1, 9, now() - interval '1 min')`, [dstTier]);

  await ticket(src, srcTier, "a");
  await ticket(src, srcTier, "b");
  const over = await consolidate(src, dst, "host", { [srcTier]: dstTier });
  assert.equal(over.ok, false);
  assert.equal(over.error, "Destination tier capacity would be exceeded");
  assert.equal(await countOn(dst), 0);

  await sql(`UPDATE tickets SET status = 'void' WHERE user_id = 'b'`);
  const fits = await consolidate(src, dst, "host", { [srcTier]: dstTier });
  assert.equal(fits.ok, true, JSON.stringify(fits));
  console.log("-. OK: capacity counts sold + live cart holds + live legacy holds, ignores dead holds");

  // Unlimited tier is not read as zero.
  const src2 = await event("host");
  const t2 = await tier(src2);
  const unlimited = await tier(dst, null, 500);
  await ticket(src2, t2, "c");
  assert.equal((await consolidate(src2, dst, "host", { [t2]: unlimited })).ok, true);
  console.log("-. OK: NULL quantity_total is unlimited");
}

// Race: the move holds the destination tier lock; a buyer for the last seat
// waits on it, then sees the moved ticket in quantity_sold and is refused.
{
  const src = await event("host");
  const dst = await event("host");
  const srcTier = await tier(src);
  const dstTier = await tier(dst, 1, 0);
  await ticket(src, srcTier, "racer");

  const mover = await pool.connect();
  const buyer = await pool.connect();
  try {
    await mover.query("BEGIN");
    const moved = await consolidate(src, dst, "host", { [srcTier]: dstTier }, mover);
    assert.equal(moved.ok, true, JSON.stringify(moved));

    let settled = false;
    const hold = buyer
      .query(`SELECT ticket_hold_create_atomic($1, 1) AS r`, [dstTier])
      .then((r) => ((settled = true), r.rows[0].r));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(settled, false, "the hold did not wait for the move's tier lock");

    await mover.query("COMMIT");
    const result = await hold;
    assert.equal(result.ok, false, `last seat sold twice: ${JSON.stringify(result)}`);
    assert.equal(result.error, "insufficient_inventory");
  } finally {
    mover.release();
    buyer.release();
  }
  console.log("-. OK: a concurrent hold for the last seat waits on the tier lock and is refused");
}

// The other order: a buyer is mid-checkout holding the last seat when the move
// starts. Without the move's own FOR UPDATE on the tier, its capacity check
// reads the pre-hold snapshot, passes, and both the hold and the move land.
{
  const src = await event("host");
  const dst = await event("host");
  const srcTier = await tier(src);
  const dstTier = await tier(dst, 1, 0);
  await ticket(src, srcTier, "late");

  const mover = await pool.connect();
  const buyer = await pool.connect();
  try {
    await buyer.query("BEGIN");
    const held = (await buyer.query(`SELECT ticket_hold_create_atomic($1, 1) AS r`, [dstTier])).rows[0].r;
    assert.equal(held.ok, true, JSON.stringify(held));

    const fingerprint = await hash(src, dst);
    let settled = false;
    const move = mover
      .query(
        `SELECT execute_event_consolidation($1,$2,'host',gen_random_uuid(),$3,$4::jsonb) AS r`,
        [src, dst, fingerprint, JSON.stringify({ [srcTier]: dstTier })],
      )
      .then((r) => ((settled = true), r.rows[0].r));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(settled, false, "the move did not wait for the buyer's tier lock");

    await buyer.query("COMMIT");
    const result = await move;
    assert.equal(result.ok, false, `last seat sold twice: ${JSON.stringify(result)}`);
    assert.equal(result.error, "Destination tier capacity would be exceeded");
    assert.equal(await countOn(dst), 0);
  } finally {
    mover.release();
    buyer.release();
  }
  console.log("-. OK: a move racing an open hold for the last seat waits and is refused");
}

// ── 3. NULL-tier tickets ─────────────────────────────────────────────────────
{
  // The predicate the guard originally used, on its own: NULL, not true.
  const [{ flagged }] = await sql(`SELECT NOT ('{}'::jsonb ? NULL::text) AS flagged`);
  assert.equal(flagged, null, "jsonb ? NULL semantics changed; revisit the guard");

  const src = await event("host");
  const dst = await event("host");
  const srcTier = await tier(src);
  const dstTier = await tier(dst);
  await ticket(src, srcTier, "paid");
  await ticket(src, null, "free-rsvp");

  const refused = await consolidate(src, dst, "host", { [srcTier]: dstTier });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /tier-less RSVP/);
  assert.equal(await countOn(dst), 0, "a NULL-tier ticket moved past the guard");
  assert.equal(await countOn(src), 2);
  console.log("-. OK: a NULL-tier ticket refuses the move instead of slipping through");
}

// ── 4. total_attendees follows event_id ──────────────────────────────────────
{
  const [{ def }] = await sql(
    `SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'trg_maintain_event_total_attendees'`,
  );
  assert.match(def, /UPDATE OF status, event_id/);

  const a = await event("host");
  const b = await event("host");
  const t = await ticket(a, await tier(a), "u1");
  await ticket(a, await tier(a), "u2");
  await sql(`INSERT INTO event_rsvps (event_id, user_id) VALUES ($1, 'u3')`, [b]);
  assert.equal(await attendees(a), 2);
  assert.equal(await attendees(b), 1);

  await sql(`UPDATE tickets SET event_id = $1 WHERE id = $2`, [b, t]);
  assert.equal(await attendees(a), 1, "old event kept counting a moved ticket");
  assert.equal(await attendees(b), 2, "new event never counted the moved ticket");

  // Through the RPC: every ticket leaves the source.
  const src = await event("host");
  const dst = await event("host");
  const srcTier = await tier(src);
  const dstTier = await tier(dst);
  await ticket(src, srcTier, "x");
  await ticket(src, srcTier, "y");
  await ticket(dst, dstTier, "x"); // same user on both: counted once
  assert.equal(await attendees(src), 2);
  assert.equal(await attendees(dst), 1);
  assert.equal((await consolidate(src, dst, "host", { [srcTier]: dstTier })).ok, true);
  assert.equal(await attendees(src), 0);
  assert.equal(await attendees(dst), 2);
  const [{ sold }] = await sql(`SELECT quantity_sold AS sold FROM ticket_types WHERE id = $1`, [dstTier]);
  assert.equal(sold, 3);
  console.log("-. OK: total_attendees recounts both events when tickets change event");
}

await pool.end();
pool = null;
console.log("verify-event-consolidation: all assertions passed");
