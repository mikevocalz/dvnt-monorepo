#!/usr/bin/env node
/**
 * StoreKit config ↔ plan table lockstep.
 *
 * `apps/mobile/DVNT.storekit` exists so the Simulator can populate
 * `availablePackages` and the whole purchase rail can be proven BEFORE the
 * App Store Connect / Play / RevenueCat dashboard work lands. That only holds
 * if its product ids and prices match `lib/subscription/plans.ts` exactly — a
 * StoreKit file that disagrees with the plan table tests a fiction.
 *
 * By contract (plans.ts): `revenueCatProductId` equals the plan key and is the
 * App Store `store_identifier` verbatim. So plan key === product id, and this
 * checks precisely that, plus price agreement to the cent.
 *
 *   node scripts/verify-storekit.mjs
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
const bundle = join(root, "node_modules", ".verify-storekit.cjs");

try {
  execFileSync(
    join(root, "node_modules", ".bin", "esbuild"),
    [
      "packages/app/lib/subscription/plans.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--packages=external",
      `--outfile=${bundle}`,
      "--log-level=warning",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const { PLANS } = require(bundle);

  const storekit = JSON.parse(
    readFileSync(join(root, "apps/mobile/DVNT.storekit"), "utf8"),
  );
  const subs = storekit.subscriptionGroups.flatMap((g) => g.subscriptions);
  const byId = new Map(subs.map((s) => [s.productID, s]));

  // Every sellable plan must exist in the StoreKit file.
  const sellable = Object.values(PLANS).filter((p) => p.revenueCatProductId);
  assert.ok(sellable.length > 0, "no sellable plans found — plans.ts changed shape?");

  for (const plan of sellable) {
    const s = byId.get(plan.revenueCatProductId);
    assert.ok(
      s,
      `plan "${plan.key}" (product ${plan.revenueCatProductId}) is missing from DVNT.storekit — ` +
        `the Simulator would show an empty paywall for it`,
    );
    const expected = (plan.priceCents / 100).toFixed(2);
    assert.strictEqual(
      s.displayPrice,
      expected,
      `price drift for ${plan.key}: plans.ts says ${expected}, StoreKit says ${s.displayPrice}`,
    );
    // The contract in plans.ts: the RC product id IS the plan key.
    assert.strictEqual(
      plan.revenueCatProductId,
      plan.key,
      `plan "${plan.key}" breaks the "product id === plan key" contract`,
    );
  }

  // And nothing sellable in StoreKit that the app doesn't know about — an
  // orphan product id here means a purchase the entitlement resolver can't map.
  const known = new Set(sellable.map((p) => p.revenueCatProductId));
  for (const s of subs) {
    assert.ok(
      known.has(s.productID),
      `DVNT.storekit sells "${s.productID}" but no plan in plans.ts claims it — ` +
        `a purchase would resolve to no entitlement`,
    );
  }

  // Auto-renewable subscriptions only; a mis-typed product silently never renews.
  for (const s of subs) {
    assert.strictEqual(
      s.type,
      "RecurringSubscription",
      `${s.productID} is ${s.type}, expected RecurringSubscription`,
    );
    assert.ok(
      s.recurringSubscriptionPeriod,
      `${s.productID} has no recurringSubscriptionPeriod`,
    );
  }

  console.log(
    `storekit OK — ${subs.length} products across ` +
      `${storekit.subscriptionGroups.length} groups, ids + prices match plans.ts`,
  );
} finally {
  rmSync(bundle, { force: true });
}
