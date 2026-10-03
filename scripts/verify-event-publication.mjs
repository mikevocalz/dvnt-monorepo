#!/usr/bin/env node
/**
 * Runs the event publication rule (hide an event, or schedule when it goes
 * public) against a real Postgres, because the rule lives in SQL that no unit
 * test executes: can_view_event behind a RESTRICTIVE RLS policy, the listing
 * RPCs, the share-token lookup and guest RSVP issuance.
 *
 * It boots a throwaway cluster, builds a fixture with only the tables and
 * columns those functions read, seeds events BEFORE the migration (so the
 * is_hidden default on existing rows is exercised, not assumed), then applies
 * 20261003110000_event_hide_and_publish_at.sql and
 * 20261003120000_discovery_rpcs_return_event_tz.sql and asserts:
 *   - hidden and future-publish_at events are absent from every listing RPC,
 *     and a scheduled event appears on its own once publish_at passes;
 *   - can_view_event and the events SELECT policies let the host, an accepted
 *     or pending co-organizer, an invitee and an admission ticket holder open a
 *     hidden or unpublished event, and refuse a stranger and anon;
 *   - get_event_by_share_token and issue_guest_rsvp_tickets refuse them too.
 *
 *   node scripts/verify-event-publication.mjs
 *   node scripts/verify-event-publication.mjs --allow-skip    # no Postgres: record as unverified
 *   node scripts/verify-event-publication.mjs --against-live  # run the quoted LIVE
 *       definitions instead of the new ones; this must FAIL (proves the checks bite)
 *
 * Copies the cluster handling from verify-call-capacity.mjs: socket-only, trust
 * auth, no TCP port, torn down on exit. A missing server is a failure unless
 * --allow-skip is passed.
 */
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowSkip = process.argv.includes("--allow-skip");
const againstLive = process.argv.includes("--against-live");
const MIGRATIONS = join(root, "apps/mobile/supabase/migrations");
const D_MIGRATION = "20261003110000_event_hide_and_publish_at.sql";
const C_MIGRATION = "20261003120000_discovery_rpcs_return_event_tz.sql";

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
    "verify-event-publication: no complete Postgres server install found " +
    "(initdb, postgres and pg_ctl in one prefix). The publication assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-event-publication-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-event-publication-sock-"));
const run = (bin, args) =>
  execFileSync(`${prefix}${bin}`, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let pool;
function teardown() {
  try {
    pool?.end();
  } catch {}
  try {
    run("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]);
  } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
process.on("exit", teardown);

writeFileSync(join(socketDir, ".keep"), "");
run("initdb", ["-D", dataDir, "-U", "harness", "--auth=trust", "--no-sync"]);
run("pg_ctl", [
  "-D", dataDir,
  "-o", `-k ${socketDir} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,
  "-w", "-l", join(dataDir, "server.log"),
  "start",
]);

pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 4 });
const sql = async (text, values) => (await pool.query(text, values)).rows;

// ── Fixture ──────────────────────────────────────────────────────────────────
// Production's column names and types for what these functions read. auth.jwt()
// is Supabase's: the request's JWT claims from request.jwt.claims.
const FIXTURE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;

CREATE TYPE public.enum_events_category AS ENUM ('music', 'party', 'other');

CREATE TABLE public.media (id serial PRIMARY KEY, url text);
CREATE TABLE public.users (
  id serial PRIMARY KEY, auth_id text UNIQUE, username text, first_name text,
  avatar_id integer, verified boolean, followers_count integer
);
CREATE TABLE public."user" (id text PRIMARY KEY, name text, email text, "emailVerified" boolean);
CREATE TABLE public.follows (follower_id integer, following_id integer);

CREATE TABLE public.events (
  id serial PRIMARY KEY,
  host_id text,
  title varchar NOT NULL,
  description varchar,
  start_date timestamptz,
  end_date timestamptz,
  location varchar,
  image varchar,
  price numeric,
  category public.enum_events_category,
  total_attendees numeric,
  is_online boolean,
  max_attendees numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  cover_image_url text,
  images jsonb,
  youtube_video_url text,
  flyer_image_url text,
  visibility text NOT NULL DEFAULT 'public',
  location_type text,
  nsfw boolean,
  age_restriction text,
  ticketing_enabled boolean,
  share_slug text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  status text NOT NULL DEFAULT 'active',
  cancelled_at timestamptz,
  video_flyer_url text,
  video_poster_url text,
  attendee_name_requirement text NOT NULL DEFAULT 'none',
  event_tz text
);

CREATE TABLE public.event_co_organizers (
  id serial PRIMARY KEY, event_id integer, user_id text, accepted boolean DEFAULT false, role text
);
CREATE TABLE public.event_invites (
  id serial PRIMARY KEY, event_id integer, invited_user_id text, invited_email text, status text
);
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id integer, user_id text,
  category text, status text
);
CREATE TABLE public.event_rsvps (
  id serial PRIMARY KEY, event_id integer, user_id text, status text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.event_likes (id serial PRIMARY KEY, event_id integer, user_id integer);
CREATE TABLE public.event_spotlight_campaigns (
  id serial PRIMARY KEY, event_id bigint, organizer_id text, status text, placement text,
  priority integer, city_id bigint, starts_at timestamptz, ends_at timestamptz
);
CREATE TABLE public.orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key text);

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
-- The three live SELECT policies on events (pg_policies, 2026-10-03).
CREATE POLICY events_select_anon ON public.events FOR SELECT TO anon USING (visibility = 'public');
CREATE POLICY events_select_authenticated ON public.events FOR SELECT TO authenticated USING (true);
`;
await sql(FIXTURE);

// Seeded before the migration: is_hidden must come back false on these rows.
const HOST = "host-auth";
const users = [
  [HOST, "host"], ["coorg-auth", "coorg"], ["pending-coorg-auth", "pending"],
  ["invitee-auth", "invitee"], ["holder-auth", "holder"], ["stranger-auth", "stranger"],
];
for (const [authId, username] of users) {
  await sql(`INSERT INTO public.users (auth_id, username) VALUES ($1, $2)`, [authId, username]);
  await sql(`INSERT INTO public."user" (id, name) VALUES ($1, $2)`, [authId, username]);
}
const start = "now() + interval '3 days'";
const ev = async (title, visibility = "public", extra = {}) => {
  const [row] = await sql(
    `INSERT INTO public.events (host_id, title, start_date, visibility, location_type, event_tz, ticketing_enabled)
     VALUES ($1, $2, ${start}, $3, 'physical', 'America/Los_Angeles', $4) RETURNING id, share_slug`,
    [HOST, title, visibility, extra.ticketing ?? true],
  );
  return row;
};
const E = {
  published: await ev("Published"),
  hidden: await ev("Hidden"),
  future: await ev("Future"),
  soon: await ev("Soon"),
  scheduledPast: await ev("Scheduled past"),
  hiddenLink: await ev("Hidden link", "link_only"),
  guestHidden: await ev("Guest hidden", "public", { ticketing: false }),
  guestFuture: await ev("Guest future", "public", { ticketing: false }),
};

// ── The migrations under test (or, with --against-live, the live bodies) ────
function migrationSql(file) {
  const text = readFileSync(join(MIGRATIONS, file), "utf8");
  if (!againstLive) return text;
  const lives = [...text.matchAll(/^-- BEGIN LIVE \S+ md5=\S+\n([\s\S]*?)^-- END LIVE$/gm)].map((m) => {
    const lines = m[1].split("\n");
    lines.pop();
    return lines.map((l) => (l === "-- |" ? "" : l.replace(/^-- \| /, ""))).join("\n") + ";\n";
  });
  const alter = text.match(/^ALTER TABLE public\.events[\s\S]*?;\n/m)?.[0] ?? "";
  return alter + lives.join("\n");
}

const [{ count: legacyHidden }] = await sql(
  `SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_name = 'events' AND column_name IN ('is_hidden', 'publish_at')`,
);
assert.equal(legacyHidden, 0, "fixture must not already have the new columns");
await sql(migrationSql(D_MIGRATION));
await sql(`CREATE POLICY events_private_boundary ON public.events AS RESTRICTIVE FOR SELECT
  TO anon, authenticated USING (public.can_view_event(id))`);

const [{ n: defaulted }] = await sql(`SELECT count(*)::int AS n FROM public.events WHERE is_hidden = false`);
assert.equal(defaulted, Object.keys(E).length, "existing rows read is_hidden = false after the migration");
console.log(`-. OK: ${defaulted} existing events default to is_hidden = false`);

await sql(`UPDATE public.events SET is_hidden = true WHERE id = ANY($1)`, [
  [E.hidden.id, E.hiddenLink.id, E.guestHidden.id],
]);
await sql(`UPDATE public.events SET publish_at = now() + interval '30 days' WHERE id = ANY($1)`, [
  [E.future.id, E.guestFuture.id],
]);
await sql(`UPDATE public.events SET publish_at = now() - interval '1 hour' WHERE id = $1`, [E.scheduledPast.id]);
// Relationships to the hidden and future events.
for (const id of [E.hidden.id, E.future.id, E.hiddenLink.id]) {
  await sql(`INSERT INTO public.event_co_organizers (event_id, user_id, accepted, role) VALUES ($1, 'coorg-auth', true, 'admin')`, [id]);
  await sql(`INSERT INTO public.event_co_organizers (event_id, user_id, accepted, role) VALUES ($1, 'pending-coorg-auth', false, 'admin')`, [id]);
  await sql(`INSERT INTO public.event_invites (event_id, invited_user_id, status) VALUES ($1, 'invitee-auth', 'pending')`, [id]);
  await sql(`INSERT INTO public.tickets (event_id, user_id, category, status) VALUES ($1, 'holder-auth', 'admission', 'active')`, [id]);
}
for (const e of [E.published, E.hidden, E.future, E.scheduledPast]) {
  await sql(
    `INSERT INTO public.event_spotlight_campaigns (event_id, organizer_id, status, placement, priority, starts_at, ends_at)
     VALUES ($1, $2, 'active', 'spotlight+feed', 1, now() - interval '1 day', now() + interval '1 day')`,
    [e.id, HOST],
  );
}

const failures = [];
const check = (label, fn) => {
  try {
    fn();
    console.log(`-. OK: ${label}`);
  } catch (err) {
    failures.push(label);
    console.error(`-. FAIL: ${label}\n   ${err.message.split("\n")[0]}`);
  }
};
const titles = (rows) => rows.map((r) => r.title).sort();
const expectListed = (got, label) =>
  check(label, () => {
    assert.ok(got.includes("Published"), "published event missing");
    assert.ok(got.includes("Scheduled past"), "event whose publish_at passed is missing");
    for (const t of ["Hidden", "Future", "Guest hidden", "Guest future"]) {
      assert.ok(!got.includes(t), `${t} is listed`);
    }
  });

// ── Listings ────────────────────────────────────────────────────────────────
// The 10-argument get_events_home overload is NOT executed: its live body
// compares e.category (enum_events_category) to p_category (text) with no
// cast, which has no operator and errors on every call, in production too.
// That bug predates this change; its publication edit is covered by the static
// diff in live-function-redefinitions.test.ts. Both clients call the 11-arg
// overload, which casts, and which is executed below.
{
  const [{ ok }] = await sql(
    `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_events_home'
       AND pg_get_functiondef(oid) LIKE '%AND NOT e.is_hidden%') AS ok`,
  );
  check("get_events_home (10 args) carries the publication rule", () => assert.equal(ok, true));
}
{
  const [{ r }] = await sql(`SELECT public.get_spotlight_feed(NULL) AS r`);
  expectListed(titles(r ?? []), "get_spotlight_feed lists only published events");
}
{
  const rows = await sql(`SELECT event_id FROM public.get_promoted_event_ids(NULL)`);
  const ids = rows.map((r) => Number(r.event_id));
  check("get_promoted_event_ids returns only published events", () => {
    assert.ok(ids.includes(E.published.id) && ids.includes(E.scheduledPast.id));
    assert.ok(!ids.includes(E.hidden.id) && !ids.includes(E.future.id));
  });
}

// ── Direct access: can_view_event and RLS, per relationship ─────────────────
async function asUser(sub, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (sub === null) {
      await client.query(`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await client.query("SET LOCAL ROLE anon");
    } else {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub, role: "authenticated" }),
      ]);
      await client.query("SET LOCAL ROLE authenticated");
    }
    return await fn((text, values) => client.query(text, values).then((r) => r.rows));
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
const ALLOWED = [HOST, "coorg-auth", "pending-coorg-auth", "invitee-auth", "holder-auth"];
for (const [label, e] of [["hidden", E.hidden], ["unpublished", E.future]]) {
  for (const who of [...ALLOWED, "stranger-auth", null]) {
    const allowed = ALLOWED.includes(who);
    const [{ v }] = await asUser(who, (q) => q(`SELECT public.can_view_event($1) AS v`, [e.id]));
    const rows = await asUser(who, (q) => q(`SELECT id FROM public.events WHERE id = $1`, [e.id]));
    check(`${label} event: ${who ?? "anon"} ${allowed ? "can" : "cannot"} open it`, () => {
      assert.equal(v, allowed, "can_view_event");
      assert.equal(rows.length, allowed ? 1 : 0, "events SELECT through RLS");
    });
  }
}
for (const who of ["stranger-auth", null]) {
  const rows = await asUser(who, (q) => q(`SELECT id FROM public.events WHERE id = ANY($1)`, [[E.published.id, E.scheduledPast.id]]));
  check(`published events stay open to ${who ?? "anon"}`, () => assert.equal(rows.length, 2));
}

// ── Share token and guest RSVP ───────────────────────────────────────────────
for (const [who, want] of [["stranger-auth", 0], [null, 0], [HOST, 1], ["invitee-auth", 1]]) {
  const rows = await asUser(who, (q) => q(`SELECT id FROM public.get_event_by_share_token($1)`, [E.hiddenLink.share_slug]));
  check(`share token for a hidden link_only event: ${who ?? "anon"} gets ${want ? "it" : "nothing"}`, () =>
    assert.equal(rows.length, want));
}
for (const [label, e] of [["hidden", E.guestHidden], ["unpublished", E.guestFuture]]) {
  // Past the gate the function goes on to write orders and tickets, which this
  // fixture does not model, so getting that far surfaces as an error here.
  // Either way it is a failure: the gate must stop it first.
  let outcome;
  try {
    const [{ r }] = await sql(
      `SELECT public.issue_guest_rsvp_tickets($1, 'guest@example.com', 'Guest', NULL, 1, NULL) AS r`,
      [e.id],
    );
    outcome = r.error ?? "issued";
  } catch (err) {
    outcome = `went past the gate (${err.message})`;
  }
  check(`guest RSVP to a ${label} event is refused as not found`, () => assert.equal(outcome, "event_not_found"));
}
{
  // Control: a published event gets past the gate (to the ticketing branch).
  const [{ r }] = await sql(
    `SELECT public.issue_guest_rsvp_tickets($1, 'guest@example.com', 'Guest', NULL, 1, NULL) AS r`,
    [E.published.id],
  );
  check("guest RSVP to a published event passes the publication gate", () => assert.equal(r.error, "requires_checkout"));
}

// ── C: the 11-arg home and For You, then the scheduled event appearing ──────
await sql(migrationSql(C_MIGRATION));
const viewer = (await sql(`SELECT id FROM public.users WHERE auth_id = 'stranger-auth'`))[0].id;
const home = async () =>
  (await sql(
    `SELECT public.get_events_home(p_limit => 50, p_offset => 0, p_viewer_id => NULL, p_city_id => NULL,
       p_filter_online => NULL, p_filter_tonight => false, p_filter_weekend => false, p_search => NULL,
       p_category => NULL, p_sort => 'soonest', p_nsfw => NULL) AS r`,
  ))[0].r ?? [];
const forYou = async () =>
  (await sql(`SELECT public.get_events_for_you($1, 50, 0) AS r`, [viewer]))[0].r ?? [];

await sql(`UPDATE public.events SET publish_at = now() + interval '2 seconds' WHERE id = $1`, [E.soon.id]);
const homeRows = await home();
expectListed(titles(homeRows), "get_events_home (11 args) lists only published events");
expectListed(titles(await forYou()), "get_events_for_you lists only published events");
{
  // Live Home had no status filter, so cancelled, draft and suspended events
  // were listed. Seed one of each, published and public, and check Home skips
  // them while For You (which always filtered) still does too.
  const statuses = ["cancelled", "draft", "suspended"];
  for (const st of statuses) {
    const row = await ev(`Status ${st}`);
    await sql(`UPDATE public.events SET status = $2 WHERE id = $1`, [row.id, st]);
  }
  const listed = titles(await home());
  for (const st of statuses) {
    check(`get_events_home does not list a ${st} event`, () => assert.ok(!listed.includes(`Status ${st}`)));
  }
  const listedForYou = titles(await forYou());
  for (const st of statuses) {
    check(`get_events_for_you does not list a ${st} event`, () => assert.ok(!listedForYou.includes(`Status ${st}`)));
  }
}
check("get_events_home returns event_tz", () =>
  assert.equal(homeRows.find((r) => r.title === "Published")?.event_tz, "America/Los_Angeles"));
check("a scheduled event is not listed before publish_at", () =>
  assert.ok(!titles(homeRows).includes("Soon")));
await new Promise((r) => setTimeout(r, 2500));
{
  const after = titles(await home());
  const afterForYou = titles(await forYou());
  check("home lists the event after publish_at, with no write in between", () => assert.ok(after.includes("Soon")));
  check("For You lists the event after publish_at", () => assert.ok(afterForYou.includes("Soon")));
}

if (failures.length) {
  console.error(`\nverify-event-publication: ${failures.length} check(s) failed${againstLive ? " (expected with --against-live)" : ""}`);
  process.exit(1);
}
console.log("\nverify-event-publication: all checks passed");
