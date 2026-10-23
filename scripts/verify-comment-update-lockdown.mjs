#!/usr/bin/env node
// Real isolated PostgreSQL regression; never connects to a deployed database.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
const migration = readFileSync(new URL("../apps/mobile/supabase/migrations/20261022232201_comments_client_update_lockdown.sql", import.meta.url), "utf8");
function serverBin() {
  const candidates = [
    process.env.PG_BIN ? `${process.env.PG_BIN}/` : "",
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
    "verify-comment-update-lockdown: no complete Postgres server install found " +
    "(initdb, postgres and pg_ctl in one prefix). The database assertions did NOT run.";
  console.error(`${message}\nInstall Postgres or set PG_BIN to its bin directory. No database checks were run.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-comment-update-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-comment-update-sock-"));
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
try { run("pg_ctl", [
  "-D", dataDir,
  "-o", `-k ${socketDir} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,
  "-w", "-l", join(dataDir, "server.log"),
  "start",
]); } catch (error) { console.error(readFileSync(join(dataDir, "server.log"), "utf8")); throw error; }

pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 4 });
const sql = async (text, values) => (await pool.query(text, values)).rows;

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

await sql(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.comments (
 id integer PRIMARY KEY, author_id integer NOT NULL, post_id integer NOT NULL,
 content text NOT NULL, likes_count integer DEFAULT 0, parent_id integer,
 attachment jsonb
);
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.comments TO anon, authenticated;
GRANT ALL ON public.comments TO service_role;
CREATE POLICY "Comments viewable by everyone" ON public.comments FOR SELECT USING (true);
CREATE POLICY "Anyone can create comments" ON public.comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can delete own comments" ON public.comments FOR DELETE USING (true);
-- Model the existing restrictive admission boundary without depending on its
-- unrelated tables: denied by default, admitted callers explicitly opt in.
CREATE POLICY verified_participation_boundary ON public.comments AS RESTRICTIVE
 FOR INSERT TO anon, authenticated WITH CHECK (current_setting('request.jwt.claims', true)::jsonb->>'sub' = 'admitted');
CREATE POLICY comments_update_anon ON public.comments FOR UPDATE TO anon USING (true) WITH CHECK (true);
INSERT INTO public.comments(id, author_id, post_id, content) VALUES (1, 101, 201, 'original');
CREATE TABLE public.comment_likes(comment_id integer, user_id integer);
GRANT ALL ON public.comment_likes TO service_role;
CREATE FUNCTION public.test_comment_counter() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN UPDATE public.comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id; RETURN NEW; END $$;
CREATE TRIGGER test_comment_counter AFTER INSERT ON public.comment_likes
 FOR EACH ROW EXECUTE FUNCTION public.test_comment_counter();
`);
// Prove the fixture reproduces the observed database-role exposure locally.
assert.equal((await as('anon', "UPDATE public.comments SET content = 'bad', author_id = 102 WHERE id = 1 RETURNING id")).rowCount, 1);
const policiesBefore = await sql("SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'comments' AND cmd <> 'UPDATE' ORDER BY policyname");
// Defense in depth: explicit column and PUBLIC grants must not survive.
await sql('GRANT UPDATE(content, author_id, attachment) ON public.comments TO anon, authenticated, public');
if (!process.argv.includes('--skip-migration')) {
 await sql(migration);
 await sql(migration); // safe to reapply
}
for (const role of ['anon', 'authenticated']) {
 for (const sub of [undefined, '101', '102']) {
  for (const statement of [
   "UPDATE public.comments SET content = 'bad' WHERE id = 1",
   "UPDATE public.comments SET author_id = 102 WHERE id = 1",
   "UPDATE public.comments SET content = 'bad', author_id = 102 WHERE id = 1",
   "UPDATE public.comments SET attachment = '{}' WHERE id = 1",
   "UPDATE public.comments SET likes_count = 100 WHERE id = 1",
  ]) assert.equal((await as(role, statement, sub)).code, '42501', `${role}/${sub}: ${statement}`);
  assert.equal((await as(role, 'SELECT * FROM public.comments', sub)).rowCount, 1);
 }
 assert.equal((await as(role, 'DELETE FROM public.comments WHERE id = 1')).code, '42501');
 assert.equal((await as(role, "INSERT INTO public.comments VALUES(2, 102, 201, 'blocked', 0, null, null)")).code, '42501');
 assert.equal((await as(role, "INSERT INTO public.comments VALUES(2, 102, 201, 'admitted', 0, null, null)", 'admitted')).rowCount, 1);
 const grants = await sql(`SELECT has_table_privilege('${role}', 'public.comments', 'UPDATE') AS table_update,
 has_any_column_privilege('${role}', 'public.comments', 'UPDATE') AS column_update`);
 assert.deepEqual(grants, [{table_update: false, column_update: false}]);
}
assert.deepEqual(await sql("SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'comments' AND cmd <> 'UPDATE' ORDER BY policyname"), policiesBefore);
assert.equal((await sql("SELECT * FROM pg_policies WHERE tablename = 'comments' AND policyname = 'comments_update_anon'")).length, 0);
for (const statement of [
 "UPDATE public.comments SET content = 'server edit' WHERE id = 1",
 "INSERT INTO public.comments VALUES(2, 101, 201, 'server create', 0, null, null)",
 "INSERT INTO public.comment_likes VALUES(1, 102)",
 "DELETE FROM public.comments WHERE id = 1",
]) assert.equal((await as('service_role', statement)).rowCount, 1, statement);
// Future GIF columns do not inherit client grants when installed afterward.
await sql('ALTER TABLE public.comments ADD COLUMN future_attachment jsonb');
assert.equal((await as('anon', "UPDATE public.comments SET future_attachment = '{}' WHERE id = 1")).code, '42501');
// No data was changed by either migration application.
assert.deepEqual(await sql('SELECT content, author_id, likes_count FROM public.comments'), [{content: 'original', author_id: 101, likes_count: 0}]);
console.log('PASS: isolated PostgreSQL proves anon/owner/cross-user UPDATE denial, immutable client authorship, unchanged reads/INSERT/DELETE, service-role writes/counters, column/PUBLIC grant revocation and repeatability.');
await pool.end();
pool = null;
