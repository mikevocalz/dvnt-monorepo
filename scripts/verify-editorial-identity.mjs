#!/usr/bin/env node
/**
 * Runs the editorial identity SQL against a real Postgres, as the PostgREST
 * roles a client actually gets.
 *
 * An editorial lane publishes as editorial_profiles.account_auth_id, so that
 * column must only ever name an account flagged users.is_editorial. The flag is
 * only as strong as whoever can write it, and on dvnt-social anon and
 * authenticated hold table-level INSERT and UPDATE on public.users under
 * policies that are USING (true) / WITH CHECK (true). This harness replays a
 * fixture of those grants and policies, applies both editorial migrations, and
 * asserts:
 *
 *   1. anon and authenticated cannot set is_editorial on any users row
 *   2. an ordinary profile update by those roles still succeeds
 *   3. a lane cannot be bound to a member account, only to a flagged one
 *   4. claim_editorial_jobs claims a runnable lane's job, and stops claiming it
 *      once the bound account loses the flag
 *   5. posts refuses an editorial post with no disclosure label
 *
 *   node scripts/verify-editorial-identity.mjs
 *   node scripts/verify-editorial-identity.mjs --allow-skip   # CI without Postgres
 *
 * Needs the Postgres server binaries (initdb/pg_ctl/postgres) in one prefix.
 * Without --allow-skip, a missing server is a failure, not a pass.
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
// Named, not globbed, so a rename fails here instead of silently testing less.
const EDITORIAL_MIGRATIONS = [
  "20261002220000_editorial_automation.sql",
  "20261003090000_editorial_identity_disclosure_and_claims.sql",
];

// Same probe as verify-call-capacity.mjs: all three binaries from one prefix.
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
    "verify-editorial-identity: no complete Postgres server install found. " +
    "The editorial identity assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-editorial-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-editorial-sock-"));
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

// Runs one statement as a PostgREST request role, the way a client reaches it.
async function asRole(role, text, values) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const res = await client.query(text, values);
    await client.query("COMMIT");
    return res.rows;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function rejects(fn, code, why) {
  try {
    await fn();
  } catch (e) {
    assert.equal(e.code, code, `${why}: expected SQLSTATE ${code}, got ${e.code} ${e.message}`);
    return;
  }
  assert.fail(`${why}: the statement succeeded`);
}

// ── Fixture ──────────────────────────────────────────────────────────────────
// Only what the editorial migrations touch. The users grants and policies copy
// dvnt-social as read on 2026-10-03 (pg_policies / role_table_grants): that
// breadth is the reason the is_editorial guard has to be a trigger.
await sql(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  auth_id TEXT,
  username VARCHAR NOT NULL,
  verified BOOLEAN DEFAULT false
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users are viewable by everyone" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (true);
CREATE POLICY users_insert_anon ON public.users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY users_insert_authenticated ON public.users FOR INSERT TO authenticated WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;
GRANT USAGE ON SEQUENCE public.users_id_seq TO anon, authenticated, service_role;

CREATE TABLE public.posts (
  id SERIAL PRIMARY KEY,
  author_id INTEGER,
  content VARCHAR
);
GRANT ALL ON public.posts TO service_role;
`);

for (const file of EDITORIAL_MIGRATIONS) {
  await sql(readFileSync(join(MIGRATIONS, file), "utf8"));
}

await sql(`
INSERT INTO public.users (auth_id, username) VALUES
  ('member-auth', 'member'),
  ('editorial-auth', 'dvnt_editorial');
-- The designation a migration makes, run as the owner like a migration is.
UPDATE public.users SET is_editorial = true WHERE auth_id = 'editorial-auth';
`);

// ── 1. Clients cannot write the marker ───────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  await rejects(
    () => asRole(role, `UPDATE public.users SET is_editorial = true WHERE auth_id = 'member-auth'`),
    "42501",
    `${role} promoted a member to editorial`,
  );
  await rejects(
    () =>
      asRole(
        role,
        `INSERT INTO public.users (auth_id, username, is_editorial) VALUES ($1::text, $1::text, true)`,
        [`forged-${role}`],
      ),
    "42501",
    `${role} inserted a pre-flagged editorial account`,
  );
}
await rejects(
  () => asRole("authenticated", `UPDATE public.users SET is_editorial = false WHERE auth_id = 'editorial-auth'`),
  "42501",
  "authenticated demoted the editorial account",
);
console.log("1. OK: anon and authenticated cannot set or clear users.is_editorial");

// ── 2. Ordinary writes still pass ────────────────────────────────────────────
await asRole("authenticated", `UPDATE public.users SET username = 'member2' WHERE auth_id = 'member-auth'`);
await asRole("anon", `INSERT INTO public.users (auth_id, username) VALUES ('new-signup', 'new')`);
await asRole("service_role", `UPDATE public.users SET username = 'dvnt_ed' WHERE auth_id = 'editorial-auth'`);
console.log("2. OK: profile updates and signups without the marker still succeed");

// ── 3. A lane binds only to a flagged account ────────────────────────────────
const [{ slug }] = await sql(`SELECT slug FROM public.editorial_profiles ORDER BY slug LIMIT 1`);
await rejects(
  () => asRole("service_role", `UPDATE public.editorial_profiles SET account_auth_id = 'member-auth' WHERE slug = $1`, [slug]),
  "23514",
  "a lane was bound to a member account",
);
await rejects(
  () => asRole("service_role", `UPDATE public.editorial_profiles SET account_auth_id = 'no-such-user' WHERE slug = $1`, [slug]),
  "23514",
  "a lane was bound to an account that does not exist",
);
await asRole("service_role", `UPDATE public.editorial_profiles SET account_auth_id = 'editorial-auth' WHERE slug = $1`, [slug]);
console.log("3. OK: account_auth_id accepts only a users.is_editorial account");

// ── 4. The worker stops claiming once the marker is revoked ──────────────────
await sql(`UPDATE public.editorial_profiles SET enabled = true, paused = false WHERE slug = $1`, [slug]);
const [profile] = await sql(`SELECT id FROM public.editorial_profiles WHERE slug = $1`, [slug]);
await sql(`INSERT INTO public.editorial_jobs (profile_id, stage, idempotency_key, prompt_version) VALUES ($1, 'intake', 'harness-1', 'v1')`, [profile.id]);
const claimed = await asRole("service_role", `SELECT id FROM public.claim_editorial_jobs(25, interval '5 minutes')`);
assert.equal(claimed.length, 1, `expected the runnable lane's job to be claimed, got ${claimed.length}`);
await sql(`UPDATE public.editorial_jobs SET claimed_at = NULL`);
await sql(`UPDATE public.users SET is_editorial = false WHERE auth_id = 'editorial-auth'`);
const afterRevoke = await asRole("service_role", `SELECT id FROM public.claim_editorial_jobs(25, interval '5 minutes')`);
assert.equal(afterRevoke.length, 0, "a lane kept running after its account lost is_editorial");
console.log("4. OK: claim_editorial_jobs claims only for a lane whose account is still editorial");

// ── 5. An editorial post carries its label ───────────────────────────────────
const [job] = await sql(`SELECT id FROM public.editorial_jobs LIMIT 1`);
await rejects(
  () => sql(`INSERT INTO public.posts (content, editorial_job_id) VALUES ('x', $1)`, [job.id]),
  "23514",
  "an editorial post was written without a disclosure label",
);
await sql(
  `INSERT INTO public.posts (content, editorial_job_id, disclosure_label) VALUES ('x', $1, 'DVNT Editorial')`,
  [job.id],
);
console.log("5. OK: posts refuses an editorial post with no disclosure_label");

console.log("\nverify-editorial-identity: all sections pass");
