#!/usr/bin/env node
/**
 * Runs 20261002210000_event_lynk_lifecycle.sql against a real Postgres and
 * checks its backfill: the INSERT that marks events already in progress live
 * when the lifecycle ships.
 *
 * The selection is: a Lynk room is set, the event is not cancelled or deleted,
 * start_date <= now() < COALESCE(end_date, start_date + 6 hours), and no other
 * event shares the room. Getting it wrong either strands guests of a running
 * event in a waiting room nobody will open, or opens rooms for events that
 * are over, not started, or cancelled. A shared room would also break the
 * unique index on room_uuid and abort the whole migration.
 *
 * This harness boots a throwaway cluster, creates public.events with the live
 * column types and status CHECK (read from npfjanxturvmjyevoyfo on
 * 2026-10-03; event_lynk_lifecycle and event_lynk_waiting do not exist there
 * yet), seeds one event per case, applies the migration, and asserts:
 *   1. exactly the in-progress events get a row, state 'live', live_at set,
 *      started_by NULL, scheduled_end = COALESCE(end, start + 6h);
 *   2. applying the migration again succeeds, adds no row, leaves existing
 *      live rows untouched, promotes a 'scheduled' row of an in-progress
 *      event, and never reopens a row a host already ended;
 *   3. the new tables and sync_event_lynk_lifecycle stay service_role only.
 *
 *   node scripts/verify-event-lynk-lifecycle.mjs
 *   node scripts/verify-event-lynk-lifecycle.mjs --allow-skip   # no Postgres: record as unverified
 *   EVENT_LYNK_LIFECYCLE_MIGRATION=/path/to/other.sql node scripts/verify-event-lynk-lifecycle.mjs
 *
 * The env var swaps in another copy of the migration, which is how the checks
 * were shown to fail without the backfill. Every section runs even if an
 * earlier one fails, and any failure exits 1.
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
const TARGET =
  process.env.EVENT_LYNK_LIFECYCLE_MIGRATION ||
  join(MIGRATIONS, "20261002210000_event_lynk_lifecycle.sql");

// Same server discovery as verify-call-capacity.mjs: initdb, postgres and
// pg_ctl must come from one prefix, or initdb dies halfway through.
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
    "verify-event-lynk-lifecycle: no complete Postgres server install found. " +
    "The in-progress backfill assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-event-lynk-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-event-lynk-sock-"));
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

run("initdb", ["-D", dataDir, "-U", "harness", "--auth=trust", "--no-sync"]);
run("pg_ctl", [
  "-D", dataDir,
  "-o", `-k ${socketDir} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,
  "-w", "-l", join(dataDir, "server.log"),
  "start",
]);

pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 4 });
const sql = async (text, values) => (await pool.query(text, values)).rows;

// Live shapes of the columns the migration reads. status is text NOT NULL
// with a CHECK that has no 'deleted' value; the migration's 'deleted' arm is
// therefore dead on live but harmless.
await sql(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE TABLE public.events (
  id SERIAL PRIMARY KEY,
  host_id TEXT,
  title VARCHAR NOT NULL,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status = ANY (ARRAY['draft', 'active', 'cancelled', 'postponed', 'suspended'])),
  lynk_room_id UUID
);
`);

// ── Fixture: one event per case ─────────────────────────────────────────────
// Times are relative to the cluster clock, so the windows hold whenever this
// runs. Shared rooms use one fixed uuid.
const SHARED_ROOM = "00000000-0000-4000-8000-000000000001";
const CASES = [
  // [title, start, end, status, room, expectLive]
  ["past", "now() - interval '5 hours'", "now() - interval '1 hour'", "active", "gen", false],
  ["past, no end, beyond the 6h default", "now() - interval '7 hours'", "NULL", "active", "gen", false],
  ["in progress", "now() - interval '1 hour'", "now() + interval '1 hour'", "active", "gen", true],
  ["in progress, no end, inside the 6h default", "now() - interval '2 hours'", "NULL", "active", "gen", true],
  ["starts exactly now", "now()", "now() + interval '2 hours'", "active", "gen", true],
  ["future", "now() + interval '1 hour'", "now() + interval '3 hours'", "active", "gen", false],
  ["cancelled, in progress", "now() - interval '1 hour'", "now() + interval '1 hour'", "cancelled", "gen", false],
  ["in progress, no Lynk room", "now() - interval '1 hour'", "now() + interval '1 hour'", "active", "none", false],
  ["in progress, no start date", "NULL", "now() + interval '1 hour'", "active", "gen", false],
  ["in progress, shared room A", "now() - interval '1 hour'", "now() + interval '1 hour'", "active", "shared", false],
  ["in progress, shared room B", "now() - interval '30 minutes'", "now() + interval '2 hours'", "active", "shared", false],
];
const ids = {};
for (const [title, start, end, status, room] of CASES) {
  const roomSql = room === "gen" ? "gen_random_uuid()" : room === "shared" ? `'${SHARED_ROOM}'::uuid` : "NULL";
  const [r] = await sql(
    `INSERT INTO public.events (title, start_date, end_date, status, lynk_room_id)
     VALUES ($1, ${start}, ${end}, $2, ${roomSql}) RETURNING id`,
    [title, status],
  );
  ids[title] = r.id;
}
const expectedLive = CASES.filter((c) => c[5]).map((c) => ids[c[0]]).sort((a, b) => a - b);

const migration = readFileSync(TARGET, "utf8");
const failures = [];
async function section(name, fn) {
  try {
    await fn();
    console.log(`OK: ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`FAIL: ${name}\n  ${err.message.split("\n").join("\n  ")}`);
  }
}

const rows = () =>
  sql(`SELECT l.event_id, l.state, l.live_at, l.started_by, l.room_uuid = e.lynk_room_id AS room_matches,
              l.scheduled_start = e.start_date AS start_matches,
              l.scheduled_end = COALESCE(e.end_date, e.start_date + interval '6 hours') AS end_matches
       FROM public.event_lynk_lifecycle l JOIN public.events e ON e.id = l.event_id
       ORDER BY l.event_id`);

let applied = false;
await section("migration applies", async () => {
  await sql(migration);
  applied = true;
});

// ── 1. Exactly the in-progress events go live ───────────────────────────────
await section("exactly the in-progress events get a live row", async () => {
  assert.ok(applied, "migration did not apply");
  const got = await rows();
  const titleOf = Object.fromEntries(Object.entries(ids).map(([t, id]) => [id, t]));
  assert.deepEqual(
    got.map((r) => titleOf[r.event_id]),
    expectedLive.map((id) => titleOf[id]),
    "events with a lifecycle row after the backfill",
  );
  for (const r of got) {
    const t = titleOf[r.event_id];
    assert.equal(r.state, "live", `${t}: state`);
    assert.ok(r.live_at instanceof Date, `${t}: live_at not set`);
    assert.equal(r.started_by, null, `${t}: started_by must stay NULL, no host pressed Start`);
    assert.deepEqual([r.room_matches, r.start_matches, r.end_matches], [true, true, true], `${t}: copied columns`);
  }
});

// ── 2. Re-runnable ──────────────────────────────────────────────────────────
await section("applying the migration again adds nothing and never reopens an ended room", async () => {
  assert.ok(applied, "migration did not apply");
  const before = await rows();
  const ended = ids["in progress"];
  const keptLive = ids["in progress, no end, inside the 6h default"];
  // A host ended one room early; a later in-progress event got its row from
  // sync_event_lynk_lifecycle, which only ever writes 'scheduled'.
  await sql(`UPDATE public.event_lynk_lifecycle SET state = 'ended', ended_at = now() WHERE event_id = $1`, [ended]);
  const [late] = await sql(
    `INSERT INTO public.events (title, start_date, end_date, lynk_room_id)
     VALUES ('in progress, added after the first run', now() - interval '10 minutes', now() + interval '1 hour', gen_random_uuid())
     RETURNING id`,
  );
  const [sync] = await sql(`SELECT public.sync_event_lynk_lifecycle($1) AS r`, [late.id]);
  assert.deepEqual(sync.r, { ok: true });
  const [pending] = await sql(`SELECT state FROM public.event_lynk_lifecycle WHERE event_id = $1`, [late.id]);
  assert.equal(pending.state, "scheduled", "sync must create a new row as 'scheduled'");

  await sql(migration);

  const after = await rows();
  assert.equal(after.length, before.length + 1, "second run changed the row count by more than the one new event");
  const byId = Object.fromEntries(after.map((r) => [r.event_id, r]));
  assert.equal(byId[ended].state, "ended", "a room the host ended was reopened");
  assert.equal(byId[late.id].state, "live", "an in-progress 'scheduled' row was not promoted");
  const was = before.find((r) => r.event_id === keptLive);
  assert.equal(byId[keptLive].live_at.getTime(), was.live_at.getTime(), "live_at of an already-live row moved");
  for (const t of ["past", "future", "cancelled, in progress", "in progress, shared room A", "in progress, shared room B"]) {
    assert.equal(byId[ids[t]], undefined, `${t}: got a row on the second run`);
  }
});

// ── 3. Privileges ───────────────────────────────────────────────────────────
await section("lifecycle tables and sync function stay service_role only", async () => {
  assert.ok(applied, "migration did not apply");
  for (const table of ["public.event_lynk_lifecycle", "public.event_lynk_waiting"]) {
    const [p] = await sql(
      `SELECT has_table_privilege('anon', $1, 'SELECT') AS anon,
              has_table_privilege('authenticated', $1, 'SELECT') AS authed,
              has_table_privilege('service_role', $1, 'INSERT') AS svc`,
      [table],
    );
    assert.deepEqual(p, { anon: false, authed: false, svc: true }, table);
  }
  const [f] = await sql(
    `SELECT has_function_privilege('anon', $1, 'execute') AS anon,
            has_function_privilege('authenticated', $1, 'execute') AS authed,
            has_function_privilege('service_role', $1, 'execute') AS svc`,
    ["public.sync_event_lynk_lifecycle(integer)"],
  );
  assert.deepEqual(f, { anon: false, authed: false, svc: true });
});

if (failures.length) {
  console.error(`\nverify-event-lynk-lifecycle: ${failures.length} section(s) failed`);
  process.exit(1);
}
console.log("\nverify-event-lynk-lifecycle: all sections pass");
