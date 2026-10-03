#!/usr/bin/env node
/**
 * Runs the @DeviantEvents follow SQL against a real Postgres.
 *
 * Product decision R05: every profile follows @DeviantEvents, prior eligible
 * accounts are backfilled without duplicates, and following grants nothing.
 * R06: @DeviantEvents follows each NEW profile back, including profiles that
 * never pass through auth-sync. Old members are not followed by the brand.
 *
 * This harness boots a throwaway cluster, builds the tables the follow
 * functions touch with production's shapes (follows keeps its real unique
 * index follower_following_idx and the live trigger_sync_follow_counts body),
 * replays the outbox migration and 20261001194000, then checks:
 *   1. the batched backfill inserts at most p_limit rows per run, finishes,
 *      and then no-ops with remaining = 0;
 *   2. no duplicate follow rows, and followers_count / following_count match
 *      the table after repeated runs;
 *   3. banned, Better-Auth-banned, deleted-login, suspended and shadow-banned
 *      members are skipped;
 *   4. the brand never follows itself;
 *   5. the brand follows no old member, through the backfill or on sign-in;
 *   6. a profile created outside auth-sync gets both directions;
 *   7. a returning old member missing the follow gets member -> brand only;
 *   8. the functions stay service_role only;
 *   9. enqueue_first_post_prompt queues first_post_v2 once for a member who
 *      passed adult verification, and nothing for an unverified member or one
 *      who has posted;
 *  10. the 24h first_post_v1 reminder is suppressed for an unverified member,
 *      and beside first_post_v2 so a member gets one first-post message;
 *  11. a checkout-created profile gets the welcome email claimed exactly once,
 *      a Better Auth signup is never claimed, and a failed send is retried.
 *
 *   node scripts/verify-brand-follows.mjs
 *   node scripts/verify-brand-follows.mjs --allow-skip   # CI without Postgres
 *   BRAND_FOLLOWS_MIGRATION=/path/to/old.sql node scripts/verify-brand-follows.mjs
 *
 * The env var swaps in another copy of the migration, which is how the checks
 * were shown to fail against the previous version. Every section runs even if
 * an earlier one fails, and any failure exits 1.
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
  process.env.BRAND_FOLLOWS_MIGRATION ||
  join(MIGRATIONS, "20261001194000_deviantevents_onboarding_retention.sql");

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
    "verify-brand-follows: no complete Postgres server install found. " +
    "The brand follow assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-brand-follows-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-brand-follows-sock-"));
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

// Shapes read from npfjanxturvmjyevoyfo on 2026-10-03 (information_schema,
// pg_indexes, pg_get_triggerdef, pg_get_functiondef). Only the columns these
// functions touch.
await sql(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  auth_id TEXT,
  username VARCHAR,
  banned_at TIMESTAMPTZ,
  followers_count NUMERIC DEFAULT 0,
  following_count NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public."user" (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  username TEXT,
  banned BOOLEAN,
  "banExpires" TIMESTAMPTZ
);

CREATE TABLE public.identity_verifications (
  user_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'didit',
  status TEXT NOT NULL,
  date_of_birth DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shape from 20261003180000_checkout_restricted_profiles.sql (checkout branch).
CREATE TABLE public.user_private_profile (
  auth_id TEXT PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,
  full_name TEXT,
  phone_e164 TEXT,
  source TEXT NOT NULL CHECK (source IN ('checkout')),
  checkout_restricted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SCHEMA payload;
CREATE TYPE payload.enum_members_status AS ENUM
  ('active', 'under_review', 'warned', 'suspended', 'shadow_banned', 'banned');
CREATE TABLE payload.members (
  id SERIAL PRIMARY KEY,
  app_user_id VARCHAR,
  status payload.enum_members_status DEFAULT 'active',
  suspended_until TIMESTAMPTZ
);

CREATE TABLE public.follows (
  id SERIAL PRIMARY KEY,
  follower_id INTEGER NOT NULL,
  following_id INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX follower_following_idx ON public.follows (follower_id, following_id);
CREATE INDEX idx_follows_follower ON public.follows (follower_id);
CREATE INDEX idx_follows_following ON public.follows (following_id);

CREATE OR REPLACE FUNCTION public.sync_follow_counts()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_follower_id integer;
  v_following_id integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_follower_id  := NEW.follower_id;
    v_following_id := NEW.following_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_follower_id  := OLD.follower_id;
    v_following_id := OLD.following_id;
  ELSE
    v_follower_id  := COALESCE(NEW.follower_id, OLD.follower_id);
    v_following_id := COALESCE(NEW.following_id, OLD.following_id);
  END IF;
  UPDATE users
  SET followers_count = (SELECT COUNT(*) FROM follows WHERE following_id = v_following_id)
  WHERE id = v_following_id;
  UPDATE users
  SET following_count = (SELECT COUNT(*) FROM follows WHERE follower_id = v_follower_id)
  WHERE id = v_follower_id;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;
CREATE TRIGGER trigger_sync_follow_counts AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION sync_follow_counts();

CREATE TABLE public.blocks (blocker_id INTEGER, blocked_id INTEGER);
CREATE TABLE public.posts (id SERIAL PRIMARY KEY, author_id INTEGER);
`);

await sql(readFileSync(join(MIGRATIONS, "20260916180000_brand_message_outbox.sql"), "utf8"));
await sql(readFileSync(TARGET, "utf8"));

// ── Seed ─────────────────────────────────────────────────────────────────────
const OLD = "now() - interval '90 days'";
async function member(name, { created = OLD, banned = false, authBanned = false, noAuth = false, status = null } = {}) {
  const [row] = await sql(
    `INSERT INTO public.users (auth_id, username, banned_at, created_at)
     VALUES ($1::text, $1::text, ${banned ? "now()" : "NULL"}, ${created}) RETURNING id`,
    [`auth_${name}`],
  );
  if (!noAuth) {
    await sql(`INSERT INTO public."user" (id, name, email, username, banned) VALUES ($1, $2, $3, $2, $4)`, [
      `auth_${name}`, name, `${name}@example.test`, authBanned,
    ]);
  }
  if (status) await sql(`INSERT INTO payload.members (app_user_id, status) VALUES ($1, $2)`, [String(row.id), status]);
  return row.id;
}

const brand = await member("deviantevents", { created: "now() - interval '3 years'" });
const OLD_COUNT = 300;
const oldIds = [];
for (let i = 0; i < OLD_COUNT; i++) oldIds.push(await member(`old${i}`));
// One old member already follows the brand by hand: it must not be re-inserted.
const prefollower = oldIds[0];
await sql(`INSERT INTO public.follows (follower_id, following_id) VALUES ($1, $2)`, [prefollower, brand]);
// The brand already follows one old member by hand: it stays, and nothing is added.
await sql(`INSERT INTO public.follows (follower_id, following_id) VALUES ($1, $2)`, [brand, oldIds[1]]);
// A moderation row that is not a restriction.
await sql(`INSERT INTO payload.members (app_user_id, status) VALUES ($1, 'warned')`, [String(oldIds[2])]);

const ineligible = {
  banned: await member("banned", { banned: true }),
  authBanned: await member("authbanned", { authBanned: true }),
  deletedLogin: await member("deleted", { noAuth: true }),
  suspended: await member("suspended", { status: "suspended" }),
  shadowBanned: await member("shadow", { status: "shadow_banned" }),
  consoleBanned: await member("cbanned", { status: "banned" }),
  newSuspended: await member("newsuspended", { created: "now()", status: "suspended" }),
};
// A profile created a minute ago by a path that never called auth-sync (the
// resolveOrProvisionUser auto-provision, or a future checkout account).
const outOfBand = await member("outofband", { created: "now() - interval '1 minute'" });

const ELIGIBLE = OLD_COUNT + 1; // old members + the out-of-band profile

const backfill = async (limit = 250) =>
  (await sql(`SELECT public.backfill_brand_follows($1, $2, interval '7 days') AS r`, [brand, limit]))[0].r;
const ensure = async (id) =>
  (await sql(`SELECT public.ensure_brand_follow_relationships($1, $2, true, interval '7 days') AS r`, [id, brand]))[0].r;
const follows = async (a, b) =>
  (await sql(`SELECT count(*)::int AS n FROM public.follows WHERE follower_id = $1 AND following_id = $2`, [a, b]))[0].n;

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

// ── 1. Batched, finite, then a no-op ────────────────────────────────────────
await section("backfill runs in batches of p_limit and stops at remaining = 0", async () => {
  const first = await backfill(250);
  assert.equal(first.memberToBrandInserted, 250, `first run: ${JSON.stringify(first)}`);
  assert.equal(first.remaining, ELIGIBLE - 1 - 250, `first run remaining: ${JSON.stringify(first)}`);
  const second = await backfill(250);
  assert.equal(second.memberToBrandInserted, ELIGIBLE - 1 - 250, `second run: ${JSON.stringify(second)}`);
  assert.equal(second.remaining, 0);
  const third = await backfill(250);
  assert.deepEqual(
    third,
    { memberToBrandInserted: 0, brandToNewMemberInserted: 0, remaining: 0 },
    "a finished backfill must insert nothing",
  );
});

// ── 2. Duplicate-free, counts exact ─────────────────────────────────────────
await section("no duplicate follows and the trigger-maintained counts match the table", async () => {
  const [dups] = await sql(
    `SELECT count(*)::int AS n FROM (SELECT 1 FROM public.follows GROUP BY follower_id, following_id HAVING count(*) > 1) d`,
  );
  assert.equal(dups.n, 0);
  assert.equal(await follows(prefollower, brand), 1, "the hand-made follow was duplicated");
  const [{ n: brandFollowers }] = await sql(
    `SELECT count(*)::int AS n FROM public.follows WHERE following_id = $1`, [brand],
  );
  assert.equal(brandFollowers, ELIGIBLE, "every eligible member follows the brand exactly once");
  const [drift] = await sql(`
    SELECT count(*)::int AS n FROM public.users u
    WHERE u.followers_count <> (SELECT count(*) FROM public.follows f WHERE f.following_id = u.id)
       OR u.following_count <> (SELECT count(*) FROM public.follows f WHERE f.follower_id = u.id)`);
  assert.equal(drift.n, 0, "followers_count/following_count drifted from the follows table");
  const [b] = await sql(`SELECT followers_count::int AS n FROM public.users WHERE id = $1`, [brand]);
  assert.equal(b.n, ELIGIBLE);
});

// ── 3. Ineligible accounts are skipped ──────────────────────────────────────
await section("banned, suspended, shadow-banned and deleted-login accounts are skipped", async () => {
  for (const [label, id] of Object.entries(ineligible)) {
    assert.equal(await follows(id, brand), 0, `${label} member follows the brand`);
    assert.equal(await follows(brand, id), 0, `brand follows the ${label} member`);
    const r = await ensure(id);
    assert.equal(r.memberToBrand, 0, `ensure_ followed for ${label}: ${JSON.stringify(r)}`);
    assert.equal(r.brandToMember, 0, `ensure_ followed back for ${label}: ${JSON.stringify(r)}`);
  }
  assert.equal(await follows(oldIds[2], brand), 1, "a warned (not restricted) member was skipped");
});

// ── 4. Never the brand itself ───────────────────────────────────────────────
await section("the brand account never follows itself", async () => {
  assert.equal(await follows(brand, brand), 0);
  const r = await ensure(brand);
  assert.equal(r.self, true);
  assert.equal(await follows(brand, brand), 0);
});

// ── 5. The brand does not follow old members ────────────────────────────────
await section("the brand follows no old member", async () => {
  const [{ n }] = await sql(
    `SELECT count(*)::int AS n FROM public.follows WHERE follower_id = $1 AND following_id = ANY($2::int[])`,
    [brand, oldIds],
  );
  assert.equal(n, 1, "only the pre-existing hand-made brand follow may remain");
});

// ── 6. Out-of-band new profile gets both directions ─────────────────────────
await section("a profile created outside auth-sync gets both directions", async () => {
  assert.equal(await follows(outOfBand, brand), 1, "out-of-band profile does not follow the brand");
  assert.equal(await follows(brand, outOfBand), 1, "brand does not follow the out-of-band profile");
  // And the immediate path (resolveOrProvisionUser -> ensure_) on a fresh one.
  const fresh = await member("fresh", { created: "now()" });
  const r = await ensure(fresh);
  assert.deepEqual([r.memberToBrand, r.brandToMember], [1, 1], JSON.stringify(r));
  const again = await ensure(fresh);
  assert.deepEqual([again.memberToBrand, again.brandToMember], [0, 0], "second call inserted again");
});

// ── 7. Returning old member on sign-in ──────────────────────────────────────
await section("a returning old member gets member -> brand only", async () => {
  const returning = await member("returning");
  const r = await ensure(returning);
  assert.equal(r.memberToBrand, 1, `old member missing the follow did not get it: ${JSON.stringify(r)}`);
  assert.equal(r.brandToMember, 0, "the brand followed an old member on sign-in");
  assert.equal(await follows(brand, returning), 0);
});

// ── 8. Privileges ───────────────────────────────────────────────────────────
await section("follow functions are service_role only", async () => {
  for (const sig of [
    "public.backfill_brand_follows(integer, integer, interval)",
    "public.ensure_brand_follow_relationships(integer, integer, boolean, interval)",
    "public.brand_follow_eligible(integer, integer)",
  ]) {
    const [p] = await sql(
      `SELECT has_function_privilege('anon', $1, 'execute') AS anon,
              has_function_privilege('authenticated', $1, 'execute') AS authed,
              has_function_privilege('service_role', $1, 'execute') AS svc`,
      [sig],
    );
    assert.deepEqual(p, { anon: false, authed: false, svc: true }, sig);
  }
});

// ── 9. First-post prompt after adult verification ──────────────────────────
const verify = (name, dob = "1990-01-01", status = "passed") =>
  sql(`INSERT INTO public.identity_verifications (user_id, status, date_of_birth) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, date_of_birth = EXCLUDED.date_of_birth`,
      [`auth_${name}`, status, dob]);
const prompt = async (name) =>
  (await sql(`SELECT public.enqueue_first_post_prompt($1) AS n`, [`auth_${name}`]))[0].n;
const outboxRows = async (id, version) =>
  sql(`SELECT state, last_error FROM public.brand_message_outbox WHERE recipient_id = $1 AND campaign_version = $2`, [id, version]);

await section("the first-post prompt is queued once after verification, never for unverified or posting members", async () => {
  const verified = await member("verifiedfresh", { created: "now()" });
  assert.equal(await prompt("verifiedfresh"), 0, "queued before the member passed verification");
  await verify("verifiedfresh", "2010-01-01");
  assert.equal(await prompt("verifiedfresh"), 0, "queued for a minor's passed verification");
  await verify("verifiedfresh", "1990-01-01", "failed");
  assert.equal(await prompt("verifiedfresh"), 0, "queued for a failed verification");
  await verify("verifiedfresh");
  assert.equal(await prompt("verifiedfresh"), 1, "not queued after adult verification");
  assert.equal(await prompt("verifiedfresh"), 0, "queued twice");
  const rows = await outboxRows(verified, "first_post_v2");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "queued");

  const poster = await member("poster", { created: "now()" });
  await verify("poster");
  await sql(`INSERT INTO public.posts (author_id) VALUES ($1)`, [poster]);
  assert.equal(await prompt("poster"), 0, "queued for a member who already posted");
  assert.equal(await prompt("nobody"), 0, "queued for an unknown auth id");
});

// ── 10. The 24h reminder skips unverified members ──────────────────────────
await section("the 24h first-post reminder is suppressed for unverified members and beside the prompt", async () => {
  const unverified = await member("unverified24", { created: "now() - interval '2 days'" });
  const verifiedOld = await member("verified24", { created: "now() - interval '2 days'" });
  await verify("verified24");
  const both = await member("both24", { created: "now() - interval '2 days'" });
  await verify("both24");
  for (const name of ["unverified24", "verified24", "both24"]) {
    await sql(`SELECT public.enqueue_brand_onboarding($1, interval '7 days', interval '0 seconds')`, [`auth_${name}`]);
  }
  assert.equal(await prompt("both24"), 1);
  // Only first-post rows are claimable for this check.
  await sql(`UPDATE public.brand_message_outbox SET state = 'suppressed' WHERE campaign <> 'first_post_reminder' AND state = 'queued'`);
  await sql(`SELECT * FROM public.claim_brand_messages($1, 100, 2, interval '7 days')`, [brand]);

  assert.deepEqual(await outboxRows(unverified, "first_post_v1"), [{ state: "suppressed", last_error: "unverified" }]);
  assert.equal((await outboxRows(verifiedOld, "first_post_v1"))[0].state, "sending", "a verified member lost the reminder");
  assert.deepEqual(await outboxRows(both, "first_post_v1"), [{ state: "suppressed", last_error: "already_prompted" }]);
  assert.equal((await outboxRows(both, "first_post_v2"))[0].state, "sending");

  // A prompt that already went out stops a later reminder and a second prompt.
  await sql(`UPDATE public.brand_message_outbox SET state = 'sent', sent_at = now() WHERE state = 'sending'`);
  assert.equal(await prompt("verified24"), 0, "prompted after the reminder was sent");
});

// ── 11. Checkout-profile welcome email exactly once ────────────────────────
await section("a checkout-created profile gets the welcome email exactly once", async () => {
  await member("checkoutbuyer", { created: "now()" });
  await sql(`INSERT INTO public.user_private_profile (auth_id, email_normalized, source) VALUES ($1, $2, 'checkout')`,
    ["auth_checkoutbuyer", "checkoutbuyer@example.test"]);
  await member("betterauthsignup", { created: "now()" });
  await member("oldcheckout", { created: OLD });
  await sql(`INSERT INTO public.user_private_profile (auth_id, email_normalized, source, created_at)
             VALUES ($1, $2, 'checkout', now() - interval '90 days')`, ["auth_oldcheckout", "oldcheckout@example.test"]);

  const claim = () => sql(`SELECT * FROM public.claim_checkout_welcome_emails(interval '7 days', 50)`);
  const complete = (sent) =>
    sql(`SELECT public.complete_checkout_welcome_email($1, $2, $3)`, ["auth_checkoutbuyer", sent, sent ? "re_1" : null]);

  const [first, second] = await Promise.all([claim(), claim()]);
  const claimed = [...first, ...second];
  assert.deepEqual(claimed, [{ auth_id: "auth_checkoutbuyer", email: "checkoutbuyer@example.test", username: "checkoutbuyer" }],
    "concurrent claims must hand the checkout profile out once, and nobody else");
  // A failed send releases the marker, so the next tick retries.
  await complete(false);
  assert.equal((await claim()).length, 1, "a released claim was not retried");
  await complete(true);
  assert.equal((await claim()).length, 0, "claimed again after it was sent");
  await complete(false);
  const [marker] = await sql(`SELECT sent_at IS NOT NULL AS sent, provider_message_id FROM public.welcome_email_sends WHERE auth_id = $1`, ["auth_checkoutbuyer"]);
  assert.deepEqual(marker, { sent: true, provider_message_id: "re_1" }, "a sent marker was released");
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM public.welcome_email_sends`);
  assert.equal(n, 1, "a Better Auth signup or an old checkout profile was claimed");
});

await section("onboarding functions are service_role only", async () => {
  for (const sig of [
    "public.enqueue_first_post_prompt(text)",
    "public.brand_member_adult_verified(integer)",
    "public.claim_checkout_welcome_emails(interval, integer)",
    "public.complete_checkout_welcome_email(text, boolean, text)",
  ]) {
    const [p] = await sql(
      `SELECT has_function_privilege('anon', $1, 'execute') AS anon,
              has_function_privilege('authenticated', $1, 'execute') AS authed,
              has_function_privilege('service_role', $1, 'execute') AS svc`,
      [sig],
    );
    assert.deepEqual(p, { anon: false, authed: false, svc: true }, sig);
  }
});

if (failures.length) {
  console.error(`\nverify-brand-follows: ${failures.length} section(s) failed`);
  process.exit(1);
}
console.log("\nverify-brand-follows: all sections pass");
