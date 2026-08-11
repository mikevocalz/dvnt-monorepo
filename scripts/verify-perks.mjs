#!/usr/bin/env node
/**
 * Host & Guest WS-3 — perk resolution.
 *
 * WS-3's accept criterion includes "a `past_due` member gets no perk". That is
 * enforced upstream (the server resolves `membership_tier` to null for a lapsed
 * subscription), so the property this file proves is the other half: given a
 * null tier, resolution yields nothing — and given a real tier, it yields
 * exactly what the host configured and nothing more.
 *
 *   node scripts/verify-perks.mjs
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const bundle = join(root, "node_modules", ".verify-perks.cjs");

try {
  execFileSync(
    join(root, "node_modules", ".bin", "esbuild"),
    [
      "packages/app/lib/perks/perk-config.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--packages=external",
      `--outfile=${bundle}`,
      "--log-level=warning",
    ],
    { cwd: root, stdio: "inherit" },
  );

  const {
    DEFAULT_PERK_CONFIG,
    effectivePerkConfig,
    resolvePerks,
    countQualifying,
  } = require(bundle);

  const cfg = DEFAULT_PERK_CONFIG;

  // ── The tier ladder ──────────────────────────────────────────────────────
  assert.deepStrictEqual(
    resolvePerks("free", cfg),
    [],
    "free must get no door perk",
  );
  assert.deepStrictEqual(
    resolvePerks("dvnt_core", cfg),
    [],
    "core is below every default threshold",
  );
  assert.deepStrictEqual(
    resolvePerks("dvnt_insider", cfg),
    ["skip_line"],
    "insider gets skip-the-line and nothing else by default",
  );
  assert.ok(
    resolvePerks("dvnt_vip", cfg).includes("early_entry"),
    "vip gets early entry",
  );
  assert.ok(
    resolvePerks("dvnt_founders_circle", cfg).includes("guaranteed_entry"),
    "founders gets guaranteed entry",
  );

  // ── Sneaky Lynk is a different product line ─────────────────────────────
  for (const plan of ["sneaky_tier_1", "sneaky_tier_2"]) {
    assert.deepStrictEqual(
      resolvePerks(plan, cfg),
      [],
      `${plan} must confer no door perk — separate product line`,
    );
  }

  // ── No tier at all: guests, and lapsed members ───────────────────────────
  assert.deepStrictEqual(resolvePerks(null, cfg), [], "a guest gets no perk");
  assert.deepStrictEqual(
    resolvePerks(undefined, cfg),
    [],
    "an unresolved tier gets no perk",
  );

  // ── comp_drink is off until a host turns it on ───────────────────────────
  assert.ok(
    !resolvePerks("dvnt_founders_circle", cfg).includes("comp_drink"),
    "comp_drink must never be granted by default — it costs the host money",
  );
  assert.ok(
    resolvePerks("dvnt_founders_circle", { comp_drink: 0 }).includes(
      "comp_drink",
    ),
    "a host enabling comp_drink must actually grant it",
  );

  // ── Host override, including turning a default OFF ───────────────────────
  assert.deepStrictEqual(
    resolvePerks("dvnt_insider", effectivePerkConfig({ skip_line: null })),
    [],
    "a host disabling skip_line must revoke it everywhere",
  );
  assert.ok(
    resolvePerks("dvnt_core", effectivePerkConfig({ skip_line: 3 })).includes(
      "skip_line",
    ),
    "a host lowering the threshold must widen the perk",
  );
  // A malformed / absent config falls back to defaults rather than granting all.
  assert.deepStrictEqual(
    effectivePerkConfig(null),
    cfg,
    "null config must fall back to defaults",
  );
  assert.deepStrictEqual(
    resolvePerks("free", effectivePerkConfig("nonsense")),
    [],
    "a garbage config must not become a free-for-all",
  );

  // ── The cost signal a host sees before saving ────────────────────────────
  const roomRanks = [0, 0, 0, 3, 4, 4, 5, 6];
  assert.strictEqual(
    countQualifying(roomRanks, cfg.skip_line),
    4,
    "skip-the-line count must include every rank at or above the threshold",
  );
  assert.strictEqual(
    countQualifying(roomRanks, null),
    0,
    "a disabled perk qualifies nobody",
  );

  console.log(
    "perks OK — ladder, sneaky excluded, lapsed/guest empty, " +
      "comp off by default, host override both directions",
  );
} finally {
  rmSync(bundle, { force: true });
}
