#!/usr/bin/env node
/**
 * Runs the checkout restricted-profile SQL against a real Postgres.
 *
 * A guest checkout now creates a profile for the buyer's email, or reuses the
 * one that exists. The ways that goes wrong are all database behaviour: two
 * checkouts for one email racing into two accounts, a checkout attaching a
 * stranger's tickets to an account whose email nobody proved, a phone number
 * landing in a table anon can read, a profile that skipped the 18+ signup
 * check being allowed to post because the rollout switch is off. Mocks cannot
 * see any of that, so this harness boots a throwaway cluster, replays the
 * real migrations the new SQL depends on, applies
 * 20261003170000_checkout_restricted_profiles.sql, and drives it with real
 * parallel connections and real role switches.
 *
 *   node scripts/verify-checkout-profile.mjs
 *   node scripts/verify-checkout-profile.mjs --allow-skip   # no Postgres here
 *
 * Same server discovery and skip rule as verify-call-capacity.mjs: without
 * --allow-skip, a missing Postgres is a failure, not a pass.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowSkip = process.argv.includes("--allow-skip");
const MIGRATIONS = join(root, "apps/mobile/supabase/migrations");
const MIGRATION = "20261003170000_checkout_restricted_profiles.sql";

// ── Locating a Postgres server (same rule as verify-call-capacity.mjs) ──────
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
    "verify-checkout-profile: no complete Postgres server install found " +
    "(initdb, postgres and pg_ctl in one prefix). The restricted-profile assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-checkout-profile-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-checkout-profile-sock-"));
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

pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 24 });
const sql = async (text, values) => (await pool.query(text, values)).rows;

/** Run `fn` on one connection as `role` with these JWT claims, then roll back. */
async function as(role, claims, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`SET LOCAL ROLE ${role}`);
    return await fn((text, values) => client.query(text, values));
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

/** The SQLSTATE a statement fails with, or null when it succeeds. */
async function failsWith(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err.code ?? String(err);
  }
}

// ── Fixture schema ───────────────────────────────────────────────────────────
// Production's columns, unique indexes and client grants for the tables the
// new SQL reads or writes (read-only from npfjanxturvmjyevoyfo, 2026-10-03):
// anon and authenticated can SELECT every column of "user" and users, which
// is exactly why phone and full name must not go there. The full migration
// history is not replayable here (auth schemas, extensions), so only the
// migrations the new functions call are applied, from the repo, unedited.
const FIXTURE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;

CREATE TABLE public."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  "emailVerified" boolean NOT NULL,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role text, banned boolean, "banReason" text, "banExpires" timestamptz,
  username text,
  "displayUsername" text
);
CREATE UNIQUE INDEX user_email_key ON public."user" (email);
CREATE UNIQUE INDEX user_username_key ON public."user" (username);

CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  username varchar NOT NULL,
  first_name varchar,
  last_name varchar,
  verified boolean DEFAULT false,
  followers_count numeric DEFAULT 0,
  following_count numeric DEFAULT 0,
  posts_count numeric DEFAULT 0,
  email varchar NOT NULL,
  auth_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON public.users (email);
CREATE UNIQUE INDEX users_username_idx ON public.users (username);
CREATE UNIQUE INDEX users_auth_id_key ON public.users (auth_id);

CREATE TABLE public.account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL, password text
);

CREATE TABLE identity_verifications (
  user_id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'didit',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','passed','failed','expired','review')),
  date_of_birth date,
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text, guest_email text, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text, guest_email text
);

-- A participation table with a client INSERT path, so the RESTRICTIVE
-- boundary from 20260916170000 has something to guard.
CREATE TABLE public.posts (
  id SERIAL PRIMARY KEY,
  author_auth_id text NOT NULL,
  content text NOT NULL
);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY posts_insert_own ON public.posts FOR INSERT TO authenticated
  WITH CHECK (author_auth_id = auth.jwt() ->> 'sub');
GRANT INSERT ON public.posts TO authenticated;
GRANT USAGE ON SEQUENCE public.posts_id_seq TO authenticated;

GRANT SELECT ON public."user", public.users TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
`;

await sql(FIXTURE);
const apply = (file) => sql(readFileSync(join(MIGRATIONS, file), "utf8"));
// Listed by name: a glob would silently stop covering a renamed migration.
for (const file of [
  "20260806100300_guest_claim.sql",
  "20260916150000_verified_adult_age_gate.sql",
  "20260916170000_verified_only_admission.sql",
]) {
  await apply(file);
}
// Seeded before the migration, so reuse has real rows to find.
await sql(`
  INSERT INTO public."user" (id, name, email, "emailVerified", username)
  VALUES ('auth_verified', 'Vera', 'vera@example.com', true, 'vera'),
         ('auth_unverified', 'Ursula', 'ursula@example.com', false, 'ursula');
  INSERT INTO public.users (username, email, auth_id, first_name)
  VALUES ('vera', 'vera@example.com', 'auth_verified', 'Vera'),
         ('ursula', 'ursula@example.com', 'auth_unverified', 'Ursula'),
         ('LegacyLarry', 'Larry@Example.com', NULL, 'Larry');
  INSERT INTO public.tickets (user_id, guest_email)
  VALUES (NULL, 'VERA@example.com'), (NULL, 'ursula@example.com');
  INSERT INTO public.orders (user_id, guest_email)
  VALUES (NULL, 'vera@example.com'), (NULL, 'ursula@example.com');
`);
await apply(MIGRATION);
console.log(`0. OK: fixture, 3 dependency migrations and ${MIGRATION} applied`);

const ensure = async (email, username, name = "Night Owl", phone = "+12125550142") =>
  (await sql(`SELECT public.ensure_checkout_profile($1, $2, $3, $4) AS r`, [email, username, name, phone]))[0].r;
const count = async (text, values) => Number((await sql(text, values))[0].n);

// ── 1. A new email gets a profile, unverified, with contact fields private ──
let owl;
{
  owl = await ensure(" Night.Owl@Example.com ", "nightowl", "Night  Owl", "+12125550142");
  assert.equal(owl.ok, true, JSON.stringify(owl));
  assert.equal(owl.status, "created");
  assert.equal(owl.username, "nightowl");
  assert.equal(owl.attached, false, "a fresh, unproven email must not claim tickets");

  const [ba] = await sql(`SELECT * FROM public."user" WHERE id = $1`, [owl.authId]);
  assert.equal(ba.email, "night.owl@example.com", "email is stored normalized");
  assert.equal(ba.emailVerified, false, "checkout must never mark the email verified");
  assert.equal(ba.name, "nightowl", "the full name leaked into the anon-readable user.name");

  const [member] = await sql(`SELECT * FROM public.users WHERE auth_id = $1`, [owl.authId]);
  assert.equal(member.id, owl.memberId);
  assert.equal(member.verified, false, "checkout must never mark the profile verified");
  assert.equal(member.first_name, null, "the full name leaked into users.first_name");
  assert.equal(member.last_name, null);

  const [priv] = await sql(`SELECT * FROM public.user_private_profile WHERE auth_id = $1`, [owl.authId]);
  assert.equal(priv.full_name, "Night Owl");
  assert.equal(priv.phone_e164, "+12125550142");
  assert.equal(priv.checkout_restricted, true);
  assert.equal(
    await count(`SELECT count(*) AS n FROM identity_verifications WHERE user_id = $1`, [owl.authId]),
    0,
    "checkout wrote a verification record",
  );

  // No anon-readable column of either profile table holds the phone or the name.
  const leaked = await sql(
    `SELECT 'user' AS t FROM public."user" u WHERE u.id = $1 AND row_to_json(u)::text ~ '(5550142|Night Owl)'
     UNION ALL
     SELECT 'users' FROM public.users m WHERE m.auth_id = $1 AND row_to_json(m)::text ~ '(5550142|Night Owl)'`,
    [owl.authId],
  );
  assert.deepEqual(leaked, [], `phone or full name found in a public table: ${JSON.stringify(leaked)}`);
  console.log("1. OK: created unverified, full name and phone only in user_private_profile");
}

// ── 2. Client roles cannot read the private fields or call the functions ────
{
  for (const role of ["anon", "authenticated"]) {
    const claims = role === "anon" ? { role } : { role, sub: owl.authId };
    for (const table of ["user_private_profile", "checkout_profile_intake"]) {
      const code = await as(role, claims, (q) => failsWith(q(`SELECT * FROM public.${table}`)));
      assert.equal(code, "42501", `${role} can read ${table} (got ${code})`);
    }
    for (const call of [
      `SELECT public.ensure_checkout_profile('x@y.co', 'xyz', 'X', '+12125550100')`,
      `SELECT public.finalize_checkout_profile('cs_x')`,
      `SELECT public.record_checkout_profile_intake('cs_x', 'x@y.co', 'xyz', 'X', '+12125550100')`,
      `SELECT public.checkout_username_available('xyz')`,
      `SELECT public.is_checkout_restricted('${owl.authId}')`,
      `SELECT public.run_new_profile_onboarding('a', 1, 2)`,
      `SELECT public.run_verified_onboarding('a')`,
    ]) {
      const code = await as(role, claims, (q) => failsWith(q(call)));
      assert.equal(code, "42501", `${role} can run: ${call} (got ${code})`);
    }
    // Still readable, unchanged: the public profile columns.
    const rows = await as(role, claims, (q) => q(`SELECT username FROM public.users WHERE auth_id = $1`, [owl.authId]));
    assert.equal(rows.rows.length, 1, `${role} lost read access to public profiles`);
  }
  console.log("2. OK: anon and authenticated get permission denied on the private tables and all 7 functions");
}

// ── 3. The same email again reuses, whatever the case ───────────────────────
{
  const again = await ensure("NIGHT.OWL@example.COM", "someoneelse", "Other Name", "+447700900123");
  assert.equal(again.status, "reused");
  assert.equal(again.authId, owl.authId);
  assert.equal(await count(`SELECT count(*) AS n FROM public."user" WHERE lower(email) = 'night.owl@example.com'`), 1);
  const [priv] = await sql(`SELECT full_name, phone_e164 FROM public.user_private_profile WHERE auth_id = $1`, [owl.authId]);
  assert.deepEqual(priv, { full_name: "Night Owl", phone_e164: "+12125550142" }, "a repeat checkout rewrote the private fields");
  assert.equal(await count(`SELECT count(*) AS n FROM public.users WHERE username = 'someoneelse'`), 0);
  console.log("3. OK: repeat checkout, different case, reused the profile and changed nothing on it");
}

// ── 4. Existing accounts: verified email attaches, unverified does not ──────
{
  const vera = await ensure("Vera@Example.com", "notvera");
  assert.equal(vera.status, "reused");
  assert.equal(vera.authId, "auth_verified");
  assert.equal(vera.attached, true);
  assert.equal(
    await count(`SELECT count(*) AS n FROM public.tickets WHERE lower(guest_email) = 'vera@example.com' AND user_id = 'auth_verified'`),
    1,
    "a verified account did not receive its guest ticket",
  );
  const [veraRow] = await sql(`SELECT name, username FROM public."user" WHERE id = 'auth_verified'`);
  assert.deepEqual(veraRow, { name: "Vera", username: "vera" }, "reuse edited the existing account");

  // Someone registered ursula@ with a password and never proved it. A buyer
  // typing that address must not hand their ticket to that account.
  const ursula = await ensure("ursula@example.com", "ursula2");
  assert.equal(ursula.status, "reused");
  assert.equal(ursula.attached, false);
  assert.equal(
    await count(`SELECT count(*) AS n FROM public.tickets WHERE guest_email = 'ursula@example.com' AND user_id IS NULL`),
    1,
    "a ticket was attached to an account whose email is unverified",
  );
  assert.equal(
    await count(`SELECT count(*) AS n FROM public.user_private_profile WHERE auth_id IN ('auth_verified', 'auth_unverified')`),
    0,
    "reuse wrote private fields onto an account the buyer has not proved they own",
  );

  // A legacy profile row with no login keeps its single identity.
  const larry = await ensure("larry@example.com", "larry2");
  assert.equal(larry.status, "reused_legacy");
  assert.equal(await count(`SELECT count(*) AS n FROM public."user" WHERE lower(email) = 'larry@example.com'`), 0);
  console.log("4. OK: verified email attached, unverified did not, legacy row not forked, nothing edited");
}

// ── 5. Twelve concurrent checkouts for one email make one profile ───────────
{
  const variants = Array.from({ length: 12 }, (_, i) =>
    i % 3 === 0 ? "Storm@Example.com" : i % 3 === 1 ? "storm@example.com" : " STORM@EXAMPLE.COM",
  );
  const results = await Promise.all(variants.map((email, i) => ensure(email, `storm_${i}`)));
  const created = results.filter((r) => r.status === "created");
  assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
  assert.equal(created.length, 1, `${created.length} profiles created for one email`);
  assert.ok(results.every((r) => r.authId === created[0].authId), "racers got different accounts");
  for (const [table, col] of [["\"user\"", "email"], ["users", "email"], ["user_private_profile", "email_normalized"]]) {
    assert.equal(
      await count(`SELECT count(*) AS n FROM public.${table} WHERE lower(${col}) = 'storm@example.com'`),
      1,
      `duplicate rows in ${table}`,
    );
  }
  console.log("5. OK: 12 parallel same-email checkouts, 1 profile, every caller got its id");
}

// ── 6. Twelve emails racing for one username all get distinct names ────────
{
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => ensure(`racer${i}@example.com`, "samename")),
  );
  assert.ok(results.every((r) => r.ok && r.status === "created"), JSON.stringify(results));
  const names = results.map((r) => r.username);
  assert.equal(new Set(names).size, 12, `duplicate usernames: ${names}`);
  assert.equal(names.filter((n) => n === "samename").length, 1);
  assert.equal(results.filter((r) => r.usernameAdjusted).length, 11);
  console.log("6. OK: 12 parallel checkouts for one username, 1 exact, 11 suffixed, 0 collisions");
}

// ── 7. Username availability ────────────────────────────────────────────────
{
  const available = async (u) => (await sql(`SELECT public.checkout_username_available($1) AS a`, [u]))[0].a;
  assert.equal(await available("nightowl"), false, "a taken username reads as free");
  assert.equal(await available("legacylarry"), false, "mixed-case legacy usernames are not compared case-insensitively");
  assert.equal(await available("deviantevents"), false, "a reserved handle reads as free");
  assert.equal(await available("Upper"), false, "an unnormalized name passed the format check");
  assert.equal(await available("fresh.name_1"), true);
  // The create path walks past a legacy mixed-case collision too.
  const r = await ensure("larry.fan@example.com", "legacylarry");
  assert.equal(r.username, "legacylarry_1");
  console.log("7. OK: availability is case-insensitive across both tables and refuses reserved names");
}

// ── 8. Paid checkout: intake, idempotent finalize, data minimised ───────────
{
  await sql(`SELECT public.record_checkout_profile_intake('cs_paid_1', 'Paid@Example.com', 'paidbuyer', 'Pat Paid', '+33612345678')`);
  // The webhook and the reconcile sweep can both land.
  const results = await Promise.all(
    Array.from({ length: 6 }, () => sql(`SELECT public.finalize_checkout_profile('cs_paid_1') AS r`).then((x) => x[0].r)),
  );
  assert.equal(results.filter((r) => r.status === "created" && !r.replayed).length, 1, JSON.stringify(results));
  assert.ok(results.every((r) => r.authId === results[0].authId));
  const [intake] = await sql(`SELECT username, full_name, phone_e164, finalized_at FROM public.checkout_profile_intake WHERE checkout_ref = 'cs_paid_1'`);
  assert.ok(intake.finalized_at);
  assert.deepEqual(
    [intake.username, intake.full_name, intake.phone_e164],
    [null, null, null],
    "finalize left the buyer's personal fields in the intake row",
  );
  assert.equal((await sql(`SELECT public.finalize_checkout_profile('cs_never_recorded') AS r`))[0].r.status, "no_intake");

  // An abandoned session's fields are purged by a later intake.
  await sql(`SELECT public.record_checkout_profile_intake('cs_abandoned', 'gone@example.com', 'gone', 'Gone', '+12125550199')`);
  await sql(`UPDATE public.checkout_profile_intake SET created_at = now() - interval '8 days' WHERE checkout_ref = 'cs_abandoned'`);
  await sql(`SELECT public.record_checkout_profile_intake('cs_paid_2', 'p2@example.com', 'p2buyer', 'P Two', '+12125550111')`);
  assert.equal(await count(`SELECT count(*) AS n FROM public.checkout_profile_intake WHERE checkout_ref = 'cs_abandoned'`), 0);
  assert.equal(await count(`SELECT count(*) AS n FROM public."user" WHERE email = 'gone@example.com'`), 0, "an abandoned checkout made an account");
  console.log("8. OK: 6 parallel finalizes made 1 profile, PII nulled after, abandoned intake purged with no account");
}

// ── 9. A restricted profile cannot post, even with enforcement off ──────────
{
  const [policy] = await sql(`SELECT enforce FROM public.verified_admission_policy WHERE id = 1`);
  assert.equal(policy.enforce, false, "fixture should mirror live: enforce = false");
  const post = (sub) =>
    as("authenticated", { role: "authenticated", sub }, (q) =>
      failsWith(q(`INSERT INTO public.posts (author_auth_id, content) VALUES ($1, 'hi')`, [sub])),
    );
  assert.equal(await post(owl.authId), "42501", "a restricted profile could insert a post");
  assert.equal(await post("auth_verified"), null, "an ordinary member was refused with enforcement off");

  const ctx = await as("authenticated", { role: "authenticated", sub: owl.authId }, (q) =>
    q(`SELECT public.verified_admission_context() AS c`),
  );
  assert.equal(ctx.rows[0].c.restricted, true, "the client banner would not know this profile is restricted");

  // Allowlisting the id does not unlock it.
  await sql(`UPDATE public.verified_admission_policy SET enforce = true, allowlist = ARRAY[$1] WHERE id = 1`, [owl.authId]);
  assert.equal(await post(owl.authId), "42501", "the allowlist unlocked a restricted profile");
  await sql(`UPDATE public.verified_admission_policy SET enforce = false, allowlist = '{}' WHERE id = 1`);

  // A pending check does not unlock it; a passed adult document does.
  await sql(`INSERT INTO identity_verifications (user_id, status) VALUES ($1, 'review')`, [owl.authId]);
  assert.equal(await post(owl.authId), "42501", "a pending verification unlocked a restricted profile");
  await sql(`UPDATE identity_verifications SET status = 'passed', date_of_birth = '1990-04-02' WHERE user_id = $1`, [owl.authId]);
  assert.equal(await post(owl.authId), null, "a verified adult checkout profile is still locked");
  assert.equal((await sql(`SELECT public.is_checkout_restricted($1) AS r`, [owl.authId]))[0].r, false);
  console.log("9. OK: restricted profile refused by RLS with enforce=false and when allowlisted, unlocked by a passed adult check");
}

// ── 10. Onboarding hooks are no-ops until their functions exist ─────────────
{
  const onboard = async (authId, memberId, brandId) =>
    (await sql(`SELECT public.run_new_profile_onboarding($1, $2, $3) AS r`, [authId, memberId, brandId]))[0].r;
  assert.deepEqual(await onboard(owl.authId, owl.memberId, 1), { enqueue: "missing", follow: "missing" });
  assert.deepEqual(await onboard(owl.authId, owl.memberId, null), { enqueue: "missing", follow: "no_brand" });
  assert.deepEqual(
    (await sql(`SELECT public.run_verified_onboarding($1) AS r`, [owl.authId]))[0].r,
    { firstPostPrompt: "missing" },
  );

  // Stand-ins with the onboarding branch's exact signatures. They record
  // their arguments, so the test proves what is passed, not only that a call
  // happened.
  await sql(`
    CREATE TABLE hook_calls (fn text, args text);
    CREATE FUNCTION public.enqueue_brand_onboarding(p_auth_id text, p_lookback interval, p_first_post_delay interval)
      RETURNS integer LANGUAGE sql AS $$
        INSERT INTO hook_calls VALUES ('enqueue', p_auth_id || '|' || p_lookback || '|' || p_first_post_delay) RETURNING 1 $$;
    CREATE FUNCTION public.ensure_brand_follow_relationships(p_member_id integer, p_brand_id integer, p_bidirectional boolean, p_lookback interval)
      RETURNS jsonb LANGUAGE sql AS $$
        INSERT INTO hook_calls VALUES ('follow', p_member_id || '|' || p_brand_id || '|' || p_bidirectional || '|' || p_lookback) RETURNING '{}'::jsonb $$;
    CREATE FUNCTION public.enqueue_first_post_prompt(p_auth_id text)
      RETURNS void LANGUAGE sql AS $$ INSERT INTO hook_calls VALUES ('first_post', p_auth_id) $$;
  `);
  assert.deepEqual(await onboard(owl.authId, owl.memberId, 7), { enqueue: "ok", follow: "ok" });
  assert.deepEqual(
    (await sql(`SELECT public.run_verified_onboarding($1) AS r`, [owl.authId]))[0].r,
    { firstPostPrompt: "ok" },
  );
  const calls = await sql(`SELECT fn, args FROM hook_calls ORDER BY fn`);
  assert.deepEqual(calls, [
    { fn: "enqueue", args: `${owl.authId}|7 days|24:00:00` },
    { fn: "first_post", args: owl.authId },
    { fn: "follow", args: `${owl.memberId}|7|true|7 days` },
  ]);

  // A hook that throws is reported and does not take the caller down.
  await sql(`CREATE OR REPLACE FUNCTION public.enqueue_first_post_prompt(p_auth_id text)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`);
  assert.deepEqual(
    (await sql(`SELECT public.run_verified_onboarding($1) AS r`, [owl.authId]))[0].r,
    { firstPostPrompt: "error:P0001" },
  );
  console.log("10. OK: hooks skip when missing, pass the right arguments when present, and contain failures");
}

console.log("\nverify-checkout-profile: all sections pass");
