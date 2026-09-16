#!/usr/bin/env node
/**
 * Fails when a live account identifier is committed to the repo.
 *
 * Written after a real incident: production Better Auth ids were pasted into a
 * test fixture and a doc, GitGuardian flagged them as high-entropy secrets, and
 * the doc containing one literally claimed the ids were "deliberately not
 * committed". A rule that is only written in prose gets broken by whoever is
 * moving fast, so it is a check now.
 *
 * Better Auth ids are 32-character nanoids of mixed case and digits. Random
 * hex, uuids and base64 are NOT matched: this is not a general secret scanner,
 * it is the one shape this repo has already leaked. GitGuardian stays the
 * backstop for everything else.
 *
 * Deliberately not matched:
 *   - anything under node_modules, .git, dist, build
 *   - lockfiles and generated bundles
 *   - a URL path segment, so a CDN asset path keeps working (those predate this
 *     check and are public object storage, not credentials)
 *
 * Usage: node scripts/verify-no-live-identifiers.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Occurrences that predate this check. They are real ids and should be cleaned
// up, but failing the build on inherited debt just gets the check disabled, so
// they are recorded instead. Keyed by file + value prefix so the entry survives
// the line moving. Refresh deliberately with --update-baseline, never casually.
const BASELINE_PATH = new URL("./live-identifier-baseline.json", import.meta.url);

// 32 chars, mixed case AND at least one digit — the Better Auth id shape.
// Requiring all three classes keeps ordinary 32-char words and hex out.
const CANDIDATE = /\b(?=[A-Za-z0-9]{32}\b)(?=[^\s]*[a-z])(?=[^\s]*[A-Z])(?=[^\s]*[0-9])[A-Za-z0-9]{32}\b/g;

const ALLOW_PATH = /(^|\/)(node_modules|\.git|dist|build|\.next|ios|android)\//;
// Binaries and vendored bundles: high-entropy by nature, never hand-written.
const ALLOW_FILE =
  /(pnpm-lock\.yaml|package-lock\.json|bun\.lock|\.map|\.lock|\.ttf|\.otf|\.woff2?|\.wasm|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.mp4|\.mov|\.pdf|\.ico|\.zip|\.jar|\.keystore)$/i;
const VENDORED = /(^|\/)(public|assets|vendor|\.yarn)\//;
// A CDN/storage path segment is an object location, not a credential.
const IN_URL = /https?:\/\/[^\s"')]*$/;

function tracked() {
  return execSync("git ls-files", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !ALLOW_PATH.test(f) && !ALLOW_FILE.test(f) && !VENDORED.test(f));
}

let hits = [];
for (const file of tracked()) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // binary or unreadable
  }
  if (text.includes("\u0000")) continue; // binary
  text.split("\n").forEach((line, i) => {
    if (line.length > 500) return; // minified or generated
    for (const m of line.matchAll(CANDIDATE)) {
      const before = line.slice(0, m.index);
      if (IN_URL.test(before)) continue;
      hits.push({ file, line: i + 1, value: m[0] });
    }
  });
}

const key = (h) => `${h.file}:${h.value.slice(0, 8)}`;
const baseline = existsSync(BASELINE_PATH)
  ? new Set(JSON.parse(readFileSync(BASELINE_PATH, "utf8")).known)
  : new Set();

if (process.argv.includes("--update-baseline")) {
  const known = [...new Set(hits.map(key))].sort();
  writeFileSync(BASELINE_PATH, JSON.stringify({ known }, null, 2) + "\n");
  console.log(`baseline updated: ${known.length} pre-existing occurrence(s) recorded`);
  process.exit(0);
}

const inherited = hits.filter((h) => baseline.has(key(h)));
hits = hits.filter((h) => !baseline.has(key(h)));
if (inherited.length > 0) {
  console.log(`note: ${inherited.length} pre-existing occurrence(s) still to clean up (see live-identifier-baseline.json)`);
}

if (hits.length === 0) {
  console.log("✔ no live account identifiers committed");
  process.exit(0);
}

console.error("✖ live account identifier(s) committed\n");
for (const h of hits) {
  // Print a prefix only. Echoing the whole value into CI logs would just move
  // the leak somewhere else.
  console.error(`  ${h.file}:${h.line}  ${h.value.slice(0, 6)}…(32 chars)`);
}
console.error(
  "\nThese look like Better Auth user ids. They are server-only configuration.",
  "\nUse an obviously-fake fixture in tests, and in docs record the lookup query",
  "\nrather than the value.",
);
process.exit(1);
