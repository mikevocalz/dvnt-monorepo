const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = fs.readFileSync(
  path.join(__dirname, "verified-sensitive-access.ts"),
  "utf8",
);

// Source-contract checks keep the cutoff and fail-closed rules visible in CI
// without adding another TS runtime just for Edge Function helpers.
assert.match(ts, /2026-07-01T00:00:00\.000Z/);
assert.match(ts, /legacy_grandfathered/);
assert.match(ts, /failureCode === "underage"/);
assert.match(ts, /failureCode === "duplicate_identity"/);
assert.match(ts, /status === "passed" && age\.allowed/);
assert.match(ts, /accountResult\?\.error && !base\.allowed/);
assert.match(ts, /restricted to real people only/);

console.log("verified-sensitive-access source contract: ok");
