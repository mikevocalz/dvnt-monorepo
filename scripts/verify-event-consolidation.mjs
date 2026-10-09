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
 *   5. max_attendees: a move that would put the destination over its event
 *      cap (distinct attendees, as the trigger counts them) is refused; NULL
 *      is unlimited.
 *   6. order_addons and checkins of moved tickets move with them.
 *   7. a before/after snapshot that does not reconcile raises, and the whole
 *      move rolls back.
 *   8. moved add-on purchases are re-pointed at the destination catalog item
 *      named in p_addon_map and quantity_sold moves with them; an unmapped
 *      add-on refuses the move; destination add-on capacity is enforced.
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
  total_attendees INTEGER DEFAULT 0,
  max_attendees NUMERIC
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
-- order_addons and checkins as production has them (20260613145014,
-- 20260313_catchup_all, 20260806100200, 20260806300000; checked live with
-- information_schema). Live has no FK from checkins to tickets or events.
CREATE TABLE public.ticket_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'drink',
  price_cents INTEGER NOT NULL DEFAULT 0,
  quantity_total INTEGER,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  quantity_held INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT ticket_addons_qty_nonneg CHECK (quantity_sold >= 0 AND quantity_held >= 0)
);
CREATE TABLE public.ticket_addon_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID NOT NULL REFERENCES public.ticket_addons(id) ON DELETE CASCADE,
  quantity_total INTEGER,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  quantity_held INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE public.order_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  addon_id UUID NOT NULL REFERENCES public.ticket_addons(id) ON DELETE RESTRICT,
  variant_id UUID,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  user_id TEXT,
  guest_email TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unfulfilled',
  qr_token TEXT
);
CREATE TABLE public.checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID,
  event_id INTEGER NOT NULL,
  result TEXT NOT NULL,
  order_addon_id UUID REFERENCES public.order_addons(id) ON DELETE SET NULL
);
CREATE TABLE public.event_rsvps (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES public.events(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'going'
);
CREATE TABLE public.cart_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id UUID,
  addon_id UUID,
  variant_id UUID,
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
// --baseline-followups replays the schema as it stood before the 2026-10-09
// add-on follow-ups, so section 10 can be shown failing against the old SQL.
if (!process.argv.includes("--baseline-followups")) {
  await sql(read("20261009100000_addon_capacity_counts_variants_and_holds.sql").replace(
    /CREATE OR REPLACE FUNCTION public\.cart_create_hold[\s\S]*$/, ""));
  await sql(read("20261009100100_event_consolidation_addon_capacity.sql"));
}

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
const consolidate = async (src, dst, actor, map, client = pool, addonMap = {}) =>
  (
    await client.query(
      `SELECT execute_event_consolidation($1,$2,$3,gen_random_uuid(),$4,$5::jsonb,$6::jsonb) AS r`,
      [src, dst, actor, await hash(src, dst), JSON.stringify(map), JSON.stringify(addonMap)],
    )
  ).rows[0].r;
const catalogAddon = async (eventId, total = null, sold = 0, held = 0) =>
  (
    await sql(
      `INSERT INTO ticket_addons (event_id, quantity_total, quantity_sold, quantity_held) VALUES ($1,$2,$3,$4) RETURNING id`,
      [eventId, total, sold, held],
    )
  )[0].id;
const buyAddon = async (eventId, addonId, ticketId, user, quantity = 1) =>
  (
    await sql(
      `INSERT INTO order_addons (event_id, addon_id, ticket_id, user_id, quantity) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [eventId, addonId, ticketId, user, quantity],
    )
  )[0].id;
const addonRow = async (id) =>
  (await sql(`SELECT event_id, quantity_sold FROM ticket_addons WHERE id = $1`, [id]))[0];
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

// ── 5. events.max_attendees ──────────────────────────────────────────────────
{
  // Destination capped at 3. It already has u1 (ticket) and u2 (going RSVP).
  // The source brings u1 again (counted once), u3 and u4: 4 distinct, over.
  const src = await event("host");
  const dst = await event("host");
  await sql(`UPDATE events SET max_attendees = 3 WHERE id = $1`, [dst]);
  const srcTier = await tier(src);
  const dstTier = await tier(dst);
  await ticket(dst, dstTier, "u1");
  await sql(`INSERT INTO event_rsvps (event_id, user_id) VALUES ($1, 'u2')`, [dst]);
  await ticket(src, srcTier, "u1");
  await ticket(src, srcTier, "u3");
  const u4 = await ticket(src, srcTier, "u4");

  const capped = await consolidate(src, dst, "host", { [srcTier]: dstTier });
  assert.equal(capped.ok, false, JSON.stringify(capped));
  assert.match(capped.error, /capped at 3 attendees; consolidating would make it 4/);
  assert.equal(await countOn(dst), 1, "a move over max_attendees still moved tickets");

  // Drop u4 to void: u1, u2, u3 is exactly 3, which fits. The duplicate u1
  // proves the count is distinct users, not tickets (tickets alone would be 4).
  await sql(`UPDATE tickets SET status = 'void' WHERE id = $1`, [u4]);
  const fits = await consolidate(src, dst, "host", { [srcTier]: dstTier });
  assert.equal(fits.ok, true, JSON.stringify(fits));
  assert.equal(await attendees(dst), 3);
  console.log("-. OK: max_attendees refuses a move past the cap, counting distinct attendees");

  // NULL max_attendees is unlimited, not zero.
  const src2 = await event("host");
  const open = await event("host");
  const t2 = await tier(src2);
  const openTier = await tier(open);
  for (const u of ["p", "q", "r"]) await ticket(src2, t2, u);
  const unlimited = await consolidate(src2, open, "host", { [t2]: openTier });
  assert.equal(unlimited.ok, true, JSON.stringify(unlimited));
  assert.equal(await countOn(open), 3);
  console.log("-. OK: NULL max_attendees is unlimited");
}

// ── 6. add-ons and check-ins follow their tickets ────────────────────────────
{
  const src = await event("host");
  const dst = await event("host");
  const other = await event("host");
  const srcTier = await tier(src);
  const dstTier = await tier(dst);
  const moving = await ticket(src, srcTier, "m");
  const voided = await ticket(src, srcTier, "v");
  await sql(`UPDATE tickets SET status = 'void' WHERE id = $1`, [voided]);

  const srcDrink = await catalogAddon(src, null, 2);
  const dstDrink = await catalogAddon(dst);
  const addon = await buyAddon(src, srcDrink, moving, "m");
  // An add-on on the void ticket stays: that ticket does not move.
  await buyAddon(src, srcDrink, voided, "v");
  await sql(`INSERT INTO checkins (ticket_id, event_id, result) VALUES ($1, $2, 'valid')`, [moving, src]);
  // An add-on scan with no ticket_id follows the add-on.
  await sql(`INSERT INTO checkins (event_id, result, order_addon_id) VALUES ($1, 'valid', $2)`, [src, addon]);
  // Scanned at another event's door: that audit row belongs to that door.
  await sql(`INSERT INTO checkins (ticket_id, event_id, result) VALUES ($1, $2, 'wrong_event')`, [moving, other]);

  const moved = await consolidate(src, dst, "host", { [srcTier]: dstTier }, pool, { [srcDrink]: dstDrink });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(moved.moved_addon_count, 1);
  assert.equal(moved.moved_checkin_count, 2);
  const addonsOn = async (e) =>
    Number((await sql(`SELECT count(*) AS n FROM order_addons WHERE event_id = $1`, [e]))[0].n);
  const checkinsOn = async (e) =>
    Number((await sql(`SELECT count(*) AS n FROM checkins WHERE event_id = $1`, [e]))[0].n);
  assert.equal(await addonsOn(dst), 1, "the moved ticket's add-on stayed on the source");
  assert.equal(await addonsOn(src), 1, "the void ticket's add-on moved");
  assert.equal(await checkinsOn(dst), 2, "check-ins for the moved ticket stayed on the source");
  assert.equal(await checkinsOn(src), 0);
  assert.equal(await checkinsOn(other), 1, "a wrong_event scan left the door it happened at");
  console.log("-. OK: order_addons and checkins of moved tickets move with them");
}

// ── 7. snapshot mismatch rolls the whole move back ───────────────────────────
{
  // Stand-in for a writer the function does not control: whenever a ticket
  // changes event, something also books an order on the destination. Orders
  // must not move, so the after snapshot cannot reconcile.
  await sql(`
    CREATE FUNCTION harness_interfere() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO orders (event_id, status, total_cents) VALUES (NEW.event_id, 'paid', 100);
      RETURN NEW;
    END $$;
    CREATE TRIGGER harness_interfere AFTER UPDATE OF event_id ON tickets
      FOR EACH ROW WHEN (current_setting('harness.interfere', true) = 'on')
      EXECUTE FUNCTION harness_interfere();
  `);
  const src = await event("host");
  const dst = await event("host");
  const srcTier = await tier(src);
  const dstTier = await tier(dst);
  const t = await ticket(src, srcTier, "s");
  const srcItem = await catalogAddon(src, null, 1);
  const dstItem = await catalogAddon(dst);
  await buyAddon(src, srcItem, t, "s");
  await sql(`INSERT INTO checkins (ticket_id, event_id, result) VALUES ($1, $2, 'valid')`, [t, src]);

  const client = await pool.connect();
  const opId = (await sql(`SELECT gen_random_uuid() AS id`))[0].id;
  try {
    await client.query(`SET harness.interfere = 'on'`);
    await assert.rejects(
      client.query(
        `SELECT execute_event_consolidation($1,$2,'host',$3,$4,$5::jsonb,$6::jsonb) AS r`,
        [src, dst, opId, await hash(src, dst), JSON.stringify({ [srcTier]: dstTier }),
         JSON.stringify({ [srcItem]: dstItem })],
      ),
      /event_consolidation_snapshot_mismatch/,
    );
    await client.query(`RESET harness.interfere`);
  } finally {
    client.release();
  }
  assert.equal(await countOn(dst), 0, "a mismatched move left tickets on the destination");
  assert.equal(await countOn(src), 1);
  const [{ n: addonsLeft }] = await sql(`SELECT count(*)::int AS n FROM order_addons WHERE event_id = $1`, [src]);
  const [{ n: checkinsLeft }] = await sql(`SELECT count(*)::int AS n FROM checkins WHERE event_id = $1`, [src]);
  assert.equal(addonsLeft, 1);
  assert.equal(checkinsLeft, 1);
  const [{ n: ordersOnDst }] = await sql(`SELECT count(*)::int AS n FROM orders WHERE event_id = $1`, [dst]);
  assert.equal(ordersOnDst, 0, "the interfering write survived the rollback");
  const [{ n: ops }] = await sql(`SELECT count(*)::int AS n FROM event_consolidation_operations WHERE operation_id = $1`, [opId]);
  assert.equal(ops, 0, "a rolled-back move left an operation row, blocking a retry");
  const [{ n: ledger }] = await sql(`SELECT count(*)::int AS n FROM event_consolidation_ticket_ledger WHERE operation_id = $1`, [opId]);
  assert.equal(ledger, 0);
  assert.equal((await addonRow(srcItem)).quantity_sold, 1, "a rolled-back move still shifted add-on stock");
  assert.equal((await addonRow(dstItem)).quantity_sold, 0);
  console.log("-. OK: a snapshot mismatch raises and nothing moves");
}

// ── 8. add-ons are remapped onto the destination catalog ─────────────────────
{
  const addonsOn = async (e) =>
    (await sql(`SELECT addon_id FROM order_addons WHERE event_id = $1 ORDER BY id`, [e])).map((r) => r.addon_id);

  // 8a. A moved purchase points at the mapped destination item, and the sold
  // quantity leaves the source item and lands on the destination item.
  {
    const src = await event("host");
    const dst = await event("host");
    const srcTier = await tier(src);
    const dstTier = await tier(dst);
    const t = await ticket(src, srcTier, "buyer");
    const srcDrink = await catalogAddon(src, 10, 3); // 3 sold: this buyer's 3
    const dstDrink = await catalogAddon(dst, 10, 1);
    await buyAddon(src, srcDrink, t, "buyer", 3);

    const r = await consolidate(src, dst, "host", { [srcTier]: dstTier }, pool, { [srcDrink]: dstDrink });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.moved_addon_quantity, 3);
    assert.deepEqual(await addonsOn(dst), [dstDrink], "moved purchase still points at the source catalog item");
    assert.equal((await addonRow(srcDrink)).quantity_sold, 0, "source add-on kept counting moved stock");
    assert.equal((await addonRow(dstDrink)).quantity_sold, 4, "destination add-on never counted moved stock");
    const [{ n }] = await sql(
      `SELECT count(*)::int AS n FROM event_consolidation_addon_ledger WHERE source_addon_id = $1 AND destination_addon_id = $2 AND quantity = 3`,
      [srcDrink, dstDrink],
    );
    assert.equal(n, 1);
    console.log("-. OK: a moved add-on points at the mapped destination item and its sold count moves");
  }

  // 8b. No mapping for a moved add-on: the whole move refuses.
  {
    const src = await event("host");
    const dst = await event("host");
    const srcTier = await tier(src);
    const dstTier = await tier(dst);
    const t = await ticket(src, srcTier, "buyer");
    const srcDrink = await catalogAddon(src, null, 1);
    await catalogAddon(dst);
    await buyAddon(src, srcDrink, t, "buyer");

    await assert.rejects(
      consolidate(src, dst, "host", { [srcTier]: dstTier }),
      /event_consolidation_addon_unmapped/,
    );
    assert.equal(await countOn(dst), 0, "an unmapped add-on still let tickets move");
    assert.deepEqual(await addonsOn(src), [srcDrink]);
    assert.equal((await addonRow(srcDrink)).quantity_sold, 1);
    // A map entry pointing at an item outside the destination is also refused.
    const elsewhere = await catalogAddon(await event("host"));
    await assert.rejects(
      consolidate(src, dst, "host", { [srcTier]: dstTier }, pool, { [srcDrink]: elsewhere }),
      /event_consolidation_addon_map_invalid/,
    );
    assert.equal(await countOn(dst), 0);
    console.log("-. OK: an unmapped add-on refuses the move and nothing moves");
  }

  // 8c. Destination add-on capacity: 5 total, 2 sold, 1 held, 1 in a live
  // cart hold leaves 1. Bringing 2 is refused; bringing 1 fits.
  {
    const src = await event("host");
    const dst = await event("host");
    const srcTier = await tier(src);
    const dstTier = await tier(dst);
    const a = await ticket(src, srcTier, "a");
    const b = await ticket(src, srcTier, "b");
    const srcDrink = await catalogAddon(src, null, 2);
    const dstDrink = await catalogAddon(dst, 5, 2, 1);
    await sql(`INSERT INTO cart_holds (addon_id, qty, expires_at) VALUES ($1, 1, now() + interval '10 min')`, [dstDrink]);
    // Dead holds must not count.
    await sql(`INSERT INTO cart_holds (addon_id, qty, released, expires_at) VALUES ($1, 9, true, now() + interval '10 min')`, [dstDrink]);
    await sql(`INSERT INTO cart_holds (addon_id, qty, expires_at) VALUES ($1, 9, now() - interval '1 min')`, [dstDrink]);
    await buyAddon(src, srcDrink, a, "a");
    await buyAddon(src, srcDrink, b, "b");

    const over = await consolidate(src, dst, "host", { [srcTier]: dstTier }, pool, { [srcDrink]: dstDrink });
    assert.equal(over.ok, false, JSON.stringify(over));
    assert.equal(over.error, "Destination add-on capacity would be exceeded");
    assert.equal(await countOn(dst), 0);
    assert.equal((await addonRow(dstDrink)).quantity_sold, 2);

    await sql(`UPDATE tickets SET status = 'void' WHERE id = $1`, [b]);
    const fits = await consolidate(src, dst, "host", { [srcTier]: dstTier }, pool, { [srcDrink]: dstDrink });
    assert.equal(fits.ok, true, JSON.stringify(fits));
    assert.equal((await addonRow(dstDrink)).quantity_sold, 3);
    assert.equal((await addonRow(srcDrink)).quantity_sold, 1, "the void ticket's add-on stock left the source");
    console.log("-. OK: destination add-on capacity counts sold + held + live cart holds and refuses an oversell");
  }
}

// ── 9. add-on refunds (20261009010000) ───────────────────────────────────────
// Lives here because this cluster already models orders, ticket_addons and
// order_addons. Adds the cart tables cart_apply_line_refund reads, replays the
// original RPC (20260516170000) and then the add-on migration over it.
// --baseline skips the add-on migration, so every assertion below should fail.
{
  await sql(`
  ALTER TABLE public.tickets
    ADD COLUMN cart_id UUID, ADD COLUMN cart_line_item_id UUID,
    ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  ALTER TABLE public.orders
    ADD COLUMN cart_id UUID, ADD COLUMN refunded_at TIMESTAMPTZ,
    ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  ALTER TABLE public.ticket_addon_variants
    ADD CONSTRAINT addon_variant_qty_nonneg CHECK (quantity_sold >= 0);
  ALTER TABLE public.order_addons
    ADD COLUMN cart_id UUID, ADD COLUMN cart_line_item_id UUID,
    ADD COLUMN unit_price_cents INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT order_addons_status_check
      CHECK (status IN ('unfulfilled','fulfilled','redeemed','refunded'));
  CREATE TABLE public.carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL, event_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed', stripe_pi_id TEXT
  );
  CREATE TABLE public.cart_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL REFERENCES public.carts(id),
    category TEXT NOT NULL,
    tier_id UUID REFERENCES public.ticket_types(id),
    addon_id UUID REFERENCES public.ticket_addons(id),
    variant_id UUID REFERENCES public.ticket_addon_variants(id),
    quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL,
    refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT cart_line_items_target_check CHECK ((tier_id IS NOT NULL) <> (addon_id IS NOT NULL))
  );
  CREATE TABLE public.cart_line_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL, line_item_id UUID NOT NULL,
    stripe_refund_id TEXT, stripe_payment_intent_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending', updated_at TIMESTAMPTZ DEFAULT now()
  );
  `);
  await sql(read("20260516170000_cart_line_refund_rpc.sql"));
  if (!process.argv.includes("--baseline")) {
    await sql(read("20261009010000_cart_line_refund_addons.sql"));
  }

  const ev = await event("host");
  const gaTier = await tier(ev, null, 1);
  const coat = (await sql(
    `INSERT INTO ticket_addons (event_id, quantity_sold) VALUES ($1, 3) RETURNING id`, [ev],
  ))[0].id;
  const shirt = await catalogAddon(ev);
  const shirtM = (await sql(
    `INSERT INTO ticket_addon_variants (addon_id, quantity_sold) VALUES ($1, 2) RETURNING id`, [shirt],
  ))[0].id;
  const cart = (await sql(
    `INSERT INTO carts (user_id, event_id, stripe_pi_id) VALUES ('buyer', $1, 'pi_addon') RETURNING id`, [ev],
  ))[0].id;
  await sql(`INSERT INTO orders (event_id, status, cart_id) VALUES ($1, 'paid', $2)`, [ev, cart]);
  const line = async (fields) =>
    (await sql(
      `INSERT INTO cart_line_items (cart_id, category, tier_id, addon_id, variant_id, quantity, unit_price_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [cart, fields.category, fields.tier ?? null, fields.addon ?? null, fields.variant ?? null, fields.qty, fields.price],
    ))[0].id;
  const purchase = async (lineId, addonId, variantId, qty, price, status = "unfulfilled") =>
    (await sql(
      `INSERT INTO order_addons (event_id, addon_id, variant_id, cart_id, cart_line_item_id, user_id, quantity, unit_price_cents, status)
       VALUES ($1,$2,$3,$4,$5,'buyer',$6,$7,$8) RETURNING id`,
      [ev, addonId, variantId, cart, lineId, qty, price, status],
    ))[0].id;
  const ticketLine = await line({ category: "admission", tier: gaTier, qty: 1, price: 2500 });
  await sql(
    `INSERT INTO tickets (event_id, ticket_type_id, user_id, cart_id, cart_line_item_id) VALUES ($1,$2,'buyer',$3,$4)`,
    [ev, gaTier, cart, ticketLine],
  );
  const coatLine = await line({ category: "addon", addon: coat, qty: 2, price: 500 });
  const coatRow = await purchase(coatLine, coat, null, 2, 500);
  const shirtLine = await line({ category: "addon", addon: shirt, variant: shirtM, qty: 1, price: 3000 });
  const shirtRow = await purchase(shirtLine, shirt, shirtM, 1, 3000);
  const redeemedLine = await line({ category: "addon", addon: coat, qty: 1, price: 500 });
  const redeemedRow = await purchase(redeemedLine, coat, null, 1, 500, "redeemed");

  const applyRefund = async (lineId, amount) =>
    (await sql(`SELECT cart_apply_line_refund($1,$2,'re_'||$3,$4,'k_'||$3) AS r`, [cart, lineId, lineId, amount]))[0].r;
  const addonState = async (id) =>
    (await sql(`SELECT status, refunded_amount_cents AS refunded FROM order_addons WHERE id = $1`, [id]))[0];
  const sold = async (table, id) =>
    (await sql(`SELECT quantity_sold AS n FROM ${table} WHERE id = $1`, [id]))[0].n;

  // 9a. An add-on line refund flips its purchase row and returns its stock.
  const coatResult = await applyRefund(coatLine, 1000);
  assert.equal(coatResult.ok, true, JSON.stringify(coatResult));
  assert.deepEqual(await addonState(coatRow), { status: "refunded", refunded: 1000 });
  assert.equal(await sold("ticket_addons", coat), 1, "coat check stock did not come back (3 sold - 2 refunded)");
  assert.equal(coatResult.addonRows?.length, 1);
  console.log("-. OK: an add-on line refund marks order_addons refunded and decrements ticket_addons.quantity_sold");

  // 9b. A variant line returns stock to the variant, not the parent add-on.
  await applyRefund(shirtLine, 3000);
  assert.deepEqual(await addonState(shirtRow), { status: "refunded", refunded: 3000 });
  assert.equal(await sold("ticket_addon_variants", shirtM), 1);
  assert.equal(await sold("ticket_addons", shirt), 0, "variant refund touched the parent add-on");
  console.log("-. OK: a variant line refund decrements ticket_addon_variants.quantity_sold only");

  // 9c. Ticket lines behave as before: tickets flip, nothing add-on side moves.
  const ticketResult = await applyRefund(ticketLine, 2500);
  assert.equal(ticketResult.ticketRows.length, 1);
  assert.equal((await sql(`SELECT status FROM tickets WHERE cart_line_item_id = $1`, [ticketLine]))[0].status, "refunded");
  assert.equal(await sold("ticket_addons", coat), 1);
  console.log("-. OK: ticket line refunds still flip tickets and leave add-on stock alone");

  // 9d. Full-charge refund: only live rows flip, the second run is a no-op,
  // a redeemed row keeps its status and stock but records the money.
  const fresh = await purchase(coatLine, coat, null, 1, 500);
  await sql(`UPDATE ticket_addons SET quantity_sold = quantity_sold + 1 WHERE id = $1`, [coat]);
  const first = (await sql(`SELECT refund_order_addons_for_cart($1) AS n`, [cart]))[0].n;
  assert.equal(first, 1, "only the one live row should flip");
  assert.deepEqual(await addonState(fresh), { status: "refunded", refunded: 500 });
  assert.deepEqual(await addonState(redeemedRow), { status: "redeemed", refunded: 500 });
  assert.equal(await sold("ticket_addons", coat), 1, "redeemed stock must stay sold; live stock comes back");
  assert.equal((await sql(`SELECT refund_order_addons_for_cart($1) AS n`, [cart]))[0].n, 0);
  assert.equal(await sold("ticket_addons", coat), 1, "a webhook retry returned stock twice");
  console.log("-. OK: refund_order_addons_for_cart flips live rows once, keeps redeemed rows redeemed");

  // 9e. Server-only: anon and authenticated cannot call either function.
  for (const fn of [
    "cart_apply_line_refund(uuid,uuid,text,integer,text)",
    "refund_order_addons_for_cart(uuid)",
  ]) {
    const grants = (await sql(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
              has_function_privilege('service_role', $1, 'EXECUTE') AS svc`,
      [`public.${fn}`],
    ))[0];
    assert.deepEqual(grants, { anon: false, auth: false, svc: true }, fn);
  }
  console.log("-. OK: both refund functions are executable by service_role only");
}

// ── 10. destination add-on room counts variants; refunded rows move free ─────
{
  // 10a. Destination coat check capped at 4: one variant sold, one variant
  // unit in a live cart hold, nothing sold on the parent itself. Room is 2.
  // The old check read only the parent's quantity_sold and non-variant holds
  // and saw 4.
  const src = await event("host");
  const dst = await event("host");
  const srcTier = await tier(src);
  const dstTier = await tier(dst);
  const srcItem = await catalogAddon(src, null, 3);
  const dstItem = await catalogAddon(dst, 4, 0);
  const [{ id: variant }] = await sql(
    `INSERT INTO ticket_addon_variants (addon_id, quantity_sold) VALUES ($1, 1) RETURNING id`, [dstItem]);
  await sql(
    `INSERT INTO cart_holds (addon_id, variant_id, qty, expires_at) VALUES ($1, $2, 1, now() + interval '10 min')`,
    [dstItem, variant]);
  const t = await ticket(src, srcTier, "v");
  await buyAddon(src, srcItem, t, "v", 3);
  const over = await consolidate(src, dst, "host", { [srcTier]: dstTier }, pool, { [srcItem]: dstItem });
  assert.equal(over.ok, false, `variant sales and holds ignored: ${JSON.stringify(over)}`);
  assert.equal(over.error, "Destination add-on capacity would be exceeded");
  console.log("-. OK: destination add-on room subtracts variant sales and variant cart holds");

  // 10b. A refunded purchase already gave its stock back. It still moves with
  // its ticket, but it must not be counted as incoming or shifted off the
  // source again (that under-counts the source or aborts on the CHECK).
  const src2 = await event("host");
  const dst2 = await event("host");
  const srcTier2 = await tier(src2);
  const dstTier2 = await tier(dst2);
  const srcItem2 = await catalogAddon(src2, null, 1);
  const dstItem2 = await catalogAddon(dst2, 1, 0);
  const t2 = await ticket(src2, srcTier2, "r");
  const live = await buyAddon(src2, srcItem2, t2, "r", 1);
  const refunded = await buyAddon(src2, srcItem2, t2, "r", 2);
  await sql(`UPDATE order_addons SET status = 'refunded' WHERE id = $1`, [refunded]);
  const moved = await consolidate(src2, dst2, "host", { [srcTier2]: dstTier2 }, pool, { [srcItem2]: dstItem2 });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(moved.moved_addon_count, 2, "both rows follow the ticket");
  assert.equal(Number(moved.moved_addon_quantity), 1, "only live stock moves");
  assert.equal((await addonRow(srcItem2)).quantity_sold, 0);
  assert.equal((await addonRow(dstItem2)).quantity_sold, 1);
  const [{ e }] = await sql(`SELECT event_id AS e FROM order_addons WHERE id = $1`, [live]);
  assert.equal(e, dst2);
  console.log("-. OK: refunded add-on rows move with their ticket without moving stock");
}

await pool.end();
pool = null;
console.log("verify-event-consolidation: all assertions passed");
