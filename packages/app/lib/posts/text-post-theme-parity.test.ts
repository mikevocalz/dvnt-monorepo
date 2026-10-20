/**
 * Every layer that can reject a theme must accept the same five.
 *
 * `deviant` was offered by the picker and rejected by the server, the RPC and
 * a CHECK constraint — each with a silent `ELSE 'graphite'`. Nothing errored,
 * so the only symptom was a post coming back the wrong colour, and every text
 * post in the table ended up grey.
 *
 * Source text rather than imports: the edge function is Deno and the migration
 * is SQL, neither of which `node --test` can load. The lists are plain literals
 * in both, so reading them is exact enough to fail when one drifts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_TEXT_POST_THEME,
  TEXT_POST_THEMES,
  normalizeTextPostTheme,
  resolveTextPostTheme,
} from "./text-post.ts";

const ROOT = join(import.meta.dirname, "../../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const EDGE_FN = "apps/mobile/supabase/functions/create-post/index.ts";
const MIGRATION =
  "apps/mobile/supabase/migrations/20260918180000_text_post_theme_deviant.sql";

/** Published themes remain supported even after removing the creation picker. */
const clientThemes = Object.keys(TEXT_POST_THEMES).sort();

test("the client preserves all five historical text-post themes", () => {
  assert.deepEqual(clientThemes, [
    "cobalt",
    "deviant",
    "ember",
    "graphite",
    "sage",
  ]);
});

test("new text posts use the existing DVNT-branded theme", () => {
  assert.equal(DEFAULT_TEXT_POST_THEME, "deviant");
  assert.equal(resolveTextPostTheme(DEFAULT_TEXT_POST_THEME), TEXT_POST_THEMES.deviant);
});

test("removing creation choices does not restyle published posts", () => {
  for (const theme of clientThemes) {
    assert.equal(normalizeTextPostTheme(theme), theme);
    assert.equal(resolveTextPostTheme(theme).key, theme);
  }
  for (const missingTheme of [null, undefined, "", "unknown-theme"]) {
    assert.equal(normalizeTextPostTheme(missingTheme), "graphite");
    assert.equal(resolveTextPostTheme(missingTheme), TEXT_POST_THEMES.graphite);
  }
});

test("the edge function accepts every supported published theme", () => {
  const src = read(EDGE_FN);
  const list = /\[((?:\s*"[a-z]+",?)+)\]\.includes\(textTheme\)/.exec(src);
  assert.ok(list, "could not find the allowlist in create-post/index.ts");
  const accepted = [...list[1]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!).sort();
  assert.deepEqual(
    accepted,
    clientThemes,
    "edge function allowlist has drifted from TEXT_POST_THEMES — the extra or " +
      "missing theme will be silently rewritten to graphite",
  );
});

test("the edge function's type admits every supported published theme", () => {
  const src = read(EDGE_FN);
  const union = /textTheme\?:\s*((?:"[a-z]+"\s*\|?\s*)+);/.exec(src);
  assert.ok(union, "could not find the textTheme union");
  const declared = [...union[1]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!).sort();
  assert.deepEqual(declared, clientThemes);
});

test("the CHECK constraint and the RPC accept every supported published theme", () => {
  const sql = read(MIGRATION);

  const check = /CHECK \(text_theme = ANY \(ARRAY\[([^\]]+)\]\)\)/.exec(sql);
  assert.ok(check, "could not find the CHECK constraint");
  const constrained = [...check[1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!).sort();
  assert.deepEqual(constrained, clientThemes, "CHECK constraint has drifted");

  const rpc = /p_text_theme IN \(([^)]+)\)/.exec(sql);
  assert.ok(rpc, "could not find the RPC predicate");
  const rpcAccepted = [...rpc[1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!).sort();
  assert.deepEqual(rpcAccepted, clientThemes, "RPC predicate has drifted");
});
