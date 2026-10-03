#!/usr/bin/env node
/**
 * Proves two holes are closed by migrations 20261003150100 and 20261003150200.
 *
 * posts: production granted anon and authenticated INSERT and UPDATE with
 * policies of WITH CHECK (true) / USING (true), so the anon key from any app
 * bundle could rewrite any post (content, is_nsfw, visibility, author_id) or
 * post as anyone.
 *
 * video_room_members (S08): authenticated had table-wide SELECT and a policy
 * that shows every row of a room to every co-member, user_id included. For an
 * anonymous Sneaky Lynk member user_id is their auth id, so any co-member
 * could unmask them with one join to users.
 *
 * Parts:
 *   1. Source scan: no client code writes posts, likes or comments (likes and
 *      comments fire SECURITY INVOKER triggers that UPDATE posts), and no
 *      client query on video_room_members names user_id.
 *   2. Throwaway Postgres with production's columns, grants, policies and
 *      helper functions (read 2026-10-03). Checks the holes are real, applies
 *      both migrations twice, then asserts they are closed, that reads the app
 *      needs still work, and that service_role keeps every privilege.
 *
 *   node scripts/verify-content-lockdown.mjs
 *   node scripts/verify-content-lockdown.mjs --skip-migration  # must exit 1
 *   node scripts/verify-content-lockdown.mjs --allow-skip      # no Postgres: skip DB part
 *
 * Postgres discovery and teardown copy scripts/verify-users-lockdown.mjs.
 */
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowSkip = process.argv.includes("--allow-skip");
const skipMigration = process.argv.includes("--skip-migration");
const MIGRATIONS = [
  "apps/mobile/supabase/migrations/20261003150100_posts_client_write_lockdown.sql",
  "apps/mobile/supabase/migrations/20261003150200_video_room_members_user_id_private.sql",
].map((p) => join(root, p));

// ── 1. Source scan ───────────────────────────────────────────────────────────
{
  const SCAN = ["packages", "apps/web", "apps/web-vite", "apps/mobile"];
  const SKIP_DIRS = new Set(["node_modules", ".next", ".expo", "dist", "build", "ios", "android", ".turbo"]);
  const SERVER_PREFIXES = ["apps/mobile/supabase/", "apps/mobile/scripts/"];
  const tableFrom = (names) =>
    new RegExp(
      `\\.from\\(\\s*(?:${names.map((n) => `DB\\.${n}\\.table|["'\`]${n}["'\`]`).join("|")})\\s*\\)`,
      "g",
    );
  const WRITE_FROM = tableFrom(["posts", "likes", "comments"]);
  const WRITE = /^\s*(?:\/\/[^\n]*\n\s*)*\.(update|insert|upsert|delete)\s*\(/;
  const MEMBERS_FROM = /\.from\(\s*["'`]video_room_members["'`]\s*\)/g;
  // Realtime filters on video_room_members are evaluated with the same column
  // privileges, so a `user_id=eq.` filter would be rejected too.
  const MEMBERS_RT = /table:\s*["'`]video_room_members["'`][^}]*filter:\s*`?["']?[^,}]*user_id/;

  const writes = [];
  const reads = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const rel = relative(root, full);
      if (SERVER_PREFIXES.some((p) => rel.startsWith(p))) continue;
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !/\.test\./.test(name)) {
        const src = readFileSync(full, "utf8");
        const lineOf = (i) => src.slice(0, i).split("\n").length;
        for (const m of src.matchAll(WRITE_FROM)) {
          const w = src.slice(m.index + m[0].length, m.index + m[0].length + 400).match(WRITE);
          if (w) writes.push(`${rel}:${lineOf(m.index)} ${m[0]}.${w[1]}()`);
        }
        for (const m of src.matchAll(MEMBERS_FROM)) {
          // The query chain runs to the end of the statement.
          const rest = src.slice(m.index, m.index + 1200);
          const chain = rest.slice(0, rest.search(/;\s*\n/) + 1 || rest.length);
          if (/\buser_id\b/.test(chain)) reads.push(`${rel}:${lineOf(m.index)}`);
        }
        if (MEMBERS_RT.test(src)) reads.push(`${rel} (realtime filter on user_id)`);
      }
    }
  };
  for (const d of SCAN) walk(join(root, d));
  assert.deepEqual(writes, [], `client code writes posts/likes/comments directly:\n  ${writes.join("\n  ")}`);
  assert.deepEqual(
    reads,
    [],
    `client code reads video_room_members.user_id (use lynk_room_roster):\n  ${reads.join("\n  ")}`,
  );
  console.log("1. OK: no client writes to posts/likes/comments; no client read of video_room_members.user_id");
}

// ── Postgres ─────────────────────────────────────────────────────────────────
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
    "verify-content-lockdown: no complete Postgres server install found " +
    "(initdb, postgres and pg_ctl in one prefix). The database assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-content-lockdown-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-content-lockdown-sock-"));
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
// posts: columns from information_schema.columns; relacl anon=arw,
// authenticated=arw; the four policies from pg_policy. likes stands in for the
// SECURITY INVOKER counter triggers that UPDATE posts.
// video_room_members / video_rooms: columns, unique (room_id, user_id), relacl
// authenticated=r, the SELECT policy and the two SECURITY DEFINER helpers
// copied from pg_get_functiondef. auth.jwt() reads request.jwt.claims the way
// Supabase's does.
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

CREATE TYPE public.enum_posts_visibility AS ENUM ('public', 'followers', 'private');
CREATE TYPE public.enum_posts_moderation_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.posts (
  id SERIAL PRIMARY KEY,
  author_id INTEGER,
  external_author_id VARCHAR,
  content VARCHAR,
  location VARCHAR,
  likes_count NUMERIC DEFAULT 0,
  comments_count NUMERIC DEFAULT 0,
  reposts_count NUMERIC DEFAULT 0,
  bookmarks_count NUMERIC DEFAULT 0,
  is_repost BOOLEAN DEFAULT false,
  original_post_id INTEGER,
  reply_to_id INTEGER,
  visibility public.enum_posts_visibility DEFAULT 'public',
  edited_at TIMESTAMPTZ,
  moderation_status public.enum_posts_moderation_status DEFAULT 'approved',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_nsfw BOOLEAN DEFAULT false,
  post_kind TEXT NOT NULL DEFAULT 'media',
  text_theme TEXT NOT NULL DEFAULT 'graphite'
);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.posts TO anon, authenticated;
GRANT ALL ON public.posts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.posts_id_seq TO anon, authenticated, service_role;

-- Stand-in: production's version reads verified_admission_policy. Returning
-- true keeps the restrictive policy from masking the permissive hole.
CREATE FUNCTION public.verified_participation_allowed() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE POLICY "Anyone can create posts" ON public.posts FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Public posts are viewable by everyone" ON public.posts FOR SELECT TO public
  USING (visibility = 'public' OR visibility IS NULL);
CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE TO public USING (true);
CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE TO public USING (true);
CREATE POLICY verified_participation_boundary ON public.posts AS RESTRICTIVE FOR INSERT
  TO authenticated, anon WITH CHECK (public.verified_participation_allowed());

INSERT INTO public.posts (author_id, content) VALUES (1, 'victim post');

CREATE TABLE public.likes (id SERIAL PRIMARY KEY, post_id INTEGER, user_id INTEGER);
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.likes TO anon, authenticated;
GRANT ALL ON public.likes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.likes_id_seq TO anon, authenticated, service_role;
CREATE POLICY likes_all ON public.likes FOR ALL TO public USING (true) WITH CHECK (true);
CREATE FUNCTION public.update_post_likes_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_likes_update_post_count AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.update_post_likes_count();

CREATE TABLE public.video_rooms (
  id SERIAL PRIMARY KEY,
  created_by TEXT,
  status TEXT DEFAULT 'open'
);
GRANT SELECT ON public.video_rooms TO anon, authenticated;
GRANT ALL ON public.video_rooms TO service_role;

CREATE TABLE public.video_room_members (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role VARCHAR DEFAULT 'participant',
  status VARCHAR DEFAULT 'active',
  joined_at TIMESTAMPTZ DEFAULT now(),
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  hand_raised BOOLEAN NOT NULL DEFAULT false,
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  anon_label TEXT,
  last_seen_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_vrm_room_user ON public.video_room_members (room_id, user_id);
ALTER TABLE public.video_room_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.video_room_members TO authenticated;
GRANT ALL ON public.video_room_members TO service_role;

CREATE FUNCTION public.viewer_hosts_lynk_room(p_room_id integer) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  select case
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then true
    when auth.jwt() ->> 'sub' is null then false
    else exists (
      select 1 from public.video_rooms r
      where r.id = p_room_id
        and r.created_by = auth.jwt() ->> 'sub'
    )
  end;
$$;
CREATE FUNCTION public.viewer_in_lynk_room(p_room_id integer) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  select case
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then true
    when auth.jwt() ->> 'sub' is null then false
    else exists (
      select 1 from public.video_room_members m
      where m.room_id = p_room_id
        and m.user_id = auth.jwt() ->> 'sub'
    )
  end;
$$;
CREATE POLICY video_room_members_select_participant ON public.video_room_members
  FOR SELECT TO authenticated
  USING ((user_id = (SELECT (auth.jwt() ->> 'sub'))) OR viewer_in_lynk_room(room_id) OR viewer_hosts_lynk_room(room_id));

INSERT INTO public.video_rooms (id, created_by) VALUES (1, 'ba-host'), (2, 'ba-other-host');
INSERT INTO public.video_room_members (room_id, user_id, role, is_anonymous, anon_label) VALUES
  (1, 'ba-host', 'host', false, NULL),
  (1, 'ba-dana', 'participant', false, NULL),
  (1, 'ba-sam', 'participant', true, 'Anon 3'),
  (2, 'ba-other-host', 'host', false, NULL);
`;
await sql(FIXTURE);
const SAM_ROW = (await sql(`SELECT id FROM public.video_room_members WHERE user_id = 'ba-sam'`))[0].id;

// One statement as `role` with JWT claims, in a rolled-back transaction.
async function as(role, text, sub) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(sub ? { sub, role } : { role }),
    ]);
    const res = await client.query(text);
    return { ok: true, rowCount: res.rowCount, rows: res.rows };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

const POST_WRITES = [
  ["flip is_nsfw", "UPDATE public.posts SET is_nsfw = true WHERE id = 1"],
  ["rewrite content", "UPDATE public.posts SET content = 'defaced' WHERE id = 1"],
  // Not tested: setting visibility away from 'public'. Postgres checks the new
  // row against the SELECT policy, which an attacker's row fails, so that
  // edit was already refused in production.
  ["reset moderation", "UPDATE public.posts SET moderation_status = 'approved' WHERE id = 1"],
  ["reassign author", "UPDATE public.posts SET author_id = 2 WHERE id = 1"],
  ["post as someone else", "INSERT INTO public.posts (author_id, content) VALUES (1, 'forged')"],
];
const UNMASK = "SELECT user_id FROM public.video_room_members WHERE room_id = 1 AND is_anonymous";

// ── 2. The fixture reproduces both holes ────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  for (const [label, stmt] of POST_WRITES) {
    const r = await as(role, stmt, "ba-attacker");
    assert.ok(r.ok && r.rowCount === 1, `fixture is not faithful: ${role} could not ${label} (${r.message})`);
  }
}
{
  const r = await as("authenticated", UNMASK, "ba-dana");
  assert.ok(r.ok, `fixture is not faithful: co-member read failed (${r.message})`);
  assert.deepEqual(r.rows, [{ user_id: "ba-sam" }], "fixture is not faithful: co-member could not unmask");
}
console.log("2. OK: before the migrations anon/authenticated rewrite posts and a co-member reads ba-sam's user_id");

// ── 3. Apply ─────────────────────────────────────────────────────────────────
if (skipMigration) {
  console.log("3. --skip-migration: NOT applying the migrations");
} else {
  for (const m of MIGRATIONS) {
    await sql(readFileSync(m, "utf8"));
    await sql(readFileSync(m, "utf8"));
  }
  console.log("3. OK: both migrations applied (twice, to prove they are re-runnable)");
}

// ── 4. posts: every client write is a privilege error ───────────────────────
for (const role of ["anon", "authenticated"]) {
  for (const [label, stmt] of [...POST_WRITES, ["delete", "DELETE FROM public.posts WHERE id = 1"]]) {
    const r = await as(role, stmt, "ba-attacker");
    assert.equal(
      r.code,
      "42501",
      `${role} could ${label} after the migration (${r.ok ? `${r.rowCount} row(s)` : `${r.code} ${r.message}`})`,
    );
  }
}
{
  const rows = await sql(`
    SELECT grantee, privilege_type FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'posts'
      AND grantee IN ('anon', 'authenticated') AND privilege_type <> 'SELECT'`);
  assert.deepEqual(rows, [], `posts column write grants remain: ${JSON.stringify(rows)}`);
  const pols = await sql(`SELECT polname FROM pg_policy WHERE polrelid = 'public.posts'::regclass ORDER BY 1`);
  assert.deepEqual(
    pols.map((p) => p.polname),
    ["Public posts are viewable by everyone", "verified_participation_boundary"],
    "only the SELECT policy and the restrictive boundary should remain",
  );
}
for (const role of ["anon", "authenticated"]) {
  const r = await as(role, "SELECT id, content, is_nsfw FROM public.posts WHERE id = 1");
  assert.ok(r.ok && r.rowCount === 1, `${role} lost SELECT on posts (${r.message})`);
}
console.log("4. OK: posts: 42501 on every anon/authenticated write, reads intact, only SELECT + boundary policies left");

// ── 5. posts: service_role and the counter triggers keep working ────────────
for (const [label, stmt] of [
  ...POST_WRITES,
  ["delete", "DELETE FROM public.posts WHERE id = 1"],
  ["like (invoker trigger updates posts)", "INSERT INTO public.likes (post_id, user_id) VALUES (1, 2)"],
]) {
  const r = await as("service_role", stmt);
  assert.ok(r.ok && r.rowCount >= 1, `service_role could not ${label} (${r.code} ${r.message})`);
}
{
  // What breaks if a client ever writes likes directly: the SECURITY INVOKER
  // trigger's UPDATE on posts now fails. Section 1 keeps such writes out.
  const r = await as("authenticated", "INSERT INTO public.likes (post_id, user_id) VALUES (1, 2)", "ba-x");
  assert.equal(r.code, "42501", `expected a client like insert to fail in the posts trigger (${JSON.stringify(r)})`);
}
console.log("5. OK: service_role writes posts and likes; a client likes insert fails in the invoker trigger (documented)");

// ── 6. video_room_members: user_id is unreadable to clients ─────────────────
for (const [label, stmt] of [
  ["select user_id", UNMASK],
  ["select *", "SELECT * FROM public.video_room_members WHERE room_id = 1"],
  ["filter on user_id", "SELECT id FROM public.video_room_members WHERE user_id = 'ba-sam'"],
  ["order by user_id", "SELECT id FROM public.video_room_members ORDER BY user_id"],
  ["return user_id via row", "SELECT m FROM public.video_room_members m"],
]) {
  for (const sub of ["ba-dana", "ba-host", "ba-sam"]) {
    const r = await as("authenticated", stmt, sub);
    assert.equal(r.code, "42501", `${sub} could ${label} (${r.ok ? JSON.stringify(r.rows) : r.message})`);
  }
}
{
  const r = await as(
    "authenticated",
    "SELECT id, room_id, role, status, hand_raised, is_anonymous, anon_label, joined_at, left_at, last_seen_at, created_at FROM public.video_room_members WHERE room_id = 1",
    "ba-dana",
  );
  assert.ok(r.ok && r.rowCount === 3, `co-member lost the non-identity columns (${r.message ?? r.rowCount})`);
  const outsider = await as("authenticated", "SELECT id FROM public.video_room_members WHERE room_id = 1", "ba-out");
  assert.ok(outsider.ok && outsider.rowCount === 0, "a non-member can see room 1 rows");
  const anonRead = await as("anon", "SELECT id FROM public.video_room_members");
  assert.equal(anonRead.code, "42501", "anon can read video_room_members");
  // realtime.apply_rls drops columns failing this check from change payloads.
  const priv = await sql(`
    SELECT attname, has_column_privilege('authenticated', 'public.video_room_members'::regclass, attname, 'SELECT') AS ok
    FROM pg_attribute WHERE attrelid = 'public.video_room_members'::regclass AND attnum > 0 AND NOT attisdropped
    ORDER BY attnum`);
  assert.deepEqual(
    priv.filter((c) => !c.ok).map((c) => c.attname),
    ["user_id"],
    "authenticated must lack SELECT on user_id and only user_id",
  );
}
console.log("6. OK: no client can read, filter or order by user_id; other columns and the policy still work");

// ── 7. lynk_room_roster masks anonymous members ─────────────────────────────
const roster = async (sub, extra = "") =>
  as("authenticated", `SELECT member_id, user_id, is_anonymous, anon_label FROM public.lynk_room_roster(1${extra})`, sub);
{
  const handle = `member:${SAM_ROW}`;
  for (const viewer of ["ba-dana", "ba-host"]) {
    const r = await roster(viewer);
    assert.ok(r.ok, `${viewer} roster failed (${r.message})`);
    const ids = r.rows.map((x) => x.user_id).sort();
    assert.deepEqual(ids, ["ba-dana", "ba-host", handle].sort(), `${viewer} roster: ${JSON.stringify(r.rows)}`);
    assert.ok(!JSON.stringify(r.rows).includes("ba-sam"), `${viewer} saw ba-sam in the roster`);
    const sam = r.rows.find((x) => x.user_id === handle);
    assert.equal(sam.anon_label, "Anon 3", "anonymous member lost its display label");
  }
  const self = await roster("ba-sam");
  assert.ok(self.rows.some((x) => x.user_id === "ba-sam"), "an anonymous member cannot see their own id");
  const one = await roster("ba-dana", `, ${SAM_ROW}`);
  assert.deepEqual(one.rows.map((x) => x.user_id), [handle], "single-row fetch by member id");
  const outsider = await roster("ba-out");
  assert.ok(outsider.ok && outsider.rowCount === 0, `outsider got roster rows: ${JSON.stringify(outsider.rows)}`);
  const otherRoom = await as("authenticated", "SELECT * FROM public.lynk_room_roster(2)", "ba-dana");
  assert.ok(otherRoom.ok && otherRoom.rowCount === 0, "a member of room 1 can read room 2's roster");
  const anonExec = await as("anon", "SELECT * FROM public.lynk_room_roster(1)");
  assert.equal(anonExec.code, "42501", "anon can execute lynk_room_roster");
}
console.log("7. OK: roster gives co-members and the host member:<id> for ba-sam, ba-sam their own id, outsiders nothing");

// ── 8. service_role keeps full access ────────────────────────────────────────
{
  const r = await as("service_role", UNMASK);
  assert.ok(r.ok && r.rows[0]?.user_id === "ba-sam", `service_role lost user_id (${r.message})`);
  const w = await as("service_role", `UPDATE public.video_room_members SET status = 'kicked' WHERE id = ${SAM_ROW}`);
  assert.ok(w.ok && w.rowCount === 1, `service_role could not update a member (${w.message})`);
  const rr = await as("service_role", "SELECT user_id FROM public.lynk_room_roster(1) ORDER BY member_id");
  assert.ok(rr.ok && rr.rowCount === 3, `service_role roster failed (${rr.message})`);
}
console.log("8. OK: service_role reads user_id, writes members and can call the roster");

console.log("\nverify-content-lockdown: all sections pass");
