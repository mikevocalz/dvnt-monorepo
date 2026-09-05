#!/usr/bin/env node
/**
 * Host & Guest WS-5 — presence privacy + boundaries.
 *
 * The spec's accept criterion is "no coordinate is ever written to the database
 * (proven by schema review and a payload audit)". Both halves are checked here:
 * the SCHEMA (the migration declares no coordinate column) and the CLIENT
 * (the module that takes the reading sends a word, not a position).
 *
 * Also pins the radius boundaries, because an `arrived` that fires 400m out
 * makes a host's "18 arrived" a lie.
 *
 *   node scripts/verify-presence.mjs
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// ── 1. Schema: there must be nowhere to put a coordinate ────────────────────
const migration = readFileSync(
  join(root, "apps/mobile/supabase/migrations/20260810190000_event_perks_and_presence.sql"),
  "utf8",
);
const presenceTable = migration.slice(
  migration.indexOf("create table if not exists public.event_presence"),
  migration.indexOf("comment on table public.event_presence"),
);
for (const banned of ["lat", "lng", "longitude", "latitude", "accuracy", "geo", "point", "coord"]) {
  assert.ok(
    !new RegExp(`\\b${banned}`, "i").test(presenceTable),
    `event_presence declares a "${banned}" column — coordinates must never be storable`,
  );
}
assert.ok(
  /check \(state in \('approaching','arrived','departed'\)\)/.test(presenceTable),
  "presence state must be constrained to the three discrete states",
);
assert.ok(
  /expires_at\s+timestamptz not null/.test(presenceTable),
  "presence rows must carry a hard expiry",
);

// ── 2. Client: the reading never leaves as numbers ──────────────────────────
const src = readFileSync(
  join(root, "packages/app/features/presence/arrival-presence.ts"),
  "utf8",
);
const reportBody = src.slice(src.indexOf('invokeEdge("event-presence"'), src.indexOf("return error ? null"));
for (const banned of ["latitude", "longitude", "coords", "accuracy"]) {
  assert.ok(
    !reportBody.includes(banned),
    `the presence payload references "${banned}" — only a state word may be sent`,
  );
}
assert.ok(
  !/requestForegroundPermissionsAsync|requestBackgroundPermissionsAsync/.test(src),
  "presence must never trigger a permission prompt — it reuses an existing grant",
);
assert.ok(
  !/startGeofencingAsync|watchPositionAsync/.test(src),
  "presence is a one-shot reading, not a geofence or a watch",
);

// ── 3. Boundaries ───────────────────────────────────────────────────────────
const bundle = join(root, "node_modules", ".verify-presence.cjs");
try {
  execFileSync(
    join(root, "node_modules", ".bin", "esbuild"),
    [
      "packages/app/features/presence/arrival-presence.ts",
      "--bundle", "--platform=node", "--format=cjs", "--packages=external",
      "--alias:expo-location=./scripts/presence-check/stubs.js",
      "--alias:@dvnt/app/lib/api/invoke-edge=./scripts/presence-check/stubs.js",
      `--outfile=${bundle}`, "--log-level=warning",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const { stateForDistance, distanceMetres, ARRIVED_RADIUS_M, APPROACHING_RADIUS_M } =
    require(bundle);

  assert.strictEqual(stateForDistance(0), "arrived");
  assert.strictEqual(stateForDistance(ARRIVED_RADIUS_M), "arrived", "the radius itself is inside");
  assert.strictEqual(stateForDistance(ARRIVED_RADIUS_M + 1), "approaching");
  assert.strictEqual(stateForDistance(APPROACHING_RADIUS_M), "approaching");
  assert.strictEqual(stateForDistance(APPROACHING_RADIUS_M + 1), "departed");

  // Distance sanity: ~111.32 m per 0.001° of latitude.
  const d = distanceMetres({ lat: 40.0, lng: -74.0 }, { lat: 40.001, lng: -74.0 });
  assert.ok(Math.abs(d - 111.32) < 1, `latitude distance off: ${d}`);

  console.log(
    "presence OK — schema has no coordinate column, payload sends only a state, " +
      "no permission prompt, boundaries hold",
  );
} finally {
  rmSync(bundle, { force: true });
}
