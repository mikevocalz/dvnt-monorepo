#!/usr/bin/env node
/**
 * Runs 20261003170000_verified_admission_whole_membership.sql against a real
 * Postgres and checks what it does to row-level security, persona by persona.
 *
 * The migration rewrites verified_participation_allowed(), drops the
 * participation boundary from tickets, ticket_holds and event_rsvps, and adds
 * RESTRICTIVE SPICY (is_nsfw) policies on posts, posts_media and
 * post_text_slides. None of that is reachable from a unit test: whether a row
 * comes back depends on which permissive and restrictive policies Postgres
 * combines for the role and JWT claims PostgREST sets. So this harness boots a
 * throwaway cluster and asks Postgres.
 *
 * It builds two databases from the same fixture. The fixture reproduces the
 * live definitions the migration depends on, read from npfjanxturvmjyevoyfo on
 * 2026-10-03 (information_schema.columns, pg_policies, pg_get_functiondef,
 * has_table_privilege): auth.jwt(), is_verified_self(), the live
 * verified_participation_allowed(), every policy on the tables involved, and
 * the table grants for anon and authenticated.
 *
 *   pre   the fixture alone, i.e. production today
 *   post  the fixture plus the migration, applied twice (it must re-run)
 *
 * Every section runs against both. On post every section must pass. On pre,
 * each section marked `changed` must FAIL, which proves the check can tell the
 * migration apart from production, and each unmarked section must pass, which
 * proves the fixture behaves like production where the migration changes
 * nothing.
 *
 * Personas, each an authenticated JWT unless noted:
 *   unverified   account two days old, no ID check
 *   underage     failed ID check, failure_code underage, born 16 years ago
 *   old          account two years old, no ID check
 *   adult        passed ID check, born 30 years ago
 *   anon         role anon, no sub
 *   service      role service_role (BYPASSRLS, as on live)
 *
 *   node scripts/verify-admission-gate.mjs
 *   node scripts/verify-admission-gate.mjs --allow-skip   # no Postgres: record as unverified
 *   ADMISSION_GATE_MIGRATION=/path/to/other.sql node scripts/verify-admission-gate.mjs
 *
 * Needs the Postgres server binaries (initdb/pg_ctl/postgres) from one prefix,
 * found the same way as verify-call-capacity.mjs. Without --allow-skip a
 * missing server is a failure, not a pass.
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
  process.env.ADMISSION_GATE_MIGRATION ||
  join(MIGRATIONS, "20261003170000_verified_admission_whole_membership.sql");

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
    "verify-admission-gate: no complete Postgres server install found. " +
    "The admission gate and SPICY RLS assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-admission-gate-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-admission-gate-sock-"));
const run = (bin, args) =>
  execFileSync(`${prefix}${bin}`, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const pools = [];
function teardown() {
  for (const p of pools) {
    try {
      p.end();
    } catch {}
  }
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

const connect = (database) => {
  const p = new pg.Pool({ host: socketDir, user: "harness", database, max: 4 });
  pools.push(p);
  return p;
};

// Roles are cluster-wide. service_role has BYPASSRLS on live (pg_roles,
// 2026-10-03), so it is created that way here.
const admin = connect("postgres");
await admin.query(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
`);
await admin.query("CREATE DATABASE pre");
await admin.query("CREATE DATABASE post");

// ── Fixture: the live definitions the migration depends on ──────────────────
// Columns are the subset these policies and checks touch, with live types,
// defaults and CHECK constraints. Foreign keys to tables outside this set
// (carts, orders, ticket_types) are left out.
//
// Left out: event_private_boundary on event_rsvps, event_likes and
// event_comments, a RESTRICTIVE SELECT policy calling can_view_event(event_id),
// which reaches the whole events privacy model. It governs reads only; this
// harness only inserts into those tables (no RETURNING), so it cannot affect
// any assertion. The count and history triggers on likes and event_likes are
// left out too: they run after the row passes RLS and do not decide it.
const FIXTURE = `
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

CREATE TYPE public.enum_posts_visibility AS ENUM ('public', 'followers', 'private');
CREATE TYPE public.enum_posts_moderation_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.enum_posts_media_type AS ENUM ('image', 'video');
CREATE TYPE public.enum_event_rsvps_status AS ENUM ('going', 'interested', 'not_going');

CREATE TABLE public."user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  username VARCHAR NOT NULL,
  email VARCHAR NOT NULL,
  auth_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_auth_id_key ON public.users (auth_id);

CREATE TABLE public.identity_verifications (
  user_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'persona'
    CHECK (provider = ANY (ARRAY['persona', 'veriff', 'onfido', 'yoti', 'didit'])),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending', 'submitted', 'passed', 'failed', 'expired', 'review'])),
  date_of_birth DATE,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.verified_admission_policy (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enforce BOOLEAN NOT NULL DEFAULT false,
  cohort_created_after TIMESTAMPTZ,
  grace_deadline TIMESTAMPTZ,
  allowlist TEXT[] NOT NULL DEFAULT '{}'::text[],
  denylist TEXT[] NOT NULL DEFAULT '{}'::text[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The live row on 2026-10-03: enforce false, no cohort, no grace, empty lists.
INSERT INTO public.verified_admission_policy (id) VALUES (1);

CREATE TABLE public.posts (
  id SERIAL PRIMARY KEY,
  author_id INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
  content VARCHAR,
  visibility public.enum_posts_visibility DEFAULT 'public',
  moderation_status public.enum_posts_moderation_status DEFAULT 'approved',
  is_nsfw BOOLEAN DEFAULT false,
  post_kind TEXT NOT NULL DEFAULT 'media' CHECK (post_kind = ANY (ARRAY['media', 'text'])),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.posts_media (
  _order INTEGER NOT NULL,
  _parent_id INTEGER NOT NULL,
  id VARCHAR PRIMARY KEY,
  type public.enum_posts_media_type,
  url VARCHAR
);

CREATE TABLE public.post_text_slides (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL,
  slide_index SMALLINT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.comments (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  content VARCHAR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stand-in: only the two columns the ticket policies read.
CREATE TABLE public.events (id SERIAL PRIMARY KEY, host_id TEXT);

CREATE TABLE public.likes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES public.posts(id) ON DELETE SET NULL,
  comment_id INTEGER REFERENCES public.comments(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);

CREATE TABLE public.event_likes (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE public.event_comments (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.event_rsvps (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status public.enum_event_rsvps_status NOT NULL DEFAULT 'interested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id TEXT,
  status TEXT DEFAULT 'active'
    CHECK (status = ANY (ARRAY['active', 'scanned', 'refunded', 'void', 'transfer_pending'])),
  qr_token TEXT NOT NULL UNIQUE,
  guest_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK ((user_id IS NOT NULL) OR (guest_email IS NOT NULL))
);

CREATE TABLE public.ticket_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  ticket_type_id UUID NOT NULL,
  event_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active', 'converted', 'expired'])),
  expires_at TIMESTAMPTZ NOT NULL,
  hold_kind TEXT NOT NULL DEFAULT 'checkout' CHECK (hold_kind = ANY (ARRAY['checkout', 'async_settlement'])),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Grants, as has_table_privilege reports them on live ──
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments, public.event_rsvps, public.posts,
  public.posts_media, public.users, public.likes, public.event_likes, public.event_comments
  TO anon, authenticated;
GRANT SELECT ON public.identity_verifications TO authenticated;
GRANT SELECT ON public.post_text_slides TO anon, authenticated;
GRANT SELECT ON public.ticket_holds TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tickets TO authenticated;
GRANT SELECT ON public."user" TO anon, authenticated;
GRANT SELECT ON public.events TO anon, authenticated;

ALTER TABLE public."user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verified_admission_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_text_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_comments ENABLE ROW LEVEL SECURITY;

-- ── Live functions (pg_get_functiondef) ──
CREATE FUNCTION public.is_verified_self()
 RETURNS boolean LANGUAGE sql STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM identity_verifications
    WHERE user_id = (NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub')
      AND status = 'passed'
      AND date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
      AND date_of_birth > (CURRENT_DATE - INTERVAL '121 years')::date
  );
$function$;
REVOKE ALL ON FUNCTION public.is_verified_self() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_verified_self() TO authenticated, service_role;

CREATE FUNCTION public.verified_participation_allowed()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role' THEN true
    ELSE (
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1 FROM public.identity_verifications v
            WHERE v.user_id = sub.id AND v.date_of_birth IS NOT NULL
              AND v.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
          ) THEN false
          WHEN NOT p.enforce THEN true
          WHEN sub.id IS NULL THEN false
          WHEN sub.id = ANY (p.denylist) THEN public.is_verified_self() OR p.grace_deadline IS NULL
            OR now() < p.grace_deadline
          WHEN sub.id = ANY (p.allowlist) THEN true
          WHEN p.cohort_created_after IS NOT NULL AND EXISTS (
            SELECT 1 FROM public."user" u
            WHERE u.id = sub.id AND u."createdAt" < p.cohort_created_after
          ) THEN true
          ELSE public.is_verified_self() OR p.grace_deadline IS NULL OR now() < p.grace_deadline
        END
      FROM public.verified_admission_policy p,
           LATERAL (SELECT auth.jwt() ->> 'sub' AS id) sub
      WHERE p.id = 1
    )
  END;
$function$;
REVOKE ALL ON FUNCTION public.verified_participation_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verified_participation_allowed() TO anon, authenticated, service_role;

CREATE FUNCTION public.verified_admission_context()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'userId', sub.id,
    'accountCreatedAt', (SELECT u."createdAt" FROM public."user" u WHERE u.id = sub.id),
    'policy', jsonb_build_object(
      'enforce', p.enforce,
      'cohort_created_after', p.cohort_created_after,
      'grace_deadline', p.grace_deadline
    ),
    'exempt', sub.id = ANY (p.allowlist),
    'denied', sub.id = ANY (p.denylist),
    'record', (
      SELECT jsonb_build_object('user_id', v.user_id, 'status', v.status, 'date_of_birth', v.date_of_birth)
      FROM public.identity_verifications v WHERE v.user_id = sub.id
    )
  )
  FROM public.verified_admission_policy p,
       LATERAL (SELECT NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub' AS id) sub
  WHERE p.id = 1 AND sub.id IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.verified_admission_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verified_admission_context() TO authenticated, service_role;

-- ── Live policies (pg_policies) ──
CREATE POLICY "Users are viewable by everyone" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (true);
CREATE POLICY users_insert_anon ON public.users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY users_insert_authenticated ON public.users FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY identity_verifications_own ON public.identity_verifications FOR SELECT TO authenticated
  USING (user_id = ((current_setting('request.jwt.claims', true))::json ->> 'sub'));

CREATE POLICY "Anyone can create posts" ON public.posts FOR INSERT WITH CHECK (true);
CREATE POLICY "Public posts are viewable by everyone" ON public.posts FOR SELECT
  USING ((visibility = 'public'::enum_posts_visibility) OR (visibility IS NULL) OR (author_id = (
    SELECT u.id FROM users u
    WHERE (u.auth_id = ((NULLIF(current_setting('request.jwt.claims', true), ''))::json ->> 'sub')))));
CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE USING (true);
CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE USING (true);
CREATE POLICY verified_participation_boundary ON public.posts AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());

CREATE POLICY "Anyone can insert posts media" ON public.posts_media FOR INSERT WITH CHECK (true);
CREATE POLICY "Posts media viewable by everyone" ON public.posts_media FOR SELECT USING (true);
CREATE POLICY posts_media_delete_anon ON public.posts_media FOR DELETE TO anon USING (true);
CREATE POLICY verified_participation_boundary ON public.posts_media AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());

CREATE POLICY post_text_slides_select_public ON public.post_text_slides FOR SELECT USING (true);
CREATE POLICY verified_participation_boundary ON public.post_text_slides AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());

CREATE POLICY "Anyone can create comments" ON public.comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Comments viewable by everyone" ON public.comments FOR SELECT USING (true);
CREATE POLICY "Users can delete own comments" ON public.comments FOR DELETE USING (true);
CREATE POLICY comments_update_anon ON public.comments FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY verified_participation_boundary ON public.comments AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());

CREATE POLICY "Anyone can create RSVPs" ON public.event_rsvps FOR INSERT WITH CHECK (true);
CREATE POLICY "RSVPs viewable by everyone" ON public.event_rsvps FOR SELECT USING (true);
CREATE POLICY "Users can update own RSVPs" ON public.event_rsvps FOR UPDATE USING (true);
CREATE POLICY event_rsvps_delete ON public.event_rsvps FOR DELETE USING (true);
CREATE POLICY verified_participation_boundary ON public.event_rsvps AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());

CREATE POLICY "Anyone can create likes" ON public.likes FOR INSERT WITH CHECK (true);
CREATE POLICY "Likes viewable by everyone" ON public.likes FOR SELECT USING (true);
CREATE POLICY "Users can delete own likes" ON public.likes FOR DELETE USING (true);
CREATE POLICY verified_participation_boundary ON public.likes AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());

CREATE POLICY event_likes_select ON public.event_likes FOR SELECT USING (true);
CREATE POLICY event_likes_insert ON public.event_likes FOR INSERT WITH CHECK (true);
CREATE POLICY event_likes_delete ON public.event_likes FOR DELETE USING (true);
CREATE POLICY verified_participation_boundary ON public.event_likes AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());

CREATE POLICY event_comments_select ON public.event_comments FOR SELECT USING (true);
CREATE POLICY event_comments_insert_all ON public.event_comments FOR INSERT WITH CHECK (true);
CREATE POLICY verified_participation_boundary ON public.event_comments AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());

CREATE POLICY ticket_holds_own ON public.ticket_holds FOR SELECT
  USING (user_id = (SELECT ((current_setting('request.jwt.claims', true))::json ->> 'sub')));
CREATE POLICY verified_participation_boundary ON public.ticket_holds AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());

CREATE POLICY tickets_select_own ON public.tickets FOR SELECT
  USING ((user_id = (SELECT ((current_setting('request.jwt.claims', true))::json ->> 'sub'))) OR (EXISTS (
    SELECT 1 FROM events e
    WHERE ((e.id = tickets.event_id) AND (e.host_id = (SELECT ((current_setting('request.jwt.claims', true))::json ->> 'sub')))))));
CREATE POLICY tickets_update_host ON public.tickets FOR UPDATE
  USING (EXISTS (SELECT 1 FROM events e
    WHERE ((e.id = tickets.event_id) AND (e.host_id = (SELECT ((current_setting('request.jwt.claims', true))::json ->> 'sub'))))));
CREATE POLICY verified_participation_boundary ON public.tickets AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (verified_participation_allowed());
`;

// ── Seed, identical in both databases ───────────────────────────────────────
const PERSONAS = {
  unverified: { id: 1, auth: "u_unverified", created: "now() - interval '2 days'" },
  underage: { id: 2, auth: "u_underage", created: "now() - interval '2 days'" },
  old: { id: 3, auth: "u_old", created: "now() - interval '2 years'" },
  adult: { id: 4, auth: "u_adult", created: "now() - interval '2 days'" },
};
const MEMBERS = Object.keys(PERSONAS);
const EVERYONE = [...MEMBERS, "anon"];

// Post ids are fixed so the checks can name them.
const POST = {
  publicByAdult: 1,
  spicyByUnverified: 2,
  spicyByAdult: 3,
  // One plain post per persona, used for the "update to SPICY" check.
  plain: { unverified: 11, underage: 12, old: 13, adult: 14, anon: 15 },
};
const SPICY = [POST.spicyByUnverified, POST.spicyByAdult];

async function seed(db) {
  for (const [name, p] of Object.entries(PERSONAS)) {
    await db.query(
      `INSERT INTO public."user" (id, name, email, "emailVerified", "createdAt")
       VALUES ($1, $2::text, $2::text || '@example.test', true, ${p.created})`,
      [p.auth, name],
    );
    await db.query(
      `INSERT INTO public.users (id, username, email, auth_id, created_at)
       VALUES ($1, $2::text, $2::text || '@example.test', $3, ${p.created})`,
      [p.id, name, p.auth],
    );
  }
  await db.query(`SELECT setval('public.users_id_seq', 100)`);
  await db.query(`
    INSERT INTO public.identity_verifications (user_id, status, date_of_birth, failure_code) VALUES
      ('u_underage', 'failed', (CURRENT_DATE - INTERVAL '16 years')::date, 'underage'),
      ('u_adult',    'passed', (CURRENT_DATE - INTERVAL '30 years')::date, NULL);
    INSERT INTO public.posts (id, author_id, content, is_nsfw) VALUES
      (1, 4, 'plain by adult', false),
      (2, 1, 'spicy by unverified', true),
      (3, 4, 'spicy by adult', true),
      (11, 1, 'plain', false), (12, 2, 'plain', false), (13, 3, 'plain', false),
      (14, 4, 'plain', false), (15, NULL, 'plain', false);
    SELECT setval('public.posts_id_seq', 100);
    INSERT INTO public.posts_media (_order, _parent_id, id, type, url) VALUES
      (1, 1, 'm1', 'image', 'https://example.test/1.jpg'),
      (1, 2, 'm2', 'image', 'https://example.test/2.jpg'),
      (2, 2, 'm2b', 'video', 'https://example.test/2.mp4'),
      (1, 3, 'm3', 'image', 'https://example.test/3.jpg');
    INSERT INTO public.post_text_slides (post_id, slide_index, content) VALUES
      (1, 0, 'plain slide'), (2, 0, 'spicy slide a'), (2, 1, 'spicy slide b'), (3, 0, 'spicy slide c');
    INSERT INTO public.events (id, host_id) VALUES (1, 'u_host');
  `);
}

const pre = connect("pre");
const post = connect("post");
const migrationSql = readFileSync(TARGET, "utf8");

for (const db of [pre, post]) {
  await db.query(FIXTURE);
  await seed(db);
}

// Applied twice: the file must be re-runnable, because a migration that
// half-applies and is retried, or is replayed by `supabase db reset`, must
// not fail on its own leftovers.
const setupFailures = [];
try {
  await post.query(migrationSql);
  await post.query(migrationSql);
  console.log("OK: migration applies, and applies again over itself");
} catch (err) {
  setupFailures.push("migration applies twice");
  console.error(`FAIL: migration applies twice\n  ${err.message}`);
}

// ── Running a statement as a persona, the way PostgREST does ────────────────
function claimsFor(who) {
  if (who === "anon") return { role: "anon", claims: { role: "anon" } };
  if (who === "service") return { role: "service_role", claims: { role: "service_role" } };
  return { role: "authenticated", claims: { sub: PERSONAS[who].auth, role: "authenticated" } };
}

async function as(db, who, text, params = []) {
  const { role, claims } = claimsFor(who);
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(text, params);
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    // Every persona statement is rolled back, so checks never see each
    // other's writes.
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

const DEFAULT_POLICY = { enforce: false, cohort_created_after: null, grace_deadline: null, allowlist: [], denylist: [] };
async function withPolicy(db, patch, fn) {
  const p = { ...DEFAULT_POLICY, ...patch };
  await db.query(
    `UPDATE public.verified_admission_policy
     SET enforce = $1, cohort_created_after = $2, grace_deadline = $3, allowlist = $4, denylist = $5
     WHERE id = 1`,
    [p.enforce, p.cohort_created_after, p.grace_deadline, p.allowlist, p.denylist],
  );
  try {
    await fn();
  } finally {
    await db.query(
      `UPDATE public.verified_admission_policy
       SET enforce = false, cohort_created_after = NULL, grace_deadline = NULL,
           allowlist = '{}', denylist = '{}'
       WHERE id = 1`,
    );
  }
}

async function withPolicyResult(db, patch, fn) {
  let out;
  await withPolicy(db, patch, async () => {
    out = await fn();
  });
  return out;
}

const userIdOf = (who) => (who === "anon" ? null : PERSONAS[who].id);
const authIdOf = (who) => (who === "anon" ? "anon_guest" : PERSONAS[who].auth);

const insertPost = (db, who, nsfw = false) =>
  as(db, who, `INSERT INTO public.posts (author_id, content, is_nsfw) VALUES ($1, 'new', $2)`, [userIdOf(who), nsfw]);
// Comments need an author row; anon has none, so it borrows the adult's id.
// The participation boundary must refuse it before that matters.
const insertComment = (db, who) =>
  as(db, who, `INSERT INTO public.comments (author_id, post_id, content) VALUES ($1, $2, 'hi')`, [
    userIdOf(who) ?? PERSONAS.adult.id,
    POST.publicByAdult,
  ]);
const insertRsvp = (db, who) =>
  as(db, who, `INSERT INTO public.event_rsvps (event_id, user_id, status) VALUES (1, $1, 'going')`, [authIdOf(who)]);

function expectOutcomes(results, expected, label) {
  const got = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.ok]));
  assert.deepEqual(got, expected, `${label}\n  errors: ${JSON.stringify(
    Object.fromEntries(Object.entries(results).filter(([, r]) => !r.ok).map(([k, r]) => [k, r.error])),
  )}`);
}

async function each(names, fn) {
  const out = {};
  for (const n of names) out[n] = await fn(n);
  return out;
}

// ── Sections ────────────────────────────────────────────────────────────────
// `changed: true` = the migration changes this behaviour, so the section must
// fail against production (pre) and pass after the migration (post).
const SECTIONS = [
  {
    name: "SPICY posts, media and slides are visible only to the author and to an approved adult",
    changed: true,
    async fn(db) {
      const expected = {
        unverified: [POST.spicyByUnverified], // the author of post 2
        underage: [],
        old: [],
        adult: SPICY,
        anon: [],
        service: SPICY,
      };
      for (const [who, ids] of Object.entries(expected)) {
        const p = await as(db, who, `SELECT id FROM public.posts WHERE is_nsfw IS TRUE ORDER BY id`);
        assert.ok(p.ok, `${who} posts read errored: ${p.error}`);
        assert.deepEqual(p.rows.map((r) => r.id), ids, `${who}: SPICY posts visible`);

        const m = await as(db, who, `SELECT DISTINCT _parent_id AS id FROM public.posts_media WHERE _parent_id = ANY($1) ORDER BY 1`, [SPICY]);
        assert.ok(m.ok, `${who} posts_media read errored: ${m.error}`);
        assert.deepEqual(m.rows.map((r) => r.id), ids, `${who}: SPICY posts_media visible`);

        const s = await as(db, who, `SELECT DISTINCT post_id::int AS id FROM public.post_text_slides WHERE post_id = ANY($1) ORDER BY 1`, [SPICY]);
        assert.ok(s.ok, `${who} post_text_slides read errored: ${s.error}`);
        assert.deepEqual(s.rows.map((r) => r.id), ids, `${who}: SPICY post_text_slides visible`);
      }
    },
  },
  {
    name: "plain posts, media and slides stay visible to every persona",
    changed: false,
    async fn(db) {
      for (const who of [...EVERYONE, "service"]) {
        const p = await as(db, who, `SELECT count(*)::int AS n FROM public.posts WHERE id = $1`, [POST.publicByAdult]);
        const m = await as(db, who, `SELECT count(*)::int AS n FROM public.posts_media WHERE _parent_id = $1`, [POST.publicByAdult]);
        const s = await as(db, who, `SELECT count(*)::int AS n FROM public.post_text_slides WHERE post_id = $1`, [POST.publicByAdult]);
        assert.deepEqual([p.rows?.[0]?.n, m.rows?.[0]?.n, s.rows?.[0]?.n], [1, 1, 1], `${who}: ${p.error ?? m.error ?? s.error ?? ""}`);
      }
    },
  },
  {
    name: "only an approved adult can create a SPICY post",
    changed: true,
    async fn(db) {
      await withPolicy(db, { enforce: false }, async () => {
        const r = await each(EVERYONE, (who) => insertPost(db, who, true));
        expectOutcomes(r, { unverified: false, underage: false, old: false, adult: true, anon: false }, "INSERT is_nsfw = true");
      });
    },
  },
  {
    name: "only an approved adult can mark a post SPICY by update",
    changed: true,
    async fn(db) {
      await withPolicy(db, { enforce: false }, async () => {
        const r = await each(EVERYONE, (who) =>
          as(db, who, `UPDATE public.posts SET is_nsfw = true WHERE id = $1`, [POST.plain[who]]));
        expectOutcomes(r, { unverified: false, underage: false, old: false, adult: true, anon: false }, "UPDATE SET is_nsfw = true");
        for (const [who, res] of Object.entries(r)) {
          if (res.ok) assert.equal(res.rowCount, 1, `${who}: the update matched no row, so it proved nothing`);
        }
      });
    },
  },
  {
    name: "a non-adult author can still edit a plain post and un-mark their own SPICY post",
    changed: false,
    async fn(db) {
      const edit = await as(db, "unverified", `UPDATE public.posts SET content = 'edited' WHERE id = $1`, [POST.plain.unverified]);
      assert.ok(edit.ok && edit.rowCount === 1, `plain edit: ${edit.error ?? edit.rowCount}`);
      const unmark = await as(db, "unverified", `UPDATE public.posts SET is_nsfw = false WHERE id = $1`, [POST.spicyByUnverified]);
      assert.ok(unmark.ok && unmark.rowCount === 1, `un-mark own SPICY: ${unmark.error ?? unmark.rowCount}`);
    },
  },
  {
    name: "enforce = true, no grace: only the approved adult may post or comment",
    changed: true,
    async fn(db) {
      await withPolicy(db, { enforce: true }, async () => {
        const expected = { unverified: false, underage: false, old: false, adult: true, anon: false };
        expectOutcomes(await each(EVERYONE, (who) => insertPost(db, who)), expected, "posts INSERT");
        expectOutcomes(await each(EVERYONE, (who) => insertComment(db, who)), expected, "comments INSERT");
      });
    },
  },
  {
    name: "enforce = true, no grace: every persona can still RSVP",
    changed: true,
    async fn(db) {
      await withPolicy(db, { enforce: true }, async () => {
        const all = Object.fromEntries(EVERYONE.map((w) => [w, true]));
        expectOutcomes(await each(EVERYONE, (who) => insertRsvp(db, who)), all, "event_rsvps INSERT");
      });
    },
  },
  {
    name: "enforce = true, no grace: every member can like a post, a comment and an event",
    changed: true,
    async fn(db) {
      await db.query(`INSERT INTO public.comments (id, author_id, post_id, content) VALUES (900, 4, 1, 'seed')
                      ON CONFLICT DO NOTHING`);
      await withPolicy(db, { enforce: true }, async () => {
        const all = Object.fromEntries(MEMBERS.map((w) => [w, true]));
        expectOutcomes(
          await each(MEMBERS, (who) => as(db, who, `INSERT INTO public.likes (user_id, post_id) VALUES ($1, $2)`, [userIdOf(who), POST.publicByAdult])),
          all, "likes INSERT (post)");
        expectOutcomes(
          await each(MEMBERS, (who) => as(db, who, `INSERT INTO public.likes (user_id, comment_id) VALUES ($1, 900)`, [userIdOf(who)])),
          all, "likes INSERT (comment)");
        expectOutcomes(
          await each(MEMBERS, (who) => as(db, who, `INSERT INTO public.event_likes (event_id, user_id) VALUES (1, $1)`, [userIdOf(who)])),
          all, "event_likes INSERT");
      });
    },
  },
  {
    name: "enforce = true, no grace: event comments stay verified-only",
    changed: true,
    async fn(db) {
      await withPolicy(db, { enforce: true }, async () => {
        expectOutcomes(
          await each(EVERYONE, (who) => as(db, who,
            `INSERT INTO public.event_comments (event_id, author_id, content) VALUES (1, $1, 'hi')`,
            [userIdOf(who) ?? PERSONAS.adult.id])),
          { unverified: false, underage: false, old: false, adult: true, anon: false },
          "event_comments INSERT",
        );
      });
    },
  },
  {
    name: "the participation boundary is gone from tickets, ticket_holds, event_rsvps, likes and event_likes and kept elsewhere",
    changed: true,
    async fn(db) {
      const rows = await db.query(
        `SELECT tablename FROM pg_policies
         WHERE schemaname = 'public' AND policyname = 'verified_participation_boundary' ORDER BY 1`,
      );
      assert.deepEqual(
        rows.rows.map((r) => r.tablename),
        ["comments", "event_comments", "post_text_slides", "posts", "posts_media"],
      );
    },
  },
  {
    name: "enforce = true: ticket and hold writes through service_role succeed for every persona; clients still cannot write tickets",
    changed: false,
    async fn(db) {
      await withPolicy(db, { enforce: true }, async () => {
        // Live has no permissive INSERT policy on tickets for anon or
        // authenticated, and no INSERT grant on ticket_holds for them. Tickets
        // and holds are written by the checkout edge functions as
        // service_role, so that is the path "everyone can buy" runs through.
        const svc = await each(EVERYONE, (who) =>
          as(db, "service", `
            WITH t AS (INSERT INTO public.tickets (event_id, user_id, qr_token) VALUES (1, $1::text, $1::text || '-qr') RETURNING 1),
                 h AS (INSERT INTO public.ticket_holds (user_id, ticket_type_id, event_id, expires_at)
                       VALUES ($1::text, gen_random_uuid(), 1, now() + interval '10 minutes') RETURNING 1)
            SELECT (SELECT count(*) FROM t) + (SELECT count(*) FROM h) AS n`, [authIdOf(who)]));
        expectOutcomes(svc, Object.fromEntries(EVERYONE.map((w) => [w, true])), "service_role tickets + ticket_holds INSERT");
        const direct = await each(EVERYONE, (who) =>
          as(db, who, `INSERT INTO public.tickets (event_id, user_id, qr_token) VALUES (1, $1::text, $1::text || '-forged')`, [authIdOf(who)]));
        expectOutcomes(direct, Object.fromEntries(EVERYONE.map((w) => [w, false])), "client tickets INSERT (must stay refused)");
      });
    },
  },
  {
    name: "enforce = false, NULL grace: inert for everyone except a proven-underage document",
    changed: false,
    async fn(db) {
      await withPolicy(db, { enforce: false, grace_deadline: null }, async () => {
        expectOutcomes(
          await each(EVERYONE, (who) => insertPost(db, who)),
          { unverified: true, underage: false, old: true, adult: true, anon: true },
          "posts INSERT with enforce = false",
        );
        // RSVPs: production still refuses the underage persona through the
        // boundary policy; the migration drops that policy, so after it every
        // persona can RSVP.
        expectOutcomes(
          await each(EVERYONE, (who) => insertRsvp(db, who)),
          Object.fromEntries(EVERYONE.map((w) => [w, w !== "underage" || db === post])),
          "event_rsvps INSERT with enforce = false",
        );
      });
    },
  },
  {
    name: "enforce = true: a future grace deadline admits the unverified, a past one refuses them",
    changed: false,
    async fn(db) {
      await withPolicy(db, { enforce: true, grace_deadline: new Date(Date.now() + 86_400_000) }, async () => {
        expectOutcomes(
          await each(["unverified", "old", "underage", "anon"], (who) => insertPost(db, who)),
          { unverified: true, old: true, underage: false, anon: false },
          "future grace",
        );
      });
      await withPolicy(db, { enforce: true, grace_deadline: new Date(Date.now() - 86_400_000) }, async () => {
        expectOutcomes(
          await each(["unverified", "old", "adult"], (who) => insertPost(db, who)),
          { unverified: false, old: false, adult: true },
          "past grace",
        );
      });
    },
  },
  {
    name: "enforce = true: the allowlist admits",
    changed: false,
    async fn(db) {
      // A past grace deadline keeps this independent of what NULL grace means.
      const PAST = new Date(Date.now() - 86_400_000);
      await withPolicy(db, { enforce: true, grace_deadline: PAST, allowlist: ["u_unverified"] }, async () => {
        expectOutcomes(await each(["unverified", "old"], (who) => insertPost(db, who)), { unverified: true, old: false }, "allowlist");
      });
    },
  },
  {
    name: "enforce = true: a cohort_created_after left on the row exempts nobody",
    changed: true,
    async fn(db) {
      const PAST = new Date(Date.now() - 86_400_000);
      await withPolicy(db, { enforce: true, grace_deadline: PAST, cohort_created_after: new Date() }, async () => {
        // Every member account predates this cohort date. Production today
        // exempts all of them; after the migration only the adult is admitted.
        expectOutcomes(
          await each(MEMBERS, (who) => insertPost(db, who)),
          { unverified: false, underage: false, old: false, adult: true },
          "posts INSERT with cohort_created_after = now()",
        );
      });
    },
  },
  {
    name: "enforce = true: the denylist wins over the allowlist, with no grace",
    changed: true,
    async fn(db) {
      await withPolicy(db, {
        enforce: true,
        allowlist: ["u_old"],
        denylist: ["u_old"],
      }, async () => {
        expectOutcomes(await each(["old"], (who) => insertPost(db, who)), { old: false }, "denied old account");
      });
    },
  },
  {
    name: "service_role is unaffected by enforcement and by SPICY",
    changed: false,
    async fn(db) {
      await withPolicy(db, { enforce: true }, async () => {
        const allowed = await as(db, "service", `SELECT public.verified_participation_allowed() AS ok`);
        assert.equal(allowed.rows?.[0]?.ok, true, allowed.error);
        const ins = await as(db, "service", `INSERT INTO public.posts (author_id, content, is_nsfw) VALUES (1, 'svc', true)`);
        assert.ok(ins.ok, ins.error);
        const upd = await as(db, "service", `UPDATE public.posts SET is_nsfw = true WHERE id = $1`, [POST.plain.unverified]);
        assert.ok(upd.ok && upd.rowCount === 1, upd.error);
        const c = await as(db, "service", `INSERT INTO public.comments (author_id, post_id, content) VALUES (1, 2, 'svc')`);
        assert.ok(c.ok, c.error);
      });
    },
  },
];

// Post-migration only: what the new functions promise about themselves.
const POST_ONLY = [
  {
    name: "the SPICY helpers and verified_admission_context() follow the JWT and keep their grants; the context no longer carries a cohort",
    async fn(db) {
      const adult = await as(db, "adult", `SELECT public.viewer_is_verified_adult() AS a, public.viewer_user_id() AS u`);
      assert.deepEqual(adult.rows?.[0], { a: true, u: PERSONAS.adult.id }, adult.error);
      const under = await as(db, "underage", `SELECT public.viewer_is_verified_adult() AS a, public.viewer_user_id() AS u`);
      assert.deepEqual(under.rows?.[0], { a: false, u: PERSONAS.underage.id }, under.error);
      const anon = await as(db, "anon", `SELECT public.viewer_is_verified_adult() AS a, public.viewer_user_id() AS u`);
      assert.deepEqual(anon.rows?.[0], { a: false, u: null }, anon.error);
      const svc = await as(db, "service", `SELECT public.viewer_is_verified_adult() AS a`);
      assert.equal(svc.rows?.[0]?.a, true, svc.error);
      const ctx = await withPolicyResult(db, { enforce: true, cohort_created_after: new Date() }, () =>
        as(db, "old", `SELECT public.verified_admission_context() AS c`));
      assert.ok(ctx.ok, ctx.error);
      const c = ctx.rows[0].c;
      assert.equal(c.userId, PERSONAS.old.auth);
      assert.deepEqual(Object.keys(c).sort(), ["denied", "exempt", "policy", "record", "userId"]);
      assert.deepEqual(Object.keys(c.policy).sort(), ["enforce", "grace_deadline"]);
      const anonCtx = await as(db, "anon", `SELECT public.verified_admission_context() AS c`);
      assert.ok(!anonCtx.ok, "anon must not execute verified_admission_context()");
      const [dup] = (await db.query(`
        SELECT count(*)::int AS n FROM pg_policies
        WHERE schemaname = 'public' AND policyname LIKE 'spicy_%'`)).rows;
      assert.equal(dup.n, 5, "two applications must leave exactly five spicy_* policies");
    },
  },
];

async function runSection(db, s) {
  try {
    await s.fn(db);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

const failures = [...setupFailures];

console.log("\n── post: fixture + migration ──");
for (const s of [...SECTIONS, ...POST_ONLY]) {
  const r = await runSection(post, s);
  if (r.ok) console.log(`OK: ${s.name}`);
  else {
    failures.push(`post: ${s.name}`);
    console.error(`FAIL: ${s.name}\n  ${r.message.split("\n").join("\n  ")}`);
  }
}

console.log("\n── pre: fixture only (production today); changed sections must fail ──");
for (const s of SECTIONS) {
  const r = await runSection(pre, s);
  if (s.changed && !r.ok) {
    console.log(`OK (fails as expected before the migration): ${s.name}`);
    console.log(`  production today: ${r.message.split("\n")[0]}`);
  }
  else if (!s.changed && r.ok) console.log(`OK (unchanged): ${s.name}`);
  else if (s.changed) {
    failures.push(`pre: ${s.name}`);
    console.error(`FAIL: passes without the migration, so it does not test it: ${s.name}`);
  } else {
    failures.push(`pre: ${s.name}`);
    console.error(`FAIL: the fixture does not behave like production here: ${s.name}\n  ${r.message.split("\n").join("\n  ")}`);
  }
}

if (failures.length) {
  console.error(`\nverify-admission-gate: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nverify-admission-gate: all sections pass");
