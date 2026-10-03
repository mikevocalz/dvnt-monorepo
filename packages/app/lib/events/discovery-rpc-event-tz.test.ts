import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The migration quotes the LIVE definitions it replaces (read with
// pg_get_functiondef) and then redefines each function. These checks hold it
// to "the live body plus `e.event_tz,`": the quoted text hashes to the md5
// recorded from the live database, and each new body is that text with exactly
// one added line.
const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../apps/mobile/supabase/migrations/20261003120000_discovery_rpcs_return_event_tz.sql",
);
const sql = readFileSync(MIGRATION, "utf8");
const ADDED = "      e.event_tz,";

function liveBlocks(): Map<string, { md5: string; text: string }> {
  const out = new Map<string, { md5: string; text: string }>();
  const re = /^-- BEGIN LIVE (\S+) md5=([0-9a-f]{32})\n([\s\S]*?)^-- END LIVE$/gm;
  for (const m of sql.matchAll(re)) {
    const text = m[3]
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => (l === "-- |" ? "" : l.replace(/^-- \| /, "")))
      .join("\n") + "\n";
    out.set(m[1], { md5: m[2], text });
  }
  return out;
}

function newBodies(): string[] {
  const code = sql.slice(sql.lastIndexOf("-- END LIVE"));
  return [...code.matchAll(/^CREATE OR REPLACE FUNCTION[\s\S]*?^\$function\$\n/gm)].map((m) => m[0]);
}

const nameOf = (def: string) => /FUNCTION (public\.\w+)\(/.exec(def)?.[1];

test("the quoted definitions are byte-for-byte the live ones", () => {
  const live = liveBlocks();
  assert.deepEqual([...live.keys()].sort(), [
    "public.get_events_for_you(integer,integer,integer)",
    "public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text,boolean)",
  ]);
  for (const [sig, { md5, text }] of live) {
    assert.equal(createHash("md5").update(text).digest("hex"), md5, sig);
  }
});

test("each new body is the live body plus e.event_tz and nothing else", () => {
  const live = [...liveBlocks().values()].map((b) => b.text);
  const bodies = newBodies();
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    const before = live.find((t) => nameOf(t) === nameOf(body));
    assert.ok(before, `no live definition for ${nameOf(body)}`);
    const lines = body.split("\n");
    assert.equal(lines.filter((l) => l === ADDED).length, 1);
    assert.ok(!before.split("\n").includes(ADDED));
    assert.equal(lines.filter((l) => l !== ADDED).join("\n"), before);
    // It sits in the SELECT list, right after cancelled_at.
    assert.equal(lines[lines.indexOf(ADDED) - 1], "      e.cancelled_at,");
  }
});

test("the migration touches no grants, constraints or triggers", () => {
  const code = sql
    .split("\n")
    .filter((l) => !l.startsWith("--"))
    .join("\n");
  assert.doesNotMatch(code, /\b(GRANT|REVOKE|ALTER|CONSTRAINT|TRIGGER|DROP)\b/i);
  assert.equal((code.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 2);
});
