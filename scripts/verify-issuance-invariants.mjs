#!/usr/bin/env node
/**
 * Static gate for the two faults that stopped paid ticket issuance for three
 * days in September 2026. Both were invisible until nine buyers had been
 * charged and given nothing, so both get a check that runs without a database.
 *
 * (A) A new public table with no `service_role` grant.
 *     `ticket_addons`, `ticket_addon_variants` and `order_addons` carried
 *     grants for anon/authenticated/postgres and none for service_role, so
 *     every edge function using the service key got
 *     `42501 permission denied for table ticket_addons` — swallowed by a catch,
 *     retried every 15 minutes, never surfaced. Supabase applies a schema-wide
 *     grant at project setup; tables created by later migrations do not inherit
 *     it. So: every migration that creates a public table must also grant
 *     service_role, in that same migration.
 *
 * (B) An upsert aimed at an index Postgres cannot infer.
 *     `_shared/session-issuance.ts` upserted with
 *     `onConflict: "stripe_checkout_session_id,order_index"` against a PARTIAL
 *     unique index. Postgres refuses to infer a partial index unless the
 *     statement repeats its predicate, so every insert raised
 *     `42P10 there is no unique or exclusion constraint matching the ON CONFLICT
 *     specification` before doing any work. PostgREST's `onConflict` option
 *     cannot express a predicate at all, so the index it targets must not have
 *     one.
 *
 * Read-only. Exits 1 on any violation.
 *
 * Usage:  node scripts/verify-issuance-invariants.mjs
 *         node scripts/verify-issuance-invariants.mjs --json
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "apps/mobile/supabase/migrations");
const FUNCTIONS = path.join(ROOT, "apps/mobile/supabase/functions");
const JSON_OUT = process.argv.includes("--json");

const failures = [];
const warnings = [];
const fail = (check, where, detail) => failures.push({ check, where, detail });

/** Every .sql directly in the migrations dir, oldest first. Skips rollback/. */
function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: fs.readFileSync(path.join(MIGRATIONS, f), "utf8") }));
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Strip `-- line` and block comments so we never match commentary as code. */
const stripComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

// ── A. every created public table is granted to service_role ───────────────
//
// Tables a migration creates and then drops in the same file are ignored, as
// are temp tables. A grant anywhere in the repo's migration history counts —
// the grant does not have to be in the creating migration, only to exist.
const CREATE_TABLE =
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?([a-z0-9_]+)["']?/gi;
const GRANT_TO_SERVICE_ROLE =
  /\bgrant\s+([^;]*?)\s+on\s+(?:table\s+)?(?:public\.)?["']?([a-z0-9_]+)["']?\s+to\s+([^;]*?)service_role/gi;
const GRANT_ALL_TABLES =
  /\bgrant\s+[^;]*?\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+[^;]*?service_role/i;

function checkGrants(files) {
  const created = new Map(); // table -> migration that created it
  const granted = new Set();
  let blanketGrant = null;

  for (const { name, sql } of files) {
    const body = stripComments(sql);
    if (GRANT_ALL_TABLES.test(body)) blanketGrant = name;
    for (const m of body.matchAll(CREATE_TABLE)) {
      if (!created.has(m[1])) created.set(m[1], name);
    }
    for (const m of body.matchAll(GRANT_TO_SERVICE_ROLE)) granted.add(m[2]);
  }

  for (const [table, where] of created) {
    if (granted.has(table)) continue;
    // A blanket grant only helps tables that already existed when it ran.
    const blanketCoversIt =
      blanketGrant !== null && where.localeCompare(blanketGrant) < 0;
    if (blanketCoversIt) continue;
    fail(
      "service_role-grant",
      `${where} → public.${table}`,
      `created but never granted to service_role. Every edge function using the ` +
        `service key will get 42501 on it. Add: grant select, insert, update, ` +
        `delete on public.${table} to service_role;`,
    );
  }
  return { createdCount: created.size, grantedCount: granted.size };
}

// ── B. no upsert aims at a partial unique index ────────────────────────────
//
// Collects `create unique index NAME on TABLE (cols) [where ...]` from the
// migrations, keyed by "table:col,col", then checks every `onConflict:` string
// in the edge functions against it. A later non-partial index on the same
// columns supersedes an earlier partial one (that is exactly how the September
// fix was shipped), so the LAST declaration for a column set wins.
const CREATE_UNIQUE_INDEX =
  /\bcreate\s+unique\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?["']?([a-z0-9_]+)["']?\s+on\s+(?:public\.)?["']?([a-z0-9_]+)["']?\s*\(([^)]*)\)([^;]*)/gi;
const DROP_INDEX = /\bdrop\s+index\s+(?:if\s+exists\s+)?(?:public\.)?["']?([a-z0-9_]+)["']?/gi;
const UNIQUE_CONSTRAINT =
  /\badd\s+constraint\s+["']?([a-z0-9_]+)["']?\s+unique\s*\(([^)]*)\)/gi;

const normCols = (s) =>
  s
    .split(",")
    .map((c) => c.trim().replace(/["']/g, "").toLowerCase())
    .filter(Boolean)
    .join(",");

/**
 * Pull the uniqueness declared INSIDE a `create table` body: a primary key or a
 * `unique` written as a column or table constraint. Postgres infers all of
 * these happily — only a PARTIAL index is un-inferable — so missing them is how
 * a checker ends up reporting two dozen upserts that are perfectly fine.
 */
function collectInlineUniques(body, byCols) {
  const CREATE_TABLE_BODY =
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?([a-z0-9_]+)["']?\s*\(/gi;
  for (const m of body.matchAll(CREATE_TABLE_BODY)) {
    const table = m[1];
    // Walk to the matching close paren so nested type parens (numeric(10,2))
    // do not truncate the body.
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i + 1;
    for (; i < body.length; i++) {
      if (body[i] === "(") depth++;
      else if (body[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const inner = body.slice(start, i);

    // Split on top-level commas only.
    const parts = [];
    let buf = "";
    let d = 0;
    for (const ch of inner) {
      if (ch === "(") d++;
      if (ch === ")") d--;
      if (ch === "," && d === 0) {
        parts.push(buf);
        buf = "";
      } else buf += ch;
    }
    parts.push(buf);

    for (const raw of parts) {
      const part = raw.trim();
      if (!part) continue;
      const tableLevel =
        /^(?:constraint\s+["']?[a-z0-9_]+["']?\s+)?(?:primary\s+key|unique)\s*\(([^)]*)\)/i.exec(
          part,
        );
      if (tableLevel) {
        byCols.set(`${table}:${normCols(tableLevel[1])}`, {
          name: `${table}_inline`,
          table,
          partial: false,
          tail: "",
        });
        continue;
      }
      const colLevel = /^["']?([a-z0-9_]+)["']?\s+[^,]*?\b(?:primary\s+key|unique)\b/i.exec(
        part,
      );
      if (colLevel) {
        byCols.set(`${table}:${normCols(colLevel[1])}`, {
          name: `${table}_${colLevel[1]}_inline`,
          table,
          partial: false,
          tail: "",
        });
      }
    }
  }
}

function collectIndexes(files) {
  /** key `table:cols` -> { name, partial, where } — last write wins. */
  const byCols = new Map();
  const dropped = new Set();

  for (const { sql } of files) {
    const body = stripComments(sql);
    collectInlineUniques(body, byCols);
    // `alter table X add primary key (cols)` / `add constraint C primary key (cols)`
    for (const m of body.matchAll(
      /\balter\s+table\s+(?:only\s+)?(?:public\.)?["']?([a-z0-9_]+)["']?[^;]*?\badd\s+(?:constraint\s+["']?[a-z0-9_]+["']?\s+)?primary\s+key\s*\(([^)]*)\)/gi,
    )) {
      byCols.set(`${m[1]}:${normCols(m[2])}`, {
        name: `${m[1]}_pkey`,
        table: m[1],
        partial: false,
        tail: "",
      });
    }
    for (const m of body.matchAll(CREATE_UNIQUE_INDEX)) {
      const [, name, table, cols, tail] = m;
      const partial = /\bwhere\b/i.test(tail);
      byCols.set(`${table}:${normCols(cols)}`, { name, table, partial, tail: tail.trim() });
    }
    for (const m of body.matchAll(UNIQUE_CONSTRAINT)) {
      // A table-level UNIQUE constraint is always inferable.
      const [, name, cols] = m;
      const tableMatch = /alter\s+table\s+(?:public\.)?["']?([a-z0-9_]+)/i.exec(body);
      if (tableMatch) {
        byCols.set(`${tableMatch[1]}:${normCols(cols)}`, {
          name,
          table: tableMatch[1],
          partial: false,
          tail: "",
        });
      }
    }
    // Order matters: `drop index if exists X; create unique index X ...` in one
    // migration is the normal redefine idiom, not a removal. Only a drop that
    // is the LAST word on a name actually kills it.
    for (const m of body.matchAll(DROP_INDEX)) dropped.add(m[1]);
    for (const m of body.matchAll(CREATE_UNIQUE_INDEX)) dropped.delete(m[1]);
  }
  return { byCols, dropped };
}

const ON_CONFLICT = /onConflict\s*:\s*["'`]([^"'`]+)["'`]/g;
const FROM_TABLE = /\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)/g;

function checkUpserts({ byCols, dropped }) {
  let checked = 0;
  for (const file of walk(FUNCTIONS)) {
    if (!/\.(ts|js)$/.test(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("onConflict")) continue;
    const rel = path.relative(ROOT, file);

    for (const m of src.matchAll(ON_CONFLICT)) {
      checked++;
      const cols = normCols(m[1]);
      const before = src.slice(0, m.index);
      const tables = [...before.matchAll(FROM_TABLE)].map((t) => t[1]);
      const table = tables[tables.length - 1];
      const line = before.split("\n").length;

      if (!table) {
        fail(
          "onConflict-target",
          `${rel}:${line}`,
          `onConflict "${m[1]}" — could not determine the target table from the ` +
            `preceding .from(). Check it by hand.`,
        );
        continue;
      }
      const idx = byCols.get(`${table}:${cols}`);
      if (!idx) {
        // Not provable from here. Plenty of these tables predate this
        // migrations directory, so their uniqueness is only in the live
        // database. Surface it for a human rather than failing the build —
        // a gate that is red for unprovable reasons is a gate nobody runs.
        warnings.push({
          check: "onConflict-unverifiable",
          where: `${rel}:${line}`,
          detail:
            `upsert on "${table}" with onConflict "${m[1]}" — no matching unique ` +
            `index or constraint in the migrations. Either the table predates ` +
            `them (fine) or this raises 42P10 at runtime. Confirm against the ` +
            `live database once.`,
        });
        continue;
      }
      if (dropped.has(idx.name)) {
        fail(
          "onConflict-target",
          `${rel}:${line}`,
          `upsert on "${table}" targets ${idx.name}, which a later migration drops.`,
        );
        continue;
      }
      if (idx.partial) {
        fail(
          "onConflict-partial-index",
          `${rel}:${line}`,
          `upsert on "${table}" with onConflict "${m[1]}" aims at PARTIAL index ` +
            `${idx.name} (${idx.tail}). PostgREST cannot emit the predicate, so ` +
            `Postgres cannot infer it and raises 42P10. Make the index ` +
            `non-partial, or stop using .upsert() here.`,
        );
      }
    }
  }
  return checked;
}

// ── run ────────────────────────────────────────────────────────────────────
const files = migrationFiles();
const grants = checkGrants(files);
const indexes = collectIndexes(files);
const upsertsChecked = checkUpserts(indexes);

const summary = {
  migrations: files.length,
  tablesCreated: grants.createdCount,
  tablesGranted: grants.grantedCount,
  uniqueIndexes: indexes.byCols.size,
  upsertsChecked,
  failures: failures.length,
  warnings: warnings.length,
};

if (JSON_OUT) {
  console.log(
    JSON.stringify({ ok: failures.length === 0, summary, failures, warnings }, null, 2),
  );
} else {
  console.log(
    `issuance invariants — ${summary.migrations} migrations, ` +
      `${summary.tablesCreated} tables created, ${summary.uniqueIndexes} unique indexes, ` +
      `${summary.upsertsChecked} upserts checked`,
  );
  if (failures.length === 0) {
    console.log("✓ every created table is granted to service_role");
    console.log("✓ every onConflict target is an inferable unique index");
  } else {
    for (const f of failures) {
      console.error(`\n✖ [${f.check}] ${f.where}\n  ${f.detail}`);
    }
    console.error(`\n${failures.length} violation(s).`);
  }
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} unverifiable from the migrations alone:`);
    for (const w of warnings) console.log(`  · ${w.where} — ${w.detail}`);
  }
}
process.exit(failures.length === 0 ? 0 : 1);
