#!/usr/bin/env node
/**
 * Proves that clients holding the public anon key cannot write public.users,
 * and cannot read email or the other private columns of public.users and
 * Better Auth's public."user".
 *
 * Production had UPDATE and INSERT granted to anon and authenticated, an
 * UPDATE policy of USING (true) and INSERT policies of WITH CHECK (true). The
 * anon key ships in every app bundle, so any visitor could set role or
 * verified on any member, or rewrite auth_id and take over an account.
 *
 * Reads: both tables granted table-wide SELECT, so the anon key read every
 * member's email, plus users.hash/salt (legacy passwords), reset tokens, API
 * keys and device coordinates. 20261003150400 limits client SELECT to the
 * remaining columns. 20261003150500 also takes users.sexuality, gender and
 * event_audience away from anon (signed-out visitors); authenticated (signed-in
 * members, via the JWT bridge) keeps them.
 *
 * Two parts:
 *
 * 1. Source scan. No client code (packages/, apps/web, apps/web-vite,
 *    apps/mobile outside supabase/functions and the service-role scripts)
 *    may chain .update/.insert/.upsert/.delete onto a users table query.
 *    Once the migration lands, such a call is a runtime 42501.
 *
 * 2. Database. Boots a throwaway cluster, recreates public.users with the
 *    production columns, grants and policies (read from pg_class.relacl and
 *    pg_policy on 2026-10-03), and checks the fixture really has the hole.
 *    Then applies 20261003150000_users_anon_write_lockdown.sql and asserts
 *    that anon and authenticated get 42501 on every write, SELECT still
 *    works, and service_role can still do everything.
 *
 *   node scripts/verify-users-lockdown.mjs
 *   node scripts/verify-users-lockdown.mjs --skip-migration  # must exit 1
 *   node scripts/verify-users-lockdown.mjs --allow-skip      # CI without Postgres
 *
 * Postgres discovery and teardown copy scripts/verify-call-capacity.mjs.
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
const MIGRATION = join(
  root,
  "apps/mobile/supabase/migrations/20261003150000_users_anon_write_lockdown.sql",
);
const READ_MIGRATION = join(
  root,
  "apps/mobile/supabase/migrations/20261003150400_users_contact_columns_private.sql",
);
const IDENTITY_MIGRATION = join(
  root,
  "apps/mobile/supabase/migrations/20261003150500_users_identity_columns_members_only.sql",
);
// Columns clients must not read. Everything else stays readable.
const PRIVATE = {
  users: [
    "api_key", "api_key_index", "device_lat", "device_lng", "email", "enable_a_p_i_key", "hash",
    "location_updated_at", "lock_until", "login_attempts", "reset_password_expiration",
    "reset_password_token", "salt",
  ],
  user: ["banExpires", "banReason", "banned", "email", "emailVerified", "role"],
};
// Readable by signed-in members (authenticated), not by the bare anon key.
const MEMBERS_ONLY = ["event_audience", "gender", "sexuality"];
// Unreadable columns per role and table, after the migrations.
const UNREADABLE = {
  users: { anon: [...PRIVATE.users, ...MEMBERS_ONLY].sort(), authenticated: [...PRIVATE.users].sort() },
  user: { anon: [...PRIVATE.user].sort(), authenticated: [...PRIVATE.user].sort() },
};

// ── 1. Source scan ───────────────────────────────────────────────────────────
{
  const SCAN = ["packages", "apps/web", "apps/web-vite", "apps/mobile"];
  const SKIP_DIRS = new Set(["node_modules", ".next", ".expo", "dist", "build", "ios", "android", ".turbo"]);
  // Server code runs with service_role, which keeps its grants. The mobile
  // maintenance scripts that write users build their client from
  // SUPABASE_SERVICE_ROLE_KEY.
  const SERVER_PREFIXES = ["apps/mobile/supabase/", "apps/mobile/scripts/"];
  const USERS_FROM = /\.from\(\s*(?:DB\.users\.table|["'`]users["'`])\s*\)/g;
  const ANY_USER_FROM = /\.from\(\s*(?:DB\.users\.table|["'`]users?["'`])\s*\)/g;
  // A select naming a private column, DB.users.email, or "*" (which now
  // includes columns clients cannot read). Filters on them count too.
  const PRIVATE_COL = new RegExp(
    `\\bDB\\.users\\.email\\b|\\.select\\(\\s*["'\`]\\*["'\`]|["'\`.,(\\s](?:${[...new Set([...PRIVATE.users, ...PRIVATE.user])].join("|")})\\b`,
  );
  const reads = [];
  // Files allowed to select a members-only column. Each read runs only for a
  // signed-in member, on their own row, so it goes out as authenticated.
  // Anything else (profile fetches that serve the signed-out public profile,
  // SSR, share pages) must not select them: as anon the whole request is a
  // 42501, not just a missing field.
  const SIGNED_IN_READERS = new Map([
    ["packages/app/lib/profile/own-identity.ts", "fetchOwnIdentity: welcome and edit-profile, own row, needs user.id"],
    ["packages/app/lib/api/auth.ts", "auth.getProfile identity read, own row after sign-in"],
    ["apps/mobile/lib/api/auth.ts", "legacy copy of auth.getProfile"],
  ]);
  const MEMBERS_ONLY_COL = new RegExp(
    `\\bDB\\.users\\.(?:gender|sexuality|eventAudience)\\b|["'\`.,(\\s](?:${MEMBERS_ONLY.join("|")})\\b`,
  );
  const signedOutReads = [];
  const WRITE = /^\s*(?:\/\/[^\n]*\n\s*)*\.(update|insert|upsert|delete)\s*\(/;

  const hits = [];
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
        for (const m of src.matchAll(ANY_USER_FROM)) {
          const rest = src.slice(m.index, m.index + 1500);
          const chain = rest.slice(0, rest.search(/;\s*\n/) + 1 || rest.length);
          // Only the select list and filters matter; drop line comments.
          const code = chain.replace(/\/\/[^\n]*/g, "");
          const hit = code.match(PRIVATE_COL);
          if (hit) {
            const line = src.slice(0, m.index).split("\n").length;
            reads.push(`${rel}:${line} ${hit[0].trim()}`);
          }
          const idHit = code.match(MEMBERS_ONLY_COL);
          if (idHit && !SIGNED_IN_READERS.has(rel)) {
            const line = src.slice(0, m.index).split("\n").length;
            signedOutReads.push(`${rel}:${line} ${idHit[0].trim()}`);
          }
        }
        for (const m of src.matchAll(USERS_FROM)) {
          const rest = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
          // supabase-js puts the write verb directly after from(); filters
          // and .select() come after it. Comment lines in between are allowed.
          const w = rest.match(WRITE);
          if (w) {
            const line = src.slice(0, m.index).split("\n").length;
            hits.push(`${rel}:${line} .${w[1]}()`);
          }
        }
      }
    }
  };
  for (const d of SCAN) walk(join(root, d));
  assert.deepEqual(
    hits,
    [],
    `client code writes public.users directly; anon and authenticated have no write grant:\n  ${hits.join("\n  ")}`,
  );
  assert.deepEqual(
    reads,
    [],
    `client code reads a private column of users/"user" (use the session for the member's own email):\n  ${reads.join("\n  ")}`,
  );
  assert.deepEqual(
    signedOutReads,
    [],
    `client code outside the signed-in allowlist reads users.${MEMBERS_ONLY.join("/")}; anon cannot (42501), so a signed-out visitor's whole request fails:\n  ${signedOutReads.join("\n  ")}`,
  );
  console.log(
    `1. OK: no client code writes public.users or reads a private users/"user" column; ${MEMBERS_ONLY.join(", ")} are read only by the ${SIGNED_IN_READERS.size} signed-in own-row readers`,
  );
}

// ── Locating a Postgres server (same rules as verify-call-capacity) ──────────
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
    "verify-users-lockdown: no complete Postgres server install found " +
    "(initdb, postgres and pg_ctl in one prefix). The database assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-users-lockdown-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-users-lockdown-sock-"));
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

// ── Fixture: production's public.users ───────────────────────────────────────
// Column list, types and defaults from information_schema.columns; grants from
// relacl (anon=arw, authenticated=arwd, service_role=arwdDxtm); policies from
// pg_policy. service_role has BYPASSRLS in production and here.
const FIXTURE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TYPE public.enum_users_user_type AS ENUM ('Organizer', 'Regular');
CREATE TYPE public.enum_users_role AS ENUM ('Super-Admin', 'Admin', 'Moderator', 'Basic');
CREATE TYPE public.enum_users_pronouns AS ENUM ('He/Him', 'She/Her', 'They/Them', 'He/They', 'She/They', 'Other');

CREATE TABLE public.users (
  id SERIAL PRIMARY KEY,
  username VARCHAR NOT NULL,
  first_name VARCHAR,
  last_name VARCHAR,
  user_type public.enum_users_user_type NOT NULL DEFAULT 'Regular',
  role public.enum_users_role NOT NULL DEFAULT 'Basic',
  avatar_id INTEGER,
  bio VARCHAR,
  pronouns public.enum_users_pronouns,
  location VARCHAR,
  verified BOOLEAN DEFAULT false,
  banned_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,
  followers_count NUMERIC DEFAULT 0,
  following_count NUMERIC DEFAULT 0,
  posts_count NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enable_a_p_i_key BOOLEAN,
  api_key VARCHAR,
  api_key_index VARCHAR,
  email VARCHAR NOT NULL,
  reset_password_token VARCHAR,
  reset_password_expiration TIMESTAMPTZ,
  salt VARCHAR,
  hash VARCHAR,
  login_attempts NUMERIC DEFAULT 0,
  lock_until TIMESTAMPTZ,
  is_private BOOLEAN DEFAULT false,
  auth_id TEXT,
  website VARCHAR,
  links JSONB DEFAULT '[]'::jsonb,
  city_id INTEGER,
  location_mode TEXT DEFAULT 'city',
  device_lat DOUBLE PRECISION,
  device_lng DOUBLE PRECISION,
  location_updated_at TIMESTAMPTZ,
  gender TEXT,
  sexuality TEXT[],
  event_audience TEXT
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.users_id_seq TO anon, authenticated, service_role;

CREATE POLICY "Users are viewable by everyone" ON public.users FOR SELECT TO public USING (true);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE TO public USING (true);
CREATE POLICY users_insert_anon ON public.users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY users_insert_authenticated ON public.users FOR INSERT TO authenticated WITH CHECK (true);

INSERT INTO public.users (username, email, auth_id, bio, hash, salt, gender, sexuality, event_audience)
VALUES ('victim', 'victim@example.test', 'ba-victim', 'original bio', 'pbkdf2-hash', 'pbkdf2-salt',
        'Nonbinary', ARRAY['Queer'], 'Queer folks');

-- Better Auth's table: columns from information_schema, relacl anon=r
-- authenticated=r, one SELECT policy for anon.
CREATE TABLE public."user" (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  role TEXT,
  banned BOOLEAN,
  "banReason" TEXT,
  "banExpires" TIMESTAMPTZ,
  username TEXT,
  "displayUsername" TEXT
);
ALTER TABLE public."user" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."user" TO anon, authenticated;
GRANT ALL ON public."user" TO service_role;
CREATE POLICY user_select_anon ON public."user" FOR SELECT TO anon USING (true);
INSERT INTO public."user" (id, name, email, username) VALUES ('ba-victim', 'Victim', 'victim@example.test', 'victim');
`;
await sql(FIXTURE);

// Runs one statement as `role` inside a rolled-back transaction. Returns
// { ok, rowCount } or { ok: false, code }.
async function as(role, text) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const res = await client.query(text);
    return { ok: true, rowCount: res.rowCount, rows: res.rows };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

const WRITES = [
  ["set role", "UPDATE public.users SET role = 'Super-Admin' WHERE id = 1"],
  ["set verified", "UPDATE public.users SET verified = true WHERE id = 1"],
  ["rewrite auth_id", "UPDATE public.users SET auth_id = 'ba-attacker' WHERE id = 1"],
  ["rewrite email", "UPDATE public.users SET email = 'attacker@example.test' WHERE id = 1"],
  ["rewrite username", "UPDATE public.users SET username = 'owned' WHERE id = 1"],
  ["rewrite id", "UPDATE public.users SET id = 999 WHERE id = 1"],
  ["edit bio", "UPDATE public.users SET bio = 'defaced' WHERE id = 1"],
  ["edit first_name", "UPDATE public.users SET first_name = 'x' WHERE id = 1"],
  ["edit location", "UPDATE public.users SET location = 'x' WHERE id = 1"],
  [
    "insert row",
    "INSERT INTO public.users (username, email, auth_id, role, verified) VALUES ('forged', 'f@example.test', 'ba-forged', 'Admin', true)",
  ],
  ["upsert", "INSERT INTO public.users (id, username, email) VALUES (1, 'u', 'e') ON CONFLICT (id) DO UPDATE SET role = 'Admin'"],
];

// ── 2. The fixture reproduces the hole ───────────────────────────────────────
// Without this, a fixture that was locked from the start would make every
// later assertion pass for the wrong reason.
for (const role of ["anon", "authenticated"]) {
  for (const [label, stmt] of WRITES.filter(([l]) => l !== "upsert")) {
    const r = await as(role, stmt);
    assert.ok(r.ok && r.rowCount === 1, `fixture is not faithful: ${role} could not ${label} before the migration (${r.message})`);
  }
}
for (const [role, stmt, want] of [
  ["anon", "SELECT email, hash FROM public.users WHERE id = 1", { email: "victim@example.test", hash: "pbkdf2-hash" }],
  ["authenticated", "SELECT email FROM public.users WHERE id = 1", { email: "victim@example.test" }],
  ["anon", `SELECT email FROM public."user" WHERE id = 'ba-victim'`, { email: "victim@example.test" }],
  ["anon", "SELECT gender, sexuality, event_audience FROM public.users WHERE id = 1", { gender: "Nonbinary", sexuality: ["Queer"], event_audience: "Queer folks" }],
]) {
  const r = await as(role, stmt);
  assert.deepEqual(r.rows, [want], `fixture is not faithful: ${role} could not read ${stmt} (${r.message})`);
}
console.log(
  "2. OK: before the migrations, anon and authenticated write every users column and read email (and users.hash); anon reads sexuality, gender, event_audience",
);

// ── 3. Apply the migration ───────────────────────────────────────────────────
if (skipMigration) {
  console.log("3. --skip-migration: NOT applying 20261003150000, 20261003150400 or 20261003150500");
} else {
  // Idempotent: Supabase may replay them on a branch reset.
  for (const m of [MIGRATION, READ_MIGRATION, IDENTITY_MIGRATION]) {
    await sql(readFileSync(m, "utf8"));
    await sql(readFileSync(m, "utf8"));
  }
  console.log("3. OK: all three migrations applied (twice, to prove they are re-runnable)");
}

// ── 4. anon and authenticated: every write is a privilege error ──────────────
for (const role of ["anon", "authenticated"]) {
  for (const [label, stmt] of WRITES) {
    const r = await as(role, stmt);
    assert.equal(
      r.code,
      "42501",
      `${role} could ${label} after the migration (${r.ok ? `${r.rowCount} row(s) written` : `${r.code} ${r.message}`})`,
    );
  }
}
{
  const r = await as("authenticated", "DELETE FROM public.users WHERE id = 1");
  assert.equal(r.code, "42501", `authenticated could delete a users row (${JSON.stringify(r)})`);
}
console.log(`4. OK: anon and authenticated get 42501 on all ${WRITES.length} writes plus DELETE`);

// ── 5. No column-level write grant is left behind ────────────────────────────
{
  const rows = await sql(`
    SELECT grantee, privilege_type, column_name
    FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'users'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type <> 'SELECT'`);
  assert.deepEqual(rows, [], `column write grants remain: ${JSON.stringify(rows)}`);
  const policies = await sql(
    `SELECT polname FROM pg_policy WHERE polrelid = 'public.users'::regclass ORDER BY 1`,
  );
  assert.deepEqual(
    policies.map((p) => p.polname),
    ["Users are viewable by everyone"],
    "only the SELECT policy should remain",
  );
  console.log("5. OK: no column write grants for anon/authenticated; only the SELECT policy remains");
}

// ── 6. Reads still work for clients ──────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  const r = await as(role, "SELECT id, username, bio, verified FROM public.users WHERE id = 1");
  assert.ok(r.ok && r.rowCount === 1, `${role} lost SELECT on users (${r.message})`);
}
console.log("6. OK: anon and authenticated can still read users");

// ── 7. service_role (edge functions) keeps every write ───────────────────────
for (const [label, stmt] of [
  ...WRITES.filter(([l]) => l !== "rewrite id"),
  ["delete", "DELETE FROM public.users WHERE id = 1"],
]) {
  const r = await as("service_role", stmt);
  assert.ok(r.ok && r.rowCount >= 1, `service_role could not ${label} (${r.code} ${r.message})`);
}
console.log("7. OK: service_role can still update, insert, upsert and delete");

// ── 8. Private columns are unreadable; the rest still read ──────────────────
{
  const tables = { users: "public.users", user: 'public."user"' };
  for (const [key, rel] of Object.entries(tables)) {
    const cols = await sql(
      `SELECT attname FROM pg_attribute WHERE attrelid = '${rel}'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`,
    );
    const names = cols.map((c) => c.attname);
    for (const p of UNREADABLE[key].anon) assert.ok(names.includes(p), `fixture ${rel} lacks ${p}`);
    const where = key === "users" ? "id = 1" : "id = 'ba-victim'";
    for (const role of ["anon", "authenticated"]) {
      const hidden = UNREADABLE[key][role];
      const pub = names.filter((n) => !hidden.includes(n));
      const priv = await sql(
        `SELECT attname FROM pg_attribute WHERE attrelid = '${rel}'::regclass AND attnum > 0 AND NOT attisdropped
           AND NOT has_column_privilege('${role}', '${rel}'::regclass, attname, 'SELECT') ORDER BY attname`,
      );
      assert.deepEqual(
        priv.map((c) => c.attname),
        hidden,
        `${role}: unreadable columns of ${rel} must be exactly ${hidden.join(", ")}`,
      );
      for (const [label, stmt] of [
        ...hidden.map((c) => [`select ${c}`, `SELECT "${c}" FROM ${rel} WHERE ${where}`]),
        ["select *", `SELECT * FROM ${rel} WHERE ${where}`],
        ["filter on email", `SELECT id FROM ${rel} WHERE email = 'victim@example.test'`],
        ["order by email", `SELECT id FROM ${rel} ORDER BY email`],
        ["row value", `SELECT t FROM ${rel} t`],
      ]) {
        const r = await as(role, stmt);
        assert.equal(r.code, "42501", `${role} could ${label} on ${rel} (${r.ok ? JSON.stringify(r.rows) : r.message})`);
      }
      const ok = await as(role, `SELECT ${pub.map((c) => `"${c}"`).join(", ")} FROM ${rel} WHERE ${where}`);
      assert.ok(ok.ok, `${role} lost a public column of ${rel} (${ok.message})`);
      // Row visibility is the policies' business and did not change: users is
      // public to both roles, "user" has a policy for anon only.
      const expectRows = key === "users" || role === "anon" ? 1 : 0;
      assert.equal(ok.rowCount, expectRows, `${role} row count on ${rel}`);
    }
    const svc = await as("service_role", `SELECT email FROM ${rel} WHERE ${where}`);
    assert.deepEqual(svc.rows, [{ email: "victim@example.test" }], `service_role lost email on ${rel} (${svc.message})`);
  }
  // The joins other tables' policies make (users.id by auth_id) still work.
  const join = await as("authenticated", "SELECT id FROM public.users WHERE auth_id = 'ba-victim'");
  assert.ok(join.ok && join.rowCount === 1, `auth_id lookup broke (${join.message})`);
}
console.log(
  `8. OK: anon/authenticated get 42501 on ${PRIVATE.users.length} users and ${PRIVATE.user.length} "user" private columns, anon also on ${MEMBERS_ONLY.length} members-only users columns (select, *, filter, order); every other column reads; service_role reads email`,
);

// ── 9. sexuality, gender, event_audience: members only ──────────────────────
{
  for (const [label, stmt] of [
    ["select all three", "SELECT gender, sexuality, event_audience FROM public.users WHERE id = 1"],
    ["filter on sexuality", "SELECT id FROM public.users WHERE 'Queer' = ANY (sexuality)"],
    ["filter on gender", "SELECT id FROM public.users WHERE gender = 'Nonbinary'"],
    ["order by event_audience", "SELECT id FROM public.users ORDER BY event_audience"],
  ]) {
    const r = await as("anon", stmt);
    assert.equal(r.code, "42501", `anon could ${label} (${r.ok ? JSON.stringify(r.rows) : r.message})`);
  }
  const member = await as(
    "authenticated",
    "SELECT gender, sexuality, event_audience FROM public.users WHERE 'Queer' = ANY (sexuality) ORDER BY gender",
  );
  assert.deepEqual(
    member.rows,
    [{ gender: "Nonbinary", sexuality: ["Queer"], event_audience: "Queer folks" }],
    `authenticated lost sexuality/gender/event_audience (${member.message})`,
  );
  // The public profile page's select, without the members-only columns,
  // still works for a signed-out visitor; pronouns stays public.
  const publicProfile = await as(
    "anon",
    "SELECT id, auth_id, username, first_name, last_name, bio, location, website, links, pronouns, verified, followers_count, following_count, posts_count, is_private, created_at FROM public.users WHERE username = 'victim'",
  );
  assert.ok(publicProfile.ok && publicProfile.rowCount === 1, `anon lost the public profile select (${publicProfile.message})`);
  const svc = await as("service_role", "SELECT gender, sexuality, event_audience FROM public.users WHERE id = 1");
  assert.equal(svc.rowCount, 1, `service_role lost the identity columns (${svc.message})`);
}
console.log(
  "9. OK: anon gets 42501 on sexuality, gender, event_audience (select, filter, order); authenticated and service_role read them; the public profile select (with pronouns) still works for anon",
);

console.log("\nverify-users-lockdown: all sections pass");
