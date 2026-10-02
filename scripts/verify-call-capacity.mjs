#!/usr/bin/env node
/**
 * Runs the call-admission SQL against a real Postgres with real concurrent
 * sessions, because the two-client happy path cannot reach the bug that broke
 * a nine-invitee call in production.
 *
 * Room 569 invited eight people plus the caller and provisioned four media
 * peers. The cap was not the problem: the room said ten. The problem is that
 * media provisioning is serialized behind one lease per room: the first joiner
 * takes the lease, everyone else gets `call_join_pending` and polls. Two
 * clients never collide, so no two-client test can see it. Twelve clients
 * arriving together collide on every join.
 *
 * So this harness boots a throwaway cluster, replays the fixture schema and
 * the three capacity migrations, and drives up to fourteen genuinely parallel
 * `pg` connections through the admission and lease paths. It asserts the
 * things only concurrency can prove: that twelve simultaneous joiners all get
 * seats, that the thirteenth is refused with the right numbers, that the lease
 * admits exactly one provisioner at a time, that a join storm drains to twelve
 * active members with zero leaked leases, and that a lease abandoned mid-flight
 * releases its holder's seat instead of stranding it.
 *
 * It also reads the capacity constants out of the edge-function source and
 * asserts the SQL agrees with them, so the TypeScript and the database cannot
 * drift apart again: the drift was itself a bug: the SQL lease ran 90s while
 * the function gave up polling at 80s, so a hung provisioner starved every
 * later joiner by design.
 *
 *   node scripts/verify-call-capacity.mjs
 *   node scripts/verify-call-capacity.mjs --allow-skip   # CI without Postgres
 *
 * Needs the Postgres server binaries (initdb/pg_ctl/postgres) on PATH or under
 * a Homebrew postgresql prefix. Without --allow-skip, a missing server is a
 * failure, not a pass: a check that quietly skips is a check that is not there.
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
const MIGRATIONS = join(root, "apps/mobile/supabase/migrations");

// ── The constants the SQL must agree with ────────────────────────────────────
// Read, not duplicated. If someone edits the TypeScript and forgets the SQL,
// this harness fails instead of the next twelve-way call.
const capacitySrc = readFileSync(
  join(MIGRATIONS, "../functions/_shared/call-capacity.ts"),
  "utf8",
);
const constant = (name) => {
  const hit = capacitySrc.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  assert.ok(hit, `call-capacity.ts no longer exports ${name}`);
  return Number(hit[1]);
};
const CAPACITY = constant("CALL_HUMAN_CAPACITY");
const LEASE_SECONDS = constant("CALL_MEDIA_LEASE_SECONDS");
assert.equal(CAPACITY, 12, "this harness is written for a twelve-seat call");

// The client cannot import the edge function's module, so the number is written
// twice. Nothing stops those two copies drifting except this check, and a
// client that validates against 11 invitees while the server admits a different
// count is a call that fails at the worst moment.
{
  const clientSrc = readFileSync(
    join(root, "packages/app/lib/constants/call-capacity.ts"),
    "utf8",
  );
  for (const [name, expected] of [
    ["CALL_HUMAN_CAPACITY", CAPACITY],
    ["CALL_MAX_INVITEES", CAPACITY - 1],
  ]) {
    const hit = clientSrc.match(new RegExp(`${name}\\s*=\\s*([\\d\\s\\w-]+?);`));
    assert.ok(hit, `packages/app/lib/constants/call-capacity.ts no longer exports ${name}`);
    const value = /^\d+$/.test(hit[1].trim())
      ? Number(hit[1].trim())
      : hit[1].includes("CALL_HUMAN_CAPACITY - 1")
        ? CAPACITY - 1
        : NaN;
    assert.equal(
      value,
      expected,
      `client ${name} is ${hit[1].trim()} but the edge function says ${expected}`,
    );
  }
  console.log(`-. OK: client and edge-function capacity constants agree on ${CAPACITY}`);
}

// ── Locating a Postgres server ───────────────────────────────────────────────
// A client-only install is the trap: Homebrew's libpq puts `initdb` on PATH
// without `postgres` beside it, and initdb then fails halfway through. Both
// binaries must answer from the SAME prefix before we commit to it.
function serverBin() {
  const candidates = [
    "", // whatever is already on PATH
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
    // On PATH these can resolve to different formulas (Homebrew's libpq ships
    // initdb and pg_ctl at one version while the server formula ships postgres
    // at another), and initdb dies partway through when they disagree.
    if (versions.every((v) => v !== null && v === versions[0])) return prefix;
  }
  return null;
}

// "" is a legitimate answer here: the binaries are on PATH: so the sentinel
// has to be null, not a falsy string.
const prefix = serverBin();
if (prefix === null) {
  const message =
    "verify-call-capacity: no complete Postgres server install found " +
    "(initdb, postgres and pg_ctl in one prefix; a client-only libpq does not count). " +
    "The call-admission concurrency assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-call-capacity-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-call-capacity-sock-"));
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

// Socket-only, trust auth, no TCP port: nothing else on the machine can reach
// it and it cannot collide with a real Postgres.
writeFileSync(join(socketDir, ".keep"), "");
run("initdb", ["-D", dataDir, "-U", "harness", "--auth=trust", "--no-sync"]);
run("pg_ctl", [
  "-D", dataDir,
  "-o", `-k ${socketDir} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,
  "-w", "-l", join(dataDir, "server.log"),
  "start",
]);

pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 20 });
const sql = async (text, values) => (await pool.query(text, values)).rows;

// ── Fixture schema ───────────────────────────────────────────────────────────
// Only the tables and columns the three call functions touch, with production's
// own types and defaults: including `max_participants ... DEFAULT 10`, so the
// migration's default change is genuinely exercised rather than assumed. The
// full 368-migration replay is not reproducible here (it reaches auth schemas
// and extensions this cluster has no business owning), and this harness does
// not pretend otherwise: it tests the call functions, not the whole schema.
const FIXTURE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.video_rooms (
  id SERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  created_by TEXT NOT NULL,
  title TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  max_participants INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'ended')),
  fishjam_room_id TEXT,
  room_kind TEXT NOT NULL DEFAULT 'lynk' CHECK (room_kind IN ('call', 'lynk')),
  participant_count INTEGER NOT NULL DEFAULT 0,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX video_rooms_uuid_idx ON public.video_rooms (uuid);

CREATE TABLE public.video_room_members (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'participant'
    CHECK (role IN ('host', 'moderator', 'speaker', 'participant')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'left', 'kicked', 'banned')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hand_raised BOOLEAN NOT NULL DEFAULT false,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  anon_label TEXT
);
CREATE INDEX video_room_members_room_user_idx ON public.video_room_members (room_id, user_id);

CREATE TABLE public.video_room_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE TABLE public.video_room_bans (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE OR REPLACE FUNCTION public.is_user_banned_from_room(p_user_id TEXT, p_room_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS(
    SELECT 1 FROM public.video_room_bans
    WHERE room_id = p_room_id AND user_id = p_user_id
      AND (expires_at IS NULL OR expires_at > now())
  );
$fn$;
`;

await sql(FIXTURE);

// The capacity lineage, in the order Supabase applies it. Listed explicitly:
// a glob would silently stop covering the new migration if someone renamed it.
const LINEAGE = [
  "20260905121000_call_admission.sql",
  "20261001120000_call_capacity_ten.sql",
];
const CAPACITY_MIGRATION = "20261001140000_call_capacity_twelve.sql";
const apply = (file) => sql(readFileSync(join(MIGRATIONS, file), "utf8"));
for (const file of LINEAGE) await apply(file);

// Seeded BEFORE the new migration, so the backfill has something to find. A
// room created fresh afterwards inherits the new default and would pass even
// if the backfill were deleted, which is how that clause went untested.
const [legacy] = await sql(
  `INSERT INTO public.video_rooms (created_by, title, room_kind, status, max_participants)
   VALUES ('u0', 'Legacy open call', 'call', 'open', 10) RETURNING id`,
);
const [legacyEnded] = await sql(
  `INSERT INTO public.video_rooms (created_by, title, room_kind, status, max_participants)
   VALUES ('u0', 'Legacy ended call', 'call', 'ended', 10) RETURNING id`,
);
const [legacyLynk] = await sql(
  `INSERT INTO public.video_rooms (created_by, title, room_kind, status, max_participants)
   VALUES ('u0', 'Legacy lynk', 'lynk', 'open', 5) RETURNING id`,
);

await apply(CAPACITY_MIGRATION);
console.log(`0. OK: fixture schema and ${LINEAGE.length + 1} capacity migrations applied`);

// ── 0b. The backfill reaches open call rooms and nothing else ────────────────
{
  const cap = async (id) =>
    (await sql(`SELECT max_participants AS n FROM public.video_rooms WHERE id = $1`, [id]))[0].n;
  assert.equal(
    await cap(legacy.id),
    CAPACITY,
    `an open call room created before the migration still seats ${await cap(legacy.id)}`,
  );
  assert.equal(await cap(legacyEnded.id), 10, "the backfill rewrote an ended call room");
  assert.equal(await cap(legacyLynk.id), 5, "the backfill rewrote a Lynk room's subscription cap");
  console.log(`0b. OK: open call rooms backfilled to ${CAPACITY}, ended and Lynk rooms untouched`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const user = (n) => `u${n}`;

/**
 * A fresh open call room with `invitees` invited.
 *
 * The cap is deliberately left to the column default rather than written in,
 * because that is the path a real room takes: video_create_room supplies it,
 * and anything that does not inherits the default. Writing 12 here would make
 * every seat assertion below pass even if the schema still said 10.
 */
async function newRoom({ invitees, max = null }) {
  const [room] = await sql(
    `INSERT INTO public.video_rooms (created_by, title, room_kind, status, max_participants)
     VALUES ($1, 'Crew', 'call', 'open',
             COALESCE($2, (SELECT column_default::int FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = 'video_rooms'
                             AND column_name = 'max_participants')))
     RETURNING id, uuid, max_participants`,
    [user(0), max],
  );
  await sql(
    `INSERT INTO public.video_room_invites (room_id, user_id, invited_by)
     SELECT $1, u, $2 FROM unnest($3::text[]) AS u`,
    [room.id, user(0), invitees],
  );
  return room;
}

/** Fire `fn` for every id at once on its own connection: real contention. */
const parallel = (ids, fn) => Promise.all(ids.map((id) => fn(id)));

const admit = async (roomUuid, userId) => {
  const [row] = await sql(`SELECT public.admit_call_participant($1, $2) AS r`, [roomUuid, userId]);
  return row.r;
};
const begin = async (roomUuid, userId, leaseId) => {
  const [row] = await sql(`SELECT public.begin_call_media($1, $2, $3) AS r`, [roomUuid, userId, leaseId]);
  return row.r;
};
const finish = async (roomUuid, leaseId, providerRoom, peerId) => {
  const [row] = await sql(
    `SELECT public.finish_call_media($1, $2, $3, $4) AS r`,
    [roomUuid, leaseId, providerRoom, peerId],
  );
  return row.r;
};
const activeCount = async (roomId) => {
  const [row] = await sql(
    `SELECT count(*)::int AS n FROM public.video_room_members
     WHERE room_id = $1 AND status = 'active'`,
    [roomId],
  );
  return row.n;
};
const uuid = async () => (await sql(`SELECT gen_random_uuid() AS u`))[0].u;

// ── 1. Twelve simultaneous joiners all get a seat ────────────────────────────
// The caller plus eleven invitees, arriving at once. This is the shape of the
// call that failed: everybody taps Answer inside the same second.
{
  const invitees = Array.from({ length: CAPACITY - 1 }, (_, i) => user(i + 1));
  const room = await newRoom({ invitees });
  const results = await parallel([user(0), ...invitees], (id) => admit(room.uuid, id));
  const admitted = results.filter((r) => r.ok);
  const refused = results.filter((r) => !r.ok);
  assert.equal(
    admitted.length,
    CAPACITY,
    `only ${admitted.length}/${CAPACITY} concurrent joiners were seated: ${JSON.stringify(refused)}`,
  );
  assert.equal(await activeCount(room.id), CAPACITY, "active member rows disagree with the admissions");
  const [row] = await sql(`SELECT participant_count AS n FROM public.video_rooms WHERE id = $1`, [room.id]);
  assert.equal(row.n, CAPACITY, `participant_count drifted under contention: ${row.n}`);
  console.log(`1. OK: ${CAPACITY} concurrent admissions all seated, participant_count exact`);
}

// ── 2. The thirteenth is refused, with honest numbers ────────────────────────
{
  const invitees = Array.from({ length: CAPACITY }, (_, i) => user(i + 1));
  const room = await newRoom({ invitees });
  const results = await parallel([user(0), ...invitees], (id) => admit(room.uuid, id));
  const refused = results.filter((r) => !r.ok);
  assert.equal(results.filter((r) => r.ok).length, CAPACITY, "capacity was exceeded under contention");
  assert.equal(refused.length, 1, `expected exactly one refusal, got ${refused.length}`);
  assert.equal(refused[0].reason, "call_full", `wrong refusal reason: ${refused[0].reason}`);
  assert.equal(refused[0].max, CAPACITY, `call_full reported max ${refused[0].max}`);
  assert.equal(refused[0].current, CAPACITY, `call_full reported current ${refused[0].current}`);
  assert.equal(await activeCount(room.id), CAPACITY, "a refused joiner left a seat behind");
  console.log(`2. OK: seat ${CAPACITY + 1} refused call_full with current/max = ${CAPACITY}`);
}

// ── 3. A room inserted without an explicit cap is not capped at ten ──────────
{
  const [row] = await sql(
    `INSERT INTO public.video_rooms (created_by, title, room_kind)
     VALUES ($1, 'Default', 'call') RETURNING max_participants AS n`,
    [user(0)],
  );
  assert.equal(
    row.n,
    CAPACITY,
    `video_rooms.max_participants still defaults to ${row.n}: a room created without an explicit cap seats ${row.n}`,
  );
  console.log(`3. OK: max_participants column defaults to ${CAPACITY}`);
}

// ── 4. The media lease admits exactly one provisioner at a time ──────────────
// Serialization is correct and deliberate: one provider round trip per room at
// a time. What must be true is that it is a QUEUE, not a lottery: one winner,
// and every loser told `call_join_pending` so the function knows to retry.
{
  const invitees = Array.from({ length: CAPACITY - 1 }, (_, i) => user(i + 1));
  const room = await newRoom({ invitees });
  const ids = [user(0), ...invitees];
  const leases = await Promise.all(ids.map(() => uuid()));
  const results = await parallel(ids.map((id, i) => [id, leases[i]]), ([id, lease]) =>
    begin(room.uuid, id, lease),
  );
  const winners = results.filter((r) => r.ok);
  const pending = results.filter((r) => !r.ok && r.reason === "call_join_pending");
  assert.equal(winners.length, 1, `${winners.length} sessions held the lease at once: the lease does not serialize`);
  assert.equal(
    pending.length,
    ids.length - 1,
    `${ids.length - 1 - pending.length} losers got something other than call_join_pending: ` +
      JSON.stringify(results.filter((r) => !r.ok && r.reason !== "call_join_pending")),
  );
  console.log(`4. OK: one lease holder, ${pending.length} told call_join_pending`);
}

// ── 5. The lease window matches what the edge function waits for ─────────────
// The production deadlock: SQL held the lease 90s while call-media.ts gave up
// polling at 80s, so a hung provisioner starved every later joiner outright.
{
  const room = await newRoom({ invitees: [user(1)] });
  const lease = await uuid();
  const admission = await begin(room.uuid, user(0), lease);
  assert.ok(admission.ok, `lease could not be taken: ${JSON.stringify(admission)}`);
  const [row] = await sql(
    `SELECT extract(epoch FROM (expires_at - clock_timestamp()))::float AS s
     FROM public.call_media_leases WHERE room_id = $1`,
    [room.id],
  );
  assert.ok(
    row.s > LEASE_SECONDS - 5 && row.s <= LEASE_SECONDS,
    `lease window is ${row.s.toFixed(1)}s but call-capacity.ts declares ${LEASE_SECONDS}s`,
  );
  console.log(`5. OK: lease window ${row.s.toFixed(1)}s matches CALL_MEDIA_LEASE_SECONDS=${LEASE_SECONDS}`);
}

// ── 6. A twelve-way join storm drains to a full room ─────────────────────────
// Every client retries `begin_call_media` on the same bounded backoff the edge
// function uses, holds the lease across a simulated provider round trip, then
// finishes. Scaled down in time, not in contention: twelve real connections
// race for one lease, repeatedly, until the room is full.
{
  const invitees = Array.from({ length: CAPACITY - 1 }, (_, i) => user(i + 1));
  const room = await newRoom({ invitees });
  const providerRoom = "fishjam-storm";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Same curve as pendingWaitMs in call-capacity.ts, compressed 25x so the test
  // finishes in seconds. The curve's shape is what matters here; its real
  // constants are asserted by the Deno unit test.
  const backoff = (attempt) => Math.min(320, 10 * 2 ** attempt) + Math.random() * 8;

  async function join(userId) {
    const lease = await uuid();
    for (let attempt = 0; attempt < 400; attempt++) {
      const admission = await begin(room.uuid, userId, lease);
      if (admission.ok) {
        await sleep(5 + Math.random() * 15); // the provider round trip
        const ok = await finish(room.uuid, lease, providerRoom, `peer-${userId}`);
        return { userId, ok, reason: ok ? null : "finish_rejected" };
      }
      if (admission.reason !== "call_join_pending") {
        return { userId, ok: false, reason: admission.reason };
      }
      await sleep(backoff(attempt));
    }
    return { userId, ok: false, reason: "exhausted_retries" };
  }

  const outcomes = await parallel([user(0), ...invitees], join);
  const failed = outcomes.filter((o) => !o.ok);
  assert.equal(
    failed.length,
    0,
    `${failed.length}/${CAPACITY} joiners never provisioned media: ${JSON.stringify(failed)}`,
  );
  assert.equal(await activeCount(room.id), CAPACITY, "the storm did not drain to a full room");
  const [peers] = await sql(
    `SELECT count(*)::int AS n FROM public.call_media_peers WHERE room_id = $1`,
    [room.id],
  );
  assert.equal(peers.n, CAPACITY, `${peers.n} media peers for ${CAPACITY} members`);
  const [leases] = await sql(
    `SELECT count(*)::int AS n FROM public.call_media_leases WHERE room_id = $1`,
    [room.id],
  );
  assert.equal(leases.n, 0, `${leases.n} lease rows survived the storm: the next joiner would be blocked`);
  console.log(`6. OK: ${CAPACITY}-way join storm drained to ${CAPACITY} peers, 0 leaked leases`);
}

// ── 7. An abandoned lease releases its holder's seat ─────────────────────────
// A joiner that dies between begin and finish used to leave an `active` member
// row behind, so the room counted a seat nobody was in. The next begin must
// reclaim it.
{
  const room = await newRoom({ invitees: [user(1), user(2)] });
  const abandoned = await uuid();
  assert.ok((await begin(room.uuid, user(1), abandoned)).ok, "first joiner could not take the lease");
  assert.equal(await activeCount(room.id), 1, "begin_call_media did not seat the joiner");

  // The client vanished: no finish, and the lease ages out.
  await sql(
    `UPDATE public.call_media_leases SET expires_at = clock_timestamp() - interval '1 second'
     WHERE room_id = $1`,
    [room.id],
  );
  const next = await uuid();
  const second = await begin(room.uuid, user(2), next);
  assert.ok(second.ok, `a stale lease blocked the next joiner: ${JSON.stringify(second)}`);
  const [seated] = await sql(
    `SELECT array_agg(user_id ORDER BY user_id) AS ids FROM public.video_room_members
     WHERE room_id = $1 AND status = 'active'`,
    [room.id],
  );
  assert.deepEqual(
    seated.ids,
    [user(2)],
    `the abandoned joiner's seat leaked: active = ${JSON.stringify(seated.ids)}`,
  );
  console.log("7. OK: abandoned lease reclaimed its holder's seat, next joiner admitted");
}

// ── 8. A reconnect at capacity does not need a free seat ─────────────────────
{
  const invitees = Array.from({ length: CAPACITY - 1 }, (_, i) => user(i + 1));
  const room = await newRoom({ invitees });
  await parallel([user(0), ...invitees], (id) => admit(room.uuid, id));
  assert.equal(await activeCount(room.id), CAPACITY, "room did not fill");
  const again = await admit(room.uuid, user(3));
  assert.ok(again.ok, `an already-active member was refused a reconnect: ${JSON.stringify(again)}`);
  assert.equal(again.reconnected, true, "reconnect was not flagged as one");
  assert.equal(await activeCount(room.id), CAPACITY, "a reconnect consumed a second seat");
  console.log("8. OK: reconnect at capacity consumed no seat");
}

console.log("\nverify-call-capacity: all sections pass");
