#!/usr/bin/env node
/**
 * Runs the phone-comp claim SQL against a real Postgres. The properties that
 * matter (single use, a second account refused, expiry, two claims racing for
 * one token) live in row locks and constraint semantics that a mocked
 * supabase client cannot reach.
 *
 * Boots a throwaway socket-only cluster (same approach as
 * verify-call-capacity.mjs), builds a fixture of only the tables and columns
 * the RPCs touch, with the production tickets_user_or_guest check, applies
 * the two 2026100219xx migrations, then asserts:
 *
 *   1. issuance returns one 43-character token per phone and the database
 *      holds only its SHA-256 hash.
 *   2. a ticket with no account, no email and no phone is still refused.
 *   3. only the host or an accepted admin co-organizer can issue.
 *   4. claim binds the ticket; the same account again is ok + already_claimed;
 *      a different account is refused.
 *   5. an expired link is refused and the ticket stays unbound.
 *   6. unknown and malformed tokens are refused.
 *   7. two sessions racing for one token: exactly one wins.
 *   8. re-comping an unclaimed phone rotates the token (old link dead) without
 *      taking another seat; re-comping a claimed phone mints nothing.
 *   9. capacity, a voided ticket, and an event that has ended.
 *
 *   node scripts/verify-comp-claims.mjs
 *   node scripts/verify-comp-claims.mjs --allow-skip   # no Postgres
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
    "verify-comp-claims: no complete Postgres server install found. " +
    "The claim assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-comp-claims-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-comp-claims-sock-"));
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

pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 8 });
const sql = async (text, values) => (await pool.query(text, values)).rows;
const one = async (text, values) => (await sql(text, values))[0];

// Production names and nullability for what the RPCs read and write. The
// tickets check is the live definition before this branch (read from
// pg_constraint on dvnt-social), so the migration's widening is exercised.
await sql(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;

CREATE TABLE public.events (
  id SERIAL PRIMARY KEY,
  host_id TEXT,
  status TEXT,
  date TIMESTAMPTZ,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ
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
  quantity_sold INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  category TEXT
);
CREATE TABLE public.cart_holds (
  tier_id UUID, qty INTEGER, released BOOLEAN DEFAULT false, expires_at TIMESTAMPTZ
);
CREATE TABLE public.ticket_holds (
  ticket_type_id UUID, quantity INTEGER, status TEXT, expires_at TIMESTAMPTZ
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
  category TEXT NOT NULL DEFAULT 'admission',
  qr_token TEXT NOT NULL UNIQUE,
  order_index INTEGER,
  order_count INTEGER,
  CONSTRAINT tickets_user_or_guest CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
);
`);

// A member ticket that predates the migration, so VALIDATE has a row to scan.
await sql(`INSERT INTO public.events (host_id, status, start_date) VALUES ('seed', 'published', now() + interval '1 day')`);
await sql(`INSERT INTO public.tickets (event_id, user_id, qr_token) VALUES (1, 'seed-user', 'seed-qr')`);

for (const file of [
  "20261002190000_phone_comp_claim_links.sql",
  "20261002190100_tickets_user_or_guest_validate.sql",
]) {
  await sql(readFileSync(join(MIGRATIONS, file), "utf8"));
}
console.log("-. OK: both migrations apply on top of the production tickets check");

const HOST = "host-auth-id";
async function makeEvent({ start = "now() + interval '2 days'", end = "NULL", total = null } = {}) {
  const ev = await one(
    `INSERT INTO public.events (host_id, status, start_date, end_date)
     VALUES ($1, 'published', ${start}, ${end}) RETURNING id`,
    [HOST],
  );
  const tier = await one(
    `INSERT INTO public.ticket_types (event_id, quantity_total, category)
     VALUES ($1, $2, 'admission') RETURNING id`,
    [ev.id, total],
  );
  return { eventId: ev.id, tierId: tier.id };
}
const issue = async (eventId, tierId, phones, actor = HOST) =>
  (await one(
    "SELECT public.issue_guest_phone_comp_tickets_atomic($1, $2, $3, $4) AS r",
    [eventId, tierId, actor, phones],
  )).r;
const claim = async (token, userId, client = pool) =>
  (await client.query("SELECT public.claim_comp_ticket($1, $2) AS r", [token, userId])).rows[0].r;

// 1. issuance + hash-only storage
const a = await makeEvent();
const first = await issue(a.eventId, a.tierId, ["+14155550134", "+447911123456"]);
assert.equal(first.ok, true, JSON.stringify(first));
assert.equal(first.links.length, 2);
for (const link of first.links) {
  assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(link.reissued, false);
}
const stored = await one(
  `SELECT count(*)::int AS plaintext FROM public.ticket_claim_links
   WHERE token_hash = ANY($1)`,
  [first.links.map((l) => l.token)],
);
assert.equal(stored.plaintext, 0, "a plaintext token is stored");
const hashed = await one(
  `SELECT count(*)::int AS n FROM public.ticket_claim_links
   WHERE token_hash = ANY(SELECT encode(extensions.digest(t, 'sha256'), 'hex') FROM unnest($1::text[]) t)`,
  [first.links.map((l) => l.token)],
);
assert.equal(hashed.n, 2);
const sold = await one("SELECT quantity_sold FROM public.ticket_types WHERE id = $1", [a.tierId]);
assert.equal(sold.quantity_sold, 2);
console.log("1. OK: one token per phone, only the SHA-256 hash is stored, two seats taken");

// 2. the widened check still refuses an ownerless ticket
await assert.rejects(
  sql(`INSERT INTO public.tickets (event_id, qr_token) VALUES ($1, 'orphan')`, [a.eventId]),
  /tickets_user_or_guest/,
);
console.log("2. OK: a ticket with no account, email or phone is refused");

// 3. authorization
const stranger = await issue(a.eventId, a.tierId, ["+14155550199"], "someone-else");
assert.deepEqual(stranger, { ok: false, error: "Not authorized to comp tickets" });
await sql(
  `INSERT INTO public.event_co_organizers (event_id, user_id, role, accepted) VALUES ($1, 'cohost', 'admin', true)`,
  [a.eventId],
);
const cohost = await issue(a.eventId, a.tierId, ["+14155550199"], "cohost");
assert.equal(cohost.ok, true);
console.log("3. OK: a stranger is refused, an accepted admin co-organizer is not");

// 4. single use, idempotent for the same account, refused for another
const [linkUs, linkUk] = first.links;
const claimed = await claim(linkUs.token, "user-a");
assert.equal(claimed.ok, true);
assert.equal(claimed.already_claimed, false);
assert.equal(claimed.ticket_id, linkUs.ticket_id);
const owner = await one("SELECT user_id FROM public.tickets WHERE id = $1", [linkUs.ticket_id]);
assert.equal(owner.user_id, "user-a");
const again = await claim(linkUs.token, "user-a");
assert.equal(again.ok, true);
assert.equal(again.already_claimed, true);
assert.deepEqual(await claim(linkUs.token, "user-b"), { ok: false, code: "claimed_by_other" });
const still = await one("SELECT user_id FROM public.tickets WHERE id = $1", [linkUs.ticket_id]);
assert.equal(still.user_id, "user-a");
console.log("4. OK: first account owns it, a repeat is idempotent, a second account is refused");

// 5. expiry
await sql(`UPDATE public.ticket_claim_links SET expires_at = now() - interval '1 second' WHERE ticket_id = $1`, [linkUk.ticket_id]);
assert.deepEqual(await claim(linkUk.token, "user-c"), { ok: false, code: "expired" });
const unbound = await one("SELECT user_id FROM public.tickets WHERE id = $1", [linkUk.ticket_id]);
assert.equal(unbound.user_id, null);
console.log("5. OK: an expired link is refused and the ticket stays unbound");

// 6. unknown and malformed tokens
assert.deepEqual(await claim("A".repeat(43), "user-c"), { ok: false, code: "invalid_token" });
assert.deepEqual(await claim("not a token", "user-c"), { ok: false, code: "invalid_token" });
assert.deepEqual(await claim(null, "user-c"), { ok: false, code: "invalid_token" });
assert.deepEqual(await claim(cohost.links[0].token, ""), { ok: false, code: "unauthenticated" });
console.log("6. OK: unknown, malformed and missing tokens are refused");

// 7. two sessions racing for one token
{
  const race = cohost.links[0];
  const c1 = await pool.connect();
  const c2 = await pool.connect();
  try {
    await c1.query("BEGIN");
    const r1 = await claim(race.token, "racer-1", c1);
    assert.equal(r1.ok, true);
    // c2 blocks on the row lock c1 holds.
    const pending = claim(race.token, "racer-2", c2);
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(settled, false, "the second claim did not wait for the first");
    await c1.query("COMMIT");
    assert.deepEqual(await pending, { ok: false, code: "claimed_by_other" });
  } finally {
    c1.release();
    c2.release();
  }
  const winner = await one("SELECT user_id FROM public.tickets WHERE id = $1", [race.ticket_id]);
  assert.equal(winner.user_id, "racer-1");

  // And an unsynchronized pile-up: eight sessions, one token.
  const pile = await issue(a.eventId, a.tierId, ["+14155550177"]);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => claim(pile.links[0].token, `piler-${i}`)),
  );
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.equal(results.filter((r) => r.code === "claimed_by_other").length, 7);
}
console.log("7. OK: racing claims serialize on the link row and exactly one wins");

// 8. re-comp: rotate unclaimed, skip claimed
{
  const b = await makeEvent();
  const orig = await issue(b.eventId, b.tierId, ["+14155550111", "+14155550122"]);
  await claim(orig.links[1].token, "user-d");
  const resend = await issue(b.eventId, b.tierId, ["+14155550111", "+14155550122"]);
  assert.equal(resend.ok, true);
  assert.equal(resend.links.length, 1);
  assert.equal(resend.links[0].reissued, true);
  assert.equal(resend.links[0].ticket_id, orig.links[0].ticket_id);
  assert.notEqual(resend.links[0].token, orig.links[0].token);
  assert.deepEqual(resend.claimed, ["+14155550122"]);
  assert.deepEqual(await claim(orig.links[0].token, "user-e"), { ok: false, code: "invalid_token" });
  assert.equal((await claim(resend.links[0].token, "user-e")).ok, true);
  const tierRow = await one("SELECT quantity_sold FROM public.ticket_types WHERE id = $1", [b.tierId]);
  assert.equal(tierRow.quantity_sold, 2, "a resend took another seat");
  const count = await one("SELECT count(*)::int AS n FROM public.tickets WHERE event_id = $1", [b.eventId]);
  assert.equal(count.n, 2);
}
console.log("8. OK: a resend rotates the token on the same ticket; a claimed phone gets nothing new");

// 9. capacity, voided ticket, ended event
{
  const c = await makeEvent({ total: 1 });
  const over = await issue(c.eventId, c.tierId, ["+14155550133", "+14155550144"]);
  assert.equal(over.ok, false);
  assert.equal(over.would_exceed, true);
  assert.equal(over.remaining, 1);
  const fits = await issue(c.eventId, c.tierId, ["+14155550133"]);
  assert.equal(fits.ok, true);
  await sql("UPDATE public.tickets SET status = 'void' WHERE id = $1", [fits.links[0].ticket_id]);
  assert.deepEqual(await claim(fits.links[0].token, "user-f"), { ok: false, code: "ticket_unavailable" });

  const ended = await makeEvent({ start: "now() - interval '2 days'", end: "now() - interval '1 day'" });
  assert.deepEqual(await issue(ended.eventId, ended.tierId, ["+14155550155"]), {
    ok: false, error: "Event has ended",
  });
  assert.deepEqual(await issue(ended.eventId, ended.tierId, ["4155550155"]), {
    ok: false, error: "Recipient phone is invalid",
  });
}
console.log("9. OK: capacity holds, a voided ticket cannot be claimed, an ended event cannot be comped");

await pool.end();
console.log("verify-comp-claims: all assertions passed");
