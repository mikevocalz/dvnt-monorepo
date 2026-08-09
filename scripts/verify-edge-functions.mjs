#!/usr/bin/env node
/**
 * Guards the two ways a Supabase edge-function deploy has silently taken
 * production down in this repo.
 *
 *   1. verify_jwt drift. A function with no [functions.<slug>] block in
 *      config.toml is deployed with verify_jwt = TRUE. This app authenticates
 *      with Better Auth tokens, not Supabase JWTs, so that 401s every caller.
 *      The 2026-08-08 bulk deploy flipped 5 unlisted functions and broke
 *      didit-webhook, create-verification-session and create-event; nobody
 *      noticed until signup was reported broken a day later.
 *
 *   2. The beta signup gate. A before-user-created hook in the auth function
 *      rejected any email missing from allowlisted_emails with 403 BETA_ONLY.
 *      It sat unenforced in the repo for a month and only reached production in
 *      that same bulk deploy, which took account creation down platform-wide.
 *
 * Static checks need no network and no credentials — run them anywhere.
 * Pass --live to additionally read deployed state (needs the supabase CLI and
 * SUPABASE_PROJECT_REF, or --project-ref).
 *
 *   node scripts/verify-edge-functions.mjs
 *   node scripts/verify-edge-functions.mjs --live
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const FN_DIR = join(REPO, "apps/mobile/supabase/functions");
const CONFIG = join(REPO, "apps/mobile/supabase/config.toml");

const failures = [];
const fail = (title, detail) => failures.push({ title, detail });

// ── 1. every shipped function is pinned verify_jwt = false ─────────────────
const config = readFileSync(CONFIG, "utf8");
const pinnedFalse = new Set();
for (const m of config.matchAll(
  /^\[functions\.([^\]]+)\]\s*\r?\n(?:[^\[]*?)verify_jwt\s*=\s*false/gm,
)) {
  pinnedFalse.add(m[1]);
}

const shipped = readdirSync(FN_DIR).filter(
  (d) => !d.startsWith("_") && statSync(join(FN_DIR, d)).isDirectory(),
);
const unpinned = shipped.filter((s) => !pinnedFalse.has(s)).sort();
if (unpinned.length) {
  fail(
    `${unpinned.length} edge function(s) are not pinned verify_jwt = false in config.toml`,
    `Deploying these sets verify_jwt = TRUE and 401s every caller.\n` +
      `Add to apps/mobile/supabase/config.toml:\n\n` +
      unpinned.map((s) => `[functions.${s}]\nverify_jwt = false`).join("\n\n"),
  );
}

// ── 2. the beta signup gate has not come back ──────────────────────────────
// Only flags a LIVE throw; the explanatory comment left behind is fine.
const authSrc = readFileSync(join(FN_DIR, "auth/index.ts"), "utf8");
const gateLine = authSrc
  .split("\n")
  .findIndex((l) => /BETA_ONLY/.test(l) && !/^\s*(\/\/|\*)/.test(l));
if (gateLine !== -1) {
  fail(
    "the beta signup gate is active in the auth edge function",
    `apps/mobile/supabase/functions/auth/index.ts:${gateLine + 1} rejects signups ` +
      `not on the allowlist with 403 BETA_ONLY. This closes account creation ` +
      `platform-wide the moment it deploys. Remove it, or pin the intent here ` +
      `deliberately if re-gating really is what you want.`,
  );
}

// ── 3. (--live) deployed state matches ─────────────────────────────────────
if (process.argv.includes("--live")) {
  const refFlag = process.argv.indexOf("--project-ref");
  const ref =
    (refFlag !== -1 && process.argv[refFlag + 1]) ||
    process.env.SUPABASE_PROJECT_REF;
  if (!ref) {
    fail("--live needs a project ref", "Pass --project-ref <ref> or set SUPABASE_PROJECT_REF.");
  } else {
    try {
      const out = execFileSync(
        "npx",
        ["supabase", "functions", "list", "--project-ref", ref],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      );
      const live = JSON.parse(out).functions ?? [];
      const on = live.filter((f) => f.verify_jwt).map((f) => f.slug);
      if (on.length) {
        fail(
          `${on.length} deployed function(s) have verify_jwt = TRUE`,
          `Every caller gets 401. Redeploy each with --no-verify-jwt:\n` +
            on.map((s) => `  npx supabase functions deploy ${s} --project-ref ${ref} --no-verify-jwt`).join("\n"),
        );
      }
      console.log(`  live: ${live.length} functions, ${on.length} with verify_jwt=TRUE`);
    } catch (err) {
      fail("could not read live function state", String(err.message ?? err).slice(0, 300));
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
console.log(`  static: ${shipped.length} shipped functions, ${unpinned.length} unpinned`);
if (!failures.length) {
  console.log("\n✔ edge functions OK");
  process.exit(0);
}
console.error(`\n✖ ${failures.length} problem(s) found\n`);
for (const f of failures) console.error(`— ${f.title}\n\n${f.detail}\n`);
process.exit(1);
