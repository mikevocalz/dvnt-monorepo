/**
 * RC product-id map sync test.
 *
 * Run:
 *   node --import tsx --test apps/mobile/supabase/__tests__/rc-product-map.sync.test.ts
 *
 * The revenuecat-webhook edge function is Deno (URL imports) so this TS
 * harness can't import it. It keeps a hand-mirrored copy of
 * RC_PRODUCT_TO_PLAN_KEY from packages/app/lib/subscription/plans.ts; this
 * test parses the map literal out of the Deno source and asserts it equals
 * the plans.ts-derived map, so the mirror can't drift silently. No DB
 * required — pure source-vs-source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RC_PRODUCT_TO_PLAN_KEY } from "../../../../packages/app/lib/subscription/plans";

const here = path.dirname(fileURLToPath(import.meta.url));
const webhookSource = readFileSync(
  path.join(here, "../functions/revenuecat-webhook/index.ts"),
  "utf8",
);

function parseWebhookMapLiteral(): Record<string, string> {
  const match = webhookSource.match(
    /const RC_PRODUCT_TO_PLAN_KEY[^=]*=\s*\{([\s\S]*?)\};/,
  );
  assert.ok(
    match,
    "RC_PRODUCT_TO_PLAN_KEY literal not found in revenuecat-webhook/index.ts — " +
      "renamed? Update this test alongside it.",
  );
  const out: Record<string, string> = {};
  for (const entry of match![1].matchAll(
    /["']?([\w:]+)["']?\s*:\s*["']([\w]+)["']/g,
  )) {
    out[entry[1]] = entry[2];
  }
  return out;
}

test("Deno-local RC product map mirrors plans.ts RC_PRODUCT_TO_PLAN_KEY", () => {
  const webhookMap = parseWebhookMapLiteral();
  assert.ok(
    Object.keys(webhookMap).length > 0,
    "parsed an empty map — regex out of date?",
  );
  assert.deepEqual(webhookMap, RC_PRODUCT_TO_PLAN_KEY);
});

test("webhook derives plan_key via the normalizer, never verbatim", () => {
  // The old defect: `const planKey = ev.new_product_id ?? ev.product_id;`
  // passed Play's `dvnt_core:monthly` straight into the membership_plans FK.
  // Guard against the passthrough coming back.
  assert.ok(
    webhookSource.includes("planKeyFromRCProductId("),
    "revenuecat-webhook no longer calls planKeyFromRCProductId",
  );
  assert.ok(
    !/const planKey = ev\.new_product_id \?\? ev\.product_id;/.test(
      webhookSource,
    ),
    "identity passthrough of product_id as plan_key has returned",
  );
});
